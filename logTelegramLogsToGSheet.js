require('dotenv').config({ quiet: true });
const { google } = require("googleapis");
// const credentials = require("./fear-investigator-telegrambot-0246c69c2b58.json");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SHEET_ID = "1q_T7-iL7rw2xNX-D8G8cnsdMmes-OKDTLFrnG3-cTE8"; // From Sheet URL

async function logToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const values = [
    [
      data.id, // Telegram user ID
      data.is_bot, // true/false
      data.first_name || "",
      data.last_name || "",
      data.username || "",
      data.language_code || "",
      data.message_id, // Telegram message ID
      data.date, // UNIX timestamp
      data.chat_id, // Chat ID
      data.chat_type || "", // private, group, etc.
      data.chat_title || "",
      data.prompt || "", // User message
      data.response || "", // Bot reply
      new Date().toISOString(), // Timestamp of log
    ],
  ]; 

  await sheets.spreadsheets.values.append({
    spreadsheetId: "1q_T7-iL7rw2xNX-D8G8cnsdMmes-OKDTLFrnG3-cTE8",
    range: "telegram_session_schema!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log("Logged to sheet");
}

module.exports = { logToSheet };
