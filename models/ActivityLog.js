const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  userName: String,
  role: String,

  adminId: String,
  enrollId: String,
  clientId: String,
  employeeId: String,

  action: String,
  details: String,

  dateTime: {
    type: Date,
    required: true ,
    default: Date.now
  }
});

module.exports = mongoose.model("ActivityLog", activityLogSchema);
