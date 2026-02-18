const mongoose = require('mongoose');

const financialStatementRequestSchema = new mongoose.Schema({
    requestId: {
        type: String,
        unique: true,
        default: () => `FSR${Date.now()}${Math.floor(Math.random() * 1000)}`
    },
    clientId: {
        type: String,
        required: true,
        index: true
    },
    clientName: {
        type: String,
        required: true
    },
    clientEmail: {
        type: String,
        required: true
    },
    // Date range fields
    fromDate: {
        type: Date,
        required: true
    },
    toDate: {
        type: Date,
        required: true
    },
    // Store as string for display (e.g., "15 Jan 2026 - 15 Feb 2026")
    dateRangeDisplay: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'approved', 'sent', 'cancelled'],
        default: 'pending'
    },
    requestedAt: {
        type: Date,
        default: Date.now
    },
    adminNotes: {
        type: String,
        default: ''
    },
    sentDate: {
        type: Date
    },
    downloadUrl: {
        type: String,
        default: ''
    },
    // Track admin actions
    processedBy: {
        adminId: String,
        adminName: String
    },
    processedAt: Date,

    // Email tracking
    emailSentToAdmin: {
        type: Boolean,
        default: false
    },
    emailSentToClient: {
        type: Boolean,
        default: false
    },
    statementSentEmail: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// COMPOUND INDEX for overlapping date queries
financialStatementRequestSchema.index({
    clientId: 1,
    fromDate: 1,
    toDate: 1,
    status: 1
});

// Index for quick status queries
financialStatementRequestSchema.index({ status: 1 });
financialStatementRequestSchema.index({ requestedAt: -1 });

const FinancialStatementRequest = mongoose.model('FinancialStatementRequest', financialStatementRequestSchema);

module.exports = FinancialStatementRequest;