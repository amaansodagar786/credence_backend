const mongoose = require("mongoose");

// SAME SCHEMA as assignedClientSchema from Employee.js
const clientAssignmentSchema = new mongoose.Schema({
  clientId: { type: String, required: true },
  clientName: { type: String },
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  assignedAt: { type: Date, default: Date.now },
  assignedBy: { type: String },
  adminName: { type: String },
  task: {
    type: String,
    enum: ['Bookkeeping', 'VAT Filing Computation', 'VAT Filing', 'Financial Statement Generation', 'Audit'],
  },
  accountingDone: { type: Boolean, default: false },
  accountingDoneAt: { type: Date },
  accountingDoneBy: { type: String },
  isRemoved: { type: Boolean, default: false },
  removedAt: Date,
  removedBy: String,
  removalReason: String
}, { _id: false });

const employeeAssignmentSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true, index: true },
  employeeName: { type: String },
  employeeEmail: { type: String },
  assignedClients: [clientAssignmentSchema]  // 👈 SAME ARRAY STRUCTURE
}, { timestamps: true });

module.exports = mongoose.model("EmployeeAssignment", employeeAssignmentSchema);