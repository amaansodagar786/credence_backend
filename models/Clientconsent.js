const mongoose = require("mongoose");

const clientConsentSchema = new mongoose.Schema(
    {
        // ============================================
        // SINGLE FIELDS — stored once on approval
        // ============================================
        clientId: {
            type: String,
            required: true,
            unique: true
        },
        name: {
            type: String,
            required: true
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        phone: {
            type: String,
            default: ""
        },

        // ============================================
        // CONSENT HISTORY — array, new entry added
        // each time client accepts updated agreement
        // ============================================
        consentHistory: [
            {
                ipAddress: {
                    type: String,
                    default: "Unknown"
                },
                acceptAgreement: {
                    type: Boolean,
                    default: true
                },
                date: {
                    type: String, // e.g. "19 March 2026"
                    required: true
                },
                time: {
                    type: String, // e.g. "10:45 AM"
                    required: true
                },
                // Stored for internal audit only — never exposed to client via API
                agreementPdfUrl: {
                    type: String,
                    default: ""
                },
                recordedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ]
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("ClientConsent", clientConsentSchema);