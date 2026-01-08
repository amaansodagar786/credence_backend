const mongoose = require("mongoose");

/**
 * Client assignment structure (month-wise) - UPDATED WITH TASK
 * - Permanent (never deleted)
 */
const assignedClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true },
    clientName: { type: String },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
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
    
    accountingDone: { 
      type: Boolean, 
      default: false 
    },
    accountingDoneAt: { type: Date },
    accountingDoneBy: { type: String },
    
    // NEW: Track if assignment was removed
    isRemoved: { type: Boolean, default: false },
    removedAt: Date,
    removedBy: String,
    removalReason: String
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String },
    
    /**
     * Month-wise client assignments with task
     * Employee can have multiple clients
     */
    assignedClients: [assignedClientSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Employee", employeeSchema);