const mongoose = require("mongoose");

const employeeTaskLogSchema = new mongoose.Schema(
  {
    /* ================= EMPLOYEE INFO ================= */
    employeeId: { type: String, required: true }, // UUID
    employeeName: { type: String, required: true },
    employeeEmail: { type: String, required: true },

    /* ================= TASK INFO ================= */
    date: {
      type: String, // YYYY-MM-DD (easy grouping & filtering)
      required: true
    },

    projectName: {
      type: String,
      required: true
    },

    description: {
      type: String,
      required: true
    },

    startTime: {
      type: String, // HH:mm
      required: true
    },

    endTime: {
      type: String, // HH:mm (nullable until completed)
      default: null
    },

    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmployeeTaskLog", employeeTaskLogSchema);
