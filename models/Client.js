const mongoose = require("mongoose");

/* ===============================
   NOTE VIEW TRACKING SCHEMA
================================ */
const noteViewSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    userType: { type: String, required: true, enum: ['client', 'employee', 'admin'] },
    viewedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

/* ===============================
   NOTE SCHEMA (REUSABLE) - UPDATED WITH VIEW TRACKING
================================ */
const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now },
    employeeId: { type: String },
    viewedBy: {
      type: [noteViewSchema],
      default: []
    },
    isViewedByClient: { type: Boolean, default: false },
    isViewedByEmployee: { type: Boolean, default: false },
    isViewedByAdmin: { type: Boolean, default: false }
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
    accountingDoneBy: String,

    // ✅ NEW: Track if this month was active/inactive for the client
    monthActiveStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    monthStatusChangedAt: Date,
    monthStatusChangedBy: String,
    monthStatusReason: String
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
        'Financial Statement Generation',
        'Audit'
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
   UPDATED CLIENT SCHEMA WITH MONTHLY ACTIVE STATUS TRACKING
================================ */
const clientSchema = new mongoose.Schema(
  {
    // EXISTING FIELDS
    clientId: { type: String, unique: true, required: true },
    name: String,
    email: String,
    phone: String,
    address: String,
    password: String,
    isActive: { type: Boolean, default: true }, // Overall client status

    // ADDITIONAL FIELDS FROM ENROLLMENT
    firstName: String,
    lastName: String,
    visaType: String,
    hasStrongId: String,
    businessAddress: String,
    bankAccount: String,
    bicCode: String,
    businessName: String,
    vatPeriod: String,
    businessNature: String,
    registerTrade: String,

    // PLAN FIELDS
    planSelected: { type: String, default: '' },
    currentPlan: { type: String, default: '' },
    nextMonthPlan: { type: String, default: '' },

    // Plan change tracking
    planChangeRequestedAt: Date,
    planEffectiveFrom: Date,
    planChangeHistory: [
      {
        fromPlan: String,
        toPlan: String,
        changeDate: Date,
        effectiveFrom: Date,
        requestedBy: String,
        notes: String
      }
    ],

    // STATUS & TRACKING
    enrollmentId: String,
    enrollmentDate: Date,

    // ✅ NEW: Track overall client status history
    globalStatusHistory: [
      {
        status: { type: String, enum: ['active', 'inactive'], required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: String, required: true }, // adminId
        adminName: String,
        reason: String,
        metadata: {
          deactivatedMonths: [String], // Which months were affected (YYYY-M)
          reactivatedMonths: [String]
        }
      }
    ],

    // ✅ NEW: Track when client was deactivated/reactivated
    deactivatedAt: Date,
    deactivatedBy: String,
    deactivationReason: String,

    reactivatedAt: Date,
    reactivatedBy: String,
    reactivationReason: String,

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