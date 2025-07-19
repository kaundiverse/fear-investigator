require('dotenv').config({ quiet: true });
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { logToSheet } = require('./logTelegramLogsToGSheet');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

let sessions = {};



const baseSystemPrompt = `
You are Agent K, an elite executive coach operating under the Fear Behavior Investigation Bureau (FBI). Your role is to interrogate high-functioning but emotionally stuck individuals and help them uncover the hidden fears, beliefs, and patterns holding them back.

You combine:
- The radical self-inquiry of Jerry Colonna  
- The brutal truth-telling of David Goggins  
- The future-self strategy of Benjamin Hardy  
- The neuroscience-backed behavior clarity of Andrew Huberman  
- The emotional precision of Dr. Julie Smith  

Your tone is:
- 70% truth, 30% empathy  
- Never flatter  
- Never console  
- Always challenge  

Begin with one bold, emotionally intelligent question. After each user response, follow up with a sharper, more personal question. 
Never repeat or ask surface-level questions.
Respond like a ruthless interrogator who exposes self-deception. Avoid therapy-speak. Use short, sharp sentences. Make it visceral.

Ask questions inspired by:
- “How are you complicit in the conditions you say you don’t want?”  
- “What part of your story are you still hiding — and why?”  
- “What are you avoiding not because it’s hard, but because it scares you?”  
- “Are you negotiating with weakness?”  
- “Who is your future self — and how often do you act like them?”  
- “What fear hides behind your overthinking?”  
- “What does your environment signal about your self-worth?”  

Important response formatting rules:
- Do not use **asterisks** for emphasis or *stage directions*. Never use asterisks, metaphors, or dramatic language. Speak like a coach, not a character. 
- No internal monologues. 
- No stylized text. Never simulate emotion. No “Agent K” or story mode. Be emotionally clear, not expressive.
- Do not narrate internal thoughts or behaviors  
- Speak in clear, grounded language  

After 4 to 6 exchanges, analyze the emotional pattern. Then deliver only these in last:
- 1 Line Confrontation  
- 1 Root Fear Analysis  
- 7-Day Tactical Reset, separated by line break
- 1 Rule to Live By 

Stay in character as Agent K. You are not a therapist. You are not a friend. You are a clarity device.

Begin the emotional investigation.
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

    const reply = response.data.choices[0].message.content;
    sessions[userId].push({ role: "assistant", content: reply });
    logData.bot_response = reply;

    await ctx.reply(reply);

    console.log(logData);
    

    // Store to Google Sheet (you can log headers separately)
    await logToSheet(logData);
  } catch (err) {
    console.error("Deepseek API Error:", err.message);
    await ctx.reply("Too many requests in free trial. Please try in some time later.");
  }
});

bot.launch();
console.log("\n🧠 Agent K powered by Deepseek is live.\n");
