require('dotenv').config({ quiet: true });
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { logToSheet } = require('./logTelegramLogsToGSheet');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

let sessions = {};



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
- Ask just ONE strong question at a time
- Wait for the answer before asking the next
- After every answer, go deeper with a sharper follow-up
- Never repeat old questions
- No asterisks or markdown
- Speak like a real coach, not a chatbot
- No long speeches. Keep it clear. Keep it real.

Sample questions to guide you:
- “How are you helping create the very problem you say you hate?”
- “What hard thing are you skipping because it scares you?”
- “What story are you using as an excuse to stay stuck?”
- “Who wins when you stay small?”
- “Are you negotiating with fear?”

Your job is to:
1. Start with a bold question
2. Ask deeper questions for 6–9 replies
3. Then deliver:
   - Confrontation: [One punchy sentence calling them out]
   - Root Fear: [One sentence naming the fear]
   - Rule to Live By: [One clear new standard]
4. Ask: “Want the 7-Day Tactical Reset?” If yes, send it.

You are not a chatbot. You are here to wake them up.
Begin.
`;




bot.start((ctx) => {
  const userId = ctx.chat.id;
  sessions[userId] = [
    { role: "system", content: baseSystemPrompt },
    {
      role: "assistant",
      content: "Welcome. I'm Agent K. You're under emotional investigation.\n\nWhat’s one thing you’re avoiding — not because it’s hard, but because it scares you?",
    },
  ];
  ctx.reply(sessions[userId][1].content);
});


bot.on("text", async (ctx) => {
  const userId = ctx.chat.id;
  const userInput = ctx.message.text;

  if (!sessions[userId]) sessions[userId] = [];
  sessions[userId].push({ role: "user", content: userInput });

  // Extract metadata from ctx.message
  const msg = ctx.message;
  const from = msg.from;
  const chat = msg.chat;
  const reply_to_message = msg.reply_to_message;


const logData = {
  id: from.id,
  is_bot: from.is_bot,
  first_name: from.first_name || "",
  last_name: from.last_name || "",
  username: from.username || "",
  language_code: from.language_code || "",
  message_id: msg.message_id,
  date: new Date(msg.date * 1000).toISOString(),
  chat_id: chat.id,
  chat_type: chat.type,
  chat_title: chat.title || "",
  text: userInput,
  reply_to_message: reply_to_message?.text || "",
  bot_response: "", // to be updated after LLM response
};

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "deepseek/deepseek-chat-v3-0324:free",
        messages: sessions[userId],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://t.me/fear_investigator_bot',
          'X-Title': 'AgentK-FBI-Bot'
        }
      }
    );

    const reply = response.data.choices[0].message.content.replace(/\*{1,2}([^*]+?)\*{1,2}/g, '$1');;
    sessions[userId].push({ role: "assistant", content: reply });
    logData.bot_response = reply;

    await ctx.reply(reply);

    

    // Store to Google Sheet (you can log headers separately)
    await logToSheet(logData);
  } catch (err) {
    console.error("API Error index:", err.message);
    await ctx.reply("Too many requests in free trial. Please try in some time later.");
  }
});

bot.launch();
console.log("\n🧠 Agent K powered by Deepseek is live.\n");
