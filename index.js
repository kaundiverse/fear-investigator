const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Agent K is operational.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start the bot logic
require('./telegramBot');


