const paymentReminderTemplate = (client) => {
  const currentDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  
  const currentTime = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
  
  return {
    subject: `💰 Monthly Payment Reminder - ${client.businessName || "Your Business"}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Reminder</title>
        <style>
          body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
          .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
          .content { padding: 30px; background: #ffffff; }
          .reminder-box { background: #fff8e1; border-left: 4px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
          .client-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
          .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
          .contact-info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; }
          .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
          .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
          .dev-link { color: #7cd64b !important; text-decoration: none; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
          th { background: #f8f9fa; font-weight: 600; width: 35%; }
          .ignore-note { background: #e8f5e9; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4caf50; }
          .important-note { color: #ff9800; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Credence Accounting Services</h1>
          <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
        </div>
        
        <div class="content">
          <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
          
          <div class="reminder-box">
            <h3 style="margin-top: 0; color: #ff9800;">💰 MONTHLY PAYMENT REMINDER</h3>
            <p>This is a friendly reminder regarding your monthly accounting service payment.</p>
            <p class="important-note">Please ensure timely payment for uninterrupted services.</p>
            <p><strong>Reminder Sent:</strong> ${currentDate} at ${currentTime} IST</p>
          </div>
          
          <div class="client-info">
            <h3 class="section-title">📋 Your Account Information</h3>
            <table>
              <tr>
                <th>Client ID</th>
                <td>${client.clientId}</td>
              </tr>
              <tr>
                <th>Business Name</th>
                <td>${client.businessName || "Not specified"}</td>
              </tr>
              <tr>
                <th>Selected Plan</th>
                <td>${client.planSelected}</td>
              </tr>
              <tr>
                <th>Contact Email</th>
                <td>${client.email}</td>
              </tr>
              <tr>
                <th>Contact Phone</th>
                <td>${client.phone || "Not provided"}</td>
              </tr>
              <tr>
                <th>VAT Period</th>
                <td>${client.vatPeriod === "monthly" ? "Monthly" : "Quarterly"}</td>
              </tr>
            </table>
          </div>
          
          <div class="ignore-note">
            <p><strong>✅ Already Paid?</strong> If you have already made the payment for this month, please <strong>politely ignore this reminder</strong>. Thank you for your timely payment!</p>
          </div>
          
          <p>If you have any questions regarding your invoice or need assistance with payment, please contact our billing department.</p>
          
          <div class="contact-info">
            <h3 class="section-title">📞 Our Contact Information</h3>
            <p><strong>Billing Department:</strong> ${process.env.EMAIL_USER || "billing@credence-accounting.com"}</p>
            <p><strong>Support Email:</strong> support@credence-accounting.com</p>
            <p><strong>Phone Support:</strong> +91 12345 67890</p>
            <p><strong>Business Hours:</strong> Monday - Friday, 9:00 AM - 6:00 PM (IST)</p>
          </div>
          
          <p style="margin-top: 25px; font-size: 14px; color: #666;">
            <strong>Note:</strong> Timely payments ensure uninterrupted accounting services and VAT compliance for your business.
          </p>
        </div>
        
        <div class="footer">
          <p><strong>Credence Accounting Services</strong></p>
          <p>Professional Accounting | VAT Compliance | Business Advisory</p>
          <div class="dev-info">
            Designed & Developed by <a href="https://techorses.com" target="_blank" class="dev-link">Techorses</a>
          </div>
          <p style="font-size: 12px; margin-top: 10px;">
            This is an automated payment reminder email.<br>
            Please do not reply to this email. For queries, contact billing@credence-accounting.com<br>
            Email sent to: ${client.email}
          </p>
        </div>
      </body>
      </html>
    `
  };
};

module.exports = paymentReminderTemplate;