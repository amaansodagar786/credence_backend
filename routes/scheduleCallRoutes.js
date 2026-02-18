const express = require("express");
const { v4: uuidv4 } = require("uuid");
const ScheduleCall = require("../models/ScheduleCall");
const ActivityLog = require("../models/ActivityLog");
const sendEmail = require("../utils/sendEmail");
const router = express.Router();
const ConnectRequest = require("../models/ConnectRequest"); // NEW


// Submit schedule call request
router.post("/submit", async (req, res) => {
    try {
        console.log("📞 SCHEDULE CALL REQUEST:", req.body);

        // Extract data
        const { fullName, email, phone } = req.body;

        // Validate required fields
        if (!fullName || !email || !phone) {
            return res.status(400).json({
                success: false,
                message: "All fields are required: fullName, email, phone"
            });
        }

        // Check if same mobile exists within 48 hours
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

        const existingRequest = await ScheduleCall.findOne({
            phone: phone.trim(),
            submittedAt: { $gte: fortyEightHoursAgo }
        });

        if (existingRequest) {
            return res.status(409).json({
                success: false,
                message: "You have already submitted a request with this mobile number. Please wait 48 hours.",
                scheduleId: existingRequest.scheduleId
            });
        }

        // Create schedule call record
        const scheduleId = `SC-${uuidv4().slice(0, 8).toUpperCase()}`;

        const scheduleData = {
            scheduleId,
            fullName: fullName.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim()
        };

        const newSchedule = await ScheduleCall.create(scheduleData);
        console.log("✅ SCHEDULE CALL SAVED:", {
            scheduleId: newSchedule.scheduleId,
            name: newSchedule.fullName,
            email: newSchedule.email,
            phone: newSchedule.phone
        });

        // Send confirmation email to user
        try {
            const userEmailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #7cd64b; text-align: center;">Call Request Confirmed!</h2>
          
          <p>Dear <strong>${fullName}</strong>,</p>
          
          <p>Thank you for scheduling a call with <strong>Credence Accounting Services</strong>.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Your Details:</strong></p>
            <p><strong>Name:</strong> ${fullName}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Email:</strong> ${email}</p>
          </div>
          
          <p>Our team will contact you within <strong>24-48 hours</strong>.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">
              Best regards,<br>
              <strong>Credence Accounting Services</strong>
            </p>
          </div>
        </div>
      `;

            await sendEmail(
                email,
                "Call Request Confirmed - Credence Accounting Services",
                userEmailContent
            );

            console.log("✅ USER CONFIRMATION EMAIL SENT:", email);
        } catch (emailError) {
            console.error("❌ USER EMAIL FAILED:", emailError.message);
        }

        // Send notification email to admin
        try {
            const adminEmail = process.env.EMAIL_USER || "support@jladgroup.fi";

            const adminEmailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #ff6b6b;">📞 New Call Request</h2>
          
          <p><strong>New call request submitted:</strong></p>
          
          <div style="background: #fff5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Request ID:</strong> ${scheduleId}</p>
            <p><strong>Name:</strong> ${fullName}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', { timeZone: "Europe/Helsinki" })}</p>
          </div>
          
          <p>Please contact the client within 24-48 hours.</p>
        </div>
      `;

            await sendEmail(
                adminEmail,
                "New Call Request - Credence Accounting",
                adminEmailContent
            );

            console.log("✅ ADMIN NOTIFICATION EMAIL SENT:", adminEmail);
        } catch (emailError) {
            console.error("❌ ADMIN EMAIL FAILED:", emailError.message);
        }

        // Activity log - REMOVED dateTime line
        await ActivityLog.create({
            userName: fullName,
            action: "CALL_REQUEST_SUBMITTED",
            details: `Call request submitted by ${fullName} (${phone})`
            // dateTime line removed
        });

        // Success response
        res.status(201).json({
            success: true,
            message: "Call request submitted successfully. We will contact you soon.",
            scheduleId: newSchedule.scheduleId,
            data: {
                name: newSchedule.fullName,
                email: newSchedule.email,
                phone: newSchedule.phone,
                submittedAt: newSchedule.submittedAt
            }
        });

    } catch (error) {
        console.error("❌ SCHEDULE CALL ERROR:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate request detected"
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error during submission"
        });
    }
});

// Get all schedule calls (for admin)
router.get("/all", async (req, res) => {
    try {
        const calls = await ScheduleCall.find().sort({ submittedAt: -1 });

        res.json({
            success: true,
            count: calls.length,
            calls
        });
    } catch (error) {
        console.error("Error fetching calls:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// Get single schedule call by ID
router.get("/:scheduleId", async (req, res) => {
    try {
        const call = await ScheduleCall.findOne({
            scheduleId: req.params.scheduleId
        });

        if (!call) {
            return res.status(404).json({
                success: false,
                message: "Call request not found"
            });
        }

        res.json({
            success: true,
            call
        });
    } catch (error) {
        console.error("Error fetching call:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});






// ==============================================
// NEW: CONNECT US REQUEST ROUTE
// ==============================================
router.post("/connect-us/submit", async (req, res) => {
    try {
        console.log("📞 CONNECT US REQUEST:", req.body);

        // Extract data
        const { name, email, mobile, companyName, selectedService } = req.body;

        // Validate required fields
        if (!name || !email || !mobile || !selectedService) {
            return res.status(400).json({
                success: false,
                message: "Name, email, mobile, and service selection are required"
            });
        }

        // Check if same mobile exists within 48 hours
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

        const existingRequest = await ConnectRequest.findOne({
            mobile: mobile.trim(),
            submittedAt: { $gte: fortyEightHoursAgo }
        });

        if (existingRequest) {
            return res.status(409).json({
                success: false,
                message: "You have already submitted a request with this mobile number. Please wait 48 hours.",
                requestId: existingRequest.requestId
            });
        }

        // Create connect request record
        const requestId = `CR-${uuidv4().slice(0, 8).toUpperCase()}`;

        const requestData = {
            requestId,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            mobile: mobile.trim(),
            companyName: companyName ? companyName.trim() : "",
            selectedService: selectedService.trim()
        };

        const newRequest = await ConnectRequest.create(requestData);
        console.log("✅ CONNECT REQUEST SAVED:", {
            requestId: newRequest.requestId,
            name: newRequest.name,
            email: newRequest.email,
            service: newRequest.selectedService
        });

        // Send thank you email to user
        try {
            const userEmailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #7cd64b; text-align: center;">Thank You for Connecting!</h2>
          
          <p>Dear <strong>${name}</strong>,</p>
          
          <p>Thank you for your interest in our <strong>${selectedService}</strong> service.</p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Your Request Details:</strong></p>
            <p><strong>Request ID:</strong> ${requestId}</p>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Mobile:</strong> ${mobile}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Company:</strong> ${companyName || 'Not provided'}</p>
            <p><strong>Service Selected:</strong> ${selectedService}</p>
          </div>
          
          <p>Our team will review your request and contact you within <strong>24-48 hours</strong> with more details and pricing.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">
              Best regards,<br>
              <strong>Credence Accounting Services</strong>
            </p>
          </div>
        </div>
      `;

            await sendEmail(
                email,
                "Thank You for Connecting - Credence Accounting Services",
                userEmailContent
            );

            console.log("✅ USER THANK YOU EMAIL SENT:", email);
        } catch (emailError) {
            console.error("❌ USER EMAIL FAILED:", emailError.message);
        }

        // Send notification email to admin
        try {
            const adminEmail = process.env.EMAIL_USER || "support@jladgroup.fi";

            const adminEmailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #ff6b6b; background: #fff5f5; padding: 15px; border-radius: 8px;">
            🔔 New Connect Request
          </h2>
          
          <p><strong>A new service inquiry has been submitted:</strong></p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7cd64b;">
            <h3 style="margin-top: 0; color: #333;">Client Details:</h3>
            <p><strong>Request ID:</strong> ${requestId}</p>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Mobile:</strong> ${mobile}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Company:</strong> ${companyName || 'Not provided'}</p>
            <p><strong>Service Interested:</strong> ${selectedService}</p>
            <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', { timeZone: "Europe/Helsinki" })}</p>
          </div>
          
          <div style="background: #fff5f5; padding: 15px; border-radius: 6px;">
            <p><strong>⚠️ Action Required:</strong> Please contact the client within 24 hours.</p>
            <p><strong>📞 Phone:</strong> ${mobile}</p>
            <p><strong>📧 Email:</strong> ${email}</p>
          </div>
        </div>
      `;

            await sendEmail(
                adminEmail,
                `New Connect Request: ${name} - ${selectedService}`,
                adminEmailContent
            );

            console.log("✅ ADMIN NOTIFICATION EMAIL SENT:", adminEmail);
        } catch (emailError) {
            console.error("❌ ADMIN EMAIL FAILED:", emailError.message);
        }

        // Activity log - REMOVED dateTime line
        await ActivityLog.create({
            userName: name,
            action: "CONNECT_REQUEST_SUBMITTED",
            details: `Connect request for ${selectedService} by ${name} (${mobile})`
            // dateTime line removed
        });

        // Success response
        res.status(201).json({
            success: true,
            message: "Request submitted successfully. We will contact you soon.",
            requestId: newRequest.requestId,
            data: {
                name: newRequest.name,
                email: newRequest.email,
                service: newRequest.selectedService,
                submittedAt: newRequest.submittedAt
            }
        });

    } catch (error) {
        console.error("❌ CONNECT REQUEST ERROR:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate request detected"
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error during submission"
        });
    }
});

// ==============================================
// GET ALL CONNECT REQUESTS (FOR ADMIN)
// ==============================================
router.get("/connect-us/all", async (req, res) => {
    try {
        const requests = await ConnectRequest.find().sort({ submittedAt: -1 });

        res.json({
            success: true,
            count: requests.length,
            requests
        });
    } catch (error) {
        console.error("Error fetching connect requests:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ==============================================
// GET SINGLE CONNECT REQUEST
// ==============================================
router.get("/connect-us/:requestId", async (req, res) => {
    try {
        const request = await ConnectRequest.findOne({
            requestId: req.params.requestId
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Request not found"
            });
        }

        res.json({
            success: true,
            request
        });
    } catch (error) {
        console.error("Error fetching request:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});


module.exports = router;