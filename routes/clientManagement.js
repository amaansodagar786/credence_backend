const express = require("express");
const mongoose = require("mongoose");
const Client = require("../models/Client");
const auth = require("../middleware/authMiddleware");
const ActivityLog = require("../models/ActivityLog"); // ADDED
const FinancialStatementRequest = require('../models/FinancialStatementRequest');

const sendEmail = require("../utils/sendEmail");


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
   TOGGLE CLIENT ACTIVE STATUS - WITH EMAIL NOTIFICATION
================================ */
router.patch("/toggle-status/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { isActive, reason } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean value"
      });
    }

    // First get client details before update (need full details for email)
    const clientBefore = await Client.findOne({ clientId })
      .select("clientId name email firstName lastName businessName phone isActive");

    if (!clientBefore) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Get current date for tracking
    const currentDate = new Date();

    // Prepare update object based on action
    const updateObj = {
      isActive,
      ...(isActive === false ? {
        deactivatedAt: currentDate,
        deactivatedBy: req.user.adminId,
        deactivationReason: reason || "No reason provided",
        reactivatedAt: null, // Clear reactivation if exists
        reactivatedBy: null,
        reactivationReason: null
      } : {
        reactivatedAt: currentDate,
        reactivatedBy: req.user.adminId,
        reactivationReason: reason || "No reason provided"
        // DO NOT clear deactivatedAt - we need it for history!
      })
    };

    // Add to global status history
    updateObj.$push = {
      globalStatusHistory: {
        status: isActive ? 'active' : 'inactive',
        changedAt: currentDate,
        changedBy: req.user.adminId,
        adminName: req.user.name,
        reason: reason || "No reason provided",
        metadata: {
          action: isActive ? 'REACTIVATION' : 'DEACTIVATION'
        }
      }
    };

    // Update the client
    const client = await Client.findOneAndUpdate(
      { clientId },
      updateObj,
      { new: true }
    ).select("-password -documents -employeeAssignments");

    // Activity Log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: clientId,
        action: isActive ? "CLIENT_REACTIVATED" : "CLIENT_DEACTIVATED",
        details: `${isActive ? 'Reactivated' : 'Deactivated'} client: ${clientBefore.name} (${clientId})${reason ? `. Reason: ${reason}` : ''}`,
        dateTime: new Date(),
        metadata: {
          clientId,
          clientName: clientBefore.name,
          previousStatus: clientBefore.isActive,
          newStatus: isActive,
          changedByAdmin: req.user.name,
          reason: reason || "No reason provided"
        }
      });
    } catch (logError) {
      console.error("Activity log failed:", logError);
    }

    // ========== NEW: Send email to client about status change ==========
    try {
      if (client.email) {
        const currentDateTime = new Date().toLocaleString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        // Email subject based on action
        const emailSubject = isActive
          ? `✅ Account Reactivated - ${client.businessName || client.name}`
          : `⚠️ Account Deactivated - ${client.businessName || client.name}`;

        // Create email HTML
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Account Status Update</title>
            <style>
              body { font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
              .header { background: #111111; color: #ffffff; padding: 30px 20px; text-align: center; }
              .header h1 { margin: 0; font-size: 24px; color: #7cd64b; }
              .content { padding: 30px; background: #ffffff; }
              .status-box { 
                background: ${isActive ? '#e8f5e9' : '#ffebee'}; 
                border-left: 4px solid ${isActive ? '#4caf50' : '#f44336'}; 
                padding: 20px; 
                margin: 25px 0; 
                border-radius: 0 8px 8px 0;
              }
              .client-info { background: #f8f9fa; border: 1px solid #e9ecef; padding: 20px; margin: 25px 0; border-radius: 8px; }
              .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; }
              .contact-info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; }
              .section-title { color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px; margin-bottom: 20px; }
              .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
              .warning-box { background: #fff3e0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ff9800; }
              table { width: 100%; border-collapse: collapse; margin: 15px 0; }
              th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
              th { background: #f8f9fa; font-weight: 600; width: 35%; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Credence Enterprise Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
            </div>
            
            <div class="content">
              <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName || ''} ${client.lastName || ''},</h2>
              
              <div class="status-box">
                <h3 style="margin-top: 0; color: ${isActive ? '#4caf50' : '#f44336'};">
                  ${isActive ? '✅ ACCOUNT REACTIVATED' : '⚠️ ACCOUNT DEACTIVATED'}
                </h3>
                <p>Your account has been ${isActive ? 'reactivated' : 'deactivated'} by our admin team.</p>
                <p><strong>Date & Time:</strong> ${currentDateTime}</p>
                <p><strong>Admin:</strong> ${req.user.name}</p>
                ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
              </div>
              
              <div class="client-info">
                <h3 class="section-title">📋 Account Information</h3>
                <table>
                  <tr>
                    <th>Full Name</th>
                    <td>${client.firstName || ''} ${client.lastName || ''}</td>
                  </tr>
                  <tr>
                    <th>Business Name</th>
                    <td>${client.businessName || 'Not specified'}</td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>${client.email}</td>
                  </tr>
                  <tr>
                    <th>Phone</th>
                    <td>${client.phone || 'Not provided'}</td>
                  </tr>
                  <tr>
                    <th>Current Status</th>
                    <td>
                      <span style="color: ${isActive ? '#4caf50' : '#f44336'}; font-weight: bold;">
                        ${isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                  </tr>
                </table>
              </div>

              ${!isActive ? `
              <div class="warning-box">
                <p><strong>⚠️ What this means:</strong></p>
                <ul>
                  <li>You will not be able to access your accounting portal</li>
                  <li>Task assignments and new requests are paused</li>
                  <li>Your data remains safe and secure with us</li>
                </ul>
                <p style="margin-top: 15px;">If you believe this was done in error or have questions, please contact our support team immediately.</p>
              </div>
              ` : `
              <div class="warning-box" style="background: #e8f5e9; border-left-color: #4caf50;">
                <p><strong>✅ Account Reactivated:</strong> You can now access all features of your accounting portal. All services have been restored.</p>
              </div>
              `}
              
              <div class="contact-info">
                <h3 class="section-title">📞 Need Assistance?</h3>
                <p><strong>Email:</strong> support@jladgroup.fi</p>
                <p><strong>Phone Support:</strong> +358413250081</p>
                <p><strong>Business Hours:</strong> Monday to Friday 9am to 3pm (EET/EEST)</p>
              </div>
            </div>
            
            <div class="footer">
              <p><strong>Credence Enterprise Accounting Services</strong></p>
              <p>Professional Accounting | VAT Compliance | Business Advisory</p>
              <div class="dev-info">
                Developed by Vapautus Media Private Limited
              </div>
              <p style="font-size: 12px; margin-top: 10px;">
                This is an automated notification email about your account status.<br>
                Please do not reply to this email. For queries, contact support@jladgroup.fi<br>
                Email sent to: ${client.email}
              </p>
            </div>
          </body>
          </html>
        `;

        // Send email using your sendEmail utility
        await sendEmail(client.email, emailSubject, emailHtml);

        logToConsole("INFO", isActive ? "ACTIVATION_EMAIL_SENT" : "DEACTIVATION_EMAIL_SENT", {
          clientId: clientId,
          clientEmail: client.email,
          adminId: req.user.adminId,
          status: isActive ? 'activated' : 'deactivated',
          reason: reason || 'No reason provided'
        });
      }
    } catch (emailError) {
      logToConsole("ERROR", "STATUS_CHANGE_EMAIL_FAILED", {
        error: emailError.message,
        clientId: clientId,
        clientEmail: client.email,
        action: isActive ? 'activation' : 'deactivation'
      });
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: `Client ${isActive ? 'activated' : 'deactivated'} successfully. Email notification ${client.email ? 'sent' : 'failed - no email address'}.`,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        isActive: client.isActive,
        deactivatedAt: client.deactivatedAt,
        reactivatedAt: client.reactivatedAt
      },
      emailSent: client.email ? true : false
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
              <h1>Credence Enterprise Accounting Services</h1>
              <p style="margin-top: 5px; opacity: 0.9;">Professional Accounting & VAT Compliance</p>
            </div>
            
            <div class="content">
              <h2 style="color: #2c3e50; margin-top: 0;">Dear ${client.firstName} ${client.lastName},</h2>
              
              <div class="update-box">
                <h3 style="margin-top: 0; color: #4caf50;">✅ PROFILE UPDATED SUCCESSFULLY</h3>
                <p>Your client profile has been updated by our admin team. Below are the details of changes made:</p>
                <p><strong>Updated On:</strong> ${currentDate} at ${currentTime} EET/EEST</p>
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
                <p><strong>Email:</strong> support@jladgroup.fi</p>
               <p><strong>Phone Support:</strong> +358413250081</p>
                <p><strong>Business Hours:</strong> Monday to Fri 9am to 3pm (EET/EEST)</p>
              </div>
              
              <p style="margin-top: 25px; font-size: 14px; color: #666;">
                <strong>Important:</strong> Keeping your profile information updated ensures we provide you with the best accounting services and VAT compliance support.
              </p>
            </div>
            
            <div class="footer">
              <p><strong>Credence Enterprise Accounting Services</strong></p>
              <p>Professional Accounting | VAT Compliance | Business Advisory</p>
              <div class="dev-info">
                Developed by Vapautus Media Private Limited
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



router.get('/all-requests', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    // Build query
    const query = {};

    // Filter by status if provided
    if (status && status !== 'all') {
      query.status = status;
    }

    // Search by client name, email, or requestId
    if (search) {
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientEmail: { $regex: search, $options: 'i' } },
        { requestId: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get requests with pagination
    const requests = await FinancialStatementRequest.find(query)
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v -updatedAt');

    // Get total count
    const total = await FinancialStatementRequest.countDocuments(query);

    // Get counts by status for filters
    const statusCounts = {
      pending: await FinancialStatementRequest.countDocuments({ status: 'pending' }),
      in_progress: await FinancialStatementRequest.countDocuments({ status: 'in_progress' }),
      approved: await FinancialStatementRequest.countDocuments({ status: 'approved' }),
      sent: await FinancialStatementRequest.countDocuments({ status: 'sent' }),
      cancelled: await FinancialStatementRequest.countDocuments({ status: 'cancelled' }),
      all: total
    };

    res.json({
      success: true,
      data: requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      statusCounts
    });

  } catch (error) {
    console.error('Error fetching admin requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests'
    });
  }
});

// 6. ADMIN: Get single request details
router.get('/request/:requestId', auth, async (req, res) => {
  try {
    const request = await FinancialStatementRequest.findOne({
      requestId: req.params.requestId
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    res.json({
      success: true,
      data: request
    });

  } catch (error) {
    console.error('Error fetching request details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch request details'
    });
  }
});

// 7. ADMIN: Approve and send statements
router.put('/approve/:requestId', auth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { adminNotes, downloadUrl } = req.body;

    // Find the request
    const request = await FinancialStatementRequest.findOne({ requestId });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }


    // Check if already approved/sent
    if (request.status === 'approved' || request.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: `Request already ${request.status}`
      });
    }

    // Update request status to approved
    request.status = 'approved';
    request.sentDate = new Date();
    request.processedAt = new Date();
    request.processedBy = {
      adminId: req.user.adminId,
      adminName: req.user.name
    };

    if (adminNotes) {
      request.adminNotes = adminNotes;
    }

    if (downloadUrl) {
      request.downloadUrl = downloadUrl;
    }

    await request.save();

    // Send email to client ONLY (no email to admin)
    const clientEmail = request.clientEmail;
    const clientName = request.clientName;
    const monthYear = `${request.month} ${request.year}`;

    const clientSubject = `✅ Your Financial Statements for ${monthYear} are Ready!`;
    const clientHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7cd64b;">Your Financial Statements are Ready!</h2>
        <div style="background: #f8fff5; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #7cd64b;">
          <h3>Request Details:</h3>
          <p><strong>Request ID:</strong> ${request.requestId}</p>
          <p><strong>Period:</strong> ${monthYear}</p>
          <p><strong>Status:</strong> <span style="color: #27ae60; font-weight: bold;">✅ Approved & Sent</span></p>
          <p><strong>Sent Date:</strong> ${new Date().toLocaleString('en-IN')}</p>
          ${downloadUrl ? `<p><strong>Download Link:</strong> <a href="${downloadUrl}" style="color: #3498db;">Click here to download</a></p>` : ''}
          ${adminNotes ? `<p><strong>Admin Notes:</strong> ${adminNotes}</p>` : ''}
        </div>
        
       
        
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196f3;">
          <p><strong>💡 Important:</strong></p>
          <p>• Review the statements carefully</p>
          <p>• Keep a copy for your records</p>
          <p>• Contact us if you have any questions</p>
        </div>
        
        <p style="margin-top: 30px;">Thank you for using our accounting services!</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <small>This is an automated notification from Credence Accounting Portal.</small>
        </div>
      </div>
    `;

    // Send email to client
    sendEmail(clientEmail, clientSubject, clientHtml)
      .then(() => {
        // Update email sent status
        request.statementSentEmail = true;
        request.save().catch(console.error);

        // Log activity
        console.log(`Email sent to client ${clientEmail} for request ${requestId}`);
      })
      .catch(error => {
        console.error('Failed to send email to client:', error);
        // Don't fail the request if email fails
      });

    // Create activity log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: request.clientId,
        clientName: request.clientName,
        action: "FINANCIAL_STATEMENT_APPROVED",
        details: `Approved financial statement request ${requestId} for ${monthYear}`,
        dateTime: new Date(),
        metadata: {
          requestId: requestId,
          month: request.month,
          year: request.year,
          clientEmail: request.clientEmail,
          downloadUrl: downloadUrl || null,
          adminNotes: adminNotes || null
        }
      });
    } catch (logError) {
      console.error('Activity log error:', logError);
    }

    res.json({
      success: true,
      message: 'Request approved successfully. Email sent to client.',
      data: request
    });

  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve request'
    });
  }
});

// 8. ADMIN: Update request status (for in_progress, sent, etc.)
router.put('/update-status/:requestId', auth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, adminNotes } = req.body;

    // Validate status
    const validStatuses = ['pending', 'in_progress', 'approved', 'sent', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Find the request
    const request = await FinancialStatementRequest.findOne({ requestId });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Update status
    request.status = status;

    if (status === 'sent') {
      request.sentDate = new Date();
    }

    if (status === 'approved' || status === 'sent') {
      request.processedAt = new Date();
      request.processedBy = {
        adminId: req.user.adminId,
        adminName: req.user.name
      };
    }

    if (adminNotes) {
      request.adminNotes = adminNotes;
    }

    await request.save();

    // Create activity log
    try {
      await ActivityLog.create({
        userName: req.user.name,
        role: req.user.role,
        adminId: req.user.adminId,
        clientId: request.clientId,
        clientName: request.clientName,
        action: `FINANCIAL_STATEMENT_${status.toUpperCase()}`,
        details: `Changed status to ${status} for request ${requestId}`,
        dateTime: new Date(),
        metadata: {
          requestId: requestId,
          previousStatus: request.status,
          newStatus: status,
          adminNotes: adminNotes || null
        }
      });
    } catch (logError) {
      console.error('Activity log error:', logError);
    }

    res.json({
      success: true,
      message: `Status updated to ${status} successfully`,
      data: request
    });

  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
});

// 9. ADMIN: Get statistics/dashboard counts
router.get('/statistics', auth, async (req, res) => {
  try {
    const totalRequests = await FinancialStatementRequest.countDocuments();
    const pendingRequests = await FinancialStatementRequest.countDocuments({ status: 'pending' });
    const inProgressRequests = await FinancialStatementRequest.countDocuments({ status: 'in_progress' });
    const approvedRequests = await FinancialStatementRequest.countDocuments({ status: 'approved' });
    const sentRequests = await FinancialStatementRequest.countDocuments({ status: 'sent' });

    // Recent requests (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentRequests = await FinancialStatementRequest.countDocuments({
      requestedAt: { $gte: sevenDaysAgo }
    });

    res.json({
      success: true,
      data: {
        total: totalRequests,
        pending: pendingRequests,
        in_progress: inProgressRequests,
        approved: approvedRequests,
        sent: sentRequests,
        recent_7_days: recentRequests
      }
    });

  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
});



/* ===============================
   HELPER FUNCTION: Get months between two dates with partial month support
================================ */
function getMonthsInRange(startDate, endDate) {
  const months = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const year = current.getFullYear();
    const month = current.getMonth();

    // First day of this month
    const monthStart = new Date(year, month, 1);
    // Last day of this month
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

    // Check if this is a partial month
    const isPartial =
      (current.getTime() === startDate.getTime() && startDate > monthStart) || // First month partial
      (monthEnd > endDate); // Last month partial

    // Actual start and end for this month within our range
    const actualStart = isPartial ?
      new Date(Math.max(monthStart.getTime(), startDate.getTime())) :
      new Date(monthStart);

    const actualEnd = isPartial ?
      new Date(Math.min(monthEnd.getTime(), endDate.getTime())) :
      new Date(monthEnd);

    months.push({
      year,
      month,
      monthName: monthStart.toLocaleString('default', { month: 'long' }),
      startOfMonth: monthStart,
      endOfMonth: monthEnd,
      isPartial,
      actualStartDate: actualStart,
      actualEndDate: actualEnd
    });

    // Move to next month
    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return months;
}

/* ===============================
   TASK INFO - FULLY OPTIMIZED VERSION
   - Shows ALL active clients (even with 0 tasks)
   - Batch queries (3 total queries, not 1,200+)
   - Fast loading (< 2 seconds)
   - Correct month filtering
================================ */
router.get("/task-info", auth, async (req, res) => {
  try {
    const { filterType, fromDate, toDate } = req.query;

    // Get date range based on filter
    let startDate, endDate;
    const today = new Date();

    if (filterType === 'thisMonth') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    }
    else if (filterType === 'lastMonth') {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    }
    else if (filterType === 'custom' && fromDate && toDate) {
      startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid date filter parameters"
      });
    }

    console.log("🔍 Fetching task info from:", startDate, "to", endDate);

    // ============= STEP 1: Get ALL active clients (even with 0 tasks) =============
    const clients = await Client.find({ isActive: true })
      .select("clientId name email businessName employeeAssignments documents firstName lastName")
      .lean();

    console.log(`🔍 Found ${clients.length} total active clients`);

    if (clients.length === 0) {
      return res.json({
        success: true,
        data: [],
        filterInfo: { type: filterType, from: startDate, to: endDate }
      });
    }

    // ============= STEP 2: Get all months in range once =============
    const monthsInRange = getMonthsInRange(startDate, endDate);
    const clientIds = clients.map(c => c.clientId);

    // ============= STEP 3: BATCH QUERY - Get ALL payment statuses in ONE go =============
    let paymentMap = new Map(); // Key: "clientId-year-month"

    try {
      const ClientMonthlyData = require("../models/ClientMonthlyData");

      // ONE query to get all payment data
      const allMonthlyData = await ClientMonthlyData.find({
        clientId: { $in: clientIds }
      }).lean();

      for (const record of allMonthlyData) {
        if (record.months && Array.isArray(record.months)) {
          for (const month of record.months) {
            if (month.paymentStatus !== undefined) {
              const key = `${record.clientId}-${month.year}-${month.month}`;
              paymentMap.set(key, {
                status: month.paymentStatus === true,
                updatedAt: month.paymentUpdatedAt || null,
                updatedBy: month.paymentUpdatedBy || null,
                updatedByName: month.paymentUpdatedByName || null,
                notes: month.paymentNotes || null,
                source: 'new'
              });
            }
          }
        }
      }

      // Also check old documents for payment status
      const clientsWithDocs = await Client.find(
        { clientId: { $in: clientIds } },
        { clientId: 1, documents: 1 }
      ).lean();

      for (const client of clientsWithDocs) {
        if (client.documents && typeof client.documents === 'object') {
          for (const [yearKey, yearData] of Object.entries(client.documents)) {
            if (yearData && typeof yearData === 'object') {
              for (const [monthKey, monthData] of Object.entries(yearData)) {
                if (monthData && monthData.paymentStatus !== undefined) {
                  const key = `${client.clientId}-${yearKey}-${monthKey}`;
                  if (!paymentMap.has(key)) {
                    paymentMap.set(key, {
                      status: monthData.paymentStatus === true,
                      updatedAt: monthData.paymentUpdatedAt || null,
                      updatedBy: monthData.paymentUpdatedBy || null,
                      updatedByName: monthData.paymentUpdatedByName || null,
                      notes: monthData.paymentNotes || null,
                      source: 'old'
                    });
                  }
                }
              }
            }
          }
        }
      }

      console.log(`🔍 Loaded ${paymentMap.size} payment records from batch query`);
    } catch (err) {
      console.log("Error loading payment data:", err.message);
    }

    // ============= STEP 4: Process EACH client (including those with 0 tasks) =============
    const taskData = [];

    for (const client of clients) {
      const assignments = client.employeeAssignments || [];

      // Filter assignments within date range (by assignedAt date)
      const assignmentsInRange = assignments.filter(assignment => {
        if (!assignment.assignedAt) return false;
        if (assignment.isRemoved) return false;
        const assignDate = new Date(assignment.assignedAt);
        return assignDate >= startDate && assignDate <= endDate;
      });

      // Calculate task counts (can be 0)
      const totalTasks = assignmentsInRange.length;
      const pendingTasks = assignmentsInRange.filter(a => !a.accountingDone).length;
      const completedTasks = assignmentsInRange.filter(a => a.accountingDone).length;

      // Calculate payment summary for the period
      let paymentSummary = {
        totalMonths: 0,
        paidMonths: 0,
        pendingMonths: 0,
        months: []
      };

      // Process each month in the range
      for (const monthInfo of monthsInRange) {
        const year = monthInfo.year;
        const monthNum = monthInfo.month + 1; // Convert to 1-12

        // Get payment from map (NO database call!)
        const paymentKey = `${client.clientId}-${year}-${monthNum}`;
        const paymentFromMap = paymentMap.get(paymentKey);

        let paymentStatus = false;
        let paymentDetails = {
          status: false,
          updatedAt: null,
          updatedBy: null,
          updatedByName: null,
          notes: null,
          source: null
        };

        if (paymentFromMap) {
          paymentStatus = paymentFromMap.status;
          paymentDetails = paymentFromMap;
        }

        paymentSummary.months.push({
          year: monthInfo.year,
          month: monthNum,
          monthName: monthInfo.monthName,
          fromDate: monthInfo.actualStartDate,
          toDate: monthInfo.actualEndDate,
          isPartial: monthInfo.isPartial,
          payment: paymentDetails
        });

        if (paymentStatus) {
          paymentSummary.paidMonths++;
        } else {
          paymentSummary.pendingMonths++;
        }
      }

      paymentSummary.totalMonths = paymentSummary.months.length;

      // Create display text based on payment status
      let paymentDisplayText = 'No Data';
      if (paymentSummary.totalMonths > 0) {
        if (paymentSummary.paidMonths === paymentSummary.totalMonths) {
          paymentDisplayText = 'All Paid';
        } else if (paymentSummary.pendingMonths === paymentSummary.totalMonths) {
          paymentDisplayText = 'All Pending';
        } else {
          paymentDisplayText = `${paymentSummary.paidMonths}/${paymentSummary.totalMonths} Paid`;
        }
      }

      // ============= CREATE MONTHLY BREAKDOWN FOR MODAL =============
      const monthlyBreakdown = [];

      for (const monthInfo of monthsInRange) {
        const year = monthInfo.year;
        const monthNum = monthInfo.month + 1;

        // ✅ FIXED: Get tasks by matching year and month from assignment object
        const monthTasks = assignments.filter(assignment => {
          return assignment.year === year &&
            assignment.month === monthNum &&
            !assignment.isRemoved;
        }).map(task => ({
          taskName: task.task || 'Task',
          employeeName: task.employeeName || 'Not Assigned',
          employeeId: task.employeeId,
          assignedAt: task.assignedAt,
          accountingDone: task.accountingDone || false,
          completedAt: task.accountingDoneAt || null,
          completedBy: task.accountingDoneBy || null
        }));

        const monthPayment = paymentSummary.months.find(
          m => m.year === year && m.month === monthNum
        )?.payment || { status: false };

        // ✅ ADD MONTH EVEN IF NO TASKS (for payment tab visibility)
        monthlyBreakdown.push({
          month: monthInfo.monthName,
          year: year,
          monthNum: monthNum,
          fromDate: monthInfo.actualStartDate,
          toDate: monthInfo.actualEndDate,
          isPartial: monthInfo.isPartial,
          tasks: monthTasks,
          payment: monthPayment
        });
      }

      // Sort breakdown by date (newest first)
      monthlyBreakdown.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.monthNum - a.monthNum;
      });

      // ✅ FIXED: ALWAYS add client (even with 0 tasks)
      taskData.push({
        clientId: client.clientId,
        clientName: client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim(),
        email: client.email,
        businessName: client.businessName || 'N/A',
        tasksSummary: {
          total: totalTasks,
          assigned: totalTasks,
          pending: pendingTasks,
          completed: completedTasks
        },
        paymentSummary: {
          totalMonths: paymentSummary.totalMonths,
          paidMonths: paymentSummary.paidMonths,
          pendingMonths: paymentSummary.pendingMonths,
          displayText: paymentDisplayText,
          months: paymentSummary.months
        },
        monthlyBreakdown: monthlyBreakdown,
        dateRange: {
          from: startDate,
          to: endDate,
          filterType
        }
      });
    }

    // Sort clients by name
    taskData.sort((a, b) => a.clientName.localeCompare(b.clientName));

    console.log(`✅ Task info processed successfully for ${taskData.length} clients (all active clients)`);

    res.json({
      success: true,
      data: taskData,
      filterInfo: {
        type: filterType,
        from: startDate,
        to: endDate
      },
      performance: {
        totalClients: taskData.length,
        clientsWithTasks: taskData.filter(c => c.tasksSummary.total > 0).length,
        monthsProcessed: monthsInRange.length,
        paymentRecordsLoaded: paymentMap.size
      }
    });

  } catch (error) {
    console.error("Error fetching task info:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching task information",
      error: error.message
    });
  }
});

module.exports = router;