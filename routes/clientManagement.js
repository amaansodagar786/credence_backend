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
   TOGGLE CLIENT ACTIVE STATUS - SIMPLIFIED (STORE ONLY DATES)
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

    // First get client details before update
    const clientBefore = await Client.findOne({ clientId })
      .select("clientId name email isActive");

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
    );

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

    res.json({
      success: true,
      message: `Client ${isActive ? 'activated' : 'deactivated'} successfully.`,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        isActive: client.isActive,
        deactivatedAt: client.deactivatedAt,
        reactivatedAt: client.reactivatedAt
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








// ==================== ADMIN ROUTES ====================

// 5. ADMIN: Get all financial statement requests (using existing auth)
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

module.exports = router;