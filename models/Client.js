const mongoose = require("mongoose");

/* ===============================
   NOTE SCHEMA (REUSABLE)
================================ */
const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now },
    employeeId: { type: String }
  },
  { _id: false }
);

/* ===============================
   SINGLE DOCUMENT (FILE LEVEL)
================================ */
const singleDocumentSchema = new mongoose.Schema(
  {
    url: String,
    uploadedAt: Date,
    uploadedBy: String,
    fileName: String,
    fileSize: Number,
    fileType: String,
    notes: [noteSchema]
  },
  { _id: false }
);

/* ===============================
   CATEGORY WITH MULTIPLE FILES
================================ */
const categorySchema = new mongoose.Schema(
  {
    files: [singleDocumentSchema],
    isLocked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,
    categoryNotes: [noteSchema],
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
    document: categorySchema
  },
  { _id: false }
);

/* ===============================
   MONTH DATA
================================ */
const monthDataSchema = new mongoose.Schema(
  {
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
   EMPLOYEE ASSIGNMENT
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
   UPDATED CLIENT SCHEMA (WITH ALL ENROLLMENT FIELDS)
================================ */
const clientSchema = new mongoose.Schema(
  {
    // EXISTING FIELDS (DO NOT CHANGE)
    clientId: { type: String, unique: true, required: true },
    name: String,           // firstName + lastName from enrollment
    email: String,
    phone: String,          // mobile from enrollment
    address: String,        // address from enrollment
    password: String,
    isActive: { type: Boolean, default: true },
    
    // ADDITIONAL FIELDS FROM ENROLLMENT
    firstName: String,      // Original first name from enrollment
    lastName: String,       // Original last name from enrollment
    visaType: String,
    hasStrongId: String,
    businessAddress: String,
    bankAccount: String,
    bicCode: String,
    businessName: String,
    vatPeriod: String,
    businessNature: String,
    registerTrade: String,
    planSelected: String,
    
    // STATUS & TRACKING
    enrollmentId: String,   // Reference to original enrollment
    enrollmentDate: Date,   // When enrollment was approved
    
    // EXISTING DOCUMENT STRUCTURE
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