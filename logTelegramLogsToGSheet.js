const { google } = require("googleapis");
const credentials = require("./fear-investigator-telegrambot-0246c69c2b58.json");

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SHEET_ID = "1q_T7-iL7rw2xNX-D8G8cnsdMmes-OKDTLFrnG3-cTE8"; // From Sheet URL

async function logToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const values = [[
    data.id,
    data.is_bot,
    data.first_name || "",
    data.last_name || "",
    data.username || "",
    data.language_code || "",
    data.message_id,
    data.date,
    data.chat_id,
    data.chat_type || "",
    data.chat_title || "",
    data.text || "",             // <-- changed from data.prompt
    data.bot_response || "",     // <-- changed from data.response
    new Date().toISOString(),    // logging timestamp
  ]];

 

  await sheets.spreadsheets.values.append({
    spreadsheetId: "1q_T7-iL7rw2xNX-D8G8cnsdMmes-OKDTLFrnG3-cTE8",
    range: "telegram_session_schema!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log("Logged to sheet");
}

module.exports = { logToSheet };
