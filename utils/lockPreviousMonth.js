const cron = require('node-cron');
const Client = require('../models/Client');
const nodemailer = require('nodemailer');

// ===============================
// EMAIL CONFIGURATION
// ===============================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ===============================
// SEND EMAIL TO ADMIN
// ===============================
const sendAdminEmail = async (stats, startTime, errors, clientLists) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const { year, month, name } = stats.month;

    // Create email HTML
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 800px; margin: 0 auto; padding: 20px; }
                .header { background-color: #2196f3; color: white; padding: 20px; text-align: center; border-radius: 5px; }
                .summary { background-color: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px; }
                .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
                .stat-card { background: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
                .stat-value { font-size: 24px; font-weight: bold; color: #2196f3; }
                .success { color: #4caf50; }
                .warning { color: #ff9800; }
                .error { color: #f44336; }
                .info { color: #2196f3; }
                .client-list { background: white; padding: 15px; border-radius: 5px; margin: 20px 0; border: 1px solid #ddd; max-height: 300px; overflow-y: auto; }
                .client-item { padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
                .client-item:last-child { border-bottom: none; }
                .client-name { font-weight: bold; }
                .client-id { color: #666; font-size: 12px; }
                .badge { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
                .badge-success { background: #e8f5e9; color: #2e7d32; }
                .badge-warning { background: #fff3e0; color: #ef6c00; }
                .badge-info { background: #e3f2fd; color: #0d47a1; }
                .badge-error { background: #ffebee; color: #c62828; }
                .errors-section { background: #ffebee; padding: 15px; border-radius: 5px; margin-top: 20px; }
                .error-item { padding: 10px; border-bottom: 1px solid #ffcdd2; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔒 Auto-Lock CRON Job Report</h1>
                    <p>Month: ${name} ${year}</p>
                </div>
                
                <div class="summary">
                    <h3>📊 Operation Summary</h3>
                    <p><strong>Execution Time:</strong> ${new Date().toLocaleString("en-IN", { timeZone: "Europe/Helsinki" })} (Finland Time)</p>
                    <p><strong>Duration:</strong> ${duration} seconds</p>
                    <p><strong>Month Processed:</strong> ${name} ${year}</p>
                </div>
                
                <h3>📈 Statistics</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Total Clients</div>
                        <div class="stat-value">${stats.total}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Newly Locked</div>
                        <div class="stat-value success">${stats.locked}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Already Locked</div>
                        <div class="stat-value warning">${stats.alreadyLocked}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Inactive Months</div>
                        <div class="stat-value info">${stats.inactiveMonths}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Failed</div>
                        <div class="stat-value error">${stats.failed}</div>
                    </div>
                </div>

                <!-- NEWLY LOCKED CLIENTS LIST -->
                ${clientLists.lockedClients.length > 0 ? `
                <div class="client-list">
                    <h4>✅ Newly Locked Clients (${clientLists.lockedClients.length})</h4>
                    ${clientLists.lockedClients.map(client => `
                        <div class="client-item">
                            <span>
                                <span class="client-name">${client.name}</span>
                                <span class="client-id"> (${client.clientId})</span>
                            </span>
                            <span class="badge badge-success">Locked</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <!-- ALREADY LOCKED CLIENTS LIST -->
                ${clientLists.alreadyLockedClients.length > 0 ? `
                <div class="client-list">
                    <h4>⏭️ Already Locked Clients (${clientLists.alreadyLockedClients.length})</h4>
                    ${clientLists.alreadyLockedClients.map(client => `
                        <div class="client-item">
                            <span>
                                <span class="client-name">${client.name}</span>
                                <span class="client-id"> (${client.clientId})</span>
                            </span>
                            <span class="badge badge-warning">Already Locked</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''} 

               
                
                ${errors && errors.length > 0 ? `
                <div class="errors-section">
                    <h4>⚠️ Errors (${errors.length})</h4>
                    ${errors.slice(0, 10).map(err => `
                        <div class="error-item">
                            <strong>Client ID:</strong> ${err.clientId}<br>
                            <strong>Client Name:</strong> ${err.clientName}<br>
                            <strong>Error:</strong> ${err.error}
                        </div>
                    `).join('')}
                    ${errors.length > 10 ? `<p>... and ${errors.length - 10} more errors</p>` : ''}
                </div>
                ` : ''}
                
                <div class="footer">
                    <p>This is an automated notification from Credence Enterprise Accounting Services</p>
                    <p>CRON Job: Auto-Lock Previous Month (26th of each month at 12:00 AM Finland time)</p>
                    <p>Timestamp: ${new Date().toISOString()}</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: `🔒 Auto-Lock CRON Report: ${name} ${year} - ${stats.locked} clients locked`,
        html: html
    };

    try {
        await transporter.sendMail(mailOptions);
        logToConsole("SUCCESS", "ADMIN_EMAIL_SENT", {
            to: process.env.EMAIL_USER,
            subject: `Auto-Lock Report: ${name} ${year}`
        });
    } catch (emailError) {
        logToConsole("ERROR", "ADMIN_EMAIL_FAILED", {
            error: emailError.message
        });
    }
};

// ===============================
// HELPER: CALCULATE MONTH ACTIVE STATUS
// ===============================
const calculateMonthActiveStatus = (client, targetYear, targetMonth) => {
    const targetMonthDate = new Date(targetYear, targetMonth - 1, 1);
    let monthActiveStatus = 'active';

    if (client.deactivatedAt) {
        const deactivationDate = new Date(client.deactivatedAt);
        const deactivationMonthStart = new Date(
            deactivationDate.getFullYear(),
            deactivationDate.getMonth(),
            1
        );

        if (targetMonthDate >= deactivationMonthStart) {
            monthActiveStatus = 'inactive';
        }
    }

    if (client.reactivatedAt && monthActiveStatus === 'inactive') {
        const reactivationDate = new Date(client.reactivatedAt);
        const reactivationMonthStart = new Date(
            reactivationDate.getFullYear(),
            reactivationDate.getMonth(),
            1
        );

        if (targetMonthDate >= reactivationMonthStart) {
            monthActiveStatus = 'active';
        }
    }

    return monthActiveStatus;
};

// ===============================
// GET OR CREATE MONTH DATA
// ===============================
const getOrCreateMonthData = (client, year, month) => {
    const y = String(year);
    const m = String(month);

    if (!client.documents.has(y)) {
        client.documents.set(y, new Map());
    }

    if (!client.documents.get(y).has(m)) {
        const monthActiveStatus = calculateMonthActiveStatus(client, year, month);

        client.documents.get(y).set(m, {
            sales: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
            purchase: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
            bank: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
            other: [],
            isLocked: false,
            wasLockedOnce: false,
            monthNotes: [],
            accountingDone: false,
            monthActiveStatus: monthActiveStatus,
            lockedAt: null,
            lockedBy: null,
            autoLockDate: null
        });
    }

    return client.documents.get(y).get(m);
};

// ===============================
// CALCULATE PREVIOUS MONTH
// ===============================
const getPreviousMonth = () => {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    let previousYear = currentYear;
    let previousMonth = currentMonth - 1;

    if (previousMonth === 0) {
        previousMonth = 12;
        previousYear = currentYear - 1;
    }

    return {
        year: previousYear,
        month: previousMonth,
        monthName: new Date(previousYear, previousMonth - 1, 1).toLocaleString('default', { month: 'long' })
    };
};

// ===============================
// CONSOLE LOGGING UTILITY
// ===============================
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

// ===============================
// MAIN LOCK FUNCTION
// ===============================
const lockPreviousMonthForAllClients = async () => {
    const startTime = Date.now();
    const { year, month, monthName } = getPreviousMonth();

    logToConsole("INFO", "AUTO_LOCK_CRON_STARTED", {
        lockingMonth: `${monthName} ${year}`,
        lockingYear: year,
        lockingMonth: month,
        timestamp: new Date().toISOString()
    });

    try {
        const clients = await Client.find({});

        logToConsole("INFO", "AUTO_LOCK_CLIENTS_FOUND", {
            totalClients: clients.length,
            monthToLock: `${monthName} ${year}`
        });

        let lockedCount = 0;
        let alreadyLockedCount = 0;
        let inactiveMonthCount = 0;
        let errorCount = 0;
        const errors = [];

        // Client lists for email
        const lockedClients = [];
        const alreadyLockedClients = [];
        const inactiveClients = [];

        for (const client of clients) {
            try {
                const monthData = getOrCreateMonthData(client, year, month);

                // Track inactive months
                if (monthData.monthActiveStatus === 'inactive') {
                    inactiveMonthCount++;
                    inactiveClients.push({
                        name: client.name,
                        clientId: client.clientId
                    });
                    logToConsole("INFO", "AUTO_LOCK_INACTIVE_MONTH", {
                        clientId: client.clientId,
                        clientName: client.name,
                        month: `${monthName} ${year}`,
                        status: 'inactive - client was deactivated during this period'
                    });
                }

                // Check if already locked
                if (monthData.isLocked) {
                    alreadyLockedCount++;
                    alreadyLockedClients.push({
                        name: client.name,
                        clientId: client.clientId
                    });
                    continue;
                }

                // LOCK THE MONTH
                monthData.isLocked = true;
                monthData.wasLockedOnce = true;
                monthData.lockedAt = new Date();
                monthData.lockedBy = "SYSTEM_CRON";
                monthData.autoLockDate = new Date();

                // Lock all categories
                if (monthData.sales) {
                    monthData.sales.isLocked = true;
                    monthData.sales.wasLockedOnce = true;
                }

                if (monthData.purchase) {
                    monthData.purchase.isLocked = true;
                    monthData.purchase.wasLockedOnce = true;
                }

                if (monthData.bank) {
                    monthData.bank.isLocked = true;
                    monthData.bank.wasLockedOnce = true;
                }

                if (monthData.other && monthData.other.length > 0) {
                    monthData.other.forEach(cat => {
                        if (cat.document) {
                            cat.document.isLocked = true;
                            cat.document.wasLockedOnce = true;
                        }
                    });
                }

                // Add system note
                if (!monthData.monthNotes) {
                    monthData.monthNotes = [];
                }

                monthData.monthNotes.push({
                    note: `Month automatically locked by system on 26th. Month status: ${monthData.monthActiveStatus}`,
                    addedBy: "SYSTEM_CRON",
                    addedAt: new Date()
                });

                await client.save();

                lockedCount++;
                lockedClients.push({
                    name: client.name,
                    clientId: client.clientId
                });

                logToConsole("SUCCESS", "AUTO_LOCK_SUCCESS", {
                    clientId: client.clientId,
                    clientName: client.name,
                    month: `${monthName} ${year}`,
                    monthStatus: monthData.monthActiveStatus
                });

            } catch (clientError) {
                errorCount++;
                errors.push({
                    clientId: client.clientId,
                    clientName: client.name,
                    error: clientError.message
                });
                logToConsole("ERROR", "AUTO_LOCK_CLIENT_FAILED", {
                    clientId: client.clientId,
                    clientName: client.name,
                    error: clientError.message
                });
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        const stats = {
            total: clients.length,
            locked: lockedCount,
            alreadyLocked: alreadyLockedCount,
            inactiveMonths: inactiveMonthCount,
            failed: errorCount,
            month: { year, month, name: monthName }
        };

        const clientLists = {
            lockedClients,
            alreadyLockedClients,
            inactiveClients
        };

        logToConsole("SUCCESS", "AUTO_LOCK_CRON_COMPLETED", {
            monthLocked: `${monthName} ${year}`,
            totalClients: clients.length,
            newlyLocked: lockedCount,
            alreadyLocked: alreadyLockedCount,
            inactiveMonths: inactiveMonthCount,
            failed: errorCount,
            durationSeconds: duration,
            timestamp: new Date().toISOString()
        });

        // SEND EMAIL WITH CLIENT LISTS
        await sendAdminEmail(stats, startTime, errors, clientLists);

        return {
            success: true,
            month: { year, month, name: monthName },
            stats: {
                total: clients.length,
                locked: lockedCount,
                alreadyLocked: alreadyLockedCount,
                inactiveMonths: inactiveMonthCount,
                failed: errorCount
            },
            clientLists
        };

    } catch (error) {
        logToConsole("ERROR", "AUTO_LOCK_CRON_FAILED", {
            error: error.message,
            stack: error.stack
        });

        try {
            await sendAdminEmail({
                total: 0,
                locked: 0,
                alreadyLocked: 0,
                inactiveMonths: 0,
                failed: 1,
                month: getPreviousMonth()
            }, startTime, [{ clientId: 'SYSTEM', clientName: 'SYSTEM', error: error.message }], {
                lockedClients: [],
                alreadyLockedClients: [],
                inactiveClients: []
            });
        } catch (emailError) {
            logToConsole("ERROR", "FAILED_TO_SEND_ERROR_EMAIL", {
                error: emailError.message
            });
        }

        return {
            success: false,
            error: error.message
        };
    }
};

// ===============================
// SCHEDULE THE CRON JOB
// ===============================
const scheduleLockJob = () => {
    // '0 0 26 * *' = At 00:00 on day-of-month 26
    const job = cron.schedule('0 0 26 * *', async () => {
        console.log('=================================');
        console.log('🔒 AUTO-LOCK CRON JOB TRIGGERED');
        console.log('=================================');
        console.log(`Time: ${new Date().toLocaleString("en-IN", { timeZone: "Europe/Helsinki" })}`);

        await lockPreviousMonthForAllClients();

        console.log('=================================');
        console.log('✅ AUTO-LOCK CRON JOB COMPLETED');
        console.log('=================================');
    }, {
        scheduled: true,
        timezone: "Europe/Helsinki"
    });

    console.log('📅 Auto-lock CRON job scheduled: Runs on 26th of each month at 12:00 AM Finland time');
    console.log('📧 Email notifications will be sent to:', process.env.EMAIL_USER);
    return job;
};

if (require.main === module) {
    console.log('🔧 Running lockPreviousMonthForAllClients() manually for testing...');
    lockPreviousMonthForAllClients()
        .then(result => {
            console.log('✅ Manual execution completed:', result);
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Manual execution failed:', error);
            process.exit(1);
        });
}

module.exports = lockPreviousMonthForAllClients;
module.exports.scheduleLockJob = scheduleLockJob;