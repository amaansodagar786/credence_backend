const express = require("express");
const jwt = require("jsonwebtoken");
const Client = require("../models/Client");
const ClientConsent = require("../models/Clientconsent");
const AgreementPdf = require("../models/AgreementPdf");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   CHECK IF CLIENT NEEDS CONSENT UPDATE
   GET /client-consent/check
   Called on dashboard load to know whether to show popup
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
   ACCEPT AGREEMENT — SAVE CONSENT
   POST /client-consent/accept
   Called when client checks checkbox and submits popup
================================ */
router.post("/accept", async (req, res) => {
    try {
        // Get client from token
        const token = req.cookies?.clientToken;
        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized. Please login." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const clientId = decoded.clientId;

        // Find client
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

        // Get current date and time for consent record
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

        // Get active PDF URL for audit trail — never exposed to client
        let activePdfUrl = "";
        try {
            const activePdf = await AgreementPdf.findOne({ isActive: true }).lean();
            if (activePdf) {
                activePdfUrl = activePdf.fileUrl;
            }
        } catch (pdfErr) {
            logToConsole("WARN", "ACTIVE_PDF_FETCH_FAILED_FOR_CONSENT", { error: pdfErr.message });
        }

        // New consent history entry
        const newConsentEntry = {
            ipAddress: userIp,
            acceptAgreement: true,
            date: consentDate,
            time: consentTime,
            agreementPdfUrl: activePdfUrl, // stored in DB only, never sent to client
            recordedAt: now
        };

        // ============================================
        // IF ClientConsent EXISTS → push new entry to history
        // IF NOT EXISTS → create new record
        // ============================================
        const existingConsent = await ClientConsent.findOne({ clientId });

        if (existingConsent) {
            // Push new entry to existing consent history
            existingConsent.consentHistory.push(newConsentEntry);
            await existingConsent.save();

            logToConsole("INFO", "CONSENT_HISTORY_UPDATED", {
                clientId,
                totalEntries: existingConsent.consentHistory.length,
                ipAddress: userIp
            });
        } else {
            // Create brand new consent record
            await ClientConsent.create({
                clientId,
                name: client.name || `${client.firstName} ${client.lastName}`,
                email: client.email,
                phone: client.phone || "",
                consentHistory: [newConsentEntry]
            });

            logToConsole("INFO", "CONSENT_RECORD_CREATED", {
                clientId,
                ipAddress: userIp
            });
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
                metadata: {
                    clientId,
                    ipAddress: userIp,
                    consentDate,
                    consentTime
                }
            });
        } catch (logErr) {
            logToConsole("ERROR", "CONSENT_ACTIVITY_LOG_FAILED", { error: logErr.message });
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