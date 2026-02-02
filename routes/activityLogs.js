// routes/activityLogs.js
const express = require("express");
const router = express.Router();
const ActivityLog = require("../models/ActivityLog");
const Client = require("../models/Client");
const Employee = require("../models/Employee");
const Admin = require("../models/Admin");

// ================================
// 1. GET ALL USERS FOR DROPDOWNS
// ================================
router.get("/get-users", async (req, res) => {
  try {
    // Get all clients
    const clients = await Client.find({ isActive: true })
      .select("clientId name email")
      .lean();

    // Get all employees
    const employees = await Employee.find({ isActive: true })
      .select("employeeId name email")
      .lean();

    // Get all admins
    const admins = await Admin.find({ isActive: true })
      .select("adminId name email")
      .lean();

    res.json({
      success: true,
      data: {
        clients: clients.map(c => ({
          id: c.clientId,
          name: c.name || `${c.firstName} ${c.lastName}`,
          email: c.email
        })),
        employees: employees.map(e => ({
          id: e.employeeId,
          name: e.name,
          email: e.email
        })),
        admins: admins.map(a => ({
          id: a.adminId,
          name: a.name,
          email: a.email
        }))
      }
    });

  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users"
    });
  }
});

// ================================
// 2. GET FILTERED ACTIVITY LOGS
// ================================
router.get("/get-logs", async (req, res) => {
  try {
    const {
      role,
      userId,
      timeRange,
      page = 1,
      limit = 20,
      search = ""
    } = req.query;

    // Build query object
    const query = {};

    // Filter by role
    if (role && role !== "ALL") {
      query.role = role.toUpperCase();
    }

    // Filter by specific user
    if (userId && userId !== "all") {
      if (role === "CLIENT") query.clientId = userId;
      if (role === "EMPLOYEE") query.employeeId = userId;
      if (role === "ADMIN") query.adminId = userId;
    }

    // Filter by time range
    if (timeRange) {
      const { startDate, endDate } = JSON.parse(timeRange);
      
      if (startDate && endDate) {
        query.dateTime = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else {
        // Default to today if no dates provided
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        query.dateTime = {
          $gte: today,
          $lt: tomorrow
        };
      }
    }

    // Search in action or details
    if (search && search.trim() !== "") {
      query.$or = [
        { action: { $regex: search, $options: "i" } },
        { details: { $regex: search, $options: "i" } },
        { userName: { $regex: search, $options: "i" } }
      ];
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalLogs = await ActivityLog.countDocuments(query);

    // Fetch logs with pagination
    const logs = await ActivityLog.find(query)
      .sort({ dateTime: -1 }) // Newest first
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Format date for display
    const formattedLogs = logs.map(log => ({
      ...log,
      dateTimeFormatted: new Date(log.dateTime).toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    }));

    res.json({
      success: true,
      data: formattedLogs,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalLogs / limitNum),
        totalLogs,
        limit: limitNum
      }
    });

  } catch (error) {
    console.error("Error fetching activity logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch activity logs"
    });
  }
});

// ================================
// 3. EXPORT LOGS TO EXCEL
// ================================
router.get("/export-logs", async (req, res) => {
  try {
    const { role, userId, timeRange } = req.query;

    // Build same query as above
    const query = {};

    if (role && role !== "ALL") {
      query.role = role.toUpperCase();
    }

    if (userId && userId !== "all") {
      if (role === "CLIENT") query.clientId = userId;
      if (role === "EMPLOYEE") query.employeeId = userId;
      if (role === "ADMIN") query.adminId = userId;
    }

    if (timeRange) {
      const { startDate, endDate } = JSON.parse(timeRange);
      if (startDate && endDate) {
        query.dateTime = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }
    }

    // Fetch all logs (no pagination for export)
    const logs = await ActivityLog.find(query)
      .sort({ dateTime: -1 })
      .lean();

    // Format data for Excel
    const excelData = logs.map((log, index) => ({
      "S.No": index + 1,
      "Date & Time": new Date(log.dateTime).toLocaleString("en-GB"),
      "User Name": log.userName || "N/A",
      "Role": log.role,
      "Action": log.action,
      "Details": log.details,
      "Client ID": log.clientId || "N/A",
      "Employee ID": log.employeeId || "N/A",
      "Admin ID": log.adminId || "N/A"
    }));

    // Set headers for Excel file
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=activity-logs-${Date.now()}.xlsx`
    );

    // In a real implementation, you would use exceljs or xlsx library
    // For now, return JSON and frontend will handle conversion
    res.json({
      success: true,
      data: excelData,
      fileName: `activity-logs-${new Date().toISOString().split("T")[0]}.xlsx`
    });

  } catch (error) {
    console.error("Error exporting logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export logs"
    });
  }
});

// ================================
// 4. GET TIME RANGE PRESETS
// ================================
router.get("/time-presets", (req, res) => {
  try {
    const now = new Date();
    
    // Today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // This week
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // This month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    // Last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    lastMonthEnd.setHours(23, 59, 59, 999);

    res.json({
      success: true,
      data: {
        TODAY: {
          startDate: todayStart,
          endDate: todayEnd,
          label: "Today"
        },
        THIS_WEEK: {
          startDate: weekStart,
          endDate: weekEnd,
          label: "This Week"
        },
        THIS_MONTH: {
          startDate: monthStart,
          endDate: monthEnd,
          label: "This Month"
        },
        LAST_MONTH: {
          startDate: lastMonthStart,
          endDate: lastMonthEnd,
          label: "Last Month"
        }
      }
    });

  } catch (error) {
    console.error("Error getting time presets:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get time presets"
    });
  }
});

module.exports = router;