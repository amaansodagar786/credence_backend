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
      dateTime: new Date().toLocaleString("en-IN")
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
      dateTime: new Date().toLocaleString("en-IN")
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
            dateTime: new Date().toLocaleString("en-IN")
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
      dateTime: new Date().toLocaleString("en-IN")
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
      dateTime: new Date().toLocaleString("en-IN")
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
      dateTime: new Date().toLocaleString("en-IN")
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
      dateTime: new Date().toLocaleString("en-IN")
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

module.exports = router;