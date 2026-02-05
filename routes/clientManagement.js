const express = require("express");
const mongoose = require("mongoose");
const Client = require("../models/Client");
const auth = require("../middleware/authMiddleware");
const ActivityLog = require("../models/ActivityLog"); // ADDED

const router = express.Router();

// Console logging helper
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
  console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   GET ALL CLIENTS (FOR ACTIVE CONTROL & CLIENTS DATA)
================================ */
router.get("/all-clients", auth, async (req, res) => {
  try {
    const clients = await Client.find()
      .select("clientId name email phone firstName lastName visaType hasStrongId businessName vatPeriod businessNature registerTrade planSelected isActive enrollmentDate createdAt")
      .sort({ createdAt: -1 });

    // ADDED: Activity Log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        action: "ALL_CLIENTS_VIEWED",
        details: `Viewed all clients list. Total: ${clients.length} clients`,
        dateTime: new Date(),
        metadata: {
          totalClients: clients.length
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        adminId: req.user.adminId
      });
    }

    res.json({
      success: true,
      count: clients.length,
      clients
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching clients",
      error: error.message
    });
  }
});

/* ===============================
   TOGGLE CLIENT ACTIVE STATUS
================================ */
router.patch("/toggle-status/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean value"
      });
    }

    // First get client details before update
    const clientBefore = await Client.findOne({ clientId })
      .select("clientId name email isActive");

    const client = await Client.findOneAndUpdate(
      { clientId },
      {
        isActive,
        ...(isActive === false ? { deactivatedAt: new Date() } : { deactivatedAt: null })
      },
      { new: true }
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ADDED: Activity Log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: clientId,
        action: "CLIENT_STATUS_TOGGLED",
        details: `Changed client status from ${clientBefore?.isActive} to ${isActive} for client: ${clientBefore?.name} (${clientId})`,
        dateTime: new Date(),
        metadata: {
          clientId,
          clientName: clientBefore?.name,
          previousStatus: clientBefore?.isActive,
          newStatus: isActive,
          changedByAdmin: req.user.name
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        adminId: req.user.adminId
      });
    }

    res.json({
      success: true,
      message: `Client ${isActive ? 'activated' : 'deactivated'} successfully`,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        isActive: client.isActive
      }
    });

  } catch (error) {
    console.error("Error toggling client status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/* ===============================
   GET SINGLE CLIENT DETAILS
================================ */
router.get("/client/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await Client.findOne({ clientId })
      .select("-password -documents -employeeAssignments");

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ADDED: Activity Log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: clientId,
        action: "CLIENT_DETAILS_VIEWED",
        details: `Viewed client details for: ${client.name} (${clientId})`,
        dateTime: new Date(),
        metadata: {
          clientId,
          clientName: client.name,
          viewedByAdmin: req.user.name
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        adminId: req.user.adminId
      });
    }

    res.json({
      success: true,
      client
    });
  } catch (error) {
    console.error("Error fetching client details:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/* ===============================
   UPDATE CLIENT DETAILS WITH EMAIL NOTIFICATION
================================ */
router.patch("/update-client/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const updateData = req.body;

    // Only allow specific fields to be updated
    const allowedFields = [
      'visaType',
      'hasStrongId',
      'vatPeriod',
      'businessNature',
      'registerTrade',
      'planSelected'
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

    // Get client before update
    const clientBefore = await Client.findOne({ clientId })
      .select("clientId name email firstName lastName businessName phone visaType hasStrongId vatPeriod businessNature registerTrade planSelected");

    const client = await Client.findOneAndUpdate(
      { clientId },
      { $set: filteredUpdate },
      { new: true }
    ).select("-password -documents -employeeAssignments");

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Track changes for email and log
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

    // ADDED: Activity Log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: clientId,
        action: "CLIENT_DETAILS_UPDATED",
        details: `Updated client details for: ${client.name} (${clientId}). Fields changed: ${changes.map(c => c.field).join(', ')}`,
        dateTime: new Date(),
        metadata: {
          clientId,
          clientName: client.name,
          changes: changes,
          updatedByAdmin: req.user.name,
          timestamp: new Date()
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        adminId: req.user.adminId
      });
    }

    // NEW: Send email to client about the update
    try {
      if (changes.length > 0 && client.email) {
        // Format field names for display
        const fieldDisplayNames = {
          visaType: "Visa Type",
          hasStrongId: "Strong ID Status",
          vatPeriod: "VAT Period",
          businessNature: "Business Nature",
          registerTrade: "Registered Trade",
          planSelected: "Selected Plan"
        };

        const currentDate = new Date().toLocaleDateString('en-IN');
        const currentTime = new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        // Create email subject and HTML
        const emailSubject = `✅ Client Profile Updated - ${client.businessName || client.name}`;

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
              <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
              
              <div class="update-box">
                <h3 style="margin-top: 0; color: #4caf50;">✅ PROFILE UPDATED SUCCESSFULLY</h3>
                <p>Your client profile has been updated by our admin team. Below are the details of changes made:</p>
                <p><strong>Updated On:</strong> ${currentDate} at ${currentTime} IST</p>
                <p><strong>Updated By:</strong> ${req.user.name} (Admin)</p>
              </div>
              
              <div class="client-info">
                <h3 class="section-title">📋 Profile Changes Summary</h3>
                <table class="change-table">
                  <tr>
                    <th>Field</th>
                    <th>Previous Value</th>
                    <th>New Value</th>
                  </tr>
                  ${changesTable}
                </table>
              </div>
              
              <div class="client-info">
                <h3 class="section-title">👤 Your Current Profile Information</h3>
                <table>
                 
                  <tr>
                    <th>Full Name</th>
                    <td>${client.firstName} ${client.lastName}</td>
                  </tr>
                  <tr>
                    <th>Business Name</th>
                    <td>${client.businessName || "Not specified"}</td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>${client.email}</td>
                  </tr>
                  <tr>
                    <th>Phone</th>
                    <td>${client.phone || "Not provided"}</td>
                  </tr>
                  <tr>
                    <th>Visa Type</th>
                    <td>${client.visaType || "Not specified"}</td>
                  </tr>
                  <tr>
                    <th>Selected Plan</th>
                    <td>${client.planSelected || "Not specified"}</td>
                  </tr>
                </table>
              </div>
              
              <div class="note-box">
                <p><strong>📝 Note:</strong> This update was performed by our admin team to ensure your profile information is accurate and up-to-date.</p>
                <p>If you did not request these changes or notice any discrepancies, please contact our support team immediately.</p>
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
                This is an automated notification email sent to inform you about profile changes.<br>
                Please do not reply to this email. For queries, contact support@jladgroup.fi<br>
                Email sent to: ${client.email}
              </p>
            </div>
          </body>
          </html>
        `;

        // Send email using your sendEmail utility
        const sendEmail = require("../utils/sendEmail");
        await sendEmail(client.email, emailSubject, emailHtml);

        logToConsole("INFO", "CLIENT_UPDATE_EMAIL_SENT", {
          clientId: clientId,
          clientEmail: client.email,
          adminId: req.user.adminId,
          fieldsUpdated: changes.map(c => c.field)
        });
      }
    } catch (emailError) {
      logToConsole("ERROR", "CLIENT_UPDATE_EMAIL_FAILED", {
        error: emailError.message,
        clientId: clientId,
        clientEmail: client.email
      });
      // Don't fail the whole request if email fails
    }

    res.json({
      success: true,
      message: "Client updated successfully",
      client,
      changes: changes.length > 0 ? changes : null,
      emailSent: changes.length > 0 && client.email ? true : false
    });

  } catch (error) {
    console.error("Error updating client:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

module.exports = router;