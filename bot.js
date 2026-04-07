const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.com';

if(!token){
  console.log('Warning: TELEGRAM_BOT_TOKEN not set. Bot will not run.');
  process.exit(0);
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Open Demo Broker', web_app: { url: WEBAPP_URL } }
      ]]
    }
  };
  bot.sendMessage(chatId, 'Открыть демо брокера (Kasper Coin)', opts);
});

console.log('Bot started (polling)');
