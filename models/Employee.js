// models/Employee.js
const mongoose = require("mongoose");

/**
 * Client assignment structure (month-wise) - UPDATED WITH TASK
 * - Permanent (never deleted)
 */
const assignedClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true },
    clientName: { type: String },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: String },
    adminName: { type: String },

    // NEW: TASK FIELD (REQUIRED)
    task: {
      type: String,
      enum: [
        'Bookkeeping',
        'VAT Filing Computation',
        'VAT Filing',
        'Financial Statement Generation',
        'Audit'
      ],
      // required: true 
    },

    accountingDone: {
      type: Boolean,
      default: false
    },
    accountingDoneAt: { type: Date },
    accountingDoneBy: { type: String },

    // NEW: Track if assignment was removed
    isRemoved: { type: Boolean, default: false },
    removedAt: Date,
    removedBy: String,
    removalReason: String
  },
  { _id: false }
);

/**
 * Employee Viewed Files Tracking
 * Tracks which files an employee has marked as reviewed
 */
const viewedFileSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true
    },
    year: {
      type: Number,
      required: true
    },
    month: {
      type: Number,
      required: true
    },
    categoryType: {
      type: String,
      required: true,
      enum: ['sales', 'purchase', 'bank', 'other']
    },
    categoryName: {
      type: String
      // Required only for 'other' category type
    },
    fileName: {
      type: String,
      required: true
    },
    fileUrl: {
      type: String
    },
    viewedAt: {
      type: Date,
      default: Date.now
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now
    },
    // For detecting if file was changed/replaced
    fileHash: {
      type: String
    },
    // Additional metadata for easy querying
    task: {
      type: String,
      enum: [
        'Bookkeeping',
        'VAT Filing Computation',
        'VAT Filing',
        'Financial Statement Generation',
        'Audit'
      ]
    }
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String },

    /**
     * Month-wise client assignments with task
     * Employee can have multiple clients
     */
    assignedClients: [assignedClientSchema],

    /**
     * NEW: Files viewed/checked by this employee
     * Each employee tracks their own file review progress
     */
    viewedFiles: [viewedFileSchema]
  },
  { timestamps: true }
);

// Create indexes for faster queries on viewedFiles
employeeSchema.index({ 'viewedFiles.clientId': 1, 'viewedFiles.year': 1, 'viewedFiles.month': 1 });
employeeSchema.index({ 'viewedFiles.fileName': 1 });
employeeSchema.index({ employeeId: 1, 'viewedFiles.clientId': 1 });

module.exports = mongoose.model("Employee", employeeSchema);