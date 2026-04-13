// utils/backupCron.js
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Email function (reuse your existing sendEmail utility)
const sendEmail = require('./sendEmail');

// Schedule job to run on January 1st at 00:00 (midnight) Finland time
function scheduleBackupJob() {
    console.log("📅 Scheduling Annual Backup Cron Job...");
    console.log("⏰ Will run on: January 1st at 00:00 Finland time");
    console.log("📧 Email notifications: ONLY on FAILURE");
    
    // Run on Jan 1st at midnight
    cron.schedule('0 0 1 1 *', async () => {
        const startTime = new Date();
        console.log("=".repeat(60));
        console.log(`🎉 ANNUAL BACKUP CRON JOB STARTED at: ${startTime.toLocaleString("en-IN", { timeZone: "Europe/Helsinki" })}`);
        console.log("=".repeat(60));
        
        const scriptPath = path.join(__dirname, "..", "scripts", "backupAndDelete.js");
        
        // Check if script exists
        if (!fs.existsSync(scriptPath)) {
            const errorMsg = `Backup script not found at: ${scriptPath}`;
            console.error(`❌ ${errorMsg}`);
            
            // Send failure email
            await sendFailureEmail({
                error: errorMsg,
                startTime: startTime,
                stage: "Script Not Found"
            });
            return;
        }
        
        // Execute the backup script
        exec(`node ${scriptPath}`, { timeout: 3600000 }, async (error, stdout, stderr) => {
            const endTime = new Date();
            
            if (error) {
                // FAILURE - Send email
                console.error(`❌ Backup Cron Error: ${error.message}`);
                console.error(`Stderr: ${stderr}`);
                
                await sendFailureEmail({
                    error: error.message,
                    stderr: stderr,
                    stdout: stdout,
                    startTime: startTime,
                    endTime: endTime,
                    stage: "Script Execution Failed"
                });
            } else if (stderr && stderr.includes("ERROR")) {
                // Partial failure - Send email
                console.error(`⚠️ Backup Cron had warnings/errors: ${stderr}`);
                
                await sendFailureEmail({
                    error: "Script completed with errors/warnings",
                    stderr: stderr,
                    stdout: stdout,
                    startTime: startTime,
                    endTime: endTime,
                    stage: "Partial Failure"
                });
            } else {
                // SUCCESS - No email (as requested)
                console.log(`✅ Backup Cron Output: ${stdout}`);
                console.log(`🎉 ANNUAL BACKUP COMPLETED SUCCESSFULLY at: ${endTime.toLocaleString("en-IN", { timeZone: "Europe/Helsinki" })}`);
                console.log("=".repeat(60));
            }
        });
    }, {
        timezone: "Europe/Helsinki"
    });
    
    console.log("✅ Annual Backup Cron Job Scheduled Successfully!");
    console.log("📧 Failure notifications will be sent to admin email");
}

// Function to send failure email
async function sendFailureEmail(data) {
    try {
        const adminEmail = process.env.EMAIL_USER;
        if (!adminEmail) {
            console.error("❌ Admin email not configured in .env");
            return;
        }
        
        const finlandTime = (date) => {
            return date.toLocaleString("en-IN", { timeZone: "Europe/Helsinki" });
        };
        
        const subject = `⚠️ URGENT: Annual Backup CRON Job FAILED - ${new Date().toLocaleDateString()}`;
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #dc3545; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
        .error-box { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; margin: 15px 0; border-radius: 5px; color: #721c24; }
        .info-box { background-color: #e2f3f5; border: 1px solid #bee5eb; padding: 15px; margin: 15px 0; border-radius: 5px; }
        .label { font-weight: bold; color: #555; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>⚠️ ANNUAL BACKUP CRON JOB FAILED</h2>
        </div>
        <div class="content">
            <div class="error-box">
                <p><strong>❌ The annual backup cron job failed to complete successfully.</strong></p>
                <p><strong>Stage:</strong> ${data.stage || "Unknown"}</p>
            </div>
            
            <div class="info-box">
                <h3>📋 Job Details</h3>
                <p><span class="label">Started at:</span> ${finlandTime(data.startTime)}</p>
                <p><span class="label">Ended at:</span> ${data.endTime ? finlandTime(data.endTime) : "N/A"}</p>
                <p><span class="label">Target Year:</span> ${new Date().getFullYear() - 2}</p>
                <p><span class="label">Server Time:</span> ${finlandTime(new Date())}</p>
            </div>
            
            <div class="error-box">
                <h3>🔴 Error Details</h3>
                <p><strong>Error Message:</strong></p>
                <pre>${data.error || "Unknown error"}</pre>
                
                ${data.stderr ? `<p><strong>Stderr Output:</strong></p><pre>${data.stderr}</pre>` : ''}
                
                ${data.stdout ? `<p><strong>Stdout Output:</strong></p><pre>${data.stdout.substring(0, 2000)}</pre>` : ''}
            </div>
            
            <div class="info-box">
                <h3>📝 Required Actions</h3>
                <ul>
                    <li>Check the server logs immediately</li>
                    <li>Verify MongoDB connection</li>
                    <li>Check disk space on server</li>
                    <li>Run manual backup if needed</li>
                    <li>Investigate the error and fix the issue</li>
                </ul>
            </div>
            
            <div class="info-box">
                <h3>🔧 Manual Backup Command</h3>
                <pre>cd ${path.join(__dirname, "..")} && node scripts/backupAndDelete.js</pre>
                <p><strong>Dry run first:</strong></p>
                <pre>node scripts/backupAndDelete.js --dry-run</pre>
            </div>
            
            <p><strong>⚠️ This is an automated alert. Please investigate immediately.</strong></p>
        </div>
        <div class="footer">
            <p>Credence Enterprise Accounting Services - Backup System</p>
        </div>
    </div>
</body>
</html>
        `;
        
        await sendEmail(adminEmail, subject, html);
        console.log(`📧 Failure email sent to: ${adminEmail}`);
        
    } catch (emailError) {
        console.error("❌ Failed to send failure email:", emailError.message);
    }
}

module.exports = { scheduleBackupJob };