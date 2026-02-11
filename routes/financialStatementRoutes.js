// routes/financialStatementRoutes.js
const express = require('express');
const router = express.Router();
const FinancialStatementRequest = require('../models/FinancialStatementRequest');
const sendEmail = require('../utils/sendEmail');
const jwt = require('jsonwebtoken');
const Client = require('../models/Client'); // ADD THIS LINE


// Middleware to verify client token
const verifyClientToken = (req, res, next) => {
  const token = req.cookies.clientToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'CLIENT') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    req.clientId = decoded.clientId;
    req.clientName = decoded.name;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// 1. Create new financial statement request
router.post('/request', verifyClientToken, async (req, res) => {
  try {
    const { month, year, additionalNotes } = req.body;

    // Validate required fields
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Month and year are required'
      });
    }

    // IMPORTANT: Import Client model at the top of your file
    // const Client = require('../models/Client'); // Add this line at the top

    // Get client details from database
    const client = await Client.findOne({ clientId: req.clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Get client email from database
    const clientEmail = client.email;
    const clientName = client.name || req.clientName || 'Client';

    // Check for duplicate pending request for same month/year
    const existingRequest = await FinancialStatementRequest.findOne({
      clientId: req.clientId,
      month,
      year,
      status: { $in: ['pending', 'in_progress'] }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: `You already have a pending request for ${month} ${year}`
      });
    }

    // Create new request
    const newRequest = new FinancialStatementRequest({
      clientId: req.clientId,
      clientName,
      clientEmail,
      month,
      year,
      adminNotes: additionalNotes || '',
      requestedAt: new Date()
    });

    await newRequest.save();

    // Send email to ADMIN
    const adminEmail = process.env.EMAIL_USER;
    const adminSubject = `New Financial Statement Request - ${clientName}`;
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Financial Statement Request</h2>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <h3>Request Details:</h3>
          <p><strong>Client Name:</strong> ${clientName}</p>
          <p><strong>Client Email:</strong> ${clientEmail}</p>
          <p><strong>Client ID:</strong> ${req.clientId}</p>
          <p><strong>Requested Period:</strong> ${month} ${year}</p>
          <p><strong>Request ID:</strong> ${newRequest.requestId}</p>
          <p><strong>Requested At:</strong> ${new Date().toLocaleString('en-IN')}</p>
          ${additionalNotes ? `<p><strong>Additional Notes:</strong> ${additionalNotes}</p>` : ''}
        </div>
        <p>Please review this request and prepare the financial statements.</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <small>This is an automated notification from Accounting Portal.</small>
        </div>
      </div>
    `;

    // Send email to CLIENT (confirmation)
    const clientSubject = `Financial Statement Request Received`;
    const clientHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7cd64b;">Request Received Successfully!</h2>
        <div style="background: #f8fff5; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #7cd64b;">
          <h3>Your Request Details:</h3>
          <p><strong>Request ID:</strong> ${newRequest.requestId}</p>
          <p><strong>Requested Period:</strong> ${month} ${year}</p>
          <p><strong>Status:</strong> <span style="color: #ffa500; font-weight: bold;">Pending Review</span></p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN')}</p>
        </div>
        <p><strong>What happens next?</strong></p>
        <ol style="margin-left: 20px;">
          <li>Our admin team has been notified of your request</li>
          <li>We will review and prepare your financial statements</li>
          <li>You will receive another email when statements are ready</li>
          <li>Statements will be available in your dashboard</li>
        </ol>
        <p style="margin-top: 30px;">Thank you for using our accounting services!</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <small>This is an automated confirmation from Accounting Portal.</small>
        </div>
      </div>
    `;

    // Send emails
    Promise.allSettled([
      sendEmail(adminEmail, adminSubject, adminHtml),
      sendEmail(clientEmail, clientSubject, clientHtml)
    ]).then(results => {
      FinancialStatementRequest.findByIdAndUpdate(newRequest._id, {
        emailSentToAdmin: results[0].status === 'fulfilled',
        emailSentToClient: results[1].status === 'fulfilled'
      }).catch(console.error);
    });

    res.status(201).json({
      success: true,
      message: 'Request submitted successfully',
      data: {
        requestId: newRequest.requestId,
        month,
        year,
        status: newRequest.status,
        requestedAt: newRequest.requestedAt
      }
    });

  } catch (error) {
    console.error('Error creating financial statement request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit request. Please try again.'
    });
  }
});

// 2. Get client's financial statement requests
router.get('/my-requests', verifyClientToken, async (req, res) => {
  try {
    const requests = await FinancialStatementRequest.find({
      clientId: req.clientId
    })
      .sort({ requestedAt: -1 })
      .select('-__v -updatedAt')
      .limit(20);

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests'
    });
  }
});

// 3. Get request status by ID
router.get('/status/:requestId', verifyClientToken, async (req, res) => {
  try {
    const request = await FinancialStatementRequest.findOne({
      requestId: req.params.requestId,
      clientId: req.clientId
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
    console.error('Error fetching request status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch request status'
    });
  }
});

// 4. Cancel a pending request
router.put('/cancel/:requestId', verifyClientToken, async (req, res) => {
  try {
    const request = await FinancialStatementRequest.findOne({
      requestId: req.params.requestId,
      clientId: req.clientId
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel request with status: ${request.status}`
      });
    }

    request.status = 'cancelled';
    await request.save();

    res.json({
      success: true,
      message: 'Request cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel request'
    });
  }
});

module.exports = router;