const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const adminSchema = new mongoose.Schema(
  {

    adminId: {
      type: String,
      unique: true,
      default: () => uuidv4() // Auto-generate UUID like Employee
    },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      default: "SUPER_ADMIN"
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", adminSchema);
