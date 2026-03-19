const mongoose = require("mongoose");

const agreementPdfSchema = new mongoose.Schema({
    pdfId: {
        type: String,
        required: true,
        unique: true  // ✅ Each PDF has UNIQUE ID
    },
    fileName: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    s3Key: {
        type: String,
        required: true
    },
    version: {
        type: Number,
        required: true
    },
    uploadedBy: {
        type: String,
        required: true
    },
    uploadedByName: {
        type: String,
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    },
    description: {
        type: String,
        default: ""
    },
    isActive: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes for better performance
agreementPdfSchema.index({ isActive: -1 });
agreementPdfSchema.index({ version: -1 });
agreementPdfSchema.index({ uploadedAt: -1 });

module.exports = mongoose.model("AgreementPdf", agreementPdfSchema);