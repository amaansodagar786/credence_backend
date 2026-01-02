const mongoose = require("mongoose");

/**
 * Single document structure
 * (used for Sales, Purchase, Bank, and each Other category)
 */
const singleDocumentSchema = new mongoose.Schema(
  {
    url: { type: String }, // S3 / server URL
    uploadedAt: { type: Date }
  },
  { _id: false }
);

/**
 * Other category structure
 * - categoryName can be anything (TDS, Salary, Rent, etc.)
 * - ONLY ONE document allowed per category
 */
const otherCategorySchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true },
    document: singleDocumentSchema
  },
  { _id: false }
);

/**
 * Month-wise data structure
 */
const monthDataSchema = new mongoose.Schema(
  {
    sales: singleDocumentSchema,    // ONLY ONE
    purchase: singleDocumentSchema, // ONLY ONE
    bank: singleDocumentSchema,     // ONLY ONE

    other: [otherCategorySchema],   // MULTIPLE categories, ONE doc each

    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date },
    autoLockDate: { type: Date }
  },
  { _id: false }
);

/**
 * Employee assignment per month
 * - One client-month → one employee
 * - NEVER deleted
 */
const employeeAssignmentSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    employeeId: { type: String, required: true }, // UUID
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: String } // adminId UUID
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, unique: true }, // UUID

    name: String,
    email: String,
    phone: String,
    address: String,

    password: String, // encrypted
    isActive: { type: Boolean, default: true },

    /**
     * Documents stored year-wise and month-wise
     * Example:
     * documents["2026"]["1"] → January 2026
     */
    documents: {
      type: Map,
      of: {
        type: Map,
        of: monthDataSchema
      }
    },

    /**
     * Month-wise employee assignments
     * Permanent history
     */
    employeeAssignments: [employeeAssignmentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);
