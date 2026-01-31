const express = require("express");
const mongoose = require("mongoose");
const Client = require("../models/Client");
const auth = require("../middleware/authMiddleware");
const router = express.Router();

/* ===============================
   GET ALL CLIENTS (FOR ACTIVE CONTROL & CLIENTS DATA)
================================ */
router.get("/all-clients", auth, async (req, res) => {
  try {
    const clients = await Client.find()
      .select("clientId name email phone firstName lastName visaType hasStrongId businessName vatPeriod businessNature registerTrade planSelected isActive enrollmentDate createdAt")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: clients.length,
      clients
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ 
      success: false,
      message: "Server error fetching clients",
      error: error.message 
    });
  }
});

/* ===============================
   TOGGLE CLIENT ACTIVE STATUS
================================ */
router.patch("/toggle-status/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean value"
      });
    }

    const client = await Client.findOneAndUpdate(
      { clientId },
      { 
        isActive,
        ...(isActive === false ? { deactivatedAt: new Date() } : { deactivatedAt: null })
      },
      { new: true }
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    res.json({
      success: true,
      message: `Client ${isActive ? 'activated' : 'deactivated'} successfully`,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        isActive: client.isActive
      }
    });

  } catch (error) {
    console.error("Error toggling client status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/* ===============================
   GET SINGLE CLIENT DETAILS
================================ */
router.get("/client/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await Client.findOne({ clientId })
      .select("-password -documents -employeeAssignments");

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    res.json({
      success: true,
      client
    });
  } catch (error) {
    console.error("Error fetching client details:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/* ===============================
   UPDATE CLIENT DETAILS
================================ */
router.patch("/update-client/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const updateData = req.body;

    // Only allow specific fields to be updated
    const allowedFields = [
      'visaType',
      'hasStrongId',
      'vatPeriod',
      'businessNature',
      'registerTrade',
      'planSelected'
    ];

    // Filter update data to only allowed fields
    const filteredUpdate = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredUpdate[field] = updateData[field];
      }
    });

    // If no valid fields to update
    if (Object.keys(filteredUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update"
      });
    }

    const client = await Client.findOneAndUpdate(
      { clientId },
      { $set: filteredUpdate },
      { new: true }
    ).select("-password -documents -employeeAssignments");

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    res.json({
      success: true,
      message: "Client updated successfully",
      client
    });

  } catch (error) {
    console.error("Error updating client:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

module.exports = router;