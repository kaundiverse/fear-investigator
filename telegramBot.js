require("dotenv").config({ quiet: true });
const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const { logToSheet } = require("./logTelegramLogsToGSheet");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let sessions = {};

const baseSystemPrompt = `
You are Agent K, a no-nonsense executive coach working for the Fear Behavior Investigation Bureau (FBI). Your job is to question ambitious but stuck people and expose what’s holding them back.

You are concise. Always respond in no more than 3 sentences. Use brevity. Never ask more than one question per reply.

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
- Ask just ONE strong question at a time 
- Wait for the answer before asking the next
- After every answer, go deeper with a sharper follow-up
- Never repeat old questions
- No asterisks or markdown in your system messages
- Speak like a real coach, not a chatbot
- No long speeches. Keep it clear. Keep it real.
- MOST IMPORTANT: Keep the language simple and layman. Reply should be understandable within the first read.

Sample questions to guide you:
- “How are you helping create the very problem you say you hate?”
- “What hard thing are you skipping because it scares you?”
- “What story are you using as an excuse to stay stuck?”
- “Who wins when you stay small?”
- “Are you negotiating with fear?”

Your job is to:
1. Start with one bold question.
2. Ask deeper follow-up questions for 6–9 total exchanges. Never go beyond 9.
3. After the final exchange, conclude by delivering:
   - Confrontation: [One punchy sentence calling them out]
   - Root Fear: [One sentence naming the fear]
   - Rule to Live By: [One clear new standard]
4. Then ask: “Want the 7-Day Tactical Reset?” If yes, send it.

You are not a chatbot. You are here to wake them up.
Begin.
`;

function cleanReply(text) {
  return (
    text
      // remove any `Command: "..."` lines
      .replace(/^\s*Command:\s*".*?"\s*$/gim, "")
      // remove any `"command": "__...__"`
      .replace(/"command":\s*"__.*?__"/g, "")
      // remove inline citations like word123 or end-of-sentence123
      .replace(/(\w+)\d+/g, "$1") // "non-negotiable145" → "non-negotiable"
      .replace(/([?.!,])\d+/g, "$1") // "minutes14?" → "minutes?"
      // remove bracket-style citations like [14] or (145)
      .replace(/\[\d+\]|\(\d+\)/g, "")
      // add a newline after every full stop if followed by space+capital letter
      .replace(/\. +(?=[A-Z])/g, ".\n\n")
      .trim()
  );
}


// 🚀 Main user text handler
bot.on("text", async (ctx) => {
  const userId = ctx.chat.id;
  const text = ctx.message.text.trim();

  if (!sessions[userId]) {
    return ctx.reply(
      `I'm Agent K. You’ve triggered an emotional investigation.`,
      Markup.inlineKeyboard([
        Markup.button.callback("🚨 Start Investigation", "START_INVESTIGATION"),
      ])
    );
  }

  sessions[userId].push({ role: "user", content: text });
  await handleAgentKConversation(ctx, text);
});

// 🎬 Start button handler
bot.action("START_INVESTIGATION", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.chat.id;

  sessions[userId] = [
    { role: "system", content: baseSystemPrompt },
    {
      role: "assistant",
      content:
        "Let’s get to it. What’s one thing you’ve been avoiding — not because it’s hard, but because it shakes you?",
    },
  ];

  await ctx.editMessageText("🕵️ Investigation started.");
  await ctx.reply(sessions[userId][1].content, { parse_mode: "Markdown" });
});

// 🧠 Core convo handler
async function handleAgentKConversation(ctx, userInput) {
  // console.log("Incoming Context:", ctx);
  console.log("User Input:", userInput);

  const { message } = ctx.update; // Telegram update payload
  const { from, chat, message_id, date, text } = message;

  const userId = chat.id;

  const logData = {
    id: from.id,
    is_bot: from.is_bot,
    first_name: from.first_name || "",
    last_name: from.last_name || "",
    username: from.username || "",
    language_code: from.language_code || "",
    message_id,
    date: new Date(date * 1000).toISOString(),
    chat_id: chat.id,
    chat_type: chat.type,
    chat_title: chat.title || "",
    text: userInput || text || "",
    bot_response: "",
  };

  try {
    // ✅ Count number of turns so far (user + assistant)
    const exchanges = (sessions[userId] || []).filter(
      (m) => m.role === "user" || m.role === "assistant"
    ).length;

    // ✅ Initialize session if new
    if (!sessions[userId]) {
      sessions[userId] = [{ role: "system", content: baseSystemPrompt }];
    }

    // ✅ If we’ve reached 9 rounds (18 messages), push concluding instruction
    if (exchanges >= 18) {
      sessions[userId].push({
        role: "user",
        content: `The user just said: "${userInput}"

Now conclude the coaching session.

Deliver:
- Confrontation: [One punchy sentence calling them out]
- Root Fear: [One sentence naming the fear]
- Rule to Live By: [One clear new standard]
Then ask: "Want the 7-Day Tactical Reset?"`,
      });
    } else {
      // Normal flow: just push user’s message
      sessions[userId].push({ role: "user", content: userInput });
    }

    // Call your model
    let res = await trySonarModels(userId);
    console.log("Sonar Response:", res.data);

    const reply = cleanReply(res.data.choices?.[0]?.message?.content || "");
    if (!reply) throw new Error("Empty reply from Sonar API");

    logData.bot_response = reply;

    // Command recognition
    if (/__RESET_ACCEPTED__/.test(reply)) {
      await ctx.reply(
        `🔥 *Here’s your 7-Day Tactical Reset Plan:*\n\n1. Own your fear in writing  \n2. Do one thing you’re avoiding  \n3. Voice the hard truth to someone  \n4. Plan your week like you mean it  \n5. Face a rejection on purpose  \n6. Say no to one “should”  \n7. Move your body and commit again`,
        { parse_mode: "Markdown" }
      );
      delete sessions[userId];
      return;
    }

    if (/__RESET_COMPLETE__|__END__/.test(reply)) {
      delete sessions[userId];
      return ctx.reply("🛑 Session closed. Type anything to start again.");
    }

    if (/__START_INVESTIGATION__/.test(reply)) {
      delete sessions[userId];
      return ctx.reply(
        "Session ended. Ready to begin again?",
        Markup.inlineKeyboard([
          Markup.button.callback(
            "🧠 Start Investigation",
            "START_INVESTIGATION"
          ),
        ])
      );
    }

    // Normal conversation flow
    if (!sessions[userId]) sessions[userId] = [];
    sessions[userId].push({ role: "assistant", content: reply });

    await ctx.reply(reply, { parse_mode: "Markdown" });
    await logToSheet(logData);
  } catch (err) {
    console.error("Agent K Error:", err.message);

    if (err.code === "ECONNABORTED") {
      return ctx.reply("⚠️ Request timed out. Please try again.");
    }
    if (err.response?.status === 401) {
      return ctx.reply("⚠️ Invalid Perplexity API key.");
    }
    if (err.response?.status === 429) {
      return ctx.reply("⚠️ Rate limit hit. Wait and retry.");
    }
    return ctx.reply("⚠️ Something went wrong. Try again later.");
  }
}

// 🔁 Try sonar-pro, fallback to sonar
// Replace your trySonarModels with this version
async function trySonarModels(userId) {
  const headers = {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  };

  // Helper to sanitize, cap and fix alternation (merge assistant after system)
  function buildMessagesFromSession(sessArr = []) {
    const MAX_MESSAGES = 20;
    // clone to avoid mutating original
    const arr = Array.isArray(sessArr) ? sessArr.slice() : [];

    // Ensure each item is simple {role, content}
    const normalized = arr.map((m) => ({
      role: m && m.role ? String(m.role) : "user",
      content: m && typeof m.content !== "undefined" ? String(m.content) : "",
    }));

    // If the first non-system message is assistant, merge it into the system prompt (preserve it)
    // Find first index that is not 'system'
    const firstNonSystemIdx = normalized.findIndex((m) => m.role !== "system");
    if (
      firstNonSystemIdx >= 0 &&
      normalized[firstNonSystemIdx].role === "assistant"
    ) {
      // Merge assistant content into the last system message (or create one)
      const assistantContent = normalized[firstNonSystemIdx].content;
      // If there is at least one system message, append; otherwise create one
      const lastSystemIdx = normalized
        .slice(0, firstNonSystemIdx)
        .reverse()
        .findIndex((m) => m.role === "system");
      if (lastSystemIdx !== -1) {
        // find actual index of last system message within slice
        const idx = firstNonSystemIdx - 1 - lastSystemIdx;
        normalized[
          idx
        ].content = `${normalized[idx].content}\n\n[assistant starter preserved]\n${assistantContent}`;
      } else {
        // no system message found before; create one at front
        normalized.unshift({
          role: "system",
          content: `[assistant starter preserved]\n${assistantContent}`,
        });
      }
      // remove the original assistant starter entry
      normalized.splice(firstNonSystemIdx, 1);
    }

    // Now ensure alternating sequence: collapse any consecutive same-role messages by concatenation
    const collapsed = [];
    for (const m of normalized) {
      if (!m || typeof m.role !== "string") continue;
      const role = m.role;
      let content = String(m.content || "");
      // truncate long messages to keep payload sane
      if (content.length > 15000)
        content = content.slice(0, 15000) + "\n\n[truncated]";
      if (collapsed.length === 0) {
        collapsed.push({ role, content });
      } else {
        const last = collapsed[collapsed.length - 1];
        if (last.role === role) {
          // combine same-role entries with a divider
          last.content = `${last.content}\n\n---\n\n${content}`;
        } else {
          collapsed.push({ role, content });
        }
      }
    }

    // Keep last MAX_MESSAGES entries (preserving order)
    const start = Math.max(0, collapsed.length - MAX_MESSAGES);
    return collapsed.slice(start);
  }

  const messages = buildMessagesFromSession(sessions[userId] || []);
  const payload = {
    model: "sonar-pro",
    messages,
  };

  try {
    console.log(
      "==> Sending Perplexity payload (model: sonar-pro). messageCount=",
      messages.length
    );
    console.log("==> payload JSON length:", JSON.stringify(payload).length);

    const sonarAPIRes = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      payload,
      {
        headers,
        timeout: 15_000,
      }
    );
    return sonarAPIRes;
  } catch (err) {
    console.error("Perplexity API error: status=", err.response?.status);
    console.error(
      "Perplexity API error data:",
      JSON.stringify(err.response?.data || err.message, null, 2)
    );

    const messageLower = (
      err.response?.data?.error?.message || ""
    ).toLowerCase();

    if (
      err.response?.status === 400 &&
      (messageLower.includes("invalid model") ||
        messageLower.includes("unsupported") ||
        messageLower.includes("model"))
    ) {
      console.warn(
        "⚠️ sonar-pro unsupported/invalid. Falling back to sonar..."
      );
      payload.model = "sonar";
      try {
        const fallbackRes = await axios.post(
          "https://api.perplexity.ai/chat/completions",
          payload,
          {
            headers,
            timeout: 15_000,
          }
        );
        return fallbackRes;
      } catch (err2) {
        console.error(
          "Perplexity fallback error:",
          JSON.stringify(err2.response?.data || err2.message, null, 2)
        );
        throw err2;
      }
    }

    // If other 400-type error (like invalid_message), rethrow so handleAgentKConversation can surface it
    throw err;
  }
}

bot.launch();
console.log("\n🧠 Agent K is live and ready to interrogate.\n");

// // 1. Text handler: either show start button or forward to conversation handler
// bot.on('text', async (ctx) => {
//   const userId = ctx.chat.id;
//   const text = ctx.message.text.trim();

//   // No session: prompt to start
//   if (!sessions[userId]) {
//     await ctx.reply(
//       `I'm Agent K. You’ve triggered an emotional investigation.`,
//       Markup.inlineKeyboard([
//         Markup.button.callback('🚨 Start Investigation', 'START_INVESTIGATION'),
//       ])
//     );
//     return;
//   }

//   // Session exists: record user message
//   sessions[userId].push({ role: 'user', content: text });
//   await handleAgentKConversation(ctx, text);
// });

// // 2. Button handler: initialize session and send first question
// bot.action('START_INVESTIGATION', async (ctx) => {
//   await ctx.answerCbQuery();
//   const userId = ctx.chat.id;

//   sessions[userId] = [
//     { role: 'system', content: baseSystemPrompt },
//     {
//       role: 'assistant',
//       content: "Let’s get to it. What’s one thing you’ve been avoiding — not because it’s hard, but because it shakes you?",
//     },
//   ];

//   await ctx.editMessageText('🕵️ Investigation started.');
//   await ctx.reply(sessions[userId][1].content, { parse_mode: 'Markdown' });
// });

// // 3. Core conversation & Sonar‑Pro API integration
// async function handleAgentKConversation(ctx, userInput) {
//   const userId = ctx.chat.id;
//   const msg = ctx.message;
//   const { from, chat, message_id, date } = msg;

//   // Prepare log data
//   const logData = {
//     id: from.id,
//     is_bot: from.is_bot,
//     first_name: from.first_name || '',
//     last_name: from.last_name || '',
//     username: from.username || '',
//     language_code: from.language_code || '',
//     message_id,
//     date: new Date(date * 1000).toISOString(),
//     chat_id: chat.id,
//     chat_type: chat.type,
//     chat_title: chat.title || '',
//     text: userInput,
//     bot_response: '',
//   };

//   try {
//     // Call Perplexity Sonar‑Pro
//     const res = await axios.post(
//       'https://api.perplexity.ai/chat/completions',
//       {
//         model: 'sonar-pro',
//         messages: sessions[userId],
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
//           'Content-Type': 'application/json',
//         },
//         timeout: 10000,
//       }
//     );

//     // Validate response
//     const choice = res.data.choices?.[0];
//     if (!choice?.message?.content) {
//       throw new Error('Invalid Sonar‑Pro response');
//     }

//     let reply = choice.message.content.trim();
//     logData.bot_response = reply;

//     // Detect internal commands
//     const isResetAccepted = /__RESET_ACCEPTED__/.test(reply);
//     const isResetDone    = /__RESET_COMPLETE__|__END__/.test(reply);
//     const isRestart      = /__START_INVESTIGATION__/.test(reply);

//     // Strip any command tokens before showing to user
//     reply = reply
//       .replace(/^\s*Command:\s*".*?"\s*$/gim, '')
//       .replace(/"command":\s*"__.*?__"/g, '')
//       .trim();

//     // Handle commands
//     if (isResetAccepted) {
//       await ctx.reply(
//         `🔥 *Here’s your 7‑Day Tactical Reset Plan:*

// 1. Own your fear in writing
// 2. Do one thing you’re avoiding
// 3. Voice the hard truth to someone
// 4. Plan your week like you mean it
// 5. Face a rejection on purpose
// 6. Say no to one “should”
// 7. Move your body and commit again`,
//         { parse_mode: 'Markdown' }
//       );
//       delete sessions[userId];
//       return;
//     }

//     if (isResetDone) {
//       delete sessions[userId];
//       await ctx.reply('🛑 Session closed. Type anything to start again.');
//       return;
//     }

//     if (isRestart) {
//       delete sessions[userId];
//       await ctx.reply(
//         'Session ended. Ready to begin again?',
//         Markup.inlineKeyboard([
//           Markup.button.callback('🧠 Start Investigation', 'START_INVESTIGATION'),
//         ])
//       );
//       return;
//     }

//     // Normal flow: record and send
//     sessions[userId].push({ role: 'assistant', content: reply });
//     await ctx.reply(reply, { parse_mode: 'Markdown' });
//     await logToSheet(logData);

//     // Auto‑end if user asked for reset in text
//     if (reply.toLowerCase().includes('7‑day tactical reset')) {
//       delete sessions[userId];
//     }
//   } catch (err) {
//     console.error('Sonar‑Pro API Error:', err.message);
//     if (err.code === 'ECONNABORTED') {
//       await ctx.reply('⚠️ Request timed out. Please try again.');
//     } else if (err.response?.status === 401) {
//       await ctx.reply('⚠️ Configuration error: invalid API key.');
//     } else if (err.response?.status === 429) {
//       await ctx.reply('⚠️ Rate limit hit. Please wait a moment.');
//     } else {
//       await ctx.reply('⚠️ Something went wrong. Please try again later.');
//     }
//   }
// }

// bot.launch();
// console.log('\n🧠 Agent K is live and ready to interrogate.\n');
