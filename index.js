require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { initializeFirebase } = require('./firebase-config');
const { generateStatsExcel } = require('./excel_helper');

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
    // Add offset hours to get the target time
    const target = new Date(now.getTime() + (offset * 60 * 60 * 1000));
    return target.toISOString().split('T')[0];
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

// Get group's daily limit
const getGroupDailyLimit = async (chatId) => {
    try {
        const groupDoc = await db.collection('groups').doc(String(chatId)).get();
        if (groupDoc.exists) {
            return groupDoc.data()?.dailyLimit || 4;
        }

        // Get default limit from settings
        const settingsDoc = await db.collection('settings').doc('global').get();
        return settingsDoc.exists ? settingsDoc.data()?.defaultDailyLimit || 4 : 4;
    } catch (error) {
        console.error('Error getting daily limit:', error.message);
        return 4; // Default limit
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

        console.log(`\n📹 [${videoType}] Received from User: ${userId} (${userName}) in Chat: ${chatId}`);

        // Check if group is registered
        const registered = await isGroupRegistered(chatId);
        if (!registered) {
            console.log(`❌ Group ${chatId} is NOT registered or NOT active`);
            return;
        }
        console.log(`✅ Group ${chatId} is registered and active`);

        // Check if this user is being tracked
        const trackedUserId = await getTrackedUser(chatId);
        console.log(`🔍 Tracked User ID for group: "${trackedUserId}" (type: ${typeof trackedUserId})`);
        console.log(`🔍 Current User ID: "${userId}" (type: ${typeof userId})`);

        // Only check if trackedUserId is set and not empty
        if (trackedUserId && trackedUserId.trim() !== '') {
            if (String(userId).trim() !== String(trackedUserId).trim()) {
                console.log(`❌ User ${userId} is NOT the tracked user (${trackedUserId}) - Video IGNORED`);
                return;
            }
            console.log(`✅ User ${userId} IS the tracked user`);
        } else {
            console.log(`⚠️ No tracked user set for group ${chatId} - counting ALL users`);
        }

        // Get group's daily limit (for logging only, no limit enforced)
        const dailyLimit = await getGroupDailyLimit(chatId);
        console.log(`📊 Daily limit for group ${chatId}: ${dailyLimit}`);

        // Get current count
        const date = getTodayDate();
        const currentCount = await getCurrentCount(chatId, userId, date);
        console.log(`📊 Current count: ${currentCount}/${dailyLimit}`);

        // Increment count (no limit check - count all videos)
        const newCount = await incrementVideoCount(chatId, userId, userName);
        console.log(`✅ ${videoType} COUNTED! Group: ${chatId}, User: ${userId}, Count: ${newCount}/${dailyLimit}`);

    } catch (error) {
        console.error(`❌ Error handling ${videoType}:`, error);
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
bot.command('start', async (ctx) => {
    try {
        await ctx.reply(
            `🎬 <b>RND SMART BOOT</b> - Video Counter Bot\n\n` +
            `Men guruhlardan video xabarlarni hisoblash uchun yaratilganman.\n\n` +
            `📋 <b>Mavjud buyruqlar:</b>\n` +
            `/chatid - Guruh yoki chat ID sini olish\n` +
            `/myid - O'z Telegram ID ingizni olish\n` +
            `/info - To'liq ma'lumotlar (Chat + User)\n` +
            `/status - Bugungi statistikani ko'rish\n\n` +
            `<i>Guruhga qo'shib, admin qiling va video yuborishni boshlang!</i>`,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        console.error('❌ Error in /start command:', error.message);
    }
});



// Bot status command
bot.command('status', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const registered = await isGroupRegistered(chatId);

        if (registered) {
            const date = getTodayDate();
            const trackedUserId = await getTrackedUser(chatId);
            const currentCount = await getCurrentCount(chatId, trackedUserId, date);
            const dailyLimit = await getGroupDailyLimit(chatId);

            await ctx.reply(
                `📊 <b>Bugungi statistika:</b>\n\n` +
                `📅 Sana: <code>${date}</code>\n` +
                `📹 Video soni: <b>${currentCount}/${dailyLimit}</b>\n` +
                `👤 Kuzatilayotgan User ID: <code>${trackedUserId}</code>`,
                { parse_mode: 'HTML' }
            );
        } else {
            await ctx.reply(
                `❌ <b>Hato:</b> Bu guruh ro'yxatdan o'tmagan.\n\n` +
                `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n` +
                `💡 <i>Guruhni Flutter dashboard orqali qo'shing.</i>`,
                { parse_mode: 'HTML' }
            );
        }
    } catch (error) {
        console.error('❌ Error in /status command:', error.message);
    }
});


// Get Chat ID command
bot.command('chatid', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const chatType = ctx.chat.type;
        const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Shaxsiy chat';

        await ctx.reply(
            `📋 <b>Chat ma'lumotlari:</b>\n\n` +
            `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n` +
            `📝 <b>Nomi:</b> ${chatTitle}\n` +
            `📦 <b>Turi:</b> ${chatType}\n\n` +
            `<i>Chat ID ni nusxalash uchun ustiga bosing</i>`,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        console.error('❌ Error in /chatid command:', error.message);
    }
});


// Get User ID command
bot.command('myid', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
        const username = ctx.from.username ? `@${ctx.from.username}` : 'Yo\'q';

        await ctx.reply(
            `👤 <b>Sizning ma'lumotlaringiz:</b>\n\n` +
            `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
            `📝 <b>Ism:</b> ${userName}\n` +
            `🔗 <b>Username:</b> ${username}\n\n` +
            `<i>User ID ni nusxalash uchun ustiga bosing</i>`,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        console.error('❌ Error in /myid command:', error.message);
    }
});


// Get both Chat ID and User ID
bot.command('info', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const chatType = ctx.chat.type;
        const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Shaxsiy chat';
        const userId = ctx.from.id;
        const userName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
        const username = ctx.from.username ? `@${ctx.from.username}` : 'Yo\'q';

        await ctx.reply(
            `📊 <b>To'liq ma'lumotlar:</b>\n\n` +
            `━━━ 💬 <b>Chat</b> ━━━\n` +
            `🆔 Chat ID: <code>${chatId}</code>\n` +
            `📝 Nomi: ${chatTitle}\n` +
            `📦 Turi: ${chatType}\n\n` +
            `━━━ 👤 <b>Foydalanuvchi</b> ━━━\n` +
            `🆔 User ID: <code>${userId}</code>\n` +
            `📝 Ism: ${userName}\n` +
            `🔗 Username: ${username}`,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        console.error('❌ Error in /info command:', error.message);
    }
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
        const { telegramId, name } = req.body;
        await db.collection('users').doc(String(telegramId)).set({
            telegramId: String(telegramId),
            name,
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
            res.json({ defaultDailyLimit: 4, timezone: 'UTC+5' });
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
        const { userId, userName, times, days, isActive } = req.body;
        const docRef = await db.collection('schedules').add({
            userId: String(userId),
            userName,
            times: times || [],
            days: days || [1, 2, 3, 4, 5, 6, 7], // Default: all days (1=Monday to 7=Sunday)
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

// ==================== BROADCASTS API ====================

// Get all broadcasts
app.get('/api/broadcasts', async (req, res) => {
    try {
        const snapshot = await db.collection('broadcasts').get();
        const broadcasts = [];
        snapshot.forEach(doc => {
            broadcasts.push({ id: doc.id, ...doc.data() });
        });
        res.json(broadcasts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new broadcast
app.post('/api/broadcasts', async (req, res) => {
    try {
        const broadcastData = req.body;
        const docRef = await db.collection('broadcasts').add({
            ...broadcastData,
            createdAt: new Date(),
        });
        res.json({ success: true, id: docRef.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update broadcast
app.put('/api/broadcasts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        await db.collection('broadcasts').doc(id).update(updateData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete broadcast
app.delete('/api/broadcasts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('broadcasts').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== EXCEL EXPORT API ====================

app.get('/api/export/excel', async (req, res) => {
    try {
        console.log('📊 Generating Excel export...');
        const date = getTodayDate();

        // Fetch all necessary data
        const statsSnapshot = await db.collection('stats').doc(date).collection('groups').get();
        const groupsSnapshot = await db.collection('groups').get();
        const usersSnapshot = await db.collection('users').get();

        const stats = statsSnapshot.docs.map(doc => ({ groupId: doc.id, ...doc.data() }));
        const groups = groupsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const buffer = await generateStatsExcel(stats, groups, users);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Statistika_${date}.xlsx`);
        res.send(buffer);
        console.log('✅ Excel export sent!');
    } catch (error) {
        console.error('❌ Error exporting Excel:', error);
        res.status(500).send('Server xatoligi');
    }
});

// ==================== REMINDER HELPER ====================


// Send reminder message to user via DM
const sendReminderToUser = async (telegramId, userName) => {
    const message =
        `Assalomu alaykum, ${userName} ustoz.\n\n` +
        `Iltimos, guruhingiz bo'yicha yo'qlama qiling.` +
        `Shuningdek, ota-onalar guruhiga video xabar yuborish vaqti keldi.\n\n` +
        `Agar bugun yaqin vaqtda darsingiz bo'lmasa,` +
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
    // Add offset hours to get the target time
    const target = new Date(now.getTime() + (offset * 60 * 60 * 1000));
    const hours = String(target.getUTCHours()).padStart(2, '0');
    const minutes = String(target.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};

// Get current day of week in target timezone (1=Monday to 7=Sunday)
const getCurrentDayOfWeek = () => {
    const offset = parseInt(process.env.TIMEZONE_OFFSET || 5);
    const now = new Date();
    // Add offset hours to get the target time
    const target = new Date(now.getTime() + (offset * 60 * 60 * 1000));
    // getUTCDay: 0=Sunday, 1=Monday, ..., 6=Saturday
    const day = target.getUTCDay();
    return day === 0 ? 7 : day;
};

// ==================== CRON JOBS ====================

// Check schedules every minute and send reminders
// Check group schedules every minute and send reminders
cron.schedule('* * * * *', async () => {
    const currentTime = getCurrentTime();
    const currentDay = getCurrentDayOfWeek();
    console.log(`[${getTodayDate()} ${currentTime}] Day: ${currentDay} - Checking group schedules...`);

    try {
        // Get all active groups with schedules
        const groupsSnapshot = await db.collection('groups')
            .where('isActive', '==', true)
            .get();

        for (const doc of groupsSnapshot.docs) {
            const group = doc.data();
            const groupDays = group.days || [1, 2, 3, 4, 5, 6, 7];
            const groupTimes = group.times || [];

            // Check if current day matches group schedule days
            if (!groupDays.includes(currentDay)) {
                continue;
            }

            // Check if current time matches group schedule times
            if (groupTimes.includes(currentTime)) {
                // Get the tracked user from users collection
                const userId = group.trackedUserId;
                if (!userId) continue;

                const userDoc = await db.collection('users').doc(String(userId)).get();
                const userName = userDoc.exists ? userDoc.data()?.name : group.name;

                console.log(`⏰ Day & Time match for group "${group.name}"! Sending reminder to user ${userId}`);
                await sendReminderToUser(userId, userName);
            }
        }
    } catch (error) {
        console.error('Error checking group schedules:', error.message);
    }
}, {
    timezone: 'Asia/Tashkent'
});

cron.schedule('* * * * *', async () => {
    const currentTime = getCurrentTime();
    const currentDay = getCurrentDayOfWeek();
    const todayDate = getTodayDate();

    try {
        const broadcastsSnapshot = await db.collection('broadcasts')
            .where('isActive', '==', true)
            .get();

        if (broadcastsSnapshot.empty) {
            return;
        }

        console.log(`[${todayDate} ${currentTime}] Checking ${broadcastsSnapshot.size} active broadcasts...`);

        for (const doc of broadcastsSnapshot.docs) {
            const broadcast = doc.data();
            const { userIds, message, scheduledTime, days, includeExcel, lastSentDate, isOneTime } = broadcast;

            // Check if it's a one-time message that hasn't been sent yet
            const shouldSendOneTime = isOneTime && !lastSentDate;

            // Check if it's a scheduled message for today and current time
            const shouldSendScheduled = !isOneTime && days.includes(currentDay) && scheduledTime === currentTime && lastSentDate !== todayDate;

            if (!shouldSendOneTime && !shouldSendScheduled) {
                // Verbose log for debugging (can be removed later)
                // console.log(`Skipping broadcast ${doc.id}: isOneTime=${isOneTime}, lastSent=${lastSentDate}, sched=${scheduledTime}, matchDay=${days.includes(currentDay)}`);
                continue;
            }

            console.log(`📢 Sending broadcast: "${message.substring(0, 20)}..." to ${userIds.length} users (Type: ${isOneTime ? 'One-time' : 'Scheduled'})`);

            let keyboard = {};
            if (includeExcel && process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
                keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Statistika Excel yuklab olish', url: `${process.env.BASE_URL}/api/export/excel` }]
                        ]
                    }
                };
            } else if (includeExcel) {
                console.log(`⚠️ Skipping Excel button: BASE_URL is "${process.env.BASE_URL}" (valid URL required for Telegram)`);
            }

            for (const userId of userIds) {
                try {
                    await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML', ...keyboard });
                    console.log(`✅ Sent to ${userId}`);
                } catch (err) {
                    console.error(`❌ Failed to send broadcast to ${userId}:`, err.message);
                    // If HTML parsing fails, try sending as plain text
                    if (err.message.includes('can\'t parse entities')) {
                        try {
                            await bot.telegram.sendMessage(userId, message, { ...keyboard });
                            console.log(`✅ Sent to ${userId} as plain text`);
                        } catch (reErr) {
                            console.error(`❌ Final fail to ${userId}:`, reErr.message);
                        }
                    }
                }
            }

            // Mark as sent for today
            await db.collection('broadcasts').doc(doc.id).update({ lastSentDate: todayDate });
        }
    } catch (error) {
        console.error('Error in broadcast cron:', error.message);
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
