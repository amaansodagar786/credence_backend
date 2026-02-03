const express = require("express");
const cron = require("node-cron");
const Client = require("../models/Client");
const sendEmail = require("../utils/sendEmail");
const documentUploadReminderTemplate = require("../utils/documentUploadReminderTemplate");
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
const notifyAdminAboutFailedUploadReminders = async (failedClients, errorReason) => {
    try {
        const adminEmail = process.env.EMAIL_USER || "admin@credence-accounting.com";
        const currentDate = new Date().toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });

        // Get previous month for context
        const currentDateObj = new Date();
        const previousMonth = new Date(currentDateObj.getFullYear(), currentDateObj.getMonth() - 1, 1);
        const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric"
        });

        const failedList = failedClients.map(client =>
            `• ${client.name} (${client.email}) - ${client.clientId}`
        ).join('<br>');

        await sendEmail(
            adminEmail,
            `⚠️ Document Upload Reminder Failures - ${previousMonthYear}`,
            `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .header { background: #ff6b6b; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .failed-list { background: #fff5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .month-info { background: #e3f2fd; padding: 10px; border-radius: 6px; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>⚠️ DOCUMENT UPLOAD REMINDER FAILURES</h2>
          </div>
          <div class="content">
            <p><strong>Date:</strong> ${currentDate}</p>
            <div class="month-info">
              <p><strong>Document Month:</strong> ${previousMonthYear}</p>
              <p><strong>Reminder Type:</strong> Monthly Document Upload Reminder</p>
            </div>
            <p><strong>Error Reason:</strong> ${errorReason}</p>
            <div class="failed-list">
              <h3>Affected Clients:</h3>
              ${failedList || "No failed emails"}
            </div>
            <p><strong>Action Required:</strong> Please contact these clients directly by phone for document upload reminder.</p>
          </div>
        </body>
        </html>
      `
        );

        logToConsole("INFO", "ADMIN_NOTIFIED_FAILED_UPLOAD_REMINDERS", {
            adminEmail,
            documentMonth: previousMonthYear,
            failedCount: failedClients.length,
            failedClients: failedClients.map(c => c.email)
        });

    } catch (error) {
        logToConsole("ERROR", "ADMIN_NOTIFICATION_FAILED_UPLOAD", {
            error: error.message
        });
    }
};

/* ===============================
   DOCUMENT UPLOAD REMINDER FUNCTION
================================ */
const sendDocumentUploadReminders = async () => {
    const startTime = Date.now();
    const operationId = `DOCUMENT_UPLOAD_REMINDER_${new Date().toISOString().split('T')[0]}`;

    // Get previous month for logging
    const currentDate = new Date();
    const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
    });

    logToConsole("INFO", "DOCUMENT_UPLOAD_REMINDER_STARTED", {
        operationId,
        documentMonth: previousMonthYear,
        startTime: new Date(startTime).toLocaleString("en-IN")
    });

    try {
        // 1. FETCH ALL ACTIVE CLIENTS
        const activeClients = await Client.find({ isActive: true });

        logToConsole("INFO", "ACTIVE_CLIENTS_FETCHED_UPLOAD", {
            documentMonth: previousMonthYear,
            count: activeClients.length,
            clientIds: activeClients.map(c => c.clientId)
        });

        if (activeClients.length === 0) {
            logToConsole("WARN", "NO_ACTIVE_CLIENTS_UPLOAD", {
                operationId,
                documentMonth: previousMonthYear
            });
            return {
                success: true,
                message: "No active clients found for document upload reminders",
                documentMonth: previousMonthYear,
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
                const template = documentUploadReminderTemplate(client);

                await sendEmail(
                    client.email,
                    template.subject,
                    template.html
                );

                results.sent.push({
                    clientId: client.clientId,
                    name: `${client.firstName} ${client.lastName}`,
                    email: client.email,
                    businessName: client.businessName,
                    documentMonth: previousMonthYear
                });

                logToConsole("INFO", "DOCUMENT_UPLOAD_REMINDER_SENT", {
                    clientId: client.clientId,
                    email: client.email,
                    documentMonth: previousMonthYear
                });

                // Add small delay to avoid overwhelming email service
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                results.failed.push({
                    clientId: client.clientId,
                    name: `${client.firstName} ${client.lastName}`,
                    email: client.email,
                    documentMonth: previousMonthYear,
                    error: error.message
                });

                logToConsole("ERROR", "DOCUMENT_UPLOAD_REMINDER_FAILED", {
                    clientId: client.clientId,
                    email: client.email,
                    documentMonth: previousMonthYear,
                    error: error.message
                });
            }
        }

        // 3. LOG ACTIVITY
        await ActivityLog.create({
            userName: "SYSTEM",
            role: "SYSTEM",
            action: "DOCUMENT_UPLOAD_REMINDER_SENT",
            details: `Document upload reminders sent for ${previousMonthYear} to ${results.sent.length} active clients. ${results.failed.length} failed.`,
            dateTime: new Date().toLocaleString("en-IN")
        });

        // 4. NOTIFY ADMIN IF ANY FAILURES
        if (results.failed.length > 0) {
            await notifyAdminAboutFailedUploadReminders(results.failed, "Email delivery failed");
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        logToConsole("INFO", "DOCUMENT_UPLOAD_REMINDER_COMPLETED", {
            operationId,
            documentMonth: previousMonthYear,
            duration: `${duration} seconds`,
            sentCount: results.sent.length,
            failedCount: results.failed.length,
            totalClients: activeClients.length
        });

        return {
            success: true,
            message: `Document upload reminders sent successfully for ${previousMonthYear}`,
            details: {
                documentMonth: previousMonthYear,
                totalClients: activeClients.length,
                sent: results.sent.length,
                failed: results.failed.length,
                failedClients: results.failed,
                duration: `${duration} seconds`
            }
        };

    } catch (error) {
        logToConsole("ERROR", "DOCUMENT_UPLOAD_REMINDER_PROCESS_FAILED", {
            operationId,
            documentMonth: previousMonthYear,
            error: error.message,
            stack: error.stack
        });

        // Notify admin about complete failure
        await notifyAdminAboutFailedUploadReminders([], `System error: ${error.message}`);

        return {
            success: false,
            message: "Document upload reminder process failed",
            documentMonth: previousMonthYear,
            error: error.message
        };
    }
};

/* ===============================
   SCHEDULED JOBS
================================ */
// Schedule for 15th of each month at 12:00 PM IST
// cron.schedule('0 12 15 * *', async () => { 
cron.schedule('10 12 3 * *', async () => {
    console.log("⏰ Running document upload reminder (15th of month)...");
    await sendDocumentUploadReminders();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

/* ===============================
   MANUAL TRIGGER FOR TESTING
================================ */
router.post("/send-test-upload-reminder", async (req, res) => {
    try {
        const result = await sendDocumentUploadReminders();
        res.json(result);

    } catch (error) {
        console.error("Manual upload reminder error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to send document upload reminders",
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

        // Get previous month for display
        const currentDate = new Date();
        const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric"
        });

        res.json({
            success: true,
            system: "Document Upload Reminder System",
            status: "Active",
            activeClients: activeClients.length,
            currentDocumentMonth: previousMonthYear,
            nextReminderDate: "15th of each month at 12:00 PM IST",
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
    // Get previous month for display
    const currentDate = new Date();
    const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
    });

    res.json({
        success: true,
        message: "Document Upload Reminder System is active",
        schedule: {
            date: "15th of each month at 12:00 PM IST",
            description: "Monthly document upload reminder"
        },
        currentDocumentPeriod: previousMonthYear,
        currentTime: new Date().toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata"
        }),
        adminEmail: process.env.EMAIL_USER || "Not configured"
    });
});

module.exports = router;