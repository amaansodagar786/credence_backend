const mongoose = require("mongoose");

/**
 * Schema to track all removed assignments (history)
 */
const removedAssignmentSchema = new mongoose.Schema(
  {
    // Original assignment details
    clientId: { type: String, required: true },
    clientName: { type: String },
    employeeId: { type: String, required: true },
    employeeName: { type: String },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    
    // Task that was assigned
    task: {
      type: String,
      enum: [
        'Bookkeeping',
        'VAT Filing Computation', 
        'VAT Filing',
        'Financial Statement Generation'
      ],
      required: true
    },
    
    // Assignment period info
    originallyAssignedAt: { type: Date },
    originallyAssignedBy: { type: String },
    adminName: { type: String },
    
    // Removal details
    removedAt: { type: Date, default: Date.now },
    removedBy: { type: String, required: true }, // adminId
    removerName: { type: String, required: true }, // admin name
    removalReason: { type: String, default: "Admin removed assignment" },
    
    // Status at time of removal
    wasAccountingDone: { type: Boolean, default: false },
    
    // Additional metadata
    durationDays: { type: Number }, // Days between assignment and removal
    notes: { type: String }
  },
  { timestamps: true }
);

// Index for faster queries
removedAssignmentSchema.index({ clientId: 1, employeeId: 1 });
removedAssignmentSchema.index({ removedAt: -1 });
removedAssignmentSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model("RemovedAssignment", removedAssignmentSchema);