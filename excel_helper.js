const ExcelJS = require('exceljs');

/**
 * Generate Excel file for statistics
 * @param {Array} stats - List of stats objects
 * @param {Array} groups - List of groups objects
 * @param {Array} users - List of users objects
 * @returns {Promise<Buffer>} - Excel file buffer
 */
const generateStatsExcel = async (stats, groups, users) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Statistika');

    // Define columns
    sheet.columns = [
        { header: 'Guruh', key: 'group', width: 25 },
        { header: 'Guruh Link', key: 'group_link', width: 35 },
        { header: 'Hodim', key: 'user', width: 25 },
        { header: 'Hodim Link', key: 'user_link', width: 35 },
        { header: 'Videolar', key: 'videos', width: 12 },
        { header: 'Limit', key: 'limit', width: 10 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Oxirgi yangilanish', key: 'last_updated', width: 20 },
    ];

    // Style header
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).alignment = { horizontal: 'center' };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4A90D9' }
    };

    // Add data
    stats.forEach(stat => {
        const group = groups.find(g => g.id === String(stat.groupId));
        const user = users.find(u => String(u.telegramId) === String(group?.trackedUserId));

        const count = stat.count || 0;
        const dailyLimit = group?.dailyLimit || 4;

        let statusText = 'Boshlanmagan';
        let statusColor = 'FF6C757D'; // Grey

        if (count >= dailyLimit) {
            statusText = 'Tugallangan';
            statusColor = 'FF28A745'; // Green
        } else if (count > 0 && count >= dailyLimit / 2) {
            statusText = 'Jarayonda';
            statusColor = 'FFFFC107'; // Yellow
        }

        const lastUpdatedText = stat.lastUpdated ?
            new Date(stat.lastUpdated.toDate ? stat.lastUpdated.toDate() : stat.lastUpdated).toLocaleString('ru-RU') : '-';

        const row = sheet.addRow({
            group: group?.name || 'Noma\'lum',
            group_link: group?.link || '-',
            user: user?.name || stat.userName || '-',
            user_link: user?.link || '-',
            videos: count,
            limit: dailyLimit,
            status: statusText,
            last_updated: lastUpdatedText
        });

        // Style status cell
        const statusCell = row.getCell('status');
        statusCell.font = { color: { argb: statusColor }, bold: true };
        statusCell.alignment = { horizontal: 'center' };

        // Links styling
        if (group?.link) {
            const groupLinkCell = row.getCell('group_link');
            groupLinkCell.font = { color: { argb: 'FF0066CC' }, underline: true };
        }
        if (user?.link) {
            const userLinkCell = row.getCell('user_link');
            userLinkCell.font = { color: { argb: 'FF0066CC' }, underline: true };
        }
    });

    return await workbook.xlsx.writeBuffer();
};

module.exports = { generateStatsExcel };
