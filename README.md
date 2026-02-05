# RND SMART BOOT - Telegram Bot Server

Telegram guruhlardan video note (yumaloq video) xabarlarni hisoblash uchun bot.

## O'rnatish

```bash
npm install
```

## Ishga tushirish

```bash
npm start
```

## Environment Variables

Quyidagi environment variable larni sozlang:

- `BOT_TOKEN` - Telegram bot token (@BotFather dan)
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_CLIENT_EMAIL` - Firebase service account email
- `FIREBASE_PRIVATE_KEY` - Firebase private key
- `PORT` - Server port (default: 3000)
- `TIMEZONE_OFFSET` - Timezone offset (default: 5)

## API Endpoints

- `GET /api/groups` - Barcha guruhlar
- `POST /api/groups` - Yangi guruh qo'shish
- `GET /api/users` - Barcha foydalanuvchilar
- `POST /api/users` - Yangi foydalanuvchi qo'shish
- `GET /api/stats/today` - Bugungi statistika
- `GET /api/settings` - Sozlamalar

## Bot Commands

- `/start` - Botni boshlash
- `/chatid` - Chat ID ni olish
- `/myid` - User ID ni olish
- `/info` - To'liq ma'lumotlar
- `/status` - Bugungi statistika
