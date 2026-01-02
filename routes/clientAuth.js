const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Client = require("../models/Client");
const ClientEnrollment = require("../models/ClientEnrollment");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

/* =========================
   CLIENT LOGIN
========================= */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const client = await Client.findOne({ email });
  if (!client) {
    return res.status(404).json({
      message: "Account not found. Please enroll first.",
      enrollRequired: true
    });
  }

  const isMatch = await bcrypt.compare(password, client.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      clientId: client.clientId,
      role: "CLIENT",
      name: client.name
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.cookie("clientToken", token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000
  });

  await ActivityLog.create({
    userName: client.name,
    role: "CLIENT",
    clientId: client.clientId,
    action: "CLIENT_LOGIN",
    details: "Client logged in",
    dateTime: new Date().toLocaleString("en-IN")
  });

  res.json({ message: "Login successful" });
});

/* =========================
   CLIENT CHECK LOGIN
========================= */
router.get("/me", async (req, res) => {
  const token = req.cookies?.clientToken;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const client = await Client.findOne({ clientId: decoded.clientId }).select(
      "-password"
    );
    res.json(client);
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

/* =========================
   CLIENT LOGOUT
========================= */
router.post("/logout", async (req, res) => {
  res.clearCookie("clientToken");
  res.json({ message: "Logged out" });
});

module.exports = router;
