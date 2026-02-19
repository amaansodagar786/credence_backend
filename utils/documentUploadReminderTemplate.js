const documentUploadReminderTemplate = (client) => {
  const currentDate = new Date();
  
  // Get previous month (if current is Feb, previous is Jan)
  const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  
  const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Helsinki"  // Finland timezone
  });
  
  const currentMonth = currentDate.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Helsinki"  // Finland timezone
  });
  
  const currentDateTime = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Helsinki"  // Finland timezone
  }) + " at " + new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki"  // Changed from Asia/Kolkata
  }) + " EET/EEST";  // Changed from IST
  
  const deadlineDate = `25th ${currentMonth}`;
  
  return {
    subject: `📄 Document Upload Reminder - ${previousMonthYear} - ${client.businessName || "Your Business"}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Document Upload Reminder</title>
        <style>
          body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
          .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
          .content { padding: 30px; background: #ffffff; }
          .reminder-box { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
          .client-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
          .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
          .contact-info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; }
          .section-title { color: #2c3e50; border-bottom: 2px solid #2196f3; padding-bottom: 8px; margin-bottom: 20px; }
          .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
          .dev-link { color: #7cd64b !important; text-decoration: none; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
          th { background: #f8f9fa; font-weight: 600; width: 35%; }
          .ignore-note { background: #e8f5e9; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4caf50; }
          .important-note { background: #fff3e0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ff9800; }
          .deadline-box { background: #ffebee; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #f44336; }
          .warning { color: #f44336; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Credence Enterprise Accounting Services</h1>
          <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
        </div>
        
        <div class="content">
          <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
          
          <div class="reminder-box">
            <h3 style="margin-top: 0; color: #2196f3;">📄 DOCUMENT UPLOAD REMINDER</h3>
            <p>This is a gentle reminder to upload your data for <strong>${previousMonthYear}</strong>!</p>
            <p><strong>Reminder Sent:</strong> ${currentDateTime}</p>
          </div>
          
          <div class="deadline-box">
            <h4 style="margin-top: 0; color: #f44336;">⚠️ IMPORTANT DEADLINE</h4>
            <p class="warning">Please note that <strong>${deadlineDate}</strong> is the final deadline for uploading all required documents for ${previousMonthYear}.</p>
            <p>If the data is not received by this date, we will assume that there is no data for the month and will proceed with filing a Nil return.</p>
          </div>
          
          
          <div class="client-info">
            <h3 class="section-title">📋 Your Account Information</h3>
            <table>
              <tr>
                <th>Business Name</th>
                <td>${client.businessName || "Not specified"}</td>
              </tr>
              <tr>
                <th>Selected Plan</th>
                <td>${client.planSelected}</td>
              </tr>
              <tr>
                <th>VAT Period</th>
                <td>${client.vatPeriod === "monthly" ? "Monthly" : "Quarterly"}</td>
              </tr>
              <tr>
                <th>Document Month</th>
                <td><strong>${previousMonthYear}</strong></td>
              </tr>
              <tr>
                <th>Deadline Date</th>
                <td><strong class="warning">${deadlineDate}</strong></td>
              </tr>
            </table>
          </div>
          
          <div class="ignore-note">
            <p><strong>✅ Already Uploaded?</strong> If you have already uploaded your documents for ${previousMonthYear}, please <strong>politely ignore this reminder</strong>. Thank you!</p>
          </div>
          
          <p>If you have any questions regarding document uploads or need assistance, please contact our support team.</p>
          
          <div class="contact-info">
            <h3 class="section-title">📞 Our Contact Information</h3>
            <p><strong>Email:</strong> support@jladgroup.fi</p>
            <p><strong>Phone Support:</strong> +358 45 8591505</p>
            <p><strong>Business Hours:</strong> Monday to Fri 9am to 3pm (EET/EEST)</p>
          </div>
          
          <p style="margin-top: 25px; font-size: 14px; color: #666;">
            <strong>Note:</strong> Timely document upload ensures smooth VAT filing and compliance for your business.
          </p>
        </div>
        
        <div class="footer">
          <p><strong>Credence Enterprise Accounting Services</strong></p>
          <p>Professional Accounting | VAT Compliance | Business Advisory</p>
          <div class="dev-info">
            Developed by Vapautus Media Private Limited
          </div>
          <p style="font-size: 12px; margin-top: 10px;">
            This is an automated document upload reminder email.<br>
            Please do not reply to this email. For queries, contact support@jladgroup.fi<br>
            Email sent to: ${client.email}
          </p>
        </div>
      </body>
      </html>
    `
  };
};

module.exports = documentUploadReminderTemplate;