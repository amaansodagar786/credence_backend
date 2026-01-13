const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const ClientEnrollment = require("../models/ClientEnrollment");
const Client = require("../models/Client");
const ActivityLog = require("../models/ActivityLog");

const sendEmail = require("../utils/sendEmail");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/enroll", async (req, res) => {
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
    const enrollment = await ClientEnrollment.create(enrollmentData);

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
      dateTime: new Date().toLocaleString("en-IN")
    });

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

  } catch (error) {
    console.error("❌ ENROLLMENT ERROR:", error);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      errors: error.errors
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
    const data = await ClientEnrollment.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: data.length,
      enrollments: data
    });
  } catch (error) {
    console.error("Error fetching enrollments:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   ADMIN VIEW SINGLE ENROLLMENT
================================ */
router.get("/:enrollId", auth, async (req, res) => {
  try {
    const enrollment = await ClientEnrollment.findOne({
      enrollId: req.params.enrollId
    });

    if (!enrollment) {
      return res.status(404).json({ message: "Enrollment not found" });
    }

    res.json({ success: true, enrollment });
  } catch (error) {
    console.error("Error fetching enrollment:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   ADMIN APPROVE / REJECT ENROLLMENT
================================ */
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
      logToConsole("WARN", "ENROLLMENT_NOT_FOUND", { enrollId });
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

    // 2. REJECT ENROLLMENT
    if (action === "REJECT") {
      enrollment.status = "REJECTED";
      enrollment.reviewedBy = req.user.adminId;
      enrollment.reviewedAt = new Date();
      enrollment.rejectionReason = rejectionReason || "No reason provided";

      await enrollment.save();
      logToConsole("INFO", "ENROLLMENT_REJECTED", {
        enrollId: enrollment.enrollId,
        email: enrollment.email
      });

      // Send rejection email
      try {
        await sendEmail(
          enrollment.email,
          "Enrollment Status Update - Credence Accounting Services",
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ff6b6b;">Enrollment Status Update</h2>
              <p>Dear ${enrollment.firstName} ${enrollment.lastName},</p>
              <p>We regret to inform you that your enrollment application has been reviewed and <strong>rejected</strong>.</p>
              
              <div style="background: #fff5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff6b6b;">
                <h3 style="margin-top: 0;">Reason for Rejection:</h3>
                <p>${enrollment.rejectionReason}</p>
              </div>
              
              <p>If you believe this was a mistake or would like to provide additional information, please contact our support team.</p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="color: #666; font-size: 14px;">
                  Credence Accounting Services Support Team
                </p>
              </div>
            </div>
          `
        );
        logToConsole("INFO", "REJECTION_EMAIL_SENT", {
          to: enrollment.email
        });
      } catch (emailError) {
        logToConsole("ERROR", "REJECTION_EMAIL_FAILED", {
          email: enrollment.email,
          error: emailError.message
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
        dateTime: new Date().toLocaleString("en-IN")
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
          existingClientId: existingClient.clientId
        });
        return res.status(409).json({
          success: false,
          message: "A client with this email already exists",
          clientId: existingClient.clientId
        });
      }

      // Generate client ID and password
      const clientId = uuidv4();
      const plainPassword = `${enrollment.firstName}@1234`;
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
        enrollmentId: enrollment.enrollId,
        enrollmentDate: new Date(),
        documents: new Map(),
        employeeAssignments: []
      };

      logToConsole("INFO", "CREATING_CLIENT", {
        clientId,
        email: clientData.email,
        planSelected: clientData.planSelected
      });

      // Create client account
      const client = await Client.create(clientData);
      logToConsole("INFO", "CLIENT_CREATED", {
        clientId: client.clientId,
        name: client.name
      });

      // Update enrollment status
      enrollment.status = "APPROVED";
      enrollment.reviewedBy = req.user.adminId;
      enrollment.reviewedAt = new Date();
      enrollment.clientId = clientId;
      await enrollment.save();
      logToConsole("INFO", "ENROLLMENT_APPROVED", {
        enrollId: enrollment.enrollId,
        clientId
      });

      // Send welcome email to client
      try {
        logToConsole("DEBUG", "SENDING_WELCOME_EMAIL", {
          to: enrollment.email
        });

        // **CRITICAL: Use await and proper timeout handling**
        await sendEmail(
          enrollment.email,
          "Welcome to Credence - Your Account Has Been Approved",
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7cd64b;">Account Approved Successfully!</h2>
              
              <p>Dear ${enrollment.firstName} ${enrollment.lastName},</p>
              
              <p>Your enrollment has been approved and your account is now active.</p>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7cd64b;">
                <h3 style="margin-top: 0;">Your Login Details:</h3>
                <p><strong>Email:</strong> ${enrollment.email}</p>
                <p><strong>Password:</strong> ${plainPassword}</p>
                <p><strong>Plan:</strong> ${enrollment.planSelected}</p>
              </div>
              
              <p>You can now access your client dashboard to upload documents, track progress.</p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="color: #666; font-size: 14px;">
                  If you have any questions, please contact our support team.<br>
                  Thank you for choosing Credence Accounting Services.
                </p>
              </div>
            </div>
          `
        );

        logToConsole("INFO", "WELCOME_EMAIL_SENT", {
          to: enrollment.email,
          clientId
        });
      } catch (emailError) {
        logToConsole("ERROR", "WELCOME_EMAIL_FAILED", {
          email: enrollment.email,
          error: emailError.message,
          stack: emailError.stack
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
        dateTime: new Date().toLocaleString("en-IN")
      });

      return res.json({
        success: true,
        message: "Client approved & account created successfully",
        clientId,
        clientName: clientData.name,
        clientEmail: clientData.email,
        planSelected: clientData.planSelected,
        temporaryPassword: plainPassword,
        enrollId: enrollment.enrollId
      });
    }

    // 4. INVALID ACTION
    logToConsole("WARN", "INVALID_ACTION", { action });
    return res.status(400).json({
      success: false,
      message: "Invalid action. Use 'APPROVE' or 'REJECT'"
    });

  } catch (error) {
    logToConsole("ERROR", "ADMIN_ACTION_FAILED", {
      error: error.message,
      stack: error.stack,
      enrollId: req.body.enrollId,
      action: req.body.action
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
    const enrollment = await ClientEnrollment.findOne({
      enrollId: req.params.enrollId
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found"
      });
    }

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
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});


module.exports = router;
