require('dotenv').config();
const { Telegraf } = require('telegraf');
const { initializeFirebase } = require('../firebase-config');

// Initialize Firebase
const db = initializeFirebase();

// Initialize Telegram Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================== HELPER FUNCTIONS ====================

// Get today's date in YYYY-MM-DD format (Tashkent timezone)
const getTodayDate = () => {
    const offset = parseInt(process.env.TIMEZONE_OFFSET || 5);
    const now = new Date();
    now.setHours(now.getUTCHours() + offset);
    return now.toISOString().split('T')[0];
};

// Check if a group is registered
const isGroupRegistered = async (chatId) => {
    try {
        const groupDoc = await db.collection('groups').doc(String(chatId)).get();
        return groupDoc.exists && groupDoc.data()?.isActive;
    } catch (error) {
        console.error('Error checking group registration:', error.message);
        return false;
    }
};

// Get tracked user for a group
const getTrackedUser = async (chatId) => {
    try {
        const groupDoc = await db.collection('groups').doc(String(chatId)).get();
        if (groupDoc.exists) {
            return groupDoc.data()?.trackedUserId;
        }
        return null;
    } catch (error) {
        console.error('Error getting tracked user:', error.message);
        return null;
    }
};

// Get user's daily limit
const getUserDailyLimit = async (userId) => {
    try {
        const userDoc = await db.collection('users').doc(String(userId)).get();
        if (userDoc.exists) {
            return userDoc.data()?.dailyLimit || 10;
        }
        const settingsDoc = await db.collection('settings').doc('global').get();
        return settingsDoc.exists ? settingsDoc.data()?.defaultDailyLimit || 10 : 10;
    } catch (error) {
        console.error('Error getting daily limit:', error.message);
        return 10;
    }
};

// Get current count for user in group today
const getCurrentCount = async (groupId, userId, date) => {
    try {
        const statDoc = await db.collection('stats')
            .doc(date)
            .collection('groups')
            .doc(String(groupId))
            .get();

        if (statDoc.exists) {
            return statDoc.data()?.count || 0;
        }
        return 0;
    } catch (error) {
        console.error('Error getting current count:', error.message);
        return 0;
    }
};

// Increment video count
const incrementVideoCount = async (groupId, userId, userName) => {
    try {
        const date = getTodayDate();
        const statRef = db.collection('stats')
            .doc(date)
            .collection('groups')
            .doc(String(groupId));

        const statDoc = await statRef.get();
        const currentCount = statDoc.exists ? statDoc.data()?.count || 0 : 0;

        await statRef.set({
            userId: String(userId),
            userName: userName,
            count: currentCount + 1,
            lastUpdated: new Date(),
        }, { merge: true });

        return currentCount + 1;
    } catch (error) {
        console.error('Error incrementing video count:', error.message);
        return 0;
    }
};

// ==================== TELEGRAM BOT HANDLERS ====================

// Handle video_note messages
bot.on('video_note', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');

        const registered = await isGroupRegistered(chatId);
        if (!registered) return;

        const trackedUserId = await getTrackedUser(chatId);
        if (trackedUserId && String(userId).trim() !== String(trackedUserId).trim()) {
            console.log(`User ${userId} is not the tracked user (${trackedUserId}) for group ${chatId}`);
            return;
        }

        const dailyLimit = await getUserDailyLimit(userId);
        const date = getTodayDate();
        const currentCount = await getCurrentCount(chatId, userId, date);

        if (currentCount >= dailyLimit) return;

        const newCount = await incrementVideoCount(chatId, userId, userName);
        console.log(`Video note counted! Group: ${chatId}, User: ${userId}, Count: ${newCount}/${dailyLimit}`);

    } catch (error) {
        console.error('Error handling video_note:', error);
    }
});

// Bot start command
bot.command('start', (ctx) => {
    ctx.reply(
        `🎬 *RND SMART BOOT* - Video Note Counter Bot\n\n` +
        `Men guruhlardan video note (yumaloq video) xabarlarni hisoblash uchun yaratilganman.\n\n` +
        `📋 *Mavjud buyruqlar:*\n` +
        `/chatid - Guruh yoki chat ID sini olish\n` +
        `/myid - O'z Telegram ID ingizni olish\n` +
        `/info - To'liq ma'lumotlar (Chat + User)\n` +
        `/status - Bugungi statistikani ko'rish\n\n` +
        `_Guruhga qo'shib, admin qiling va video note yuborishni boshlang!_`,
        { parse_mode: 'Markdown' }
    );
});

// Bot status command
bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    const registered = await isGroupRegistered(chatId);

    if (registered) {
        const date = getTodayDate();
        const trackedUserId = await getTrackedUser(chatId);
        const currentCount = await getCurrentCount(chatId, trackedUserId, date);
        const dailyLimit = await getUserDailyLimit(trackedUserId);

        ctx.reply(
            `📊 *Bugungi statistika:*\n\n` +
            `📅 Sana: \`${date}\`\n` +
            `📹 Video soni: *${currentCount}/${dailyLimit}*\n` +
            `👤 Kuzatilayotgan User ID: \`${trackedUserId}\``,
            { parse_mode: 'Markdown' }
        );
    } else {
        ctx.reply(
            `❌ *Hato:* Bu guruh ro'yxatdan o'tmagan.\n\n` +
            `🆔 *Chat ID:* \`${chatId}\`\n` +
            `💡 _Guruhni Flutter dashboard orqali qo'shing._`,
            { parse_mode: 'Markdown' }
        );
    }
});

// Get Chat ID command
bot.command('chatid', (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Shaxsiy chat';

    ctx.reply(
        `📋 *Chat ma'lumotlari:*\n\n` +
        `🆔 *Chat ID:* \`${chatId}\`\n` +
        `📝 *Nomi:* ${chatTitle}\n` +
        `📦 *Turi:* ${chatType}\n\n` +
        `_Chat ID ni nusxalash uchun ustiga bosing_`,
        { parse_mode: 'Markdown' }
    );
});

// Get User ID command
bot.command('myid', (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
    const username = ctx.from.username ? `@${ctx.from.username}` : 'Yo\'q';

    ctx.reply(
        `👤 *Sizning ma'lumotlaringiz:*\n\n` +
        `🆔 *User ID:* \`${userId}\`\n` +
        `📝 *Ism:* ${userName}\n` +
        `🔗 *Username:* ${username}\n\n` +
        `_User ID ni nusxalash uchun ustiga bosing_`,
        { parse_mode: 'Markdown' }
    );
});

// Get both Chat ID and User ID
bot.command('info', (ctx) => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Shaxsiy chat';
    const userId = ctx.from.id;
    const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
    const username = ctx.from.username ? `@${ctx.from.username}` : 'Yo\'q';

    ctx.reply(
        `📊 *To'liq ma'lumotlar:*\n\n` +
        `━━━ 💬 *Chat* ━━━\n` +
        `🆔 Chat ID: \`${chatId}\`\n` +
        `📝 Nomi: ${chatTitle}\n` +
        `📦 Turi: ${chatType}\n\n` +
        `━━━ 👤 *Foydalanuvchi* ━━━\n` +
        `🆔 User ID: \`${userId}\`\n` +
        `📝 Ism: ${userName}\n` +
        `🔗 Username: ${username}`,
        { parse_mode: 'Markdown' }
    );
});

// ==================== API HANDLERS ====================

// Get all groups
const getGroups = async () => {
    const snapshot = await db.collection('groups').get();
    const groups = [];
    snapshot.forEach(doc => {
        groups.push({ id: doc.id, ...doc.data() });
    });
    return groups;
};

// Get all users
const getUsers = async () => {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
        users.push({ id: doc.id, ...doc.data() });
    });
    return users;
};

// Get today's stats
const getTodayStats = async () => {
    const date = getTodayDate();
    const snapshot = await db.collection('stats')
        .doc(date)
        .collection('groups')
        .get();

    const stats = [];
    for (const doc of snapshot.docs) {
        const groupDoc = await db.collection('groups').doc(doc.id).get();
        const groupData = groupDoc.data();

        stats.push({
            groupId: doc.id,
            groupName: groupData?.name || 'Unknown',
            ...doc.data(),
        });
    }
    return { date, stats };
};

// ==================== VERCEL HANDLER ====================

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const path = req.url;

    try {
        // Telegram Webhook
        if (path === '/webhook' || path === '/api/webhook') {
            if (req.method === 'POST') {
                await bot.handleUpdate(req.body);
                return res.status(200).json({ ok: true });
            }
            return res.status(200).json({ status: 'Webhook endpoint ready' });
        }

        // API Routes
        if (path.startsWith('/api/groups') || path === '/groups') {
            if (req.method === 'GET') {
                const groups = await getGroups();
                return res.status(200).json(groups);
            }
            if (req.method === 'POST') {
                const { chatId, name, trackedUserId } = req.body;
                await db.collection('groups').doc(String(chatId)).set({
                    chatId: String(chatId),
                    name,
                    trackedUserId: String(trackedUserId),
                    isActive: true,
                    createdAt: new Date(),
                });
                return res.status(200).json({ success: true, id: chatId });
            }
        }

        if (path.startsWith('/api/users') || path === '/users') {
            if (req.method === 'GET') {
                const users = await getUsers();
                return res.status(200).json(users);
            }
            if (req.method === 'POST') {
                const { telegramId, name, dailyLimit } = req.body;
                await db.collection('users').doc(String(telegramId)).set({
                    telegramId: String(telegramId),
                    name,
                    dailyLimit: dailyLimit || 10,
                    createdAt: new Date(),
                });
                return res.status(200).json({ success: true, id: telegramId });
            }
        }

        if (path.startsWith('/api/stats') || path === '/stats/today') {
            const stats = await getTodayStats();
            return res.status(200).json(stats);
        }

        if (path.startsWith('/api/settings') || path === '/settings') {
            if (req.method === 'GET') {
                const settingsDoc = await db.collection('settings').doc('global').get();
                if (settingsDoc.exists) {
                    return res.status(200).json(settingsDoc.data());
                }
                return res.status(200).json({ defaultDailyLimit: 10, timezone: 'UTC+5' });
            }
            if (req.method === 'PUT') {
                await db.collection('settings').doc('global').set(req.body, { merge: true });
                return res.status(200).json({ success: true });
            }
        }

        // Health check
        if (path === '/' || path === '/api') {
            return res.status(200).json({
                status: 'RND SMART BOOT API is running!',
                version: '1.0.0',
                endpoints: ['/api/groups', '/api/users', '/api/stats/today', '/api/settings', '/webhook']
            });
        }

        return res.status(404).json({ error: 'Not found' });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
