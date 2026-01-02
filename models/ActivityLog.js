const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  userName: String,
  role: String,

  adminId: String,
  enrollId: String,
  clientId: String,

  action: String,
  details: String,

  dateTime: {
    type: String,
    required: true
  }
});

module.exports = mongoose.model("ActivityLog", activityLogSchema);
