const mongoose = require("mongoose");

/* ===============================
   NOTE SCHEMA (REUSABLE)
================================ */
const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now },
    employeeId: { type: String } // NEW: Track which employee added the note
  },
  { _id: false }
);

/* ===============================
   SINGLE DOCUMENT (FILE LEVEL) - UPDATED WITH NOTES
================================ */
const singleDocumentSchema = new mongoose.Schema(
  {
    url: String,
    uploadedAt: Date,
    uploadedBy: String,
    fileName: String,
    fileSize: Number,
    fileType: String,
    // NEW: Employee notes for this file
    notes: [noteSchema] // Each file can have multiple employee notes
  },
  { _id: false }
);

/* ===============================
   CATEGORY WITH MULTIPLE FILES
================================ */
const categorySchema = new mongoose.Schema(
  {
    // Multiple files per category
    files: [singleDocumentSchema],
    
    // Lock/note info stays at CATEGORY level
    isLocked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,
    
    // Category-level notes (for client updates)
    categoryNotes: [noteSchema],
    
    // Track if category was ever locked
    wasLockedOnce: { type: Boolean, default: false }
  },
  { _id: false }
);

/* ===============================
   OTHER CATEGORY
================================ */
const otherCategorySchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true },
    document: categorySchema  // Changed to categorySchema to support multiple files
  },
  { _id: false }
);

/* ===============================
   MONTH DATA - NO CHANGES NEEDED
================================ */
const monthDataSchema = new mongoose.Schema(
  {
    // Each category now contains array of files
    sales: categorySchema,
    purchase: categorySchema,
    bank: categorySchema,
    other: [otherCategorySchema],
    isLocked: { type: Boolean, default: false },
    wasLockedOnce: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,
    autoLockDate: Date,
    monthNotes: [noteSchema],
    accountingDone: { type: Boolean, default: false },
    accountingDoneAt: Date,
    accountingDoneBy: String
  },
  { _id: false }
);

/* ===============================
   EMPLOYEE ASSIGNMENT - NO CHANGES
================================ */
const employeeAssignmentSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    employeeId: { type: String, required: true },
    employeeName: { type: String },
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: String },
    adminName: { type: String },
    task: {
      type: String,
      enum: [
        'Bookkeeping',
        'VAT Filing Computation', 
        'VAT Filing',
        'Financial Statement Generation'
      ]
    },
    accountingDone: { type: Boolean, default: false },
    accountingDoneAt: Date,
    accountingDoneBy: String,
    isRemoved: { type: Boolean, default: false },
    removedAt: Date,
    removedBy: String,
    removalReason: String
  },
  { _id: false }
);

/* ===============================
   CLIENT SCHEMA - NO CHANGES
================================ */
const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, unique: true },
    name: String,
    email: String,
    phone: String,
    address: String,
    password: String,
    isActive: { type: Boolean, default: true },
    
    documents: {
      type: Map,
      of: {
        type: Map,
        of: monthDataSchema
      },
      default: () => new Map()
    },
    
    employeeAssignments: [employeeAssignmentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);