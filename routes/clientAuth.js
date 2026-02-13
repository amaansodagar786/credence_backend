const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Client = require("../models/Client");
const ClientEnrollment = require("../models/ClientEnrollment");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();
const Otp = require("../models/Otp");
const sendEmail = require("../utils/sendEmail");

// Console logging utility
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

/* =========================
   CLIENT LOGIN
========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    logToConsole("INFO", "CLIENT_LOGIN_REQUEST", {
      email,
      ip: req.ip
    });

    const client = await Client.findOne({ email });
    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND", {
        email,
        ip: req.ip
      });
      return res.status(404).json({
        message: "Account not found. Please enroll first.",
        enrollRequired: true
      });
    }

    const isMatch = await bcrypt.compare(password, client.password);
    if (!isMatch) {
      logToConsole("WARN", "INVALID_PASSWORD", {
        email,
        clientId: client.clientId,
        ip: req.ip
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        clientId: client.clientId,
        role: "CLIENT",
        name: client.name
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.cookie("clientToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    });

    // Create activity log
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "CLIENT_LOGIN",
      details: "Client logged in successfully",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("SUCCESS", "CLIENT_LOGIN_SUCCESS", {
      clientId: client.clientId,
      name: client.name,
      email: client.email
    });

    res.json({
      message: "Login successful",
      clientId: client.clientId
    });

  } catch (error) {
    logToConsole("ERROR", "CLIENT_LOGIN_FAILED", {
      error: error.message,
      stack: error.stack,
      email: req.body?.email
    });

    res.status(500).json({
      message: "Login failed. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* =========================
   CLIENT CHECK LOGIN
========================= */
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.clientToken;
    if (!token) {
      logToConsole("WARN", "CLIENT_TOKEN_MISSING", {
        ip: req.ip
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const client = await Client.findOne({ clientId: decoded.clientId }).select("-password");

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_BY_TOKEN", {
        clientId: decoded.clientId
      });
      return res.status(404).json({ message: "Client not found" });
    }

    // Create activity log for checking login status
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "CLIENT_SESSION_CHECK",
      details: "Client checked login status",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "CLIENT_SESSION_CHECKED", {
      clientId: client.clientId,
      name: client.name
    });

    res.json(client);

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logToConsole("WARN", "INVALID_CLIENT_TOKEN", {
        error: error.message,
        ip: req.ip
      });
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    logToConsole("ERROR", "CLIENT_SESSION_CHECK_FAILED", {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      message: "Failed to check session",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* =========================
   CLIENT LOGOUT
========================= */
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.clientToken;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const client = await Client.findOne({ clientId: decoded.clientId });

        if (client) {
          // Create activity log for logout
          await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            action: "CLIENT_LOGOUT",
            details: "Client logged out",
            // dateTime: new Date().toLocaleString("en-IN")
          });

          logToConsole("INFO", "CLIENT_LOGOUT", {
            clientId: client.clientId,
            name: client.name,
            email: client.email
          });
        }
      } catch (tokenError) {
        // Token verification failed, but we still clear the cookie
        logToConsole("WARN", "INVALID_TOKEN_ON_LOGOUT", {
          error: tokenError.message
        });
      }
    }

    res.clearCookie("clientToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none"
    });

    res.json({
      message: "Logged out successfully",
      success: true
    });

  } catch (error) {
    logToConsole("ERROR", "CLIENT_LOGOUT_FAILED", {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      message: "Logout failed",
      success: false
    });
  }
});

/* =========================
   FORGOT PASSWORD - STEP 1: Request OTP
========================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    logToConsole("INFO", "FORGOT_PASSWORD_REQUEST", {
      email,
      ip: req.ip
    });

    // Check if client exists
    const client = await Client.findOne({ email });
    if (!client) {
      logToConsole("WARN", "FORGOT_PASSWORD_EMAIL_NOT_FOUND", {
        email,
        ip: req.ip
      });
      return res.status(404).json({
        message: "Email not found. Please check your email or enroll first.",
        success: false
      });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Store OTP (expires in 10 minutes)
    await Otp.findOneAndDelete({ email });
    await Otp.create({
      email,
      otp,
      clientId: client.clientId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    logToConsole("INFO", "OTP_GENERATED", {
      clientId: client.clientId,
      email,
      otp: "***" // Masking OTP for security
    });

    // Send OTP email
    await sendEmail(
      email,
      "Password Reset OTP - Credence",
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7cd64b;">Credence Password Reset</h2>
        <p>Hello ${client.name},</p>
        <p>You requested to reset your password. Use the OTP below:</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="color: #7cd64b; font-size: 32px; letter-spacing: 5px; margin: 0;">${otp}</h1>
        </div>
        <p>This OTP is valid for <strong>10 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#666;font-size:12px;">This is an automated message from Credence.</p>
      </div>
      `
    );

    logToConsole("INFO", "OTP_EMAIL_SENT", {
      clientId: client.clientId,
      email
    });

    // Create activity log
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "FORGOT_PASSWORD_REQUEST",
      details: "Requested password reset OTP",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "FORGOT_PASSWORD_REQUEST",
      clientId: client.clientId
    });

    res.json({
      message: "OTP sent to your email",
      success: true,
      email
    });

  } catch (error) {
    logToConsole("ERROR", "FORGOT_PASSWORD_FAILED", {
      error: error.message,
      stack: error.stack,
      email: req.body?.email
    });

    res.status(500).json({
      message: "Failed to process request. Please try again.",
      success: false
    });
  }
});

/* =========================
   FORGOT PASSWORD - STEP 2: Verify OTP
========================= */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    logToConsole("INFO", "VERIFY_OTP_REQUEST", {
      email,
      otp: "***", // Masking OTP for security
      ip: req.ip
    });

    const otpRecord = await Otp.findOne({ email, otp });

    if (!otpRecord) {
      logToConsole("WARN", "INVALID_OTP", {
        email,
        ip: req.ip
      });
      return res.status(400).json({
        message: "Invalid or expired OTP. Please request a new one.",
        success: false
      });
    }

    if (new Date() > otpRecord.expiresAt) {
      await Otp.findByIdAndDelete(otpRecord._id);
      logToConsole("WARN", "EXPIRED_OTP", {
        email,
        clientId: otpRecord.clientId
      });
      return res.status(400).json({
        message: "OTP has expired. Please request a new one.",
        success: false
      });
    }

    // Generate short-lived verification token
    const verifyToken = jwt.sign(
      {
        email,
        clientId: otpRecord.clientId,
        purpose: "PASSWORD_RESET"
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    await Otp.findByIdAndDelete(otpRecord._id);

    logToConsole("SUCCESS", "OTP_VERIFIED", {
      clientId: otpRecord.clientId,
      email
    });

    // Create activity log
    await ActivityLog.create({
      userName: otpRecord.clientId,
      role: "CLIENT",
      clientId: otpRecord.clientId,
      action: "OTP_VERIFIED",
      details: "OTP verified for password reset",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "OTP_VERIFIED",
      clientId: otpRecord.clientId
    });

    res.json({
      message: "OTP verified successfully",
      success: true,
      verifyToken
    });

  } catch (error) {
    logToConsole("ERROR", "VERIFY_OTP_FAILED", {
      error: error.message,
      stack: error.stack,
      email: req.body?.email
    });

    res.status(500).json({
      message: "Failed to verify OTP. Please try again.",
      success: false
    });
  }
});

/* =========================
   FORGOT PASSWORD - STEP 3: Reset Password
========================= */
router.post("/reset-password", async (req, res) => {
  try {
    const { verifyToken, newPassword } = req.body;

    logToConsole("INFO", "RESET_PASSWORD_REQUEST", {
      hasToken: !!verifyToken,
      tokenLength: verifyToken?.length,
      ip: req.ip
    });

    let decoded;
    try {
      decoded = jwt.verify(verifyToken, process.env.JWT_SECRET);
    } catch (error) {
      logToConsole("WARN", "INVALID_RESET_TOKEN", {
        error: error.message,
        ip: req.ip
      });
      return res.status(401).json({
        message: "Session expired. Please start the process again.",
        success: false
      });
    }

    if (decoded.purpose !== "PASSWORD_RESET") {
      logToConsole("WARN", "INVALID_TOKEN_PURPOSE", {
        purpose: decoded.purpose,
        clientId: decoded.clientId
      });
      return res.status(400).json({
        message: "Invalid token.",
        success: false
      });
    }

    const client = await Client.findOne({ clientId: decoded.clientId });
    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_RESET", {
        clientId: decoded.clientId,
        email: decoded.email
      });
      return res.status(404).json({
        message: "Client not found.",
        success: false
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    client.password = hashedPassword;
    await client.save();

    logToConsole("SUCCESS", "PASSWORD_RESET", {
      clientId: client.clientId,
      email: client.email
    });

    // Confirmation email
    await sendEmail(
      client.email,
      "Password Updated Successfully - Credence",
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7cd64b;">Password Updated - Credence</h2>
        <p>Hello ${client.name},</p>
        <p>Your password has been successfully updated.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0;">If you did not make this change, please contact Credence support immediately.</p>
        </div>
        <p>
          Login here:
          <a href="${process.env.FRONTEND_URL}/client/login">
            ${process.env.FRONTEND_URL}/client/login
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#666;font-size:12px;">This is an automated message from Credence.</p>
      </div>
      `
    );

    logToConsole("INFO", "PASSWORD_RESET_EMAIL_SENT", {
      clientId: client.clientId,
      email: client.email
    });

    // Create activity log
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "PASSWORD_RESET",
      details: "Password reset successfully via forgot password",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "PASSWORD_RESET",
      clientId: client.clientId
    });

    res.json({
      message: "Password updated successfully. You can now login with your new password.",
      success: true
    });

  } catch (error) {
    logToConsole("ERROR", "RESET_PASSWORD_FAILED", {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      message: "Failed to reset password. Please try again.",
      success: false
    });
  }
});

/* =========================
   CHANGE PASSWORD (WITH OLD PASSWORD VERIFICATION)
========================= */
router.post("/change-password", async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Get client from token
    const token = req.cookies?.clientToken;
    if (!token) {
      logToConsole("WARN", "CHANGE_PASSWORD_NO_TOKEN", {
        ip: req.ip
      });
      return res.status(401).json({
        message: "Unauthorized",
        success: false
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const client = await Client.findOne({ clientId: decoded.clientId });

    if (!client) {
      logToConsole("WARN", "CHANGE_PASSWORD_CLIENT_NOT_FOUND", {
        clientId: decoded.clientId
      });
      return res.status(404).json({
        message: "Client not found",
        success: false
      });
    }

    logToConsole("INFO", "CHANGE_PASSWORD_REQUEST", {
      clientId: client.clientId,
      email: client.email
    });

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, client.password);
    if (!isMatch) {
      logToConsole("WARN", "CHANGE_PASSWORD_INCORRECT_OLD", {
        clientId: client.clientId
      });
      return res.status(400).json({
        message: "Current password is incorrect",
        success: false
      });
    }

    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      logToConsole("WARN", "CHANGE_PASSWORD_INVALID_NEW", {
        clientId: client.clientId,
        passwordLength: newPassword?.length
      });
      return res.status(400).json({
        message: "New password must be at least 6 characters",
        success: false
      });
    }

    // Check if new password is same as old password
    const isSamePassword = await bcrypt.compare(newPassword, client.password);
    if (isSamePassword) {
      logToConsole("WARN", "CHANGE_PASSWORD_SAME_AS_OLD", {
        clientId: client.clientId
      });
      return res.status(400).json({
        message: "New password cannot be the same as current password",
        success: false
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    client.password = hashedPassword;
    await client.save();

    logToConsole("SUCCESS", "PASSWORD_CHANGED", {
      clientId: client.clientId,
      email: client.email
    });

    // Send confirmation email
    await sendEmail(
      client.email,
      "Password Changed - Credence",
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7cd64b;">Password Changed Successfully</h2>
        <p>Hello ${client.name},</p>
        <p>Your password has been successfully changed from your profile settings.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0;">If you did not make this change, please contact Credence support immediately.</p>
        </div>
        <p>Thank you for keeping your account secure.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#666;font-size:12px;">This is an automated message from Credence.</p>
      </div>
      `
    );

    logToConsole("INFO", "PASSWORD_CHANGE_EMAIL_SENT", {
      clientId: client.clientId,
      email: client.email
    });

    // Create activity log
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "PASSWORD_CHANGED",
      details: "Password changed from profile settings",
      // dateTime: new Date().toLocaleString("en-IN")
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "PASSWORD_CHANGED",
      clientId: client.clientId
    });

    res.json({
      message: "Password changed successfully",
      success: true
    });

  } catch (error) {
    console.error("Change password error:", error);

    if (error.name === 'JsonWebTokenError') {
      logToConsole("WARN", "CHANGE_PASSWORD_INVALID_TOKEN", {
        error: error.message,
        ip: req.ip
      });
      return res.status(401).json({
        message: "Invalid session. Please login again.",
        success: false
      });
    }

    logToConsole("ERROR", "CHANGE_PASSWORD_FAILED", {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      message: "Failed to change password. Please try again.",
      success: false
    });
  }
});




/* ===============================
   CLIENT UPDATE OWN PROFILE
   (Client can update their own info)
================================ */
router.patch("/update-profile", async (req, res) => {
  try {
    // Get client from token (client logged in)
    const token = req.cookies?.clientToken;
    if (!token) {
      logToConsole("WARN", "CLIENT_UPDATE_PROFILE_NO_TOKEN", {
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login first."
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const clientId = decoded.clientId;

    // Find client
    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("WARN", "CLIENT_UPDATE_PROFILE_NOT_FOUND", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found."
      });
    }

    // Get update data from request body
    const updateData = req.body;

    // Define allowed fields that client can update
    const allowedFields = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'address',
      'visaType',
      'hasStrongId',
      'businessAddress',
      'bankAccount',
      'bicCode',
      'businessName',
      'vatPeriod',
      'businessNature',
      'registerTrade'
    ];

    // Filter update data to only allowed fields
    const filteredUpdate = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredUpdate[field] = updateData[field];
      }
    });

    // If no valid fields to update
    if (Object.keys(filteredUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update"
      });
    }

    // Get client details before update for logging
    const clientBefore = await Client.findOne({ clientId })
      .select("clientId name email phone firstName lastName address visaType hasStrongId businessAddress bankAccount bicCode businessName vatPeriod businessNature registerTrade");

    // Update the client
    const updatedClient = await Client.findOneAndUpdate(
      { clientId },
      { $set: filteredUpdate },
      { new: true }
    ).select("-password -documents -employeeAssignments");

    if (!updatedClient) {
      return res.status(404).json({
        success: false,
        message: "Failed to update profile"
      });
    }

    // Track changes for logging
    const changes = [];
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined && clientBefore[field] !== updateData[field]) {
        changes.push({
          field,
          oldValue: clientBefore[field],
          newValue: updateData[field]
        });
      }
    });

    // ADDED: Activity Log for client updating their own profile
    try {
      await ActivityLog.create({
        userName: updatedClient.name || `${updatedClient.firstName} ${updatedClient.lastName}`,
        role: "CLIENT",
        clientId: clientId,
        action: "CLIENT_PROFILE_UPDATED_SELF",
        details: `Client updated their own profile. Fields changed: ${changes.map(c => c.field).join(', ')}`,
        // dateTime: new Date(),
        metadata: {
          clientId,
          clientName: updatedClient.name,
          changes: changes,
          updatedBy: "CLIENT",
          timestamp: new Date()
        }
      });

      logToConsole("INFO", "CLIENT_PROFILE_UPDATED_SELF_LOG", {
        clientId: clientId,
        changesCount: changes.length,
        fields: changes.map(c => c.field)
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED_CLIENT_UPDATE", {
        error: logError.message,
        clientId: clientId
      });
    }

    // NEW: Send confirmation email to client about their update
    try {
      if (changes.length > 0 && updatedClient.email) {
        // Format field names for display
        const fieldDisplayNames = {
          firstName: "First Name",
          lastName: "Last Name",
          email: "Email Address",
          phone: "Phone Number",
          address: "Address",
          visaType: "Visa Type",
          hasStrongId: "Strong ID Status",
          businessAddress: "Business Address",
          bankAccount: "Bank Account",
          bicCode: "BIC Code",
          businessName: "Business Name",
          vatPeriod: "VAT Period",
          businessNature: "Business Nature",
          registerTrade: "Registered Trade"
        };

        const currentDate = new Date().toLocaleDateString('en-IN');
        const currentTime = new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        // Create email subject and HTML
        const emailSubject = `✅ Profile Updated Successfully - ${updatedClient.businessName || updatedClient.name}`;

        // Build changes table HTML
        let changesTable = '';
        changes.forEach(change => {
          changesTable += `
            <tr>
              <th>${fieldDisplayNames[change.field] || change.field}</th>
              <td><span style="color: #e74c3c; text-decoration: line-through;">${change.oldValue || 'Not set'}</span></td>
              <td><span style="color: #27ae60; font-weight: bold;">→ ${change.newValue || 'Not set'}</span></td>
            </tr>
          `;
        });

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Profile Updated</title>
            <style>
              body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
              .content { padding: 30px; background: #ffffff; }
              .update-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
              .client-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
              .contact-info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; }
              .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
              .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
              .dev-link { color: #7cd64b !important; text-decoration: none; }
              table { width: 100%; border-collapse: collapse; margin: 15px 0; }
              th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
              th { background: #f8f9fa; font-weight: 600; width: 35%; }
              .note-box { background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2196f3; }
              .important-note { color: #ff9800; font-weight: 600; }
              .change-table th { width: 25%; }
              .old-value { color: #e74c3c; text-decoration: line-through; }
              .new-value { color: #27ae60; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Credence Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
            </div>
            
            <div class="content">
              <h2 style="color: #2c3e50; margin-top: 0;">Dear ${updatedClient.firstName} ${updatedClient.lastName},</h2>
              
              <div class="update-box">
                <h3 style="margin-top: 0; color: #4caf50;">✅ YOUR PROFILE HAS BEEN UPDATED</h3>
                <p>Your profile information has been successfully updated from your account.</p>
                <p><strong>Updated On:</strong> ${currentDate} at ${currentTime} IST</p>
              </div>
              
              ${changes.length > 0 ? `
              <div class="client-info">
                <h3 class="section-title">📋 Changes Summary</h3>
                <table class="change-table">
                  <tr>
                    <th>Field</th>
                    <th>Previous Value</th>
                    <th>New Value</th>
                  </tr>
                  ${changesTable}
                </table>
              </div>
              ` : ''}
              
              <div class="client-info">
                <h3 class="section-title">👤 Your Current Profile Information</h3>
                <table>
                  <tr>
                    <th>Client ID</th>
                    <td>${updatedClient.clientId}</td>
                  </tr>
                  <tr>
                    <th>Full Name</th>
                    <td>${updatedClient.firstName} ${updatedClient.lastName}</td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>${updatedClient.email}</td>
                  </tr>
                  <tr>
                    <th>Phone</th>
                    <td>${updatedClient.phone || "Not provided"}</td>
                  </tr>
                  <tr>
                    <th>Business Name</th>
                    <td>${updatedClient.businessName || "Not specified"}</td>
                  </tr>
                  <tr>
                    <th>VAT Period</th>
                    <td>${updatedClient.vatPeriod === "monthly" ? "Monthly" : "Quarterly" || "Not specified"}</td>
                  </tr>
                  <tr>
                    <th>Plan Selected</th>
                    <td>${updatedClient.planSelected || "Not specified"}</td>
                  </tr>
                </table>
              </div>
              
              <div class="note-box">
                <p><strong>📝 Note:</strong> These changes were made from your account. Your information is now updated in our records.</p>
                <p>If you did not make these changes, please contact our support team immediately.</p>
              </div>
              
              <div class="contact-info">
                <h3 class="section-title">📞 Need Assistance?</h3>
                <p><strong>Support Email:</strong> support@jladgroup.fi</p>
                <p><strong>Admin Email:</strong> support@jladgroup.fi</p>
                <p><strong>Phone Support:</strong> +91 12345 67890</p>
                <p><strong>Business Hours:</strong> Monday - Friday, 9:00 AM - 6:00 PM (IST)</p>
              </div>
              
              <p style="margin-top: 25px; font-size: 14px; color: #666;">
                <strong>Important:</strong> Keeping your profile information updated ensures we provide you with the best accounting services and VAT compliance support.
              </p>
            </div>
            
            <div class="footer">
              <p><strong>Credence Accounting Services</strong></p>
              <p>Professional Accounting | VAT Compliance | Business Advisory</p>
              <div class="dev-info">
                Designed & Developed by <a href="https://techorses.com" target="_blank" class="dev-link">Techorses</a>
              </div>
              <p style="font-size: 12px; margin-top: 10px;">
                This is an automated confirmation email.<br>
                Please do not reply to this email. For queries, contact support@jladgroup.fi<br>
                Email sent to: ${updatedClient.email}
              </p>
            </div>
          </body>
          </html>
        `;

        // Send email using your sendEmail utility
        const sendEmail = require("../utils/sendEmail");
        await sendEmail(updatedClient.email, emailSubject, emailHtml);

        logToConsole("INFO", "CLIENT_SELF_UPDATE_EMAIL_SENT", {
          clientId: clientId,
          clientEmail: updatedClient.email,
          fieldsUpdated: changes.map(c => c.field)
        });
      }
    } catch (emailError) {
      logToConsole("ERROR", "CLIENT_SELF_UPDATE_EMAIL_FAILED", {
        error: emailError.message,
        clientId: clientId,
        clientEmail: updatedClient.email
      });
      // Don't fail the whole request if email fails
    }

    // Return success response
    res.json({
      success: true,
      message: "Profile updated successfully",
      client: updatedClient,
      changes: changes.length > 0 ? changes : null,
      emailSent: changes.length > 0 && updatedClient.email ? true : false
    });

  } catch (error) {
    console.error("Error updating client profile:", error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again."
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please login again."
      });
    }

    // Check for duplicate email error
    if (error.code === 11000 && error.keyPattern && error.keyPattern.email) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered with another account."
      });
    }

    logToConsole("ERROR", "CLIENT_PROFILE_UPDATE_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.cookies?.clientToken ? jwt.decode(req.cookies.clientToken)?.clientId : 'unknown'
    });

    res.status(500).json({
      success: false,
      message: "Failed to update profile. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});



/* ===============================
   CLIENT CHANGE PLAN REQUEST - CORRECT LOGIC
   planSelected = MAIN PLAN (shows in admin panel)
   currentPlan = CURRENT BILLING PLAN
   nextMonthPlan = PLAN FOR NEXT MONTH
================================ */
router.patch("/change-plan", async (req, res) => {
  try {
    // Get client from token (client logged in)
    const token = req.cookies?.clientToken;
    if (!token) {
      logToConsole("WARN", "CLIENT_CHANGE_PLAN_NO_TOKEN", {
        ip: req.ip
      });
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login first."
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const clientId = decoded.clientId;

    // Get new plan from request body
    const { newPlan } = req.body;

    if (!newPlan) {
      return res.status(400).json({
        success: false,
        message: "Please select a plan."
      });
    }

    // Validate plan options
    const validPlans = ['Lite', 'Taxi', 'Premium', 'Pro', 'Restaurant'];
    if (!validPlans.includes(newPlan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan selected."
      });
    }

    // Find client
    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("WARN", "CLIENT_CHANGE_PLAN_NOT_FOUND", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found."
      });
    }

    // Get current active plan (use planSelected as main)
    const currentActivePlan = client.planSelected;

    // Check if client is trying to change to same plan
    if (currentActivePlan === newPlan) {
      return res.status(400).json({
        success: false,
        message: `You are already on the ${newPlan} plan.`
      });
    }

    const today = new Date();
    const currentDate = today.getDate();
    const isFirstOfMonth = currentDate === 1;

    let effectiveDate;
    let actionType;
    let emailSubject;
    let clientMessage;
    let adminMessage;

    // Helper function to get first of next month
    const getFirstOfNextMonth = () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    };

    // Format date for display
    const formatDate = (date) => {
      return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    };

    if (isFirstOfMonth) {
      // ✅ TODAY IS 1ST - CHANGE IMMEDIATELY
      effectiveDate = today;
      actionType = 'IMMEDIATE_CHANGE';
      clientMessage = `Your plan has been changed from ${currentActivePlan} to ${newPlan} effective immediately (${formatDate(today)}).`;
      adminMessage = `Client ${client.name} (${clientId}) changed plan from ${currentActivePlan} to ${newPlan} effective immediately (1st of month).`;
      emailSubject = `✅ Plan Changed Successfully - ${client.businessName || client.name}`;

      // ✅ UPDATE ALL PLAN FIELDS IMMEDIATELY
      client.planSelected = newPlan;      // ✅ MAIN PLAN - Updated immediately
      client.currentPlan = newPlan;       // ✅ CURRENT BILLING - Updated immediately
      client.nextMonthPlan = '';          // ✅ FUTURE - Cleared
      client.planChangeRequestedAt = today;
      client.planEffectiveFrom = today;

    } else {
      // ✅ TODAY IS 2ND OR LATER - SCHEDULE FOR NEXT MONTH
      effectiveDate = getFirstOfNextMonth();
      actionType = 'NEXT_MONTH_CHANGE';
      clientMessage = `Your plan change request from ${currentActivePlan} to ${newPlan} has been received. It will be effective from ${formatDate(effectiveDate)} (1st of next month).`;
      adminMessage = `Client ${client.name} (${clientId}) requested plan change from ${currentActivePlan} to ${newPlan} effective from ${formatDate(effectiveDate)}.`;
      emailSubject = `🔄 Plan Change Request Received - ${client.businessName || client.name}`;

      // ✅ ONLY UPDATE NEXT MONTH PLAN
      client.nextMonthPlan = newPlan;     // ✅ FUTURE - Set for next month
      // planSelected STAYS SAME (currentActivePlan) - Admin sees old plan
      // currentPlan STAYS SAME (currentActivePlan) - Billing stays old

      client.planChangeRequestedAt = today;
      client.planEffectiveFrom = effectiveDate;
    }

    // Add to plan change history
    client.planChangeHistory.push({
      fromPlan: currentActivePlan,
      toPlan: newPlan,
      changeDate: today,
      effectiveFrom: effectiveDate,
      requestedBy: 'client',
      notes: actionType === 'IMMEDIATE_CHANGE' ? 'Changed immediately (1st of month)' : 'Scheduled for next month'
    });

    // Save client
    await client.save();

    // Plan prices for email
    const planPrices = {
      'Lite': '40 Euros + VAT',
      'Taxi': '45 Euros + VAT',
      'Premium': '50 Euros + VAT',
      'Pro': '60 Euros + VAT',
      'Restaurant': '80 Euros + VAT'
    };

    // Send email to client
    try {
      const currentDateStr = today.toLocaleDateString('en-IN');
      const currentTimeStr = today.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      let emailHtml;

      if (isFirstOfMonth) {
        // Immediate change email
        emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Plan Changed</title>
            <style>
              body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
              .content { padding: 30px; background: #ffffff; }
              .success-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
              .plan-details { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
              .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; margin: 15px 0; }
              th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
              th { background: #f8f9fa; font-weight: 600; width: 40%; }
              .note-box { background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2196f3; }
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
                <h3 style="margin-top: 0; color: #4caf50;">✅ PLAN CHANGED IMMEDIATELY</h3>
                <p>Your accounting plan has been updated immediately (1st of month).</p>
                <p><strong>Changed On:</strong> ${currentDateStr} at ${currentTimeStr} IST</p>
              </div>
              
              <div class="plan-details">
                <h3 class="section-title">📋 Plan Change Details</h3>
                <table>
                  <tr>
                    <th>Previous Plan</th>
                    <td>${currentActivePlan} (${planPrices[currentActivePlan] || 'N/A'})</td>
                  </tr>
                  <tr>
                    <th>New Plan</th>
                    <td><strong>${newPlan}</strong> (${planPrices[newPlan]})</td>
                  </tr>
                  <tr>
                    <th>Effective From</th>
                    <td><strong>${formatDate(today)}</strong> (Immediate - 1st of month)</td>
                  </tr>
                  <tr>
                    <th>Billing Amount</th>
                    <td><strong>${planPrices[newPlan]}</strong> starting this month</td>
                  </tr>
                  <tr>
                    <th>Admin Panel Display</th>
                    <td>Will show as <strong>${newPlan}</strong> immediately</td>
                  </tr>
                </table>
              </div>
              
              <div class="note-box">
                <p><strong>📝 Important:</strong> Since today is 1st of the month, your plan change is effective immediately. Your billing for ${today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} will be based on the new ${newPlan} plan.</p>
              </div>
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
      } else {
        // Next month change email
        emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Plan Change Request</title>
            <style>
              body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
              .content { padding: 30px; background: #ffffff; }
              .pending-box { background: #fff8e1; border-left: 4px solid #ffc107; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
              .plan-details { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
              .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; margin: 15px 0; }
              th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
              th { background: #f8f9fa; font-weight: 600; width: 40%; }
              .note-box { background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2196f3; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Credence Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
            </div>
            
            <div class="content">
              <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
              
              <div class="pending-box">
                <h3 style="margin-top: 0; color: #ff9800;">🔄 PLAN CHANGE SCHEDULED</h3>
                <p>Your plan change request has been scheduled for next month.</p>
                <p><strong>Requested On:</strong> ${currentDateStr} at ${currentTimeStr} IST</p>
                <p><strong>Since today is not 1st of month, change will be effective from 1st of next month.</strong></p>
              </div>
              
              <div class="plan-details">
                <h3 class="section-title">📋 Plan Change Details</h3>
                <table>
                  <tr>
                    <th>Current Active Plan</th>
                    <td><strong>${currentActivePlan}</strong> (${planPrices[currentActivePlan] || 'N/A'})</td>
                  </tr>
                  <tr>
                    <th>Scheduled New Plan</th>
                    <td><strong>${newPlan}</strong> (${planPrices[newPlan]})</td>
                  </tr>
                  <tr>
                    <th>Effective From</th>
                    <td><strong>${formatDate(effectiveDate)}</strong> (1st of next month)</td>
                  </tr>
                  <tr>
                    <th>Current Month Billing</th>
                    <td><strong>${planPrices[currentActivePlan] || 'N/A'}</strong> (${today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })})</td>
                  </tr>
                  <tr>
                    <th>Next Month Billing</th>
                    <td><strong>${planPrices[newPlan]}</strong> (${effectiveDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })})</td>
                  </tr>
                  <tr>
                    <th>Admin Panel Display</th>
                    <td>Will show as <strong>${currentActivePlan}</strong> until ${formatDate(effectiveDate)}</td>
                  </tr>
                </table>
              </div>
              
              <div class="note-box">
                <p><strong>📝 Important:</strong> You will continue with your current <strong>${currentActivePlan}</strong> plan for billing this month. The change to <strong>${newPlan}</strong> will take effect automatically on ${formatDate(effectiveDate)}.</p>
                <p><strong>Admin panel will continue to show ${currentActivePlan} until the change takes effect.</strong></p>
                <p>If you wish to modify or cancel this change before it takes effect, please contact our billing department.</p>
              </div>
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
      }

      // Send email to client
      await sendEmail(client.email, emailSubject, emailHtml);
      logToConsole("INFO", "PLAN_CHANGE_EMAIL_SENT_TO_CLIENT", {
        clientId,
        clientEmail: client.email,
        actionType,
        fromPlan: currentActivePlan,
        toPlan: newPlan
      });

    } catch (emailError) {
      logToConsole("ERROR", "CLIENT_PLAN_CHANGE_EMAIL_FAILED", {
        error: emailError.message,
        clientId,
        clientEmail: client.email
      });
    }

    // Send email to admin
    try {
      const adminEmail = process.env.EMAIL_USER;
      const adminSubject = `📋 Plan Change ${isFirstOfMonth ? 'Completed' : 'Scheduled'} - ${client.name} (${clientId})`;

      const adminEmailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Plan Change Alert</title>
          <style>
            body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
            .content { padding: 30px; background: #ffffff; }
            .alert-box { background: #${isFirstOfMonth ? 'e8f5e9' : 'fff8e1'}; border-left: 4px solid #${isFirstOfMonth ? '4caf50' : 'ffc107'}; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0; }
            .client-details { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
            .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
            .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
            th { background: #f8f9fa; font-weight: 600; width: 40%; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Credence Accounting Services</h1>
            <p style="margin-top: 5px; opacity: 0.9;">Admin Notification - Plan Change</p>
          </div>
          
          <div class="content">
            <div class="alert-box">
              <h3 style="margin-top: 0; color: #${isFirstOfMonth ? '4caf50' : 'ff9800'};">${isFirstOfMonth ? '✅ IMMEDIATE PLAN CHANGE' : '🔄 SCHEDULED PLAN CHANGE'}</h3>
              <p><strong>Client:</strong> ${client.name} (${clientId})</p>
              <p><strong>Date:</strong> ${today.toLocaleDateString('en-IN')} at ${today.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST</p>
              <p><strong>Status:</strong> ${isFirstOfMonth ? 'Changed immediately (1st of month)' : 'Scheduled for 1st of next month'}</p>
            </div>
            
            <div class="client-details">
              <h3 class="section-title">📋 Plan Details</h3>
              <table>
                <tr>
                  <th>Client Name</th>
                  <td>${client.firstName} ${client.lastName}</td>
                </tr>
                <tr>
                  <th>Client ID</th>
                  <td>${clientId}</td>
                </tr>
                <tr>
                  <th>Current Plan (planSelected)</th>
                  <td><strong>${client.planSelected}</strong></td>
                </tr>
                <tr>
                  <th>New Plan</th>
                  <td><strong>${newPlan}</strong></td>
                </tr>
                <tr>
                  <th>Effective Date</th>
                  <td>${formatDate(effectiveDate)}</td>
                </tr>
                ${!isFirstOfMonth ? `
                <tr>
                  <th>Next Month Plan</th>
                  <td><strong>${client.nextMonthPlan}</strong> (scheduled)</td>
                </tr>
                <tr>
                  <th>Admin Panel Shows</th>
                  <td><strong>${client.planSelected}</strong> until ${formatDate(effectiveDate)}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <p style="margin-top: 25px; font-size: 14px; color: #666;">
              <strong>Note:</strong> ${isFirstOfMonth ?
          'All plan fields updated immediately in database.' :
          'planSelected remains as ' + client.planSelected + ' until ' + formatDate(effectiveDate) + '. nextMonthPlan set to ' + newPlan + '.'}
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Credence Accounting Services - Admin Portal</strong></p>
            <p style="font-size: 12px; margin-top: 10px;">
              This is an automated notification email.<br>
              ${isFirstOfMonth ? 'No action required - change already applied.' : 'Change will auto-apply on ' + formatDate(effectiveDate)}<br>
              Email sent to: ${adminEmail}
            </p>
          </div>
        </body>
        </html>
      `;

      await sendEmail(adminEmail, adminSubject, adminEmailHtml);
      logToConsole("INFO", "PLAN_CHANGE_EMAIL_SENT_TO_ADMIN", {
        adminEmail,
        clientId,
        actionType
      });

    } catch (adminEmailError) {
      logToConsole("ERROR", "ADMIN_PLAN_CHANGE_EMAIL_FAILED", {
        error: adminEmailError.message,
        adminEmail: process.env.EMAIL_USER,
        clientId
      });
    }

    // Create activity log
    try {
      await ActivityLog.create({
        userName: client.name,
        role: "CLIENT",
        clientId: clientId,
        action: "PLAN_CHANGE_REQUESTED",
        details: `Plan change requested: ${currentActivePlan} → ${newPlan}. ${isFirstOfMonth ? 'Applied immediately (1st of month)' : 'Scheduled for ' + formatDate(effectiveDate)}`,
        // dateTime: new Date(),
        metadata: {
          clientId,
          clientName: client.name,
          fromPlan: currentActivePlan,
          toPlan: newPlan,
          planSelected: client.planSelected,
          currentPlan: client.currentPlan,
          nextMonthPlan: client.nextMonthPlan,
          effectiveFrom: effectiveDate,
          changeType: isFirstOfMonth ? 'immediate' : 'scheduled',
          requestedBy: 'client'
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "PLAN_CHANGE_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        clientId
      });
    }

    // Return success response
    res.json({
      success: true,
      message: clientMessage,
      planDetails: {
        planSelected: client.planSelected,        // ✅ MAIN PLAN (may be old if not 1st)
        currentPlan: client.currentPlan,          // ✅ CURRENT BILLING
        nextMonthPlan: client.nextMonthPlan,      // ✅ FUTURE
        effectiveFrom: effectiveDate,
        changeType: isFirstOfMonth ? 'immediate' : 'scheduled',
        note: isFirstOfMonth ?
          'All plan fields updated immediately.' :
          'planSelected will update on ' + formatDate(effectiveDate) + '.'
      }
    });

  } catch (error) {
    console.error("Error processing plan change:", error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again."
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please login again."
      });
    }

    logToConsole("ERROR", "PLAN_CHANGE_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.cookies?.clientToken ? jwt.decode(req.cookies.clientToken)?.clientId : 'unknown'
    });

    res.status(500).json({
      success: false,
      message: "Failed to process plan change. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});




module.exports = router;