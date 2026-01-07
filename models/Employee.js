const mongoose = require("mongoose");

/**
 * Client assignment structure (month-wise)
 * - Permanent (never deleted)
 */
const assignedClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true }, // UUID
    clientName: { type: String }, // Added for easy reference
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: String }, // adminId UUID
    adminName: { type: String }, // Added for easy reference
    
    // NEW FIELD: Accounting status
    accountingDone: { 
      type: Boolean, 
      default: false 
    },
    accountingDoneAt: { type: Date },
    accountingDoneBy: { type: String } // employeeId (self)
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, unique: true }, // UUID

    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,

    password: { type: String, required: true }, // encrypted
    isActive: { type: Boolean, default: true },

    createdBy: { type: String }, // adminId UUID

    /**
     * Month-wise client assignments
     * Employee can have multiple clients
     */
    assignedClients: [assignedClientSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Employee", employeeSchema);