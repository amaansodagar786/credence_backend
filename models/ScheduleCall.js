const mongoose = require("mongoose");

const scheduleCallSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: String,
      unique: true,
      required: true
    },
    fullName: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      required: true
    },
    submittedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ScheduleCall", scheduleCallSchema);