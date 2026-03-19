const mongoose = require("mongoose");

const clientEnrollmentSchema = new mongoose.Schema(
  {
    enrollId: {
      type: String,
      unique: true,
      required: true
    },

    // Personal Information
    firstName: { type: String },
    lastName: { type: String },
    address: { type: String },
    visaType: { type: String },
    hasStrongId: { type: String },
    mobile: { type: String },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },

    // Business Information
    businessAddress: { type: String },
    bankAccount: { type: String },
    bicCode: { type: String },
    businessName: { type: String },
    vatPeriod: { type: String },
    businessNature: { type: String },
    registerTrade: { type: String },
    planSelected: { type: String },

    // IP Address — captured from request on backend, never from frontend
    ipAddress: { type: String, default: "Unknown" },

    // Status and tracking
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },

    reviewedBy: String,
    reviewedAt: Date,
    clientId: String,
    rejectionReason: String
  },
  {
    timestamps: true,
    indexes: [
      { email: 1 },
      { status: 1 }
    ]
  }
);

// Compound index to prevent duplicate pending/approved enrollments
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