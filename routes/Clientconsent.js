const express = require("express");
const jwt = require("jsonwebtoken");
const Client = require("../models/Client");
const ClientConsent = require("../models/Clientconsent");
const AgreementPdf = require("../models/AgreementPdf");
const ActivityLog = require("../models/ActivityLog");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   CHECK IF CLIENT NEEDS CONSENT UPDATE
   GET /client-consent/check
================================ */
router.get("/check", async (req, res) => {
    try {
        const token = req.cookies?.clientToken;
        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized. Please login." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const clientId = decoded.clientId;

        const client = await Client.findOne({ clientId }).select("clientId requiresConsentUpdate");
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found." });
        }

        res.json({
            success: true,
            requiresConsentUpdate: client.requiresConsentUpdate || false
        });

    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, message: "Session expired. Please login again." });
        }
        logToConsole("ERROR", "CONSENT_CHECK_FAILED", { error: error.message });
        res.status(500).json({ success: false, message: "Failed to check consent status." });
    }
});

/* ===============================
   ACCEPT AGREEMENT — SAVE CONSENT + SEND EMAIL WITH PDF
   POST /client-consent/accept
================================ */
router.post("/accept", async (req, res) => {
    try {
        const token = req.cookies?.clientToken;
        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized. Please login." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const clientId = decoded.clientId;

        const client = await Client.findOne({ clientId });
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found." });
        }

        // Capture IP — backend only, never from frontend
        const userIp =
            req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
            req.headers["x-real-ip"] ||
            req.socket.remoteAddress ||
            "Unknown";

        const now = new Date();

        const consentDate = now.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });

        const consentTime = now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "Europe/Helsinki"
        });

        // ============================================
        // FETCH ACTIVE PDF
        // URL stored for audit trail (DB only, never sent to client)
        // Buffer used for email attachment
        // ============================================
        let activePdfUrl = "";
        let pdfAttachment = null;

        try {
            const activePdf = await AgreementPdf.findOne({ isActive: true }).lean();
            if (activePdf) {
                // Save URL for audit trail in DB only
                activePdfUrl = activePdf.fileUrl;

                // Fetch as buffer for email attachment
                const fileResponse = await fetch(activePdf.fileUrl);
                const arrayBuffer = await fileResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                pdfAttachment = {
                    filename: "Agreement.pdf",
                    content: buffer,
                    contentType: "application/pdf"
                };

                logToConsole("INFO", "ACTIVE_PDF_FETCHED_FOR_CONSENT_EMAIL", {
                    version: activePdf.version,
                    size: buffer.length
                });
            }
        } catch (pdfErr) {
            logToConsole("WARN", "ACTIVE_PDF_FETCH_FAILED_FOR_CONSENT", { error: pdfErr.message });
            // Don't fail — consent still saves, email sends without attachment
        }

        const newConsentEntry = {
            ipAddress: userIp,
            acceptAgreement: true,
            date: consentDate,
            time: consentTime,
            agreementPdfUrl: activePdfUrl, // stored in DB only, never sent to client
            recordedAt: now
        };

        // IF ClientConsent EXISTS → push new entry to history
        // IF NOT EXISTS → create new record
        const existingConsent = await ClientConsent.findOne({ clientId });

        if (existingConsent) {
            existingConsent.consentHistory.push(newConsentEntry);
            await existingConsent.save();
            logToConsole("INFO", "CONSENT_HISTORY_UPDATED", {
                clientId,
                totalEntries: existingConsent.consentHistory.length,
                ipAddress: userIp
            });
        } else {
            await ClientConsent.create({
                clientId,
                name: client.name || `${client.firstName} ${client.lastName}`,
                email: client.email,
                phone: client.phone || "",
                consentHistory: [newConsentEntry]
            });
            logToConsole("INFO", "CONSENT_RECORD_CREATED", { clientId, ipAddress: userIp });
        }

        // Set requiresConsentUpdate: false on client record
        await Client.findOneAndUpdate(
            { clientId },
            { $set: { requiresConsentUpdate: false } }
        );

        logToConsole("INFO", "CONSENT_FLAG_CLEARED", { clientId });

        // Activity Log
        try {
            await ActivityLog.create({
                userName: client.name || `${client.firstName} ${client.lastName}`,
                role: "CLIENT",
                clientId,
                action: "CLIENT_CONSENT_ACCEPTED",
                details: `Client accepted updated agreement on ${consentDate} at ${consentTime}`,
                metadata: { clientId, ipAddress: userIp, consentDate, consentTime }
            });
        } catch (logErr) {
            logToConsole("ERROR", "CONSENT_ACTIVITY_LOG_FAILED", { error: logErr.message });
        }

        // ============================================
        // SEND CONFIRMATION EMAIL TO CLIENT (WITH PDF ATTACHED)
        // AWS URL never exposed — only buffer sent as attachment
        // ============================================
        try {
            const clientName = client.name || `${client.firstName} ${client.lastName}`;
            const attachments = pdfAttachment ? [pdfAttachment] : [];

            await sendEmail(
                client.email,
                "Agreement Accepted - Credence Enterprise Accounting Services",
                `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Agreement Acceptance Confirmation</title>
                    <style>
                        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                        .header { background: #111111; color: #ffffff; padding: 25px 20px; text-align: center; }
                        .header h1 { margin: 0; font-size: 22px; color: #7cd64b; }
                        .content { padding: 25px; background: #ffffff; }
                        .confirmation-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
                        .info-box { background: #f8f9fa; border: 1px solid #e9ecef; padding: 15px; margin: 15px 0; border-radius: 8px; }
                        .pdf-box { background: #f8f9fa; border: 1px solid #e9ecef; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #7cd64b; }
                        .footer { background: #111111; color: #ffffff; padding: 20px; text-align: center; font-size: 14px; }
                        .dev-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8; }
                        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; font-size: 14px; }
                        th { background: #f8f9fa; font-weight: 600; width: 40%; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Credence Enterprise Accounting Services</h1>
                        <p style="margin-top: 5px; opacity: 0.9;">Agreement Acceptance Confirmation</p>
                    </div>

                    <div class="content">
                        <div class="confirmation-box">
                            <h2 style="margin-top: 0; color: #4caf50;">✅ Agreement Accepted Successfully</h2>
                            <p>Dear ${clientName},</p>
                            <p>This email confirms that you have read and accepted the updated Terms &amp; Conditions of Credence Enterprise Accounting Services.</p>
                        </div>

                        <div class="info-box">
                            <h3 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #7cd64b; padding-bottom: 8px;">📋 Acceptance Details</h3>
                            <table>
                                <tr>
                                    <th>Date</th>
                                    <td>${consentDate}</td>
                                </tr>
                                <tr>
                                    <th>Time</th>
                                    <td>${consentTime} EET/EEST</td>
                                </tr>
                                <tr>
                                    <th>Client Name</th>
                                    <td>${clientName}</td>
                                </tr>
                                <tr>
                                    <th>Email</th>
                                    <td>${client.email}</td>
                                </tr>
                                <tr>
                                    <th>Status</th>
                                    <td style="color: #4caf50; font-weight: 600;">✅ Accepted</td>
                                </tr>
                            </table>
                        </div>

                        ${pdfAttachment ? `
                        <div class="pdf-box">
                            <h3 style="margin-top: 0; color: #2c3e50;">📄 Agreement Document</h3>
                            <p>Please find the accepted <strong>Agreement.pdf</strong> attached to this email for your records.</p>
                        </div>
                        ` : ''}

                        <p style="background: #e7f4ff; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff; font-size: 14px;">
                            <strong>Note:</strong> This record has been saved for compliance purposes.
                            If you did not perform this action, please contact our support team immediately.
                        </p>

                        <p style="margin-top: 20px; font-size: 14px;">If you have any questions, please contact our support team.</p>
                        <p style="font-size: 14px;"><strong>Email:</strong> support@jladgroup.fi</p>
                        <p style="font-size: 14px;"><strong>Phone:</strong> +358413250081</p>
                        <p style="font-size: 14px;"><strong>Business Hours:</strong> Monday to Friday, 9am to 3pm (EET/EEST)</p>
                    </div>

                    <div class="footer">
                        <p><strong>Credence Enterprise Accounting Services</strong></p>
                        <p>Professional Accounting | VAT Compliance | Business Advisory</p>
                        <div class="dev-info">Developed by Vapautus Media Private Limited</div>
                        <p style="font-size: 12px; margin-top: 10px;">
                            This is an automated confirmation email.<br>
                            Please do not reply to this email.
                        </p>
                    </div>
                </body>
                </html>
                `,
                attachments
            );

            logToConsole("INFO", "CONSENT_CONFIRMATION_EMAIL_SENT", {
                clientId,
                email: client.email,
                pdfAttached: !!pdfAttachment
            });

        } catch (emailErr) {
            logToConsole("ERROR", "CONSENT_CONFIRMATION_EMAIL_FAILED", {
                clientId,
                error: emailErr.message
            });
            // Don't fail the response if email fails
        }

        res.json({
            success: true,
            message: "Agreement accepted successfully."
        });

    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, message: "Session expired. Please login again." });
        }
        logToConsole("ERROR", "CONSENT_ACCEPT_FAILED", { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, message: "Failed to save consent. Please try again." });
    }
});

module.exports = router;