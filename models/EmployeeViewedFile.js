const mongoose = require("mongoose");

const viewedFileSchema = new mongoose.Schema({
    clientId: { type: String, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    categoryType: { type: String, enum: ['sales', 'purchase', 'bank', 'other'], required: true },
    categoryName: { type: String },
    fileName: { type: String, required: true },
    fileUrl: { type: String },
    viewedAt: { type: Date, default: Date.now },
    lastCheckedAt: { type: Date, default: Date.now },
    fileHash: { type: String },
    task: { type: String, enum: ['Bookkeeping', 'VAT Filing Computation', 'VAT Filing', 'Financial Statement Generation', 'Audit'] }
}, { _id: false });

const employeeViewedFileSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, unique: true, index: true },
    employeeName: { type: String },
    employeeEmail: { type: String },
    viewedFiles: [viewedFileSchema]
}, { timestamps: true });

module.exports = mongoose.model("EmployeeViewedFile", employeeViewedFileSchema);