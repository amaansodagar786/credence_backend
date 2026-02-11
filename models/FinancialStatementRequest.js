// models/FinancialStatementRequest.js
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
    month: {
        type: String,
        required: true,
        enum: [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ]
    },
    year: {
        type: Number,
        required: true,
        min: 2020,
        max: new Date().getFullYear() + 1
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'approved' , 'sent', 'cancelled'],
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

// Index for faster queries
financialStatementRequestSchema.index({ clientId: 1, month: 1, year: 1 });
financialStatementRequestSchema.index({ status: 1 });
financialStatementRequestSchema.index({ requestedAt: -1 });

const FinancialStatementRequest = mongoose.model('FinancialStatementRequest', financialStatementRequestSchema);

module.exports = FinancialStatementRequest;