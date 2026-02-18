const express = require('express');
const router = express.Router();
const FinancialStatementRequest = require('../models/FinancialStatementRequest');
const sendEmail = require('../utils/sendEmail');
const jwt = require('jsonwebtoken');
const Client = require('../models/Client');

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

// Helper function to format date range for display
const formatDateRange = (fromDate, toDate) => {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${from.toLocaleDateString('en-IN', options)} - ${to.toLocaleDateString('en-IN', options)}`;
};

// Helper function to check for overlapping dates
const checkOverlappingRequests = async (clientId, fromDate, toDate, excludeRequestId = null) => {
  const query = {
    clientId: clientId,
    status: { $in: ['pending', 'in_progress'] }, // Only check active requests
    $or: [
      // Case 1: New request starts during existing request
      {
        fromDate: { $lte: new Date(toDate) },
        toDate: { $gte: new Date(fromDate) }
      },
      // Case 2: New request ends during existing request
      {
        fromDate: { $lte: new Date(toDate) },
        toDate: { $gte: new Date(fromDate) }
      },
      // Case 3: New request completely covers existing request
      {
        fromDate: { $gte: new Date(fromDate) },
        toDate: { $lte: new Date(toDate) }
      }
    ]
  };

  // If updating an existing request, exclude it from check
  if (excludeRequestId) {
    query.requestId = { $ne: excludeRequestId };
  }

  const overlappingRequests = await FinancialStatementRequest.find(query);

  console.log('Overlapping check:', {
    clientId,
    fromDate,
    toDate,
    overlappingCount: overlappingRequests.length,
    overlappingRequests: overlappingRequests.map(r => ({
      requestId: r.requestId,
      fromDate: r.fromDate,
      toDate: r.toDate,
      status: r.status
    }))
  });

  return overlappingRequests;
};

// 1. CREATE NEW REQUEST - WITH OVERLAP VALIDATION
router.post('/request', verifyClientToken, async (req, res) => {
  try {
    const { fromDate, toDate, additionalNotes } = req.body;

    console.log('Received request:', { fromDate, toDate, additionalNotes });

    // Validate required fields
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: 'From date and to date are required'
      });
    }

    // Parse dates
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // VALIDATION 1: Future dates check
    if (from > today) {
      return res.status(400).json({
        success: false,
        message: 'From date cannot be in the future'
      });
    }
    if (to > today) {
      return res.status(400).json({
        success: false,
        message: 'To date cannot be in the future'
      });
    }

    // VALIDATION 2: Date order check
    if (to < from) {
      return res.status(400).json({
        success: false,
        message: 'To date must be after or equal to from date'
      });
    }

    // Get client details from database
    const client = await Client.findOne({ clientId: req.clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const clientEmail = client.email;
    const clientName = client.name || req.clientName || 'Client';

    // VALIDATION 3: Check for overlapping requests (CRITICAL!)
    const overlappingRequests = await checkOverlappingRequests(req.clientId, from, to);

    if (overlappingRequests.length > 0) {
      // Format the overlapping dates for error message
      const overlappingDates = overlappingRequests.map(r =>
        `${r.fromDate.toLocaleDateString('en-IN')} to ${r.toDate.toLocaleDateString('en-IN')} (${r.status})`
      ).join(', ');

      console.log('❌ Overlap detected! Blocking request:', overlappingDates);

      return res.status(400).json({
        success: false,
        message: `You already have pending requests for these dates: ${overlappingDates}. Please wait for them to be processed before requesting overlapping periods.`,
        overlapping: overlappingRequests.map(r => ({
          fromDate: r.fromDate,
          toDate: r.toDate,
          status: r.status,
          requestId: r.requestId
        }))
      });
    }

    // Create date range display string
    const dateRangeDisplay = formatDateRange(from, to);

    // Create new request
    const newRequest = new FinancialStatementRequest({
      clientId: req.clientId,
      clientName,
      clientEmail,
      fromDate: from,
      toDate: to,
      dateRangeDisplay,
      adminNotes: additionalNotes || '',
      requestedAt: new Date(),
      status: 'pending'
    });

    await newRequest.save();
    console.log('✅ Request saved successfully:', newRequest.requestId);

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
                    <p><strong>Requested Period:</strong> ${dateRangeDisplay}</p>
                    <p><strong>From Date:</strong> ${from.toLocaleDateString('en-IN')}</p>
                    <p><strong>To Date:</strong> ${to.toLocaleDateString('en-IN')}</p>
                    <p><strong>Request ID:</strong> ${newRequest.requestId}</p>
                    <p><strong>Requested At:</strong> ${new Date().toLocaleString('en-IN', {
      timeZone: "Europe/Helsinki"
    })}</p>
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
                    <p><strong>Requested Period:</strong> ${dateRangeDisplay}</p>
                    <p><strong>From Date:</strong> ${from.toLocaleDateString('en-IN')}</p>
                    <p><strong>To Date:</strong> ${to.toLocaleDateString('en-IN')}</p>
                    <p><strong>Status:</strong> <span style="color: #ffa500; font-weight: bold;">Pending Review</span></p>
                    <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', {
      timeZone: "Europe/Helsinki"
    })}</p>
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

    // Send emails (don't await - let them run in background)
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
        fromDate: newRequest.fromDate,
        toDate: newRequest.toDate,
        dateRangeDisplay,
        status: newRequest.status,
        requestedAt: newRequest.requestedAt
      }
    });

  } catch (error) {
    console.error('❌ Error creating financial statement request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit request. Please try again.'
    });
  }
});

// 2. Get client's financial statement requests (UPDATED)
router.get('/my-requests', verifyClientToken, async (req, res) => {
  try {
    const requests = await FinancialStatementRequest.find({
      clientId: req.clientId
    })
      .sort({ requestedAt: -1 })
      .select('-__v -updatedAt')
      .limit(50);

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

// 3. Check availability for a date range (NEW HELPER ENDPOINT)
router.post('/check-availability', verifyClientToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: 'From date and to date are required'
      });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);

    const overlappingRequests = await checkOverlappingRequests(req.clientId, from, to);

    res.json({
      success: true,
      available: overlappingRequests.length === 0,
      overlapping: overlappingRequests.map(r => ({
        fromDate: r.fromDate,
        toDate: r.toDate,
        status: r.status,
        requestId: r.requestId,
        dateRangeDisplay: r.dateRangeDisplay
      }))
    });
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check availability'
    });
  }
});

// 4. Get request status by ID (UPDATED)
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

// 5. Cancel a pending request
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