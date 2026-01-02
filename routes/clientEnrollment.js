const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const ClientEnrollment = require("../models/ClientEnrollment");
const Client = require("../models/Client");
const ActivityLog = require("../models/ActivityLog");

const sendEmail = require("../utils/sendEmail");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

/* ===============================
   CLIENT ENROLL (PUBLIC)
================================ */
router.post("/enroll", async (req, res) => {
  const enrollId = uuidv4();

  const enrollment = await ClientEnrollment.create({
    enrollId,
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone
  });

  await ActivityLog.create({
    userName: req.body.name,
    role: "CLIENT",
    enrollId,
    action: "CLIENT_ENROLL",
    details: "Client enrollment submitted",
    dateTime: new Date().toLocaleString("en-IN")
  });

  res.json({ message: "Enrollment submitted", enrollId });
});

/* ===============================
   ADMIN VIEW ALL ENROLLMENTS
================================ */
router.get("/all", auth, async (req, res) => {
  const data = await ClientEnrollment.find().sort({ createdAt: -1 });
  res.json(data);
});

/* ===============================
   ADMIN APPROVE / REJECT
================================ */
router.post("/action", auth, async (req, res) => {
  const { enrollId, action } = req.body;

  const enrollment = await ClientEnrollment.findOne({ enrollId });
  if (!enrollment) return res.status(404).json({ message: "Not found" });

  // REJECT
  if (action === "REJECT") {
    enrollment.status = "REJECTED";
    enrollment.reviewedBy = req.user.adminId;
    enrollment.reviewedAt = new Date();
    await enrollment.save();

    await ActivityLog.create({
      userName: req.user.name,
      role: "ADMIN",
      adminId: req.user.adminId,
      enrollId,
      action: "CLIENT_REJECTED",
      details: "Client enrollment rejected",
      dateTime: new Date().toLocaleString("en-IN")
    });

    return res.json({ message: "Client rejected" });
  }

  // APPROVE → CREATE CLIENT
  const clientId = uuidv4();
  const plainPassword = `${enrollment.name.split(" ")[0]}@1234`;
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const client = await Client.create({
    clientId,
    name: enrollment.name,
    email: enrollment.email,
    phone: enrollment.phone,
    password: hashedPassword
  });

  enrollment.status = "APPROVED";
  enrollment.reviewedBy = req.user.adminId;
  enrollment.reviewedAt = new Date();
  enrollment.clientId = clientId;
  await enrollment.save();

  await sendEmail(
    enrollment.email,
    "Your Client Account Created",
    `
      <p>Your account is ready.</p>
      <p><b>Email:</b> ${enrollment.email}</p>
      <p><b>Password:</b> ${plainPassword}</p>
    `
  );

  await ActivityLog.create({
    userName: req.user.name,
    role: "ADMIN",
    adminId: req.user.adminId,
    enrollId,
    clientId,
    action: "CLIENT_APPROVED",
    details: "Client approved and account created",
    dateTime: new Date().toLocaleString("en-IN")
  });

  res.json({ message: "Client approved & created" });
});

module.exports = router;
