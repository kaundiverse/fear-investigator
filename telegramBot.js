require("dotenv").config({ quiet: true });
const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const { logToSheet } = require("./logTelegramLogsToGSheet");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const baseSystemPrompt = `
You are Agent K, a no-nonsense executive coach working for the Fear Behavior Investigation Bureau (FBI). Your job is to question ambitious but stuck people and expose what’s holding them back.

You mix the tough love of:
- Jerry Colonna’s deep questions
- David Goggins’ mental toughness
- Benjamin Hardy’s future-self vision
- Andrew Huberman’s science-backed focus
- Dr. Julie Smith’s emotional sharpness

Your tone:
- 70% truth, 30% empathy
- No flattery
- No comforting
- Always challenge
- No therapy-talk. No motivational fluff.

RULES:
- Ask one strong question at a time, it should be as if the user’s life depends on the strong question
- Always wait for the user’s answer before asking the next.
- After each answer, go deeper with a sharper follow-up.
- Never repeat old questions.
- Keep questions in simple, layman’s language—easy to understand at first read.
- No long speeches—be clear, direct, and real.
- Don’t sound like a chatbot.

Sample questions to guide you:
“Are you letting fear run your life?”
“Why do you want to make your own problem worse?”
“What tough thing are you avoiding?” 
“What excuse keeps you stuck?”
“When will you stop waiting and start moving?”
"Don't you know you'll pay the price for your decisions? "
 
Your job is to:

1. Start with a bold question
2. Ask deeper questions for 6–9 replies
3. Then deliver, each on a new line:
    - Confrontation: [One punchy sentence calling them out]

    - Root Fear: [One sentence naming the fear]

    - Rule to Live By: [One clear new standard]

    - 7-Day Tactical Reset: [Give the full plan directly]
Do NOT deliver confrontation, root fear, rule, or 7-Day Reset until AFTER the user has answered at least 6 times. Before that, ONLY ask sharp questions.

You are not a chatbot. You are here to wake them up.
Begin.
`;
// ---- MODEL CHAIN (edit these IDs to match what your OpenRouter account has) ----
const MODEL_CHAIN = [
  "openai/gpt-4.1-nano",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/gpt-4.1",
  "anthropic/claude-3.5-sonnet",
  "cohere/command-r-plus",
];
// ---- Adapter registry (per-model request/normalize tweaks) ----
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_TIMEOUT = 20000;

// Startup sanity check
if (!API_KEY) {
  console.error(
    "ERROR: Missing OPENROUTER_API_KEY. Set it in your environment and restart the bot."
  );
  process.exit(1);
}

const adapters = {
  // default adapter: standard OpenRouter chat/completions
  default: (modelId, messages) => ({
    body: { model: modelId, messages },
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://t.me/fear_investigator_bot",
      "X-Title": "AgentK-FBI-Bot",
    },
    timeout: DEFAULT_TIMEOUT,
    normalize: (resp) => {
      // Try common response shapes
      const c = resp?.data;
      const text =
        c?.choices?.[0]?.message?.content ||
        c?.choices?.[0]?.text ||
        c?.output?.text ||
        c?.result ||
        "";
      return { text: String(text || "").trim(), raw: c };
    },
  }),

  // qwen coder tweak (example)
  "qwen/qwen3-coder:free": (modelId, messages) => {
    const base = adapters.default(modelId, messages);
    base.body = {
      ...base.body,
      // vendor-specific hints — tweak if model page shows different params
      mode: "coder",
      temperature: 0.15,
    };
    base.timeout = 15000;
    return base;
  },

  // Quasar long-context knob (example)
  "openrouter/quasar-alpha": (modelId, messages) => {
    const base = adapters.default(modelId, messages);
    base.body = {
      ...base.body,
      // example knob — replace with real param names if model page lists them
      context_window: 1000000,
      temperature: 0.2,
    };
    base.timeout = 60000;
    return base;
  },

  // GLM may prefer plain text messages
  "z-ai/glm-4.5-air": (modelId, messages) => {
    const base = adapters.default(modelId, messages);
    base.body.messages = messages.map((m) => ({
      role: m.role,
      content: String(m.content),
    }));
    base.timeout = 25000;
    return base;
  },
};

// fallback to default for models without a specific adapter
function getAdapter(modelId) {
  return adapters[modelId] || adapters.default;
}

// ---- Core: call a single model once using its adapter ----
async function callModelOnce(modelId, messages) {
  const adapter = getAdapter(modelId);
  const { body, headers, timeout, normalize } = adapter(modelId, messages);

  const resp = await axios.post(OPENROUTER_URL, body, { headers, timeout });
  return normalize(resp);
}

// ---- Fallback + retry/backoff ----
async function callWithFallback(
  messages,
  { models = MODEL_CHAIN, maxAttemptsPerModel = 2 } = {}
) {
  let lastErr = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        const { text, raw } = await callModelOnce(model, messages);
        // success
        return { text, raw, modelUsed: model };
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const headers = err.response?.headers || {};

        // Payment required -> skip this model immediately
        if (status === 402) {
          console.warn(`[${model}] 402 Payment required — skipping model`);
          break; // move to next model
        }

        // Rate limited -> respect Retry-After or exponential backoff with jitter
        if (status === 429) {
          const retryAfter = headers["retry-after"]
            ? parseInt(headers["retry-after"], 10) * 1000
            : null;
          const waitMs =
            retryAfter ??
            Math.min(30000, 1000 * Math.pow(2, attempt)) +
              Math.floor(Math.random() * 300);
          console.warn(
            `[${model}] 429 rate limited. Waiting ${waitMs}ms (attempt ${attempt})`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue; // retry same model
        }

        // Server errors -> retry after backoff
        if (status >= 500 && status < 600) {
          const waitMs = Math.min(20000, 1000 * Math.pow(2, attempt));
          console.warn(
            `[${model}] server error ${status}. Waiting ${waitMs}ms (attempt ${attempt})`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        // other client errors -> don't retry this model
        console.warn(
          `[${model}] non-retryable error or unknown error:`,
          status || err.message || err
        );
        break;
      }
    } // attempts for model
    console.warn(`Model ${model} exhausted attempts — trying next model.`);
  } // model chain

  // All models failed
  throw lastErr || new Error("All models failed");
}

// ---- Safety constants for locks ----
const LOCK_TIMEOUT_MS = 90_000; // safety unlock after 90s
let sessions = {}; // sessions[userId] = [{role, content}, ...]
let userLocks = {}; // userLocks[userId] = true|false

// ---- Telegram handlers ----

// Show "Start Investigation" button on any message
bot.on("text", async (ctx) => {
  const userId = ctx.chat.id;
  const text = ctx.message.text;

  // If no session yet, show the button and don't start
  if (!sessions[userId]) {
    await ctx.reply(
      `👋 Hey there! Welcome onboard    \n\n` +
        `This bot will helps you destroy your fears \n\n` +
        `Rules of Engagement:\n` +
        `1. Bot will ask One hard question at a time to unlock root cause of your fear\n` +
        `2. Answer one question with single reply. \n` +
        `3. Only your True answers will help you \n` +
        `4. After 6–9 answers → Bot will provide Confrontation | Root Fear | Life Rule | 7-Days Fear Reset Plan\n\n` +
        `⚠️ Disclaimer: Bot will be brutally honest\n\n` +
        `Click "🚨 Start Investigation" below ⬇️ to begin your journey.`,
      Markup.inlineKeyboard([
        Markup.button.callback("🚨 Start Investigation", "START_INVESTIGATION"),
      ])
    );
    return;
  }

  // If there's already an inflight request for this user, ask them to wait
  if (userLocks[userId]) {
    await ctx.reply(
      "⏳ Slow down — finishing the last step. Wait a moment and reply again."
    );
    return;
  }

  // Acquire lock immediately (atomic under Node single-thread)
  userLocks[userId] = true;

  // set safety unlock timer so lock won't be held forever
  const unlockTimer = setTimeout(() => {
    console.warn(
      `Safety unlock for user ${userId} fired after ${LOCK_TIMEOUT_MS}ms`
    );
    userLocks[userId] = false;
  }, LOCK_TIMEOUT_MS);

  // Push user message and handle it (handler must not set lock again)
  sessions[userId].push({ role: "user", content: text });

  try {
    await handleAgentKConversation(ctx, text);
  } finally {
    // ensure safety unlock cleaned and lock released
    clearTimeout(unlockTimer);
    userLocks[userId] = false;
  }
});

// Handle button press to start the flow
bot.action("START_INVESTIGATION", async (ctx) => {
  // answer callback to remove spinner in Telegram UI
  await ctx.answerCbQuery().catch(() => {});

  const userId = ctx.chat.id;
  sessions[userId] = [
    { role: "system", content: baseSystemPrompt },
    {
      role: "assistant",
      content: "What keeps you restless, no matter how much you push it aside?",
    },
  ];

  // ensure not locked
  userLocks[userId] = false;

  await ctx
    .editMessageText("Awesome! You’ve chosen to face your fear ")
    .catch(() => {});
  // no markdown (system rules forbid asterisks/markdown)
  await ctx.reply(sessions[userId][1].content);
});

async function handleAgentKConversation(ctx, userInput) {
  const userId = ctx.chat.id;

  // try {
  //   await ctx.sendChatAction('typing').catch(() => {});
  // } catch {}

  const userMessages = sessions[userId].filter((m) => m.role === "user");
  let extraInstruction = "";

  if (userMessages.length < 6) {
    extraInstruction =
      "Continue asking only sharp investigative questions. Do NOT reveal confrontation, fear, rule, or reset yet.";
  } else if (userMessages.length >= 6 && userMessages.length <= 9) {
    extraInstruction =
      "Now it’s time to deliver the final outcome. Provide Confrontation, Root Fear, Rule to Live By, and the full 7-Day Tactical Reset plan.";
  }

  const messagesForModel = [
    ...sessions[userId],
    { role: "system", content: extraInstruction },
  ];

  try {
    const { text: reply, modelUsed } = await callWithFallback(messagesForModel);

    if (!reply || !reply.trim()) throw new Error("Empty reply from model");

    sessions[userId].push({ role: "assistant", content: reply });
    await ctx.reply(reply);

    // end session once reset delivered
    if (reply.includes("7-Day Tactical Reset")) {
      delete sessions[userId];
    }
  } catch (err) {
    console.error(
      "OpenRouter call failed:",
      err?.response?.status,
      err?.message
    );
    await ctx.reply("⚠️ Something went wrong. Try again in a moment.");
  }
}

// ---- TODO (future): implement process-level auto-restart on crash
// For now we will not implement server restart logic — keep for next iteration.
// Suggestion later: use PM2 or systemd or Docker restart policies; OR implement a tiny watchdog process.

// Launch bot
bot
  .launch()
  .then(() => {
    console.log("\n🧠 Agent K is live \n");
  })
  .catch((err) => {
    console.error("❌ Bot launch failed:", err);
    process.exit(1);
  });

// graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
