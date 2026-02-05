const cron = require('node-cron');
const Client = require('../models/Client');
const ActivityLog = require('../models/ActivityLog');
const sendEmail = require('../utils/sendEmail');

// Console logging helper
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
  console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

const processScheduledPlanChanges = async () => {
  try {
    const today = new Date();
    const currentDate = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Only run on 1st of month 
    if (currentDate !== 1) {
      return;
    }

    logToConsole("INFO", "CRON_PLAN_CHANGE_START", {
      date: today.toLocaleDateString('en-IN'),
      month: currentMonth + 1,
      year: currentYear
    });

    // Find all clients with nextMonthPlan set
    const clientsWithPendingChanges = await Client.find({
      nextMonthPlan: { $ne: "", $exists: true }
    });

    logToConsole("INFO", "CRON_FOUND_CLIENTS", {
      count: clientsWithPendingChanges.length
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const client of clientsWithPendingChanges) {
      try {
        const oldPlan = client.planSelected;
        const newPlan = client.nextMonthPlan;

        // Update plan fields
        client.planSelected = newPlan;
        client.currentPlan = newPlan;
        client.nextMonthPlan = "";
        client.planEffectiveFrom = today;

        // Add to plan change history
        client.planChangeHistory.push({
          fromPlan: oldPlan,
          toPlan: newPlan,
          changeDate: today,
          effectiveFrom: today,
          requestedBy: 'system',
          notes: 'Automatically applied on 1st of month'
        });

        await client.save();

        // Log activity
        await ActivityLog.create({
          userName: client.name,
          role: "CLIENT",
          clientId: client.clientId,
          action: "PLAN_CHANGE_AUTO_APPLIED",
          details: `Plan automatically changed from ${oldPlan} to ${newPlan} on 1st of month`,
          dateTime: new Date(),
          metadata: {
            clientId: client.clientId,
            clientName: client.name,
            fromPlan: oldPlan,
            toPlan: newPlan,
            effectiveDate: today,
            processedBy: 'cron_job'
          }
        });

        // Send email to client
        try {
          const emailSubject = `✅ Plan Change Applied - ${client.businessName || client.name}`;
          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Plan Change Applied</title>
              <style>
                body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
                .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
                .content { padding: 30px; background: #ffffff; }
                .success-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
                .plan-details { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
                .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
                th { background: #f8f9fa; font-weight: 600; width: 40%; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Credence Accounting Services</h1>
                <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
              </div>
              
              <div class="content">
                <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
                
                <div class="success-box">
                  <h3 style="margin-top: 0; color: #4caf50;">✅ SCHEDULED PLAN CHANGE APPLIED</h3>
                  <p>Your scheduled plan change has been automatically applied as of today (1st of the month).</p>
                  <p><strong>Applied On:</strong> ${today.toLocaleDateString('en-IN')}</p>
                </div>
                
                <div class="plan-details">
                  <h3 style="color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px;">📋 Plan Change Details</h3>
                  <table>
                    <tr>
                      <th>Previous Plan</th>
                      <td>${oldPlan}</td>
                    </tr>
                    <tr>
                      <th>New Active Plan</th>
                      <td><strong>${newPlan}</strong></td>
                    </tr>
                    <tr>
                      <th>Effective Date</th>
                      <td><strong>${today.toLocaleDateString('en-IN')}</strong> (1st of month)</td>
                    </tr>
                    <tr>
                      <th>Billing Month</th>
                      <td>${today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td>
                    </tr>
                  </table>
                </div>
                
                <p style="margin-top: 25px; font-size: 14px; color: #666;">
                  Your account has been updated with the new plan. All future billing will be based on the ${newPlan} plan.
                </p>
              </div>
              
              <div class="footer">
                <p><strong>Credence Accounting Services</strong></p>
                <p>Professional Accounting | VAT Compliance | Business Advisory</p>
                <p style="font-size: 12px; margin-top: 10px;">
                  This is an automated notification email.<br>
                  Please do not reply to this email. For queries, contact support@jladgroup.fi<br>
                  Email sent to: ${client.email}
                </p>
              </div>
            </body>
            </html>
          `;

          await sendEmail(client.email, emailSubject, emailHtml);
          logToConsole("INFO", "CRON_PLAN_CHANGE_EMAIL_SENT", {
            clientId: client.clientId,
            email: client.email
          });

        } catch (emailError) {
          logToConsole("ERROR", "CRON_PLAN_CHANGE_EMAIL_FAILED", {
            clientId: client.clientId,
            error: emailError.message
          });
        }

        processedCount++;
        logToConsole("INFO", "CRON_PLAN_CHANGE_PROCESSED", {
          clientId: client.clientId,
          fromPlan: oldPlan,
          toPlan: newPlan
        });

      } catch (clientError) {
        failedCount++;
        logToConsole("ERROR", "CRON_PLAN_CHANGE_CLIENT_FAILED", {
          clientId: client.clientId,
          error: clientError.message
        });
      }
    }

    logToConsole("INFO", "CRON_PLAN_CHANGE_COMPLETED", {
      total: clientsWithPendingChanges.length,
      processed: processedCount,
      failed: failedCount
    });

  } catch (error) {
    logToConsole("ERROR", "CRON_PLAN_CHANGE_FAILED", {
      error: error.message,
      stack: error.stack
    });
  }
};

// Schedule to run daily at 2:00 AM
const schedulePlanChangeCron = () => {
  // Run every day at 2:00 AM
  cron.schedule('0 2 * * *', processScheduledPlanChanges);
  
  logToConsole("INFO", "CRON_PLAN_CHANGE_SCHEDULED", {
    schedule: "Daily at 2:00 AM",
    timezone: "System timezone"
  });
};

module.exports = {
  processScheduledPlanChanges,
  schedulePlanChangeCron
};