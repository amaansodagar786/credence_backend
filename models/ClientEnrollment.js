const mongoose = require("mongoose");

const clientEnrollmentSchema = new mongoose.Schema(
  {
    enrollId: { type: String, unique: true }, // UUID

    name: String,
    email: String,
    phone: String,

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },

    reviewedBy: String, // admin UUID
    reviewedAt: Date,
    clientId: String // set after approval
  },
  { timestamps: true }
);

module.exports = mongoose.model("ClientEnrollment", clientEnrollmentSchema);
