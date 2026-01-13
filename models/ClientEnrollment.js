const mongoose = require("mongoose");

const clientEnrollmentSchema = new mongoose.Schema(
  {
    enrollId: { 
      type: String, 
      unique: true,
      required: true 
    },

    // Personal Information - REMOVED required: true for now
    firstName: { type: String }, // CHANGED: removed required
    lastName: { type: String }, // CHANGED: removed required
    address: { type: String }, // CHANGED: removed required
    visaType: { type: String }, // CHANGED: removed required
    hasStrongId: { type: String }, // CHANGED: removed required
    mobile: { type: String }, // CHANGED: removed required
    email: { 
      type: String, 
      required: true, // KEEP required for email
      lowercase: true,
      trim: true
    },

    // Business Information - REMOVED required: true for now
    businessAddress: { type: String }, // CHANGED: removed required
    bankAccount: { type: String }, // CHANGED: removed required
    bicCode: { type: String }, // CHANGED: removed required
    businessName: { type: String }, // CHANGED: removed required
    vatPeriod: { type: String }, // CHANGED: removed required
    businessNature: { type: String }, // CHANGED: removed required
    registerTrade: { type: String }, // CHANGED: removed required
    planSelected: { type: String }, // CHANGED: removed required

    // Status and tracking
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },

    reviewedBy: String, // admin UUID
    reviewedAt: Date,
    clientId: String, // set after approval
    rejectionReason: String // optional: reason for rejection
  },
  { 
    timestamps: true,
    indexes: [
      { email: 1 }, // Index for faster email lookup
      { status: 1 } // Index for status filtering
    ]
  }
);

// Create a compound index to prevent duplicate pending/approved enrollments
clientEnrollmentSchema.index(
  { email: 1, status: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      status: { $in: ["PENDING", "APPROVED"] } 
    }
  }
);

module.exports = mongoose.model("ClientEnrollment", clientEnrollmentSchema);