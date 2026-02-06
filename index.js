require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { initializeFirebase } = require('./firebase-config');

// Initialize Firebase
const db = initializeFirebase();

// Initialize Telegram Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

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

        // Get default limit from settings
        const settingsDoc = await db.collection('settings').doc('global').get();
        return settingsDoc.exists ? settingsDoc.data()?.defaultDailyLimit || 10 : 10;
    } catch (error) {
        console.error('Error getting daily limit:', error.message);
        return 10; // Default limit
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

// Common handler for video messages
const handleVideoMessage = async (ctx, videoType) => {
    try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');

        // Check if group is registered
        const registered = await isGroupRegistered(chatId);
        if (!registered) {
            console.log(`Group ${chatId} is not registered`);
            return;
        }

        // Check if this user is being tracked
        const trackedUserId = await getTrackedUser(chatId);
        if (trackedUserId && String(userId).trim() !== String(trackedUserId).trim()) {
            console.log(`User ${userId} is not the tracked user (${trackedUserId}) for group ${chatId}`);
            return;
        }

        // Get user's daily limit
        const dailyLimit = await getUserDailyLimit(userId);

        // Get current count
        const date = getTodayDate();
        const currentCount = await getCurrentCount(chatId, userId, date);

        // Check if limit reached
        if (currentCount >= dailyLimit) {
            console.log(`User ${userId} reached daily limit (${dailyLimit}) in group ${chatId}`);
            return;
        }

        // Increment count
        const newCount = await incrementVideoCount(chatId, userId, userName);
        console.log(`${videoType} counted! Group: ${chatId}, User: ${userId}, Count: ${newCount}/${dailyLimit}`);

    } catch (error) {
        console.error(`Error handling ${videoType}:`, error);
    }
};

// Handle video_note messages (round videos)
bot.on('video_note', async (ctx) => {
    await handleVideoMessage(ctx, 'Video note');
});

// Handle regular video messages
bot.on('video', async (ctx) => {
    await handleVideoMessage(ctx, 'Video');
});

// Bot start command
bot.command('start', (ctx) => {
    ctx.reply(
        `🎬 *RND SMART BOOT* - Video Counter Bot\n\n` +
        `Men guruhlardan video xabarlarni hisoblash uchun yaratilganman.\n\n` +
        `📋 *Mavjud buyruqlar:*\n` +
        `/chatid - Guruh yoki chat ID sini olish\n` +
        `/myid - O'z Telegram ID ingizni olish\n` +
        `/info - To'liq ma'lumotlar (Chat + User)\n` +
        `/status - Bugungi statistikani ko'rish\n\n` +
        `_Guruhga qo'shib, admin qiling va video yuborishni boshlang!_`,
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

// ==================== REST API ENDPOINTS ====================

// Get all groups
app.get('/api/groups', async (req, res) => {
    try {
        const snapshot = await db.collection('groups').get();
        const groups = [];
        snapshot.forEach(doc => {
            groups.push({ id: doc.id, ...doc.data() });
        });
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new group
app.post('/api/groups', async (req, res) => {
    try {
        const { chatId, name, trackedUserId } = req.body;
        await db.collection('groups').doc(String(chatId)).set({
            chatId: String(chatId),
            name,
            trackedUserId: String(trackedUserId),
            isActive: true,
            createdAt: new Date(),
        });
        res.json({ success: true, id: chatId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update group
app.put('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        await db.collection('groups').doc(id).update(updateData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete group
app.delete('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('groups').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await db.collection('users').get();
        const users = [];
        snapshot.forEach(doc => {
            users.push({ id: doc.id, ...doc.data() });
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new user
app.post('/api/users', async (req, res) => {
    try {
        const { telegramId, name, dailyLimit } = req.body;
        await db.collection('users').doc(String(telegramId)).set({
            telegramId: String(telegramId),
            name,
            dailyLimit: dailyLimit || 10,
            createdAt: new Date(),
        });
        res.json({ success: true, id: telegramId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user
app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        await db.collection('users').doc(id).update(updateData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('users').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get today's stats
app.get('/api/stats/today', async (req, res) => {
    try {
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

        res.json({ date, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get stats by date
app.get('/api/stats/:date', async (req, res) => {
    try {
        const { date } = req.params;
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

        res.json({ date, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get global settings
app.get('/api/settings', async (req, res) => {
    try {
        const settingsDoc = await db.collection('settings').doc('global').get();
        if (settingsDoc.exists) {
            res.json(settingsDoc.data());
        } else {
            res.json({ defaultDailyLimit: 10, timezone: 'UTC+5' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update global settings
app.put('/api/settings', async (req, res) => {
    try {
        const updateData = req.body;
        await db.collection('settings').doc('global').set(updateData, { merge: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SCHEDULES API ====================

// Get all schedules
app.get('/api/schedules', async (req, res) => {
    try {
        const snapshot = await db.collection('schedules').get();
        const schedules = [];
        snapshot.forEach(doc => {
            schedules.push({ id: doc.id, ...doc.data() });
        });
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new schedule
app.post('/api/schedules', async (req, res) => {
    try {
        const { userId, userName, times, isActive } = req.body;
        const docRef = await db.collection('schedules').add({
            userId: String(userId),
            userName,
            times: times || [],
            isActive: isActive !== false,
            createdAt: new Date(),
        });
        res.json({ success: true, id: docRef.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update schedule
app.put('/api/schedules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        await db.collection('schedules').doc(id).update(updateData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete schedule
app.delete('/api/schedules/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('schedules').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== REMINDER HELPER ====================

// Send reminder message to user via DM
const sendReminderToUser = async (telegramId, userName) => {
    const message =
        `Assalomu alaykum, ${userName} ustoz.\n\n` +
        `Iltimos, guruhingiz bo'yicha yo'qlama qiling.\n` +
        `Shuningdek, ota-onalar guruhiga video xabar yuborish vaqti keldi.\n\n` +
        `Agar bugun yaqin vaqtda darsingiz bo'lmasa,\n` +
        `@SanjarbekFayzullayev ga murojaat qiling.`;

    try {
        await bot.telegram.sendMessage(telegramId, message);
        console.log(`✅ Reminder sent to user ${telegramId} (${userName})`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send reminder to ${telegramId}:`, error.message);
        return false;
    }
};

// Get current time in HH:MM format (Tashkent timezone)
const getCurrentTime = () => {
    const offset = parseInt(process.env.TIMEZONE_OFFSET || 5);
    const now = new Date();
    now.setHours(now.getUTCHours() + offset);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};

// ==================== CRON JOBS ====================

// Check schedules every minute and send reminders
cron.schedule('* * * * *', async () => {
    const currentTime = getCurrentTime();
    console.log(`[${getTodayDate()} ${currentTime}] Checking schedules...`);

    try {
        const snapshot = await db.collection('schedules')
            .where('isActive', '==', true)
            .get();

        for (const doc of snapshot.docs) {
            const schedule = doc.data();
            if (schedule.times && schedule.times.includes(currentTime)) {
                console.log(`⏰ Time match! Sending reminder to ${schedule.userName}`);
                await sendReminderToUser(schedule.userId, schedule.userName);
            }
        }
    } catch (error) {
        console.error('Error checking schedules:', error.message);
    }
}, {
    timezone: 'Asia/Tashkent'
});

// Daily reset notification (optional - for logging purposes)
cron.schedule('0 0 * * *', () => {
    console.log(`[${getTodayDate()}] New day started - counters reset`);
}, {
    timezone: 'Asia/Tashkent'
});

// ==================== START SERVERS ====================

const PORT = process.env.PORT || 3000;

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});

// Start Telegram bot
bot.launch()
    .then(() => {
        console.log('🤖 Telegram Bot started successfully!');
    })
    .catch((error) => {
        console.error('Failed to start bot:', error);
    });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
