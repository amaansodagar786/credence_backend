const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const ClientEnrollment = require("../models/ClientEnrollment");
const Client = require("../models/Client");
const ActivityLog = require("../models/ActivityLog");

const sendEmail = require("../utils/sendEmail");
const auth = require("../middleware/authMiddleware");

const router = express.Router();



/* ===============================
   CONSOLE LOGGING UTILITY
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
   CLIENT ENROLLMENT ROUTE
================================ */
router.post("/enroll", async (req, res) => {
  let enrollment = null;

  try {
    console.log("📨 FULL REQUEST BODY:", req.body);

    // EXTRACT ALL FIELDS FROM REQUEST
    const enrollmentData = {
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      address: req.body.address || '',
      visaType: req.body.visaType || '',
      hasStrongId: req.body.hasStrongId || '',
      mobile: req.body.mobile || '',
      email: req.body.email || '',
      businessAddress: req.body.businessAddress || '',
      bankAccount: req.body.bankAccount || '',
      bicCode: req.body.bicCode || '',
      businessName: req.body.businessName || '',
      vatPeriod: req.body.vatPeriod || '',
      businessNature: req.body.businessNature || '',
      registerTrade: req.body.registerTrade || '',
      planSelected: req.body.planSelected || ''
    };

    console.log("📋 PROCESSED DATA:", enrollmentData);

    // Validate required fields
    if (!enrollmentData.firstName || !enrollmentData.lastName || !enrollmentData.email || !enrollmentData.mobile || !enrollmentData.planSelected) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
        missing: {
          firstName: !enrollmentData.firstName,
          lastName: !enrollmentData.lastName,
          email: !enrollmentData.email,
          mobile: !enrollmentData.mobile,
          planSelected: !enrollmentData.planSelected
        }
      });
    }

    // Check if email already exists
    const existingEnrollment = await ClientEnrollment.findOne({
      email: enrollmentData.email.toLowerCase().trim(),
      status: { $in: ["PENDING", "APPROVED"] }
    });

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: "An enrollment with this email already exists",
        currentStatus: existingEnrollment.status,
        enrollId: existingEnrollment.enrollId
      });
    }

    // Generate unique enrollment ID
    const enrollId = uuidv4();
    enrollmentData.enrollId = enrollId;
    enrollmentData.status = "PENDING";
    enrollmentData.email = enrollmentData.email.toLowerCase().trim();

    console.log("💾 FINAL DATA TO SAVE:", enrollmentData);

    // Create enrollment record
    enrollment = await ClientEnrollment.create(enrollmentData);

    console.log("✅ ENROLLMENT SAVED TO DB:", {
      _id: enrollment._id,
      enrollId: enrollment.enrollId,
      firstName: enrollment.firstName,
      lastName: enrollment.lastName,
      email: enrollment.email,
      mobile: enrollment.mobile,
      planSelected: enrollment.planSelected
    });

    // Log the activity
    await ActivityLog.create({
      userName: `${enrollmentData.firstName} ${enrollmentData.lastName}`,
      role: "CLIENT",
      enrollId,
      action: "CLIENT_ENROLL",
      details: `Client enrollment submitted for ${enrollmentData.planSelected} plan`,
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "CLIENT_ENROLL",
      enrollId,
      clientName: `${enrollmentData.firstName} ${enrollmentData.lastName}`
    });

    // ===========================================
    // SEND NOTIFICATION EMAIL TO ADMIN (UPDATED)
    // ===========================================
    try {
      const adminEmail = "support@jladgroup.fi";
      const currentDateTime = new Date().toLocaleString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Kolkata"
      });

      const adminNotificationSubject = `🚨 New Client Enrollment - ${enrollment.businessName || enrollment.firstName + " " + enrollment.lastName}`;

      await sendEmail(
        adminEmail,
        adminNotificationSubject,
        `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Enrollment Notification</title>
            <style>
              body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 25px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 22px; color: #7cd64b; }
              .content { padding: 30px; background: #ffffff; }
              .alert-box { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
              .info-box { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 20px 0; border-radius: 8px; }
              .quick-actions { background: #e8f5e9; border: 1px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; font-size: 14px; }
              .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 15px; font-size: 18px; }
              .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
              .dev-link { color: #7cd64b !important; text-decoration: none; }
              table { width: 100%; border-collapse: collapse; margin: 15px 0; }
              th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
              th { background: #f8f9fa; font-weight: 600; width: 35%; }
              .status-badge { display: inline-block; padding: 4px 10px; background: #ff9800; color: #000; border-radius: 12px; font-size: 12px; font-weight: 600; }
              .action-btn { display: inline-block; padding: 8px 16px; background: #7cd64b; color: #000000; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px; margin: 5px; }
              .admin-url { color: #7cd64b; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Credence Enterprise Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9; font-size: 14px;">Admin Notification - New Enrollment</p>
            </div>
            
            <div class="content">
              <div class="alert-box">
                <h2 style="margin-top: 0; color: #2196f3;">📋 New Client Enrollment Received!</h2>
                <p>A new client has submitted an enrollment form and is awaiting your review.</p>
                <p><strong>Submission Time:</strong> ${currentDateTime} EET/EEST</p>
              </div>
              
              <div class="info-box">
                <h3 class="section-title">📊 Enrollment Summary</h3>
                <table>
                  <tr>
                    <th>Enrollment ID</th>
                    <td><strong>${enrollment.enrollId}</strong></td>
                  </tr>
                  <tr>
                    <th>Client Name</th>
                    <td>${enrollment.firstName} ${enrollment.lastName}</td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>${enrollment.email}</td>
                  </tr>
                  <tr>
                    <th>Phone</th>
                    <td>${enrollment.mobile || "Not provided"}</td>
                  </tr>
                  <tr>
                    <th>Business Name</th>
                    <td>${enrollment.businessName || "Not provided"}</td>
                  </tr>
                  <tr>
                    <th>Selected Plan</th>
                    <td><strong>${enrollment.planSelected}</strong></td>
                  </tr>
                  <tr>
                    <th>Current Status</th>
                    <td><span class="status-badge">PENDING REVIEW</span></td>
                  </tr>
                </table>
              </div>
              
              <div class="info-box">
                <h3 class="section-title">📝 Additional Details</h3>
                <table>
                  <tr>
                    <th>Visa Type</th>
                    <td>${enrollment.visaType || "Not provided"}</td>
                  </tr>
                  <tr>
                    <th>Strong ID Available</th>
                    <td>${enrollment.hasStrongId === "yes" ? "✅ Yes" : "❌ No"}</td>
                  </tr>
                  <tr>
                    <th>VAT Period</th>
                    <td>${enrollment.vatPeriod === "monthly" ? "Monthly" : "Quarterly"}</td>
                  </tr>
                  <tr>
                    <th>Nature of Business</th>
                    <td>${enrollment.businessNature || "Not specified"}</td>
                  </tr>
                  <tr>
                    <th>Trade Register</th>
                    <td>${enrollment.registerTrade === "yes" ? "✅ Registered" : "❌ Not Registered"}</td>
                  </tr>
                  <tr>
                    <th>Address</th>
                    <td>${enrollment.address || "Not provided"}</td>
                  </tr>
                </table>
              </div>
              
              
              <div style="margin-top: 25px; padding: 15px; background: #fff8e1; border-radius: 8px; border-left: 4px solid #ffc107;">
                <h4 style="margin-top: 0; color: #ff9800;">📋 Next Steps Required:</h4>
                <ol style="margin-bottom: 0;">
                  <li>Review the client's information in the admin panel</li>
                  <li>Verify business details and plan selection</li>
                  <li>Approve to create client account OR Reject with reason</li>
                  <li>System will automatically send approval/rejection email to client</li>
                </ol>
              </div>
            </div>
            
            <div class="footer">
              <p style="font-size: 16px; margin-bottom: 10px;"><strong>Credence Enterprise Accounting Services - Admin Panel</strong></p>
              <p style="margin-bottom: 10px; opacity: 0.9; font-size: 14px;">Professional Client Management System</p>
              <div class="dev-info">
                System Notification | Developed by Vapautus Media Private Limited
              </div>
              <p style="font-size: 12px; margin-top: 15px; opacity: 0.7;">
                © ${new Date().getFullYear()} Credence Enterprise Accounting Services. All rights reserved.<br>
                This is an automated notification email from the enrollment system.
              </p>
            </div>
          </body>
          </html>
        `
      );

      console.log("📧 ADMIN NOTIFICATION EMAIL SENT to:", adminEmail);
      logToConsole("INFO", "ADMIN_NOTIFICATION_SENT", {
        to: adminEmail,
        enrollId: enrollment.enrollId,
        clientName: `${enrollment.firstName} ${enrollment.lastName}`
      });

    } catch (emailError) {
      console.error("❌ ADMIN NOTIFICATION EMAIL FAILED:", emailError);
      logToConsole("ERROR", "ADMIN_NOTIFICATION_FAILED", {
        email: adminEmail,
        error: emailError.message,
        enrollId: enrollment.enrollId
      });
      // Don't fail the enrollment if admin email fails
    }

    // ===========================================
    // SEND CONFIRMATION EMAIL TO CLIENT (UPDATED)
    // ===========================================
    try {
      await sendEmail(
        enrollment.email,
        "Enrollment Submitted Successfully - Credence Enterprise Accounting Services",
        `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Enrollment Confirmation</title>
            <style>
              body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 25px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 22px; color: #7cd64b; }
              .content { padding: 25px; background: #ffffff; }
              .confirmation-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
              .info-box { background: #f8f9fa; border: 1px solid #e9ecef; padding: 15px; margin: 15px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; font-size: 14px; }
              .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
              .dev-link { color: #7cd64b !important; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Credence Enterprise Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9;">Enrollment Confirmation</p>
            </div>
            
            <div class="content">
              <div class="confirmation-box">
                <h2 style="margin-top: 0; color: #4caf50;">✅ Enrollment Submitted Successfully!</h2>
                <p>Dear ${enrollment.firstName} ${enrollment.lastName},</p>
                <p>Thank you for choosing Credence Enterprise Accounting Services. Your enrollment has been received and is currently under review.</p>
              </div>
              
              <div class="info-box">
                <p><strong>Enrollment ID:</strong> ${enrollment.enrollId}</p>
                <p><strong>Selected Plan:</strong> ${enrollment.planSelected}</p>
                <p><strong>Status:</strong> <span style="color: #ff9800; font-weight: 600;">Pending Review</span></p>
                <p><strong>Submission Date:</strong> ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
              
              <div class="info-box">
                <h3 style="margin-top: 0;">What Happens Next?</h3>
                <ol>
                  <li>Our team will review your application within 24-48 hours</li>
                  <li>You will receive an approval or rejection email with details</li>
                  <li>If approved, you'll get login credentials for your client portal</li>
                  <li>You can then upload documents and start using our services</li>
                </ol>
              </div>
              
              <p style="margin-top: 20px;">If you have any questions, please contact our support team.</p>
            </div>
            
            <div class="footer">
              <p><strong>Credence Enterprise Accounting Services</strong></p>
              <p>Professional Accounting | VAT Compliance | Business Advisory</p>
              <div class="dev-info">
                Developed by Vapautus Media Private Limited
              </div>
              <p style="font-size: 12px; margin-top: 10px;">
                This email confirms your enrollment submission.<br>
                Please do not reply to this automated email.
              </p>
            </div>
          </body>
          </html>
        `
      );

      console.log("📧 CLIENT CONFIRMATION EMAIL SENT to:", enrollment.email);
      logToConsole("INFO", "CLIENT_CONFIRMATION_EMAIL_SENT", {
        to: enrollment.email,
        enrollId: enrollment.enrollId
      });

    } catch (clientEmailError) {
      console.error("❌ CLIENT CONFIRMATION EMAIL FAILED:", clientEmailError);
      logToConsole("ERROR", "CLIENT_CONFIRMATION_EMAIL_FAILED", {
        email: enrollment.email,
        error: clientEmailError.message,
        enrollId: enrollment.enrollId
      });
      // Don't fail the enrollment if client email fails
    }

    res.status(201).json({
      success: true,
      message: "Enrollment submitted successfully",
      enrollId,
      status: "PENDING",
      savedData: {
        firstName: enrollment.firstName,
        lastName: enrollment.lastName,
        email: enrollment.email,
        mobile: enrollment.mobile
      }
    });

    logToConsole("SUCCESS", "CLIENT_ENROLLMENT_COMPLETE", {
      enrollId,
      clientName: `${enrollment.firstName} ${enrollment.lastName}`,
      email: enrollment.email,
      planSelected: enrollment.planSelected
    });

  } catch (error) {
    console.error("❌ ENROLLMENT ERROR:", error);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      errors: error.errors
    });

    logToConsole("ERROR", "CLIENT_ENROLLMENT_FAILED", {
      error: error.message,
      stack: error.stack,
      requestBody: req.body
    });

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate enrollment detected",
        error: "DUPLICATE_ENROLLMENT"
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error during enrollment",
      error: error.message
    });
  }
});

/* ===============================
   ADMIN VIEW ALL ENROLLMENTS
================================ */
router.get("/all", auth, async (req, res) => {
  try {
    logToConsole("INFO", "GET_ALL_ENROLLMENTS_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name
    });

    const data = await ClientEnrollment.find().sort({ createdAt: -1 });

    // Create activity log for viewing all enrollments
    await ActivityLog.create({
      userName: req.user.name,
      role: "ADMIN",
      adminId: req.user.adminId,
      action: "ALL_ENROLLMENTS_VIEWED",
      details: `Admin viewed all client enrollments (${data.length} records)`,
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "ALL_ENROLLMENTS_VIEWED",
      adminId: req.user.adminId,
      count: data.length
    });

    logToConsole("SUCCESS", "ALL_ENROLLMENTS_FETCHED", {
      count: data.length,
      adminId: req.user.adminId
    });

    res.json({
      success: true,
      count: data.length,
      enrollments: data
    });
  } catch (error) {
    console.error("Error fetching enrollments:", error);

    logToConsole("ERROR", "GET_ALL_ENROLLMENTS_FAILED", {
      error: error.message,
      stack: error.stack,
      adminId: req.user?.adminId
    });

    res.status(500).json({
      message: "Server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   ADMIN VIEW SINGLE ENROLLMENT
================================ */
router.get("/:enrollId", auth, async (req, res) => {
  try {
    logToConsole("INFO", "GET_SINGLE_ENROLLMENT_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      enrollId: req.params.enrollId
    });

    const enrollment = await ClientEnrollment.findOne({
      enrollId: req.params.enrollId
    });

    if (!enrollment) {
      logToConsole("WARN", "ENROLLMENT_NOT_FOUND", {
        enrollId: req.params.enrollId,
        adminId: req.user.adminId
      });
      return res.status(404).json({
        message: "Enrollment not found",
        success: false
      });
    }

    // Create activity log for viewing single enrollment
    await ActivityLog.create({
      userName: req.user.name,
      role: "ADMIN",
      adminId: req.user.adminId,
      enrollId: enrollment.enrollId,
      action: "SINGLE_ENROLLMENT_VIEWED",
      details: `Admin viewed enrollment details for ${enrollment.firstName} ${enrollment.lastName}`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        clientName: `${enrollment.firstName} ${enrollment.lastName}`,
        email: enrollment.email,
        status: enrollment.status,
        planSelected: enrollment.planSelected
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "SINGLE_ENROLLMENT_VIEWED",
      adminId: req.user.adminId,
      enrollId: enrollment.enrollId
    });

    logToConsole("SUCCESS", "SINGLE_ENROLLMENT_FETCHED", {
      enrollId: enrollment.enrollId,
      clientName: `${enrollment.firstName} ${enrollment.lastName}`,
      status: enrollment.status
    });

    res.json({
      success: true,
      enrollment
    });
  } catch (error) {
    console.error("Error fetching enrollment:", error);

    logToConsole("ERROR", "GET_SINGLE_ENROLLMENT_FAILED", {
      error: error.message,
      stack: error.stack,
      enrollId: req.params.enrollId,
      adminId: req.user?.adminId
    });

    res.status(500).json({
      message: "Server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post("/action", auth, async (req, res) => {
  try {
    const { enrollId, action, rejectionReason } = req.body;

    logToConsole("INFO", "ADMIN_ACTION_REQUEST", {
      enrollId,
      action,
      adminId: req.user.adminId,
      adminName: req.user.name
    });

    // 1. FIND ENROLLMENT
    const enrollment = await ClientEnrollment.findOne({ enrollId });
    if (!enrollment) {
      logToConsole("WARN", "ENROLLMENT_NOT_FOUND", {
        enrollId,
        adminId: req.user.adminId
      });
      return res.status(404).json({
        success: false,
        message: "Enrollment not found"
      });
    }

    logToConsole("DEBUG", "ENROLLMENT_FOUND", {
      enrollId: enrollment.enrollId,
      email: enrollment.email,
      status: enrollment.status
    });

    // Get current date and time for email
    const currentDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    const currentTime = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Helsinki"
    });

    // 2. REJECT ENROLLMENT
    if (action === "REJECT") {
      enrollment.status = "REJECTED";
      enrollment.reviewedBy = req.user.adminId;
      enrollment.reviewedAt = new Date();
      enrollment.rejectionReason = rejectionReason || "No reason provided";

      await enrollment.save();
      logToConsole("INFO", "ENROLLMENT_REJECTED", {
        enrollId: enrollment.enrollId,
        email: enrollment.email,
        adminId: req.user.adminId
      });

      // Send professional rejection email (UPDATED)
      try {
        await sendEmail(
          enrollment.email,
          `Application Status Update - ${enrollment.businessName || "Your Business"} | Credence Enterprise Accounting Services`,
          `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Application Status Update</title>
              <style>
                body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
                .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
                .content { padding: 30px; background: #ffffff; }
                .status-box { background: #fff5f5; border-left: 4px solid #ff6b6b; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
                .info-box { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
                .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; border-top: 1px solid #dee2e6; }
                .contact-info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; }
                .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
                .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
                .dev-link { color: #7cd64b !important; text-decoration: none; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Credence Enterprise Accounting Services</h1>
                <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
              </div>
              
              <div class="content">
                <h2 style="color: #2c3e50; margin-top: 0;">Dear ${enrollment.firstName} ${enrollment.lastName},</h2>
                
                <p>Thank you for your interest in Credence Enterprise Accounting Services. We have reviewed your application submitted on ${new Date(enrollment.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</p>
                
                <div class="status-box">
                  <h3 style="color: #ff6b6b; margin-top: 0;">Application Status: <strong>Rejected</strong></h3>
                  <p><strong>Application ID:</strong> ${enrollment.enrollId}</p>
                  <p><strong>Review Date:</strong> ${currentDate}</p>
                  <p><strong>Review Time:</strong> ${currentTime} EET/EEST</p>
                  <p><strong>Review By:</strong> ${req.user.name || "Administrator"}</p>
                </div>
                
                <div class="info-box">
                  <h4 class="section-title">Reason for Rejection</h4>
                  <p>${enrollment.rejectionReason || "No specific reason provided."}</p>
                </div>
                
                <div class="info-box">
                  <h4 class="section-title">Application Details</h4>
                  <p><strong>Business Name:</strong> ${enrollment.businessName || "Not provided"}</p>
                  <p><strong>Selected Plan:</strong> ${enrollment.planSelected || "Not selected"}</p>
                  <p><strong>Contact Email:</strong> ${enrollment.email}</p>
                  <p><strong>Contact Phone:</strong> ${enrollment.mobile || "Not provided"}</p>
                </div>
                
                <p>If you believe there has been an error, or if you wish to provide additional information, please feel free to contact our support team for clarification.</p>
                
                <div class="contact-info">
                  <h4 class="section-title">📞 Our Contact Information</h4>
                  <p><strong>Email:</strong> support@jladgroup.fi</p>
<p><strong>Phone Support:</strong> +358413250081</p>                  <p><strong>Business Hours:</strong> Monday to Fri 9am to 3pm (EET/EEST)</p>
                </div>
              </div>
              
              <div class="footer">
                <p><strong>Credence Enterprise Accounting Services</strong></p>
                <p>Professional Accounting | VAT Compliance | Business Advisory</p>
                <p>© ${new Date().getFullYear()} Credence Enterprise Accounting Services. All rights reserved.</p>
                <div class="dev-info">
                  Developed by Vapautus Media Private Limited
                </div>
                <p style="font-size: 12px; margin-top: 10px;">
                  This email was sent to ${enrollment.email} regarding your application.<br>
                  Please do not reply to this automated email.
                </p>
              </div>
            </body>
            </html>
          `
        );
        logToConsole("INFO", "REJECTION_EMAIL_SENT", {
          to: enrollment.email,
          enrollId: enrollment.enrollId
        });
      } catch (emailError) {
        logToConsole("ERROR", "REJECTION_EMAIL_FAILED", {
          email: enrollment.email,
          error: emailError.message,
          enrollId: enrollment.enrollId
        });
      }

      // Activity log
      await ActivityLog.create({
        userName: req.user.name,
        role: "ADMIN",
        adminId: req.user.adminId,
        enrollId,
        action: "CLIENT_REJECTED",
        details: `Client enrollment rejected. Reason: ${enrollment.rejectionReason}`,
        // dateTime: new Date().toLocaleString("en-IN")
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "CLIENT_REJECTED",
        adminId: req.user.adminId,
        enrollId: enrollment.enrollId
      });

      return res.json({
        success: true,
        message: "Client enrollment rejected successfully",
        enrollId: enrollment.enrollId,
        status: "REJECTED"
      });
    }

    // 3. APPROVE ENROLLMENT
    if (action === "APPROVE") {
      // Check if client already exists with this email
      const existingClient = await Client.findOne({
        email: enrollment.email
      });

      if (existingClient) {
        logToConsole("WARN", "DUPLICATE_CLIENT_EMAIL", {
          email: enrollment.email,
          existingClientId: existingClient.clientId,
          adminId: req.user.adminId
        });
        return res.status(409).json({
          success: false,
          message: "A client with this email already exists",
          clientId: existingClient.clientId
        });
      }

      // Generate client ID and password
      const clientId = uuidv4();
      const plainPassword = `${enrollment.firstName.trim()}@1234`;
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      // Prepare client data
      const clientData = {
        clientId,
        name: `${enrollment.firstName} ${enrollment.lastName}`,
        email: enrollment.email.toLowerCase().trim(),
        phone: enrollment.mobile,
        address: enrollment.address,
        password: hashedPassword,
        isActive: true,
        firstName: enrollment.firstName,
        lastName: enrollment.lastName,
        visaType: enrollment.visaType,
        hasStrongId: enrollment.hasStrongId,
        businessAddress: enrollment.businessAddress,
        bankAccount: enrollment.bankAccount,
        bicCode: enrollment.bicCode,
        businessName: enrollment.businessName,
        vatPeriod: enrollment.vatPeriod,
        businessNature: enrollment.businessNature,
        registerTrade: enrollment.registerTrade,
        planSelected: enrollment.planSelected,
        currentPlan: enrollment.planSelected,
        enrollmentId: enrollment.enrollId,
        enrollmentDate: new Date(),
        documents: new Map(),
        employeeAssignments: []
      };

      logToConsole("INFO", "CREATING_CLIENT", {
        clientId,
        email: clientData.email,
        planSelected: clientData.planSelected,
        adminId: req.user.adminId
      });

      // Create client account
      const client = await Client.create(clientData);
      logToConsole("INFO", "CLIENT_CREATED", {
        clientId: client.clientId,
        name: client.name,
        adminId: req.user.adminId
      });

      // Update enrollment status
      enrollment.status = "APPROVED";
      enrollment.reviewedBy = req.user.adminId;
      enrollment.reviewedAt = new Date();
      enrollment.clientId = clientId;
      await enrollment.save();
      logToConsole("INFO", "ENROLLMENT_APPROVED", {
        enrollId: enrollment.enrollId,
        clientId,
        adminId: req.user.adminId
      });

      // Send professional welcome email to client (UPDATED)
      try {
        logToConsole("DEBUG", "SENDING_WELCOME_EMAIL", {
          to: enrollment.email,
          clientId
        });

        // Client portal URL (update with your actual URL)
        const portalUrl = "https://jladgroup.fi/login";

        await sendEmail(
          enrollment.email,
          `Welcome to Credence Enterprise Accounting Services - Account Approved & Activated`,
          `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Account Approval Confirmation</title>
              <style>
                body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
                .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
                .header h1 { margin: 0; font-size: 26px; color: #7cd64b; }
                .content { padding: 35px; background: #ffffff; }
                .credentials-box { background: #f0f9ff; border: 2px solid #7cd64b; padding: 25px; margin: 25px 0; border-radius: 8px; }
                .client-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
                .important-box { background: #fff8e1; border-left: 4px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
                .terms-box { background: #ffffff; padding: 25px; margin: 25px 0; border: 2px solid #7cd64b; border-radius: 8px; }
                .footer { background: #111111; color: #ffffff; padding: 25px; text-align: center; }
                .contact-info { margin-top: 25px; padding-top: 25px; border-top: 1px solid #dee2e6; }
                .login-button { display: inline-block; padding: 14px 32px; background: #7cd64b; color: #000000; text-decoration: none; border-radius: 4px; font-weight: 700; font-size: 16px; margin: 15px 0; }
                .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 10px; margin-bottom: 20px; font-size: 18px; }
                ul { padding-left: 20px; }
                li { margin-bottom: 12px; }
                .highlight { background: #7cd64b; color: #000000; padding: 3px 6px; border-radius: 3px; font-weight: 600; }
                .warning { color: #dc3545; font-weight: 600; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #dee2e6; }
                th { background: #f8f9fa; font-weight: 600; }
                .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
                .dev-link { color: #7cd64b !important; text-decoration: none; }
                .terms-list li { margin-bottom: 15px; line-height: 1.8; }
                .sub-heading { color: #2c3e50; font-weight: 600; margin-top: 20px; margin-bottom: 10px; }
                .guideline-item { margin-bottom: 15px; padding-left: 10px; border-left: 3px solid #7cd64b; }
                .guideline-number { font-weight: 700; color: #2c3e50; margin-right: 8px; }
                .plan-table { width: 100%; border: 1px solid #dee2e6; border-collapse: collapse; margin: 15px 0; }
                .plan-table th { background: #7cd64b; color: #000; padding: 12px; text-align: center; }
                .plan-table td { padding: 10px; text-align: center; border: 1px solid #dee2e6; }
                .plan-table .lite-bg { background: #f8f9fa; }
                .plan-table .taxi-bg { background: #f8f9fa; }
                .plan-table .premium-bg { background: #f8f9fa; }
                .plan-table .pro-bg { background: #f8f9fa; }
                .plan-table .restaurant-bg { background: #f8f9fa; }
                .services-table { width: 100%; border: 1px solid #dee2e6; border-collapse: collapse; margin: 15px 0; }
                .services-table th { background: #2c3e50; color: #fff; padding: 12px; text-align: left; }
                .services-table td { padding: 12px; text-align: left; border: 1px solid #dee2e6; }
                .services-table tr:nth-child(even) { background: #f8f9fa; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Credence Enterprise Accounting Services</h1>
                <p style="margin-top: 5px; opacity: 0.9; font-size: 16px;">Professional Accounting | VAT Compliance | Business Advisory</p>
              </div>
              
              <div class="content">
                <h2 style="color: #2c3e50; margin-top: 0;">Welcome ${enrollment.firstName} ${enrollment.lastName}!</h2>
                
                <p>We are pleased to inform you that your application has been <span class="highlight">APPROVED</span> and your client account has been successfully activated.</p>
                
                <div class="credentials-box">
                  <h3 class="section-title">🔐 Your Portal Access Credentials</h3>
                  <p><strong>Client Portal URL:</strong> <a href="${portalUrl}" style="color: #7cd64b; text-decoration: none;">${portalUrl}</a></p>
                  <table>
                    <tr>
                      <th>Email Address</th>
                      <td>${enrollment.email}</td>
                    </tr>
                    <tr>
                      <th>Temporary Password</th>
                      <td><strong>${plainPassword}</strong></td>
                    </tr>
                    <tr>
                      <th>Client ID</th>
                      <td>${clientId}</td>
                    </tr>
                  </table>
                  <div style="text-align: center; margin-top: 20px;">
                    <a href="${portalUrl}" class="login-button">Login to Client Portal</a>
                  </div>
                  <p style="margin-top: 15px; font-size: 14px; color: #6c757d;">
                    <strong>Important:</strong> Please change your password after first login for security.
                  </p>
                </div>
                
                <div class="client-info">
                  <h3 class="section-title">📋 Your Account Details</h3>
                  <table>
                    <tr>
                      <th>Application Approved On</th>
                      <td>${currentDate} at ${currentTime} EET/EEST</td>
                    </tr>
                    <tr>
                      <th>Approved By</th>
                      <td>${req.user.name || "Administrator"}</td>
                    </tr>
                    <tr>
                      <th>Business Name</th>
                      <td>${enrollment.businessName || "Not specified"}</td>
                    </tr>
                    <tr>
                      <th>Selected Plan</th>
                      <td><strong>${enrollment.planSelected}</strong></td>
                    </tr>
                    <tr>
                      <th>VAT Period</th>
                      <td>${enrollment.vatPeriod || "Not specified"}</td>
                    </tr>
                    <tr>
                      <th>Enrollment ID</th>
                      <td>${enrollment.enrollId}</td>
                    </tr>
                  </table>
                </div>

                <!-- PACKAGE PLANS TABLE (STATIC) -->
                <div class="client-info">
                  <h3 class="section-title">📊 Our Package Plans Overview</h3>
                  <p>Here's a complete overview of all our available packages:</p>
                  
                  <table class="plan-table">
                    <thead>
                      <tr>
                        <th>Features</th>
                        <th class="lite-bg">Lite</th>
                        <th class="taxi-bg">Taxi</th>
                        <th class="premium-bg">Premium</th>
                        <th class="pro-bg">Pro</th>
                        <th class="restaurant-bg">Restaurant</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Monthly Price</strong></td>
                        <td class="lite-bg">€40</td>
                        <td class="taxi-bg">€45</td>
                        <td class="premium-bg">€50</td>
                        <td class="pro-bg">€60</td>
                        <td class="restaurant-bg">€80</td>
                      </tr>
                      <tr>
                        <td><strong>Income Sources Covered</strong></td>
                        <td class="lite-bg">1</td>
                        <td class="taxi-bg">1</td>
                        <td class="premium-bg">2</td>
                        <td class="pro-bg">3</td>
                        <td class="restaurant-bg">1</td>
                      </tr>
                      <tr>
                        <td><strong>Outgoing Invoices</strong></td>
                        <td class="lite-bg">Up to 2</td>
                        <td class="taxi-bg">Up to 4</td>
                        <td class="premium-bg">Up to 4</td>
                        <td class="pro-bg">Up to 8</td>
                        <td class="restaurant-bg">Up to 10</td>
                      </tr>
                      <tr>
                        <td><strong>Expense Receipts</strong></td>
                        <td class="lite-bg">Up to 10</td>
                        <td class="taxi-bg">Up to 40</td>
                        <td class="premium-bg">Up to 40</td>
                        <td class="pro-bg">Up to 50</td>
                        <td class="restaurant-bg">Up to 50</td>
                      </tr>
                      <tr>
                        <td><strong>Support Availability</strong></td>
                        <td class="lite-bg">Mon-Fri (9am-3pm)</td>
                        <td class="taxi-bg">Mon-Fri (9am-3pm)</td>
                        <td class="premium-bg">Mon-Fri (9am-3pm)</td>
                        <td class="pro-bg">Mon-Fri (9am-3pm)</td>
                        <td class="restaurant-bg">Mon-Fri (9am-3pm)</td>
                      </tr>
                      <tr>
                        <td><strong>Invoice Generation via Email</strong></td>
                        <td class="lite-bg">✔ Yes</td>
                        <td class="taxi-bg">✔ Yes</td>
                        <td class="premium-bg">✔ Yes</td>
                        <td class="pro-bg">✔ Yes</td>
                        <td class="restaurant-bg">✖ No</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style="font-size: 14px; color: #6c757d; margin-top: 10px;">
                    <em>All prices are Monthly Fixed Pricing | VAT Excluded</em>
                  </p>
                </div>

                <!-- ADDITIONAL SERVICES TABLE (STATIC) -->
                <div class="client-info">
                  <h3 class="section-title">💰 Additional Services & Charges</h3>
                  <p>Applicable only when required | Prices exclude VAT</p>
                  
                  <table class="services-table">
                    <thead>
                      <tr>
                        <th>Additional Service</th>
                        <th>Price (Excl. VAT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>New Tax Card / New Tax Declaration / Amendment</td>
                        <td>€25</td>
                      </tr>
                      <tr>
                        <td>Salary Processing (Palkka)</td>
                        <td>€20 per salary</td>
                      </tr>
                      <tr>
                        <td>Financial Statement (Interim / Year-End) – Toiminimi</td>
                        <td>Equivalent to <strong>1 month's accounting fee</strong></td>
                      </tr>
                      <tr>
                        <td>Financial Statement (Interim / Year-End) – OY</td>
                        <td>€150</td>
                      </tr>
                      <tr>
                        <td>Tax Return (Year-End)</td>
                        <td>Equivalent to <strong>1 month's accounting fee</strong></td>
                      </tr>
                      <tr>
                        <td>Other Accounting Services</td>
                        <td>€50 per hour</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style="font-size: 14px; color: #6c757d; margin-top: 10px;">
                    <em>These services are available at additional cost when required</em>
                  </p>
                </div>
                
                <div class="important-box">
                  <h3 class="section-title">✅ Acceptance Confirmation</h3>
                  <p>By using our services and accessing the client portal, you acknowledge and agree to our <strong>Terms & Conditions and Privacy Policy</strong> as mentioned below:</p>
                  <p style="margin-top: 15px;">
                    <strong>Approval Time:</strong> ${currentDate} at ${currentTime} EET/EEST<br>
                    <strong>Service Start Date:</strong> ${currentDate}
                  </p>
                </div>
                
                <div class="terms-box">
                  <h3 class="section-title">📜 Important Guidelines & Terms of Service</h3>
                  
                  <div class="sub-heading">Important Guidelines for All Clients:</div>
                  <ul class="terms-list">
                    <li>Please do not share your any details on any number other than mentioned in the form.</li>
                    <li>Please do not share photographs of RP card or social security number or any EU IDs.</li>
                    <li>Make sure you have at least 75 euros balance in your bank account.</li>
                    <li>Every Entrepreneur must take Pension Insurance if their income exceeds 9010 Euros in the respective financial Year.</li>
                    <li>While applying application, you need to be online for strong identification and answering queries while processing.</li>
                    <li>Please note that even if you have no transitions in your company, we will charge Minimum Plan fees for that particular Month.</li>
                  </ul>
                  
                  <div class="sub-heading">Bookkeeping Charges:</div>
                  <ul class="terms-list">
                    <li>Bookkeeping charges are billed on the 1st of every month.</li>
                    <li>If your enrolment is after the 1st of the month, you will get an invoice from our company in a week.</li>
                    <li>VAT on the monthly bookkeeping fees is deductible.</li>
                  </ul>
                  
                  <div class="sub-heading">The Responsibility of the Service Provider:</div>
                  <ul class="terms-list">
                    <li>Under the Lite Plan, the service provider maintains the client's accounts using single-entry accounting, limited to the preparation of the income statement and balance sheet. Under all other plans, the service provider maintains the client's accounts using double-entry accounting.</li>
                    <li>The service provider will give the right information to the client as per the required ethical principles of accounting, but in case any wrong information is provided by the client, they shall be responsible for all legal or financial repercussions, if any.</li>
                    <li>Annual personal return will be charged separately, which will be equal to your monthly accounting fees.</li>
                    <li>A separate folder with the client's name will be provided by the service provider in Google Drive, and all required documents must be uploaded by the client. The service provider shall not be held responsible for any information provided by the client.</li>
                    <li>The service provider will provide the financial statements whenever needed, subject to the Fees agreed on the Initial offer.</li>
                    <li>The service provider may keep the record for a maximum of one year after the termination of this contract. This may be done without any prior notification to the client.</li>
                  </ul>
                  
                  <div class="sub-heading">The Responsibilities of the Client:</div>
                  <ul class="terms-list">
                    <li>The client must provide all relevant information required to manage the accounts of the company. In case of any wrong information provided by the client, the service provider shall not be held responsible for any discrepancies.</li>
                    <li>Accounting policies will be designed by the client, and guidance can be provided by the service provider, but the ultimate responsibility will always lie on the client.</li>
                    <li>The client will provide all relevant information for a month on a daily basis, so that the records can be maintained by the service provider in due time.</li>
                    <li>If documents are delayed and not submitted even after reminders, then service provider will not be responsible for submitting the reports to the authorities.</li>
                    <li>The client must pay the service fee in advance by the 15th of every month at the latest. If the fee is not paid on time by the client, then the service provider has the right to not submit any report for the month in question.</li>
                    <li>Annual personal return will be charged separately, which will be equal to your monthly accounting fees.</li>
                    <li class="warning">Important Note: If your business involves courier or taxi services, it is mandatory to maintain a driving logbook. Please note that personal fuel expenses are not deductible under any circumstances. Claiming personal expenses as business-related will result in the disallowance of all previously claimed VAT, and you will be solely responsible for the consequences.</li>
                  </ul>
                  
                  <div class="sub-heading">Additional Terms & Communication:</div>
                  <ul class="terms-list">
                    <li>The service provider may share the client details (Company Name and/or Business ID) for the purpose of marketing, if needed. No other information will be shared by the service provider without prior consent from the client.</li>
                    <li>Important note: you must check your email every day and see if there is any query from PRH. If you fail to inform us about the query, you will lose your 70-euro trademark fees (trade register).</li>
                    <li>You will get a follow-up from our back office for data upload and for VAT reporting.</li>
                    <li>Also, they may contact you for any other information or queries during the course of monthly VAT compliance.</li>
                  </ul>
                  
                  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 25px;">
                    <h4 style="color: #2c3e50; margin-top: 0;">📋 Summary of Key Points:</h4>
                    <div class="guideline-item">
                      <span class="guideline-number">1.</span> Do not share personal IDs or contact details outside our official channels.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">2.</span> Maintain minimum 75€ in your business bank account.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">3.</span> Pension insurance required if income exceeds 9,010€ annually.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">4.</span> Be available online during application processing for verification.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">5.</span> Minimum fees apply even with zero transactions.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">6.</span> Monthly invoices issued on 1st of each month.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">7.</span> Payment due by 15th of each month for uninterrupted service.
                    </div>
                    <div class="guideline-item">
                      <span class="guideline-number">8.</span> Daily check of emails for PRH queries is mandatory.
                    </div>
                  </div>
                </div>
                
                <p style="background: #e7f4ff; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff;">
                  <strong>Note:</strong> By accessing your client portal and using our services, you acknowledge that you have read, understood, and agree to all the terms and conditions mentioned above.
                </p>
                
                <div class="contact-info">
                  <h3 class="section-title">📞 Our Contact Information</h3>
                  <p><strong>Email:</strong> support@jladgroup.fi</p>
                  <<p><strong>Phone Support:</strong> +358413250081</p>
                  <p><strong>Business Hours:</strong> Monday to Fri 9am to 3pm (EET/EEST)</p>
                </div>
              </div>
              
              <div class="footer">
                <p style="font-size: 18px; margin-bottom: 10px;"><strong>Credence Enterprise Accounting Services</strong></p>
                <p style="margin-bottom: 15px; opacity: 0.9;">Professional Accounting Solutions for Growing Businesses</p>
                <p style="font-size: 14px; opacity: 0.8; margin-bottom: 5px;">
                  VAT Compliance | Financial Reporting | Business Advisory | Tax Planning
                </p>
                <div class="dev-info">
                  Developed by Vapautus Media Private Limited
                </div>
                <p style="font-size: 12px; margin-top: 20px; opacity: 0.7;">
                  © ${new Date().getFullYear()} Credence Enterprise Accounting Services. All rights reserved.<br>
                  This is an automated email. Please do not reply directly to this message.<br>
                  Email sent to: ${enrollment.email}
                </p>
                <p style="font-size: 12px; margin-top: 10px; color: #7cd64b;">
                  This email contains legally binding terms and conditions. Please retain it for your records.
                </p>
              </div>
            </body>
            </html>
          `
        );

        logToConsole("INFO", "WELCOME_EMAIL_SENT", {
          to: enrollment.email,
          clientId,
          enrollId: enrollment.enrollId
        });
      } catch (emailError) {
        logToConsole("ERROR", "WELCOME_EMAIL_FAILED", {
          email: enrollment.email,
          error: emailError.message,
          stack: emailError.stack,
          enrollId: enrollment.enrollId
        });
        // Don't fail the request if email fails
      }

      // Log the activity
      await ActivityLog.create({
        userName: req.user.name,
        role: "ADMIN",
        adminId: req.user.adminId,
        enrollId,
        clientId,
        action: "CLIENT_APPROVED",
        details: `Client approved and account created for ${enrollment.planSelected} plan`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientName: clientData.name,
          planSelected: clientData.planSelected,
          email: clientData.email
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "CLIENT_APPROVED",
        adminId: req.user.adminId,
        enrollId: enrollment.enrollId,
        clientId
      });

      return res.json({
        success: true,
        message: "Client approved & account created successfully",
        clientId,
        clientName: clientData.name,
        clientEmail: clientData.email,
        planSelected: clientData.planSelected,
        temporaryPassword: plainPassword,
        enrollId: enrollment.enrollId,
        approvalDate: currentDate,
        approvalTime: currentTime
      });
    }

    // 4. INVALID ACTION
    logToConsole("WARN", "INVALID_ACTION", {
      action,
      adminId: req.user.adminId
    });
    return res.status(400).json({
      success: false,
      message: "Invalid action. Use 'APPROVE' or 'REJECT'"
    });

  } catch (error) {
    logToConsole("ERROR", "ADMIN_ACTION_FAILED", {
      error: error.message,
      stack: error.stack,
      enrollId: req.body.enrollId,
      action: req.body.action,
      adminId: req.user?.adminId
    });

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate client detected. Please try again.",
        error: "DUPLICATE_CLIENT"
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error during admin action",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});


/* ===============================
   GET SINGLE ENROLLMENT DETAILS (FOR VIEW MODAL)
================================ */

router.get("/enrollment/:enrollId", auth, async (req, res) => {
  try {
    logToConsole("INFO", "GET_ENROLLMENT_DETAILS_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      enrollId: req.params.enrollId
    });

    const enrollment = await ClientEnrollment.findOne({
      enrollId: req.params.enrollId
    });

    if (!enrollment) {
      logToConsole("WARN", "ENROLLMENT_NOT_FOUND_DETAILS", {
        enrollId: req.params.enrollId,
        adminId: req.user.adminId
      });
      return res.status(404).json({
        success: false,
        message: "Enrollment not found"
      });
    }

    // Create activity log for viewing enrollment details
    await ActivityLog.create({
      userName: req.user.name,
      role: "ADMIN",
      adminId: req.user.adminId,
      enrollId: enrollment.enrollId,
      action: "ENROLLMENT_DETAILS_VIEWED",
      details: `Admin viewed detailed enrollment information for ${enrollment.firstName} ${enrollment.lastName}`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        clientName: `${enrollment.firstName} ${enrollment.lastName}`,
        email: enrollment.email,
        status: enrollment.status,
        planSelected: enrollment.planSelected
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "ENROLLMENT_DETAILS_VIEWED",
      adminId: req.user.adminId,
      enrollId: enrollment.enrollId
    });

    logToConsole("SUCCESS", "ENROLLMENT_DETAILS_FETCHED", {
      enrollId: enrollment.enrollId,
      clientName: `${enrollment.firstName} ${enrollment.lastName}`,
      status: enrollment.status
    });

    res.json({
      success: true,
      enrollment: {
        enrollId: enrollment.enrollId,
        status: enrollment.status,
        createdAt: enrollment.createdAt,

        // Personal Information
        firstName: enrollment.firstName,
        lastName: enrollment.lastName,
        name: `${enrollment.firstName} ${enrollment.lastName}`,
        address: enrollment.address,
        visaType: enrollment.visaType,
        hasStrongId: enrollment.hasStrongId,
        mobile: enrollment.mobile,
        email: enrollment.email,

        // Business Information
        businessAddress: enrollment.businessAddress,
        bankAccount: enrollment.bankAccount,
        bicCode: enrollment.bicCode,
        businessName: enrollment.businessName,
        vatPeriod: enrollment.vatPeriod,
        businessNature: enrollment.businessNature,
        registerTrade: enrollment.registerTrade,
        planSelected: enrollment.planSelected,

        // Review Information
        reviewedBy: enrollment.reviewedBy,
        reviewedAt: enrollment.reviewedAt,
        clientId: enrollment.clientId,
        rejectionReason: enrollment.rejectionReason
      }
    });
  } catch (error) {
    console.error("Error fetching enrollment:", error);

    logToConsole("ERROR", "GET_ENROLLMENT_DETAILS_FAILED", {
      error: error.message,
      stack: error.stack,
      enrollId: req.params.enrollId,
      adminId: req.user?.adminId
    });

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});


module.exports = router;