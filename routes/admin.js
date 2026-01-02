const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const ActivityLog = require("../models/ActivityLog");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

const log = async (name, action, details) => {
  await ActivityLog.create({
    userName: name,
    role: "ADMIN",
    action,
    details,
    dateTime: new Date().toLocaleString("en-IN")
  });
};

/* REGISTER */
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await Admin.findOne({ email });
  if (exists) return res.status(400).json({ message: "Admin exists" });

  const hashed = await bcrypt.hash(password, 10);
  await Admin.create({ name, email, password: hashed });

  await log(name, "ADMIN_REGISTER", `Admin ${email} registered`);
  res.json({ message: "Admin registered" });
});

/* LOGIN */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const admin = await Admin.findOne({ email });
  if (!admin) return res.status(401).json({ message: "Invalid credentials" });

  const ok = await bcrypt.compare(password, admin.password);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { id: admin._id, name: admin.name, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.cookie("accessToken", token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000
  });

  await log(admin.name, "ADMIN_LOGIN", "Admin logged in");
  res.json({ message: "Login success" });
});

/* CHECK LOGIN */
router.get("/me", auth, async (req, res) => {
  const admin = await Admin.findById(req.user.id).select("-password");
  res.json(admin);
});

/* LOGOUT */
router.post("/logout", auth, async (req, res) => {
  res.clearCookie("accessToken");
  await log(req.user.name, "ADMIN_LOGOUT", "Admin logged out");
  res.json({ message: "Logged out" });
});

module.exports = router;
