const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Client = require("../models/Client");
const ClientEnrollment = require("../models/ClientEnrollment");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();
const Otp = require("../models/Otp");
const sendEmail = require("../utils/sendEmail");


/* =========================
   CLIENT LOGIN
========================= */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const client = await Client.findOne({ email });
  if (!client) {
    return res.status(404).json({
      message: "Account not found. Please enroll first.",
      enrollRequired: true
    });
  }

  const isMatch = await bcrypt.compare(password, client.password);
  if (!isMatch) {
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
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000
  });

  await ActivityLog.create({
    userName: client.name,
    role: "CLIENT",
    clientId: client.clientId,
    action: "CLIENT_LOGIN",
    details: "Client logged in",
    dateTime: new Date().toLocaleString("en-IN")
  });

  res.json({ message: "Login successful" });
});

/* =========================
   CLIENT CHECK LOGIN
========================= */
router.get("/me", async (req, res) => {
  const token = req.cookies?.clientToken;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const client = await Client.findOne({ clientId: decoded.clientId }).select(
      "-password"
    );
    res.json(client);
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

/* =========================
   CLIENT LOGOUT
========================= */
router.post("/logout", async (req, res) => {
  res.clearCookie("clientToken");
  res.json({ message: "Logged out" });
});



/* =========================
   FORGOT PASSWORD - STEP 1: Request OTP
========================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    // Check if client exists
    const client = await Client.findOne({ email });
    if (!client) {
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

    // Log activity
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "FORGOT_PASSWORD_REQUEST",
      details: "Requested password reset OTP",
      dateTime: new Date().toLocaleString("en-IN")
    });

    res.json({
      message: "OTP sent to your email",
      success: true,
      email
    });

  } catch (error) {
    console.error("Forgot password error:", error);
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

    const otpRecord = await Otp.findOne({ email, otp });

    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid or expired OTP. Please request a new one.",
        success: false
      });
    }

    if (new Date() > otpRecord.expiresAt) {
      await Otp.findByIdAndDelete(otpRecord._id);
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

    await ActivityLog.create({
      userName: otpRecord.clientId,
      role: "CLIENT",
      clientId: otpRecord.clientId,
      action: "OTP_VERIFIED",
      details: "OTP verified for password reset",
      dateTime: new Date().toLocaleString("en-IN")
    });

    res.json({
      message: "OTP verified successfully",
      success: true,
      verifyToken
    });

  } catch (error) {
    console.error("Verify OTP error:", error);
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

    let decoded;
    try {
      decoded = jwt.verify(verifyToken, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        message: "Session expired. Please start the process again.",
        success: false
      });
    }

    if (decoded.purpose !== "PASSWORD_RESET") {
      return res.status(400).json({
        message: "Invalid token.",
        success: false
      });
    }

    const client = await Client.findOne({ clientId: decoded.clientId });
    if (!client) {
      return res.status(404).json({
        message: "Client not found.",
        success: false
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    client.password = hashedPassword;
    await client.save();

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

    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "PASSWORD_RESET",
      details: "Password reset successfully",
      dateTime: new Date().toLocaleString("en-IN")
    });

    res.json({
      message: "Password updated successfully. You can now login with your new password.",
      success: true
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      message: "Failed to reset password. Please try again.",
      success: false
    });
  }
});


module.exports = router;
