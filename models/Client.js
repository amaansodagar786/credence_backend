const mongoose = require("mongoose");

/* ===============================
   NOTE SCHEMA (REUSABLE)
================================ */
const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now }
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
    isLocked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,
    notes: [noteSchema]
  },
  { _id: false }
);

/* ===============================
   OTHER CATEGORY
================================ */
const otherCategorySchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true },
    document: singleDocumentSchema
  },
  { _id: false }
);

/* ===============================
   MONTH DATA
================================ */
const monthDataSchema = new mongoose.Schema(
  {
    sales: singleDocumentSchema,
    purchase: singleDocumentSchema,
    bank: singleDocumentSchema,
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
   EMPLOYEE ASSIGNMENT (UPDATED WITH TASK)
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
    
    // NEW: TASK FIELD (REQUIRED)
    task: {
      type: String,
      enum: [
        'Bookkeeping',
        'VAT Filing Computation', 
        'VAT Filing',
        'Financial Statement Generation'
      ],
      // required: true 
    },
    
    accountingDone: { type: Boolean, default: false },
    accountingDoneAt: Date,
    accountingDoneBy: String,
    
    // NEW: Track if assignment was removed
    isRemoved: { type: Boolean, default: false },
    removedAt: Date,
    removedBy: String,
    removalReason: String
  },
  { _id: false }
);

/* ===============================
   CLIENT SCHEMA
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