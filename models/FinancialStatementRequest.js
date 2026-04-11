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

// ============= OPTIMIZED INDEXES =============

// 1. COMPOUND INDEX for overlapping date queries (MOST IMPORTANT)
financialStatementRequestSchema.index({
    clientId: 1,
    fromDate: 1,
    toDate: 1,
    status: 1
});

// 2. Index for quick status queries (used in filters)
financialStatementRequestSchema.index({ status: 1, requestedAt: -1 });

// 3. Index for searching by client email
financialStatementRequestSchema.index({ clientEmail: 1 });

// 4. Index for searching by client name
financialStatementRequestSchema.index({ clientName: 1 });

// 5. Index for date range searches
financialStatementRequestSchema.index({ requestedAt: -1 });

// 6. Text index for search functionality (if needed)
financialStatementRequestSchema.index({
    clientName: 'text',
    clientEmail: 'text',
    requestId: 'text'
}, {
    weights: {
        clientName: 10,
        clientEmail: 5,
        requestId: 3
    }
});

const FinancialStatementRequest = mongoose.model('FinancialStatementRequest', financialStatementRequestSchema);

module.exports = FinancialStatementRequest;