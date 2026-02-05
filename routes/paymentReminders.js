const express = require("express");
const cron = require("node-cron");
const Client = require("../models/Client");
const sendEmail = require("../utils/sendEmail");
const paymentReminderTemplate = require("../utils/paymentReminderTemplate");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

/* ===============================
   LOGGING UTILITY
================================ */
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    const logEntry = {
        timestamp,
        type,
        operation,
        data
    };
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
    return logEntry;
};

/* ===============================
   ADMIN NOTIFICATION FOR FAILED EMAILS
================================ */
const notifyAdminAboutFailedEmails = async (failedClients, errorReason) => {
    try {
        const adminEmail = process.env.EMAIL_USER || "support@jladgroup.fi";
        const currentDate = new Date().toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });

        const failedList = failedClients.map(client =>
            `• ${client.name} (${client.email}) - ${client.clientId}`
        ).join('<br>');

        await sendEmail(
            adminEmail,
            "⚠️ Payment Reminder Email Failures - Immediate Attention Required",
            `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .header { background: #ff6b6b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .failed-list { background: #fff5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>⚠️ PAYMENT REMINDER EMAIL FAILURES</h2>
          </div>
          <div class="content">
            <p><strong>Date:</strong> ${currentDate}</p>
            <p><strong>Error Reason:</strong> ${errorReason}</p>
            <div class="failed-list">
              <h3>Affected Clients:</h3>
              ${failedList || "No failed emails"}
            </div>
            <p><strong>Action Required:</strong> Please contact these clients directly by phone.</p>
          </div>
        </body>
        </html>
      `
        );

        logToConsole("INFO", "ADMIN_NOTIFIED_FAILED_EMAILS", {
            adminEmail,
            failedCount: failedClients.length,
            failedClients: failedClients.map(c => c.email)
        });

    } catch (error) {
        logToConsole("ERROR", "ADMIN_NOTIFICATION_FAILED", {
            error: error.message
        });
    }
};

/* ===============================
   PAYMENT REMINDER FUNCTION
================================ */
const sendPaymentReminders = async () => {
    const startTime = Date.now();
    const operationId = `PAYMENT_REMINDER_${new Date().toISOString().split('T')[0]}`;

    logToConsole("INFO", "PAYMENT_REMINDER_STARTED", {
        operationId,
        startTime: new Date(startTime).toLocaleString("en-IN")
    });

    try {
        // 1. FETCH ALL ACTIVE CLIENTS
        const activeClients = await Client.find({ isActive: true });

        logToConsole("INFO", "ACTIVE_CLIENTS_FETCHED", {
            count: activeClients.length,
            clientIds: activeClients.map(c => c.clientId)
        });

        if (activeClients.length === 0) {
            logToConsole("WARN", "NO_ACTIVE_CLIENTS", { operationId });
            return {
                success: true,
                message: "No active clients found for payment reminders",
                sentCount: 0,
                failedCount: 0
            };
        }

        // 2. SEND EMAILS TO EACH CLIENT
        const results = {
            sent: [],
            failed: []
        };

        for (const client of activeClients) {
            try {
                const template = paymentReminderTemplate(client);

                await sendEmail(
                    client.email,
                    template.subject,
                    template.html
                );

                results.sent.push({
                    clientId: client.clientId,
                    name: client.name,
                    email: client.email,
                    businessName: client.businessName
                });

                logToConsole("INFO", "PAYMENT_REMINDER_SENT", {
                    clientId: client.clientId,
                    email: client.email
                });

                // Add small delay to avoid overwhelming email service
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                results.failed.push({
                    clientId: client.clientId,
                    name: client.name,
                    email: client.email,
                    error: error.message
                });

                logToConsole("ERROR", "PAYMENT_REMINDER_FAILED", {
                    clientId: client.clientId,
                    email: client.email,
                    error: error.message
                });
            }
        }

        // 3. LOG ACTIVITY
        await ActivityLog.create({
            userName: "SYSTEM",
            role: "SYSTEM",
            action: "PAYMENT_REMINDER_SENT",
            details: `Payment reminders sent to ${results.sent.length} active clients. ${results.failed.length} failed.`,
            dateTime: new Date().toLocaleString("en-IN")
        });

        // 4. NOTIFY ADMIN IF ANY FAILURES
        if (results.failed.length > 0) {
            await notifyAdminAboutFailedEmails(results.failed, "Email delivery failed");
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        logToConsole("INFO", "PAYMENT_REMINDER_COMPLETED", {
            operationId,
            duration: `${duration} seconds`,
            sentCount: results.sent.length,
            failedCount: results.failed.length,
            totalClients: activeClients.length
        });

        return {
            success: true,
            message: `Payment reminders sent successfully`,
            details: {
                totalClients: activeClients.length,
                sent: results.sent.length,
                failed: results.failed.length,
                failedClients: results.failed,
                duration: `${duration} seconds`
            }
        };

    } catch (error) {
        logToConsole("ERROR", "PAYMENT_REMINDER_PROCESS_FAILED", {
            operationId,
            error: error.message,
            stack: error.stack
        });

        // Notify admin about complete failure
        await notifyAdminAboutFailedEmails([], `System error: ${error.message}`);

        return {
            success: false,
            message: "Payment reminder process failed",
            error: error.message
        };
    }
};

/* ===============================
   SCHEDULED JOBS
================================ */
// Schedule for 20th of each month at 12:00 PM
cron.schedule('0 12 20 * *', async () => {
    console.log("⏰ Running payment reminder (20th of month)...");
    await sendPaymentReminders();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Schedule for 25th of each month at 12:00 PM  
cron.schedule('0 12 25 * *', async () => {
    console.log("⏰ Running payment reminder (25th of month)...");
    await sendPaymentReminders();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

/* ===============================
   MANUAL TRIGGER FOR TESTING
================================ */
router.post("/send-test-reminder", async (req, res) => {
    try {
        const result = await sendPaymentReminders();
        res.json(result);

    } catch (error) {
        console.error("Manual reminder error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to send payment reminders",
            error: error.message
        });
    }
});

/* ===============================
   TEST ENDPOINT - Check system status
================================ */
router.get("/test", async (req, res) => {
    try {
        const activeClients = await Client.find({ isActive: true });
        const adminEmail = process.env.EMAIL_USER;

        res.json({
            success: true,
            system: "Payment Reminder System",
            status: "Active",
            activeClients: activeClients.length,
            clientIds: activeClients.map(c => c.clientId),
            adminEmail: adminEmail || "NOT CONFIGURED",
            emailService: adminEmail ? "Configured" : "Not Configured",
            currentTime: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/* ===============================
   STATUS CHECK ENDPOINT
================================ */
router.get("/status", (req, res) => {
    res.json({
        success: true,
        message: "Payment Reminder System is active",
        schedules: [
            {
                schedule: "20th of each month at 12:00 PM IST",
                description: "Monthly payment reminder"
            },
            {
                schedule: "25th of each month at 12:00 PM IST",
                description: "Monthly payment reminder"
            }
        ],
        currentTime: new Date().toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata"
        }),
        adminEmail: process.env.EMAIL_USER || "Not configured"
    });
});

module.exports = router;