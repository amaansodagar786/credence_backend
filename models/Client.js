const mongoose = require("mongoose");

/* ===============================
   NOTE SCHEMA (REUSABLE)
================================ */
const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    addedBy: { type: String }, // clientId / adminId
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

    // FILE LOCK
    isLocked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,

    // FILE UPDATE NOTES (ONLY ON RE-UPLOAD)
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

    // MONTH LOCK
    isLocked: { type: Boolean, default: false },
    wasLockedOnce: { type: Boolean, default: false },
    lockedAt: Date,
    lockedBy: String,
    autoLockDate: Date,

    // MONTH UPDATE NOTES (ONLY WHEN UPDATED AFTER UNLOCK)
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
    year: Number,
    month: Number,
    employeeId: String,
    employeeName: String,
    assignedAt: Date,
    assignedBy: String,
    adminName: String,

    accountingDone: { type: Boolean, default: false },
    accountingDoneAt: Date,
    accountingDoneBy: String
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

    // Year → Month → Data
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
