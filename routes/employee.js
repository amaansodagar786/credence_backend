const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const Client = require("../models/Client");

const router = express.Router();

// Console logging utility
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
  const logEntry = {
    timestamp,
    type,
    operation,
    data
  };

  // Color-coded console output for better visibility
  const colors = {
    INFO: '\x1b[36m',    // Cyan
    SUCCESS: '\x1b[32m', // Green
    WARN: '\x1b[33m',    // Yellow
    ERROR: '\x1b[31m',   // Red
    DEBUG: '\x1b[35m',   // Magenta
    RESET: '\x1b[0m'     // Reset
  };

  const color = colors[type] || colors.RESET;
  console.log(`${color}[${timestamp}] ${type}: ${operation}${colors.RESET}`, data);

  return logEntry;
};

/* ===============================
   HELPER: GET FILE FROM CATEGORY
================================ */
const getFileFromCategory = (category, fileName) => {
  if (!category || !category.files || !Array.isArray(category.files)) {
    return null;
  }

  return category.files.find(file => file.fileName === fileName);
};

/* ===============================
   HELPER: GET TOTAL FILES COUNT
================================ */
const getTotalFilesCount = (monthData) => {
  let count = 0;

  // Count files from main categories
  ['sales', 'purchase', 'bank'].forEach(categoryType => {
    const category = monthData[categoryType];
    if (category && category.files && Array.isArray(category.files)) {
      count += category.files.length;
    }
  });

  // Count files from other categories
  if (monthData.other && Array.isArray(monthData.other)) {
    monthData.other.forEach(otherCat => {
      if (otherCat.document && otherCat.document.files && Array.isArray(otherCat.document.files)) {
        count += otherCat.document.files.length;
      }
    });
  }

  return count;
};

/* ===============================
   EMPLOYEE LOGIN
================================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Console log: Login attempt
    logToConsole("INFO", "EMPLOYEE_LOGIN_ATTEMPT", {
      email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!email || !password) {
      logToConsole("WARN", "MISSING_CREDENTIALS", { email: !!email, password: !!password });
      return res.status(400).json({ message: "Email and password are required" });
    }

    const employee = await Employee.findOne({ email });
    if (!employee) {
      // Console log: Employee not found
      logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { email });
      return res.status(404).json({ message: "Employee not found" });
    }

    // Console log: Employee found
    logToConsole("DEBUG", "EMPLOYEE_FOUND", {
      employeeId: employee.employeeId,
      name: employee.name
    });

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      // Console log: Password mismatch
      logToConsole("WARN", "INVALID_PASSWORD", {
        email,
        employeeId: employee.employeeId
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Console log: Password match successful
    logToConsole("SUCCESS", "PASSWORD_MATCH", {
      employeeId: employee.employeeId,
      name: employee.name
    });

    const token = jwt.sign(
      {
        employeeId: employee.employeeId,
        role: "EMPLOYEE",
        name: employee.name
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Console log: JWT token created
    logToConsole("DEBUG", "JWT_TOKEN_CREATED", {
      employeeId: employee.employeeId,
      expiresIn: "1d"
    });

    res.cookie("employeeToken", token, {
      httpOnly: true,
      secure: true,        // REQUIRED on HTTPS
      sameSite: "none",    // REQUIRED for cross-origin
      maxAge: 24 * 60 * 60 * 1000
    });

    // Console log: Cookie set
    logToConsole("INFO", "COOKIE_SET", {
      employeeId: employee.employeeId,
      cookieName: "employeeToken"
    });

    // Create activity log for employee login
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "EMPLOYEE_LOGIN",
        details: "Employee logged in successfully",
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          email: employee.email,
          loginTime: new Date().toISOString(),
          ip: req.ip
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "EMPLOYEE_LOGIN",
        employeeId: employee.employeeId,
        employeeName: employee.name
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
      // Don't fail login if activity log fails
    }

    // Console log: Login successful
    logToConsole("SUCCESS", "EMPLOYEE_LOGIN_SUCCESS", {
      employeeId: employee.employeeId,
      name: employee.name,
      email: employee.email
    });

    res.json({
      message: "Login successful",
      employee: {
        name: employee.name,
        email: employee.email,
        employeeId: employee.employeeId
      }
    });

  } catch (error) {
    logToConsole("ERROR", "LOGIN_PROCESS_ERROR", {
      error: error.message,
      stack: error.stack,
      email: req.body.email,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error during login",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   EMPLOYEE CHECK LOGIN (GET CURRENT USER)
================================ */
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;

    // Console log: Token check request
    logToConsole("INFO", "EMPLOYEE_AUTH_CHECK", {
      hasToken: !!token,
      ip: req.ip
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_PROVIDED", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verification success
      logToConsole("DEBUG", "TOKEN_VERIFIED", {
        employeeId: decoded.employeeId,
        role: decoded.role
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...' // Log first 20 chars only
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    }).select("-password");

    if (!employee) {
      // Console log: Employee not found in DB
      logToConsole("ERROR", "EMPLOYEE_NOT_FOUND_IN_DB", {
        employeeId: decoded.employeeId
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(404).json({
        message: "Employee not found in database",
        clearedCookie: true
      });
    }

    // Create activity log for checking login status
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "EMPLOYEE_SESSION_CHECK",
        details: "Employee checked login status",
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          checkTime: new Date().toISOString(),
          ip: req.ip
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "EMPLOYEE_SESSION_CHECK",
        employeeId: employee.employeeId
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    // Console log: Employee data fetched
    logToConsole("SUCCESS", "EMPLOYEE_DATA_FETCHED", {
      employeeId: employee.employeeId,
      name: employee.name
    });

    res.json(employee);

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_ME_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error checking authentication",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   EMPLOYEE LOGOUT
================================ */
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    let decoded = null;

    // Console log: Logout request
    logToConsole("INFO", "EMPLOYEE_LOGOUT_REQUEST", {
      hasToken: !!token,
      ip: req.ip
    });

    // Try to decode token to get employee info for activity log
    if (token) {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        // Token is invalid, but we'll still clear the cookie
        logToConsole("WARN", "INVALID_TOKEN_ON_LOGOUT", { ip: req.ip });
      }
    }

    // Clear the cookie
    res.clearCookie("employeeToken");

    // Console log: Cookie cleared
    logToConsole("INFO", "COOKIE_CLEARED", {
      cookieName: "employeeToken"
    });

    // Log activity if we have valid token info
    if (decoded && decoded.employeeId) {
      try {
        const employee = await Employee.findOne({
          employeeId: decoded.employeeId
        }).select("name");

        if (employee) {
          await ActivityLog.create({
            userName: employee.name,
            role: "EMPLOYEE",
            employeeId: decoded.employeeId,
            action: "EMPLOYEE_LOGOUT",
            details: "Employee logged out successfully",
            // dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
              logoutTime: new Date().toISOString(),
              ip: req.ip
            }
          });

          logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_LOGOUT",
            employeeId: decoded.employeeId,
            employeeName: employee.name
          });
        }
      } catch (logError) {
        logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
          error: logError.message,
          employeeId: decoded.employeeId
        });
      }
    }

    // Console log: Logout successful
    logToConsole("SUCCESS", "EMPLOYEE_LOGOUT_SUCCESS", {
      employeeId: decoded?.employeeId || 'unknown',
      ip: req.ip
    });

    res.json({
      message: "Logged out successfully",
      clearedCookie: true
    });

  } catch (error) {
    logToConsole("ERROR", "LOGOUT_PROCESS_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error during logout",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   EMPLOYEE GET ASSIGNED CLIENTS (UPDATED FOR MULTIPLE FILES)
================================ */
router.get("/assigned-clients", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;

    // Console log: Request for assigned clients
    logToConsole("INFO", "GET_ASSIGNED_CLIENTS_REQUEST", {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_ASSIGNED_CLIENTS", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verified
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_ASSIGNED_CLIENTS", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_ASSIGNED_CLIENTS", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...'
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      // Console log: Employee not found
      logToConsole("ERROR", "EMPLOYEE_NOT_FOUND_FOR_ASSIGNED_CLIENTS", {
        employeeId: decoded.employeeId
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(404).json({
        message: "Employee not found",
        clearedCookie: true
      });
    }

    // Console log: Employee found with assignments
    logToConsole("DEBUG", "EMPLOYEE_ASSIGNMENTS_FOUND", {
      employeeId: employee.employeeId,
      name: employee.name,
      assignmentCount: employee.assignedClients?.length || 0
    });

    const response = [];
    const clientCache = new Map();
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // 1-12

    for (const assign of employee.assignedClients || []) {
      try {
        // ===== CRITICAL FIX: FILTER OUT REMOVED ASSIGNMENTS =====
        if (assign.isRemoved) {
          logToConsole("DEBUG", "SKIPPING_REMOVED_ASSIGNMENT", {
            employeeId: employee.employeeId,
            clientId: assign.clientId,
            year: assign.year,
            month: assign.month,
            task: assign.task,
            removedAt: assign.removedAt,
            removedBy: assign.removedBy
          });
          continue; // Skip this removed assignment
        }

        let client;

        // Check cache first
        if (clientCache.has(assign.clientId)) {
          client = clientCache.get(assign.clientId);
          logToConsole("DEBUG", "CLIENT_FROM_CACHE", {
            clientId: assign.clientId
          });
        } else {
          client = await Client.findOne({ clientId: assign.clientId });

          if (client) {
            clientCache.set(assign.clientId, client);
            logToConsole("DEBUG", "CLIENT_FETCHED_FROM_DB", {
              clientId: assign.clientId,
              name: client.name
            });
          }
        }

        if (!client) {
          logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_ASSIGNMENT", {
            clientId: assign.clientId,
            employeeId: employee.employeeId
          });
          continue;
        }

        // ===== ALSO CHECK IF THIS ASSIGNMENT IS REMOVED IN CLIENT RECORD =====
        // Find the corresponding assignment in client's employeeAssignments
        const clientAssignment = client.employeeAssignments?.find(a =>
          a.employeeId === employee.employeeId &&
          a.year === assign.year &&
          a.month === assign.month &&
          a.task === assign.task
        );

        // If assignment is removed in client record, skip it
        if (clientAssignment && clientAssignment.isRemoved) {
          logToConsole("DEBUG", "SKIPPING_ASSIGNMENT_REMOVED_IN_CLIENT_RECORD", {
            employeeId: employee.employeeId,
            clientId: assign.clientId,
            year: assign.year,
            month: assign.month,
            task: assign.task
          });
          continue;
        }

        const yearKey = String(assign.year);
        const monthKey = String(assign.month);

        // Get month data from client documents
        let monthData = {
          sales: { files: [], isLocked: false },
          purchase: { files: [], isLocked: false },
          bank: { files: [], isLocked: false },
          other: [],
          isLocked: false,
          lockedAt: null,
          lockedBy: null,
          autoLockDate: null,
          accountingDone: false,
          accountingDoneAt: null,
          accountingDoneBy: null
        };

        if (client.documents &&
          client.documents.get(yearKey) &&
          client.documents.get(yearKey).get(monthKey)) {
          monthData = client.documents.get(yearKey).get(monthKey);

          // Convert Map to array for 'other' documents if needed
          if (monthData.other && !Array.isArray(monthData.other)) {
            monthData.other = Array.from(monthData.other?.values() || []);
          }

          // Ensure all categories have files array
          ['sales', 'purchase', 'bank'].forEach(categoryType => {
            if (monthData[categoryType] && !monthData[categoryType].files) {
              monthData[categoryType].files = [];
            }
          });

          // Ensure accountingDone is boolean
          monthData.accountingDone = Boolean(monthData.accountingDone);
        }

        // Determine if this is the current active month
        const isCurrentMonth = (assign.year === currentYear && assign.month === currentMonth);

        // Get total files count
        const totalFiles = getTotalFilesCount(monthData);

        // Create assignment object
        const assignmentObj = {
          _id: assign._id,
          client: {
            clientId: client.clientId,
            name: client.name || assign.clientName,
            email: client.email,
            phone: client.phone,
            address: client.address,
            isActive: client.isActive
          },
          year: assign.year,
          month: assign.month,
          assignedAt: assign.assignedAt,
          assignedBy: assign.assignedBy,
          adminName: assign.adminName,
          task: assign.task,
          clientName: assign.clientName || client.name,
          isLocked: assign.isLocked || monthData.isLocked || false,
          accountingDone: assign.accountingDone || monthData.accountingDone || false,
          accountingDoneAt: assign.accountingDoneAt || monthData.accountingDoneAt,
          accountingDoneBy: assign.accountingDoneBy || monthData.accountingDoneBy,
          isCurrentMonth: isCurrentMonth,
          totalFiles: totalFiles,
          // NEW: Individual category file counts
          salesFilesCount: monthData.sales?.files?.length || 0,
          purchaseFilesCount: monthData.purchase?.files?.length || 0,
          bankFilesCount: monthData.bank?.files?.length || 0,
          otherCategoriesCount: monthData.other?.length || 0,
          monthData
        };

        response.push(assignmentObj);

        logToConsole("DEBUG", "ASSIGNMENT_PROCESSED", {
          employeeId: employee.employeeId,
          clientId: assign.clientId,
          year: assign.year,
          month: assign.month,
          task: assign.task,
          isCurrentMonth: isCurrentMonth,
          accountingDone: assignmentObj.accountingDone,
          totalFiles: totalFiles,
          isRemoved: false // Explicitly marking as not removed
        });

      } catch (assignError) {
        logToConsole("ERROR", "ASSIGNMENT_PROCESSING_ERROR", {
          error: assignError.message,
          employeeId: employee.employeeId,
          clientId: assign.clientId,
          year: assign.year,
          month: assign.month,
          task: assign.task
        });
      }
    }

    // Sort assignments: current month first, then others
    response.sort((a, b) => {
      // Current month first
      if (a.isCurrentMonth && !b.isCurrentMonth) return -1;
      if (!a.isCurrentMonth && b.isCurrentMonth) return 1;

      // Then by year (descending) and month (descending)
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    // Create activity log for viewing assigned clients
    try {
      const totalAssignments = employee.assignedClients?.length || 0;
      const activeAssignments = response.length;
      const removedAssignments = totalAssignments - activeAssignments;

      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "VIEWED_ASSIGNED_CLIENTS",
        details: `Employee viewed assigned clients - ${activeAssignments} active assignments (${removedAssignments} removed)`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          activeAssignments,
          removedAssignments,
          totalAssignments,
          currentMonthAssignments: response.filter(a => a.isCurrentMonth).length,
          accountingDoneCount: response.filter(a => a.accountingDone).length,
          totalFiles: response.reduce((sum, a) => sum + (a.totalFiles || 0), 0)
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "VIEWED_ASSIGNED_CLIENTS",
        employeeId: employee.employeeId,
        employeeName: employee.name,
        activeAssignments: activeAssignments,
        removedAssignments: removedAssignments,
        totalAssignments: totalAssignments
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    // Console log: Success response
    logToConsole("SUCCESS", "ASSIGNED_CLIENTS_FETCHED_SUCCESS", {
      employeeId: employee.employeeId,
      name: employee.name,
      totalAssignments: employee.assignedClients?.length || 0,
      activeAssignments: response.length,
      removedAssignmentsFiltered: (employee.assignedClients?.length || 0) - response.length,
      currentMonthAssignments: response.filter(a => a.isCurrentMonth).length,
      accountingDoneCount: response.filter(a => a.accountingDone).length,
      totalFilesAcrossAll: response.reduce((sum, a) => sum + (a.totalFiles || 0), 0),
      timestamp: new Date().toISOString()
    });

    res.json(response);

  } catch (error) {
    logToConsole("ERROR", "ASSIGNED_CLIENTS_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/assigned-clients"
    });

    res.status(500).json({
      message: "Error fetching assigned clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   TOGGLE ACCOUNTING DONE STATUS (UPDATED WITH TASK FILTERING)
================================ */
router.put("/toggle-accounting-done", async (req, res) => {
  try {
    const { clientId, year, month, task, accountingDone } = req.body;
    const token = req.cookies?.employeeToken;

    // Console log: Toggle request
    logToConsole("INFO", "TOGGLE_ACCOUNTING_DONE_REQUEST", {
      clientId,
      year,
      month,
      task,
      accountingDone,
      ip: req.ip
    });

    // Validation (ADDED TASK TO REQUIRED FIELDS)
    if (!clientId || !year || !month || !task) {
      logToConsole("WARN", "MISSING_PARAMETERS_ACCOUNTING", {
        clientId: !!clientId,
        year: !!year,
        month: !!month,
        task: !!task
      });
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, task"
      });
    }

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_ACCOUNTING_TOGGLE", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_ACCOUNTING", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_ACCOUNTING", {
        error: jwtError.message
      });
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Find employee
    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      logToConsole("ERROR", "EMPLOYEE_NOT_FOUND_ACCOUNTING", {
        employeeId: decoded.employeeId
      });
      return res.status(404).json({ message: "Employee not found" });
    }

    // Find the assignment using composite key (clientId + year + month + task)
    const assignmentIndex = employee.assignedClients.findIndex(
      a => a.clientId === clientId &&
        a.year === parseInt(year) &&
        a.month === parseInt(month) &&
        a.task === task
    );

    if (assignmentIndex === -1) {
      logToConsole("WARN", "ASSIGNMENT_NOT_FOUND_IN_EMPLOYEE", {
        clientId,
        year,
        month,
        task,
        employeeId: employee.employeeId,
        availableTasks: employee.assignedClients
          .filter(a => a.clientId === clientId && a.year === parseInt(year) && a.month === parseInt(month))
          .map(a => a.task)
      });
      return res.status(404).json({
        message: `Assignment not found for client ${clientId}, ${month}/${year}, task: ${task}`
      });
    }

    // Update accounting status in Employee collection
    employee.assignedClients[assignmentIndex].accountingDone = accountingDone;
    employee.assignedClients[assignmentIndex].accountingDoneAt = new Date();
    employee.assignedClients[assignmentIndex].accountingDoneBy = employee.employeeId;

    await employee.save();

    logToConsole("DEBUG", "EMPLOYEE_ASSIGNMENT_UPDATED", {
      clientId,
      year,
      month,
      task,
      accountingDone,
      employeeId: employee.employeeId,
      assignmentId: employee.assignedClients[assignmentIndex]._id
    });

    // Also update in Client collection for consistency
    const client = await Client.findOne({
      clientId: clientId
    });

    if (client) {
      // Find the assignment in client's employeeAssignments
      const clientAssignmentIndex = client.employeeAssignments.findIndex(
        a => a.year === parseInt(year) &&
          a.month === parseInt(month) &&
          a.employeeId === employee.employeeId &&
          a.task === task
      );

      if (clientAssignmentIndex !== -1) {
        client.employeeAssignments[clientAssignmentIndex].accountingDone = accountingDone;
        client.employeeAssignments[clientAssignmentIndex].accountingDoneAt = new Date();
        client.employeeAssignments[clientAssignmentIndex].accountingDoneBy = employee.employeeId;

        // Also update in documents map if exists
        const yearKey = String(year);
        const monthKey = String(month);

        if (client.documents &&
          client.documents.get(yearKey) &&
          client.documents.get(yearKey).get(monthKey)) {

          const monthData = client.documents.get(yearKey).get(monthKey);
          // Note: Documents are per month, not per task
          // Accounting status in documents remains per month
          // We'll keep it as is, or you can track per task in documents too
          // For now, we'll update if this is the first task being marked done

          // Check if all tasks for this month are done
          const allTasksForMonth = client.employeeAssignments.filter(
            a => a.year === parseInt(year) &&
              a.month === parseInt(month) &&
              a.employeeId === employee.employeeId
          );

          const allDone = allTasksForMonth.every(t => t.accountingDone);

          if (allDone) {
            monthData.accountingDone = true;
            monthData.accountingDoneAt = new Date();
            monthData.accountingDoneBy = employee.employeeId;
          } else {
            monthData.accountingDone = false;
            monthData.accountingDoneAt = null;
            monthData.accountingDoneBy = null;
          }

          // Update the map
          if (!client.documents.get(yearKey)) {
            client.documents.set(yearKey, new Map());
          }
          client.documents.get(yearKey).set(monthKey, monthData);
        }

        await client.save();

        logToConsole("DEBUG", "CLIENT_ASSIGNMENT_UPDATED", {
          clientId,
          year,
          month,
          task,
          accountingDone
        });
      }
    }

    // Create activity log for accounting status change
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId: clientId,
        action: accountingDone ? "ACCOUNTING_MARKED_DONE" : "ACCOUNTING_MARKED_PENDING",
        details: `Accounting ${accountingDone ? 'marked as done' : 'marked as pending'} for client ${clientId}, ${month}/${year}, task: ${task}`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientId,
          year,
          month,
          task,
          accountingDone,
          changeTime: new Date().toISOString()
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: accountingDone ? "ACCOUNTING_MARKED_DONE" : "ACCOUNTING_MARKED_PENDING",
        employeeId: employee.employeeId,
        clientId: clientId,
        task,
        accountingDone
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    logToConsole("SUCCESS", "ACCOUNTING_STATUS_UPDATED", {
      clientId,
      year,
      month,
      task,
      employeeId: employee.employeeId,
      accountingDone,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: accountingDone ? "Accounting marked as done" : "Accounting marked as pending",
      assignment: {
        clientId,
        year: parseInt(year),
        month: parseInt(month),
        task,
        accountingDone,
        accountingDoneAt: new Date(),
        accountingDoneBy: employee.employeeId
      }
    });

  } catch (error) {
    logToConsole("ERROR", "TOGGLE_ACCOUNTING_DONE_ERROR", {
      error: error.message,
      stack: error.stack,
      body: req.body,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error updating accounting status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   ADD NOTE TO FILE (WITH EMAIL NOTIFICATIONS)
================================ */
router.post("/add-file-note", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,   // 'sales', 'purchase', 'bank', 'other'
      categoryName,   // Required only for 'other'
      fileName,       // The specific file to add note to
      note            // Note text
    } = req.body;

    // Console log: Add note request
    logToConsole("INFO", "ADD_FILE_NOTE_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      noteLength: note?.length || 0,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month || !categoryType || !fileName || !note?.trim()) {
      logToConsole("WARN", "MISSING_PARAMETERS_ADD_NOTE", {
        clientId: !!clientId,
        year: !!year,
        month: !!month,
        categoryType: !!categoryType,
        fileName: !!fileName,
        note: !!note?.trim()
      });
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, note"
      });
    }

    // Get employee info from token
    const token = req.cookies?.employeeToken;
    let employeeId = "unknown";
    let employeeName = "Employee";

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        employeeId = decoded.employeeId;
        employeeName = decoded.name;
      } catch (error) {
        logToConsole("WARN", "TOKEN_FAILED_FOR_NOTE", { error: error.message });
      }
    }

    // Find client
    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_FOR_NOTE", { clientId });
      return res.status(404).json({ message: "Client not found" });
    }

    // Get month data
    const yearKey = String(year);
    const monthKey = String(month);

    if (!client.documents ||
      !client.documents.get(yearKey) ||
      !client.documents.get(yearKey).get(monthKey)) {
      logToConsole("WARN", "MONTH_DATA_NOT_FOUND", {
        clientId,
        year,
        month
      });
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    const monthData = client.documents.get(yearKey).get(monthKey);

    let file = null;
    let categoryPath = "";

    // Find the file based on category type
    if (categoryType === 'other') {
      if (!categoryName) {
        return res.status(400).json({
          message: "categoryName is required for 'other' category"
        });
      }

      const otherCategory = monthData.other?.find(
        cat => cat.categoryName === categoryName
      );

      if (!otherCategory || !otherCategory.document) {
        return res.status(404).json({
          message: `Category '${categoryName}' not found`
        });
      }

      file = getFileFromCategory(otherCategory.document, fileName);
      categoryPath = `other.${categoryName}`;

    } else {
      // Main categories: sales, purchase, bank
      const category = monthData[categoryType];
      if (!category) {
        return res.status(404).json({
          message: `Category '${categoryType}' not found`
        });
      }

      file = getFileFromCategory(category, fileName);
      categoryPath = categoryType;
    }

    if (!file) {
      logToConsole("WARN", "FILE_NOT_FOUND", {
        clientId,
        year,
        month,
        categoryType,
        fileName
      });
      return res.status(404).json({
        message: `File '${fileName}' not found in ${categoryPath}`
      });
    }

    // Add note to file
    if (!file.notes) {
      file.notes = [];
    }

    const newNote = {
      note: note.trim(),
      addedBy: employeeName,
      employeeId: employeeId,
      addedAt: new Date()
    };

    file.notes.push(newNote);

    // Update the client document
    await client.save();

    logToConsole("DEBUG", "FILE_NOTE_ADDED", {
      clientId,
      year,
      month,
      categoryPath,
      fileName,
      employeeId: employeeId,
      noteId: newNote._id || "generated"
    });

    // ============================================
    // SEND EMAIL NOTIFICATIONS
    // ============================================
    try {
      // Prepare email details
      const emailDetails = {
        clientId,
        clientName: client.name,
        clientEmail: client.email,
        employeeName,
        employeeId,
        year,
        month,
        categoryType,
        categoryName: categoryName || categoryType,
        fileName,
        note: note.trim(),
        addedAt: new Date().toLocaleString("en-IN"),
        categoryPath
      };

      // Send email to client
      if (client.email) {
        const clientEmailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #4CAF50; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
              .note-box { background-color: #fff; border-left: 4px solid #4CAF50; padding: 15px; margin: 15px 0; }
              .details { background-color: #e8f5e9; padding: 10px; border-radius: 3px; margin: 10px 0; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>📝 New Note Added to Your File</h2>
              </div>
              <div class="content">
                <p>Dear ${client.name},</p>
                
                <p>A new note has been added to one of your files by our accounting team.</p>
                
                <div class="details">
                  <p><strong>Employee:</strong> ${employeeName}</p>
                  <p><strong>File:</strong> ${fileName}</p>
                  <p><strong>Category:</strong> ${categoryName || categoryType}</p>
                  <p><strong>Period:</strong> ${month}/${year}</p>
                  <p><strong>Time:</strong> ${emailDetails.addedAt}</p>
                </div>
                
                <div class="note-box">
                  <h4>📋 Note:</h4>
                  <p>${note.trim()}</p>
                </div>
                
                <p>Please log in to your account to view the complete details and respond if needed.</p>
                
                <div class="footer">
                  <p>This is an automated notification from Accounting Portal.</p>
                  <p>Client ID: ${clientId}</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;

        await sendEmail(
          client.email,
          `📝 Note Added to File ${fileName} - ${client.name}`,
          clientEmailHtml
        );

        logToConsole("SUCCESS", "EMAIL_SENT_TO_CLIENT", {
          clientId,
          clientEmail: client.email,
          employeeId,
          fileName
        });
      }

      // Send email to admin
      const adminEmail = process.env.EMAIL_USER;
      if (adminEmail) {
        const adminEmailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #2196F3; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
              .note-box { background-color: #fff; border-left: 4px solid #2196F3; padding: 15px; margin: 15px 0; }
              .details { background-color: #e3f2fd; padding: 10px; border-radius: 3px; margin: 10px 0; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
              .alert { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 3px; margin: 10px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>🔔 Employee Added Note to Client File</h2>
              </div>
              <div class="content">
                <div class="alert">
                  <strong>Notification:</strong> An employee has added a note to a client file.
                </div>
                
                <div class="details">
                  <p><strong>Employee:</strong> ${employeeName} (${employeeId})</p>
                  <p><strong>Client:</strong> ${client.name} (${clientId})</p>
                  <p><strong>Client Email:</strong> ${client.email || 'Not provided'}</p>
                  <p><strong>File:</strong> ${fileName}</p>
                  <p><strong>Category:</strong> ${categoryName || categoryType}</p>
                  <p><strong>Period:</strong> ${month}/${year}</p>
                  <p><strong>Time:</strong> ${emailDetails.addedAt}</p>
                </div>
                
                <div class="note-box">
                  <h4>📋 Note Content:</h4>
                  <p>${note.trim()}</p>
                </div>
                
                <p><strong>IP Address:</strong> ${req.ip}</p>
                <p><strong>User Agent:</strong> ${req.get('User-Agent')?.substring(0, 100)}...</p>
                
                <div class="footer">
                  <p>This is an automated notification from Accounting Portal System.</p>
                  <p>Note ID: ${newNote._id || 'Generated'}</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;

        await sendEmail(
          adminEmail,
          `🔔 Employee ${employeeName} Added Note to ${client.name}'s File`,
          adminEmailHtml
        );

        logToConsole("SUCCESS", "EMAIL_SENT_TO_ADMIN", {
          adminEmail,
          employeeId,
          clientId
        });
      }

    } catch (emailError) {
      logToConsole("ERROR", "EMAIL_SENDING_FAILED", {
        error: emailError.message,
        clientId,
        employeeId
      });
      // Don't fail the note addition if email fails
    }

    // Create activity log for adding file note
    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "ADDED_FILE_NOTE",
        details: `Added note to file "${fileName}" in ${categoryPath} for client ${client.name} (${month}/${year})`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientId,
          year,
          month,
          categoryType,
          categoryName,
          fileName,
          noteLength: note.trim().length,
          notePreview: note.trim().substring(0, 50) + (note.trim().length > 50 ? "..." : ""),
          emailSent: true,
          clientEmail: client.email || 'Not sent',
          adminEmail: process.env.EMAIL_USER || 'Not sent'
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED_WITH_EMAIL", {
        action: "ADDED_FILE_NOTE",
        employeeId: employeeId,
        clientId: clientId,
        fileName: fileName
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employeeId
      });
    }

    logToConsole("SUCCESS", "FILE_NOTE_ADDED_SUCCESS_WITH_EMAIL", {
      clientId,
      year,
      month,
      categoryPath,
      fileName,
      employeeId: employeeId,
      clientEmailSent: !!client.email,
      adminEmailSent: !!process.env.EMAIL_USER,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Note added successfully",
      note: newNote,
      file: {
        fileName: file.fileName,
        totalNotes: file.notes.length
      },
      notifications: {
        clientEmailSent: !!client.email,
        adminEmailSent: !!process.env.EMAIL_USER
      }
    });

  } catch (error) {
    logToConsole("ERROR", "ADD_FILE_NOTE_ERROR", {
      error: error.message,
      stack: error.stack,
      body: req.body,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error adding note to file",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


/* ===============================
   GET ALL FILES FOR ASSIGNMENT (WITH NOTES) - UPDATED WITH CATEGORY NOTES
================================ */
router.get("/assignment-files", async (req, res) => {
  try {
    const { clientId, year, month } = req.query;

    // Console log: Get assignment files request
    logToConsole("INFO", "GET_ASSIGNMENT_FILES_REQUEST", {
      clientId,
      year,
      month,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month) {
      logToConsole("WARN", "MISSING_PARAMETERS_ASSIGNMENT_FILES", {
        clientId: !!clientId,
        year: !!year,
        month: !!month
      });
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month"
      });
    }

    // Get employee info from token (for logging)
    const token = req.cookies?.employeeToken;
    let employeeId = "unknown";
    let employeeName = "Employee";

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        employeeId = decoded.employeeId;
        employeeName = decoded.name;
      } catch (error) {
        // If token fails, still proceed
        logToConsole("WARN", "TOKEN_FAILED_FOR_ASSIGNMENT_FILES", { error: error.message });
      }
    }

    // Find client
    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_FILES", { clientId });
      return res.status(404).json({ message: "Client not found" });
    }

    // Get month data
    const yearKey = String(year);
    const monthKey = String(month);

    if (!client.documents ||
      !client.documents.get(yearKey) ||
      !client.documents.get(yearKey).get(monthKey)) {
      logToConsole("WARN", "MONTH_DATA_NOT_FOUND_FILES", {
        clientId,
        year,
        month
      });
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    const monthData = client.documents.get(yearKey).get(monthKey);

    // NEW: Get employee names for all notes
    const employeeMap = new Map();

    // Collect all employeeIds from ALL notes (file notes + category notes)
    const employeeIds = new Set();

    // Helper to collect employeeIds from notes array
    const collectEmployeeIds = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;
      notesArray.forEach(note => {
        if (note.employeeId) employeeIds.add(note.employeeId);
        if (note.addedBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
          employeeIds.add(note.addedBy);
        }
      });
    };

    // Collect from category notes (sales, purchase, bank)
    ['sales', 'purchase', 'bank'].forEach(categoryType => {
      const category = monthData[categoryType];
      if (category && category.categoryNotes) {
        collectEmployeeIds(category.categoryNotes);
      }
    });

    // Collect from other category notes
    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat.document && otherCat.document.categoryNotes) {
          collectEmployeeIds(otherCat.document.categoryNotes);
        }
      });
    }

    // Collect from file notes
    ['sales', 'purchase', 'bank'].forEach(categoryType => {
      const category = monthData[categoryType];
      if (category && category.files && Array.isArray(category.files)) {
        category.files.forEach(file => {
          collectEmployeeIds(file.notes);
        });
      }
    });

    // Collect from other category file notes
    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat.document && otherCat.document.files && Array.isArray(otherCat.document.files)) {
          otherCat.document.files.forEach(file => {
            collectEmployeeIds(file.notes);
          });
        }
      });
    }

    // Fetch employee names for all collected IDs
    if (employeeIds.size > 0) {
      const employees = await Employee.find(
        { employeeId: { $in: Array.from(employeeIds) } },
        { employeeId: 1, name: 1 }
      );

      employees.forEach(emp => {
        employeeMap.set(emp.employeeId, emp.name);
      });

      logToConsole("DEBUG", "EMPLOYEES_FETCHED_FOR_NOTES", {
        totalEmployeesFound: employees.length,
        employeeIdsRequested: employeeIds.size
      });
    }

    // Helper to populate employee names in notes
    const populateEmployeeNames = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;

      notesArray.forEach(note => {
        // First try to get name from employeeId
        if (note.employeeId && employeeMap.has(note.employeeId)) {
          note.employeeName = employeeMap.get(note.employeeId);
        }
        // If no employeeName found, check addedBy (might be employeeId)
        else if (!note.employeeName && note.addedBy) {
          // Check if addedBy is an employeeId UUID
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
            if (employeeMap.has(note.addedBy)) {
              note.employeeName = employeeMap.get(note.addedBy);
            }
          }
          // If addedBy is already a name, keep it
          else if (typeof note.addedBy === 'string' && note.addedBy.trim().length > 0) {
            note.employeeName = note.addedBy;
          }
        }

        // Ensure we have at least some display name
        if (!note.employeeName) {
          note.employeeName = note.addedBy || 'Unknown';
        }
      });
    };

    // Prepare response with all files and notes
    const response = {
      period: `${month}/${year}`,
      clientId,
      clientName: client.name,
      categories: {}
    };

    // Process each main category
    const mainCategories = ['sales', 'purchase', 'bank'];
    mainCategories.forEach(categoryType => {
      const category = monthData[categoryType];
      if (category) {
        // Process category-level notes first
        let categoryNotes = [];
        let totalCategoryNotes = 0;

        if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
          // Create a copy to avoid modifying original
          categoryNotes = [...category.categoryNotes];
          totalCategoryNotes = categoryNotes.length;

          // Populate employee names in category notes
          populateEmployeeNames(categoryNotes);

          logToConsole("DEBUG", "CATEGORY_NOTES_FOUND", {
            categoryType,
            notesCount: totalCategoryNotes
          });
        }

        // Process file-level notes
        let filesData = [];
        let totalFileNotes = 0;

        if (category.files && Array.isArray(category.files)) {
          filesData = category.files.map(file => {
            // Create a copy of file notes
            const fileNotes = file.notes ? [...file.notes] : [];
            totalFileNotes += fileNotes.length;

            // Populate employee names in file notes
            populateEmployeeNames(fileNotes);

            return {
              fileName: file.fileName,
              url: file.url,
              uploadedAt: file.uploadedAt,
              uploadedBy: file.uploadedBy,
              fileSize: file.fileSize,
              fileType: file.fileType,
              notes: fileNotes,
              totalNotes: fileNotes.length
            };
          });
        }

        response.categories[categoryType] = {
          files: filesData,
          totalFiles: filesData.length,
          // NEW: Include category-level notes
          categoryNotes: categoryNotes,
          totalCategoryNotes: totalCategoryNotes,
          totalFileNotes: totalFileNotes,
          totalNotes: totalCategoryNotes + totalFileNotes,
          isLocked: category.isLocked || false
        };
      }
    });

    // Process other categories
    if (monthData.other && Array.isArray(monthData.other)) {
      response.categories.other = monthData.other.map(otherCat => {
        const document = otherCat.document || {};

        // Process category-level notes for other categories
        let categoryNotes = [];
        let totalCategoryNotes = 0;

        if (document.categoryNotes && Array.isArray(document.categoryNotes)) {
          categoryNotes = [...document.categoryNotes];
          totalCategoryNotes = categoryNotes.length;

          // Populate employee names in category notes
          populateEmployeeNames(categoryNotes);
        }

        // Process file-level notes
        let filesData = [];
        let totalFileNotes = 0;

        if (document.files && Array.isArray(document.files)) {
          filesData = document.files.map(file => {
            const fileNotes = file.notes ? [...file.notes] : [];
            totalFileNotes += fileNotes.length;

            // Populate employee names in file notes
            populateEmployeeNames(fileNotes);

            return {
              fileName: file.fileName,
              url: file.url,
              uploadedAt: file.uploadedAt,
              uploadedBy: file.uploadedBy,
              fileSize: file.fileSize,
              fileType: file.fileType,
              notes: fileNotes,
              totalNotes: fileNotes.length
            };
          });
        }

        return {
          categoryName: otherCat.categoryName,
          files: filesData,
          totalFiles: filesData.length,
          // NEW: Include category-level notes for other categories
          categoryNotes: categoryNotes,
          totalCategoryNotes: totalCategoryNotes,
          totalFileNotes: totalFileNotes,
          totalNotes: totalCategoryNotes + totalFileNotes,
          isLocked: document.isLocked || false
        };
      });
    }

    // Calculate totals
    let totalFiles = 0;
    let totalFileNotes = 0;
    let totalCategoryNotes = 0;

    Object.values(response.categories).forEach(cat => {
      if (Array.isArray(cat)) {
        // For other categories array
        cat.forEach(otherCat => {
          totalFiles += otherCat.totalFiles || 0;
          totalFileNotes += otherCat.totalFileNotes || 0;
          totalCategoryNotes += otherCat.totalCategoryNotes || 0;
        });
      } else {
        totalFiles += cat.totalFiles || 0;
        totalFileNotes += cat.totalFileNotes || 0;
        totalCategoryNotes += cat.totalCategoryNotes || 0;
      }
    });

    response.totalFiles = totalFiles;
    response.totalFileNotes = totalFileNotes;
    response.totalCategoryNotes = totalCategoryNotes;
    response.totalNotes = totalFileNotes + totalCategoryNotes;

    // Create activity log for viewing assignment files
    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "VIEWED_ASSIGNMENT_FILES",
        details: `Employee viewed files for client ${client.name} (${month}/${year})`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientId,
          year,
          month,
          clientName: client.name,
          totalFiles,
          totalFileNotes,
          totalCategoryNotes,
          totalNotes: totalFileNotes + totalCategoryNotes
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "VIEWED_ASSIGNMENT_FILES",
        employeeId: employeeId,
        clientId: clientId,
        clientName: client.name
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employeeId
      });
    }

    logToConsole("SUCCESS", "ASSIGNMENT_FILES_FETCHED_WITH_CATEGORY_NOTES", {
      clientId,
      year,
      month,
      totalFiles,
      totalFileNotes,
      totalCategoryNotes,
      employeeId: employeeId,
      timestamp: new Date().toISOString()
    });

    res.json(response);

  } catch (error) {
    logToConsole("ERROR", "GET_ASSIGNMENT_FILES_ERROR", {
      error: error.message,
      stack: error.stack,
      query: req.query,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error fetching assignment files",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   GET NOTES FOR SPECIFIC FILE
================================ */
router.get("/file-notes", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName
    } = req.query;

    // Console log: Get notes request
    logToConsole("INFO", "GET_FILE_NOTES_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month || !categoryType || !fileName) {
      logToConsole("WARN", "MISSING_PARAMETERS_GET_NOTES", {
        clientId: !!clientId,
        year: !!year,
        month: !!month,
        categoryType: !!categoryType,
        fileName: !!fileName
      });
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName"
      });
    }

    // Get employee info from token (for activity log)
    const token = req.cookies?.employeeToken;
    let employeeId = "unknown";
    let employeeName = "Employee";

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        employeeId = decoded.employeeId;
        employeeName = decoded.name;
      } catch (error) {
        logToConsole("WARN", "TOKEN_FAILED_FOR_FILE_NOTES", { error: error.message });
      }
    }

    // Find client
    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_GET_NOTES", { clientId });
      return res.status(404).json({ message: "Client not found" });
    }

    // Get month data
    const yearKey = String(year);
    const monthKey = String(month);

    if (!client.documents ||
      !client.documents.get(yearKey) ||
      !client.documents.get(yearKey).get(monthKey)) {
      logToConsole("WARN", "MONTH_DATA_NOT_FOUND_GET_NOTES", {
        clientId,
        year,
        month
      });
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    const monthData = client.documents.get(yearKey).get(monthKey);

    let file = null;
    let categoryPath = "";

    // Find the file based on category type
    if (categoryType === 'other') {
      if (!categoryName) {
        return res.status(400).json({
          message: "categoryName is required for 'other' category"
        });
      }

      const otherCategory = monthData.other?.find(
        cat => cat.categoryName === categoryName
      );

      if (!otherCategory || !otherCategory.document) {
        return res.status(404).json({
          message: `Category '${categoryName}' not found`
        });
      }

      file = getFileFromCategory(otherCategory.document, fileName);
      categoryPath = `other.${categoryName}`;

    } else {
      // Main categories: sales, purchase, bank
      const category = monthData[categoryType];
      if (!category) {
        return res.status(404).json({
          message: `Category '${categoryType}' not found`
        });
      }

      file = getFileFromCategory(category, fileName);
      categoryPath = categoryType;
    }

    if (!file) {
      logToConsole("WARN", "FILE_NOT_FOUND_GET_NOTES", {
        clientId,
        year,
        month,
        categoryType,
        fileName
      });
      return res.status(404).json({
        message: `File '${fileName}' not found in ${categoryPath}`
      });
    }

    // Return file with notes
    const response = {
      file: {
        fileName: file.fileName,
        url: file.url,
        uploadedAt: file.uploadedAt,
        uploadedBy: file.uploadedBy,
        fileSize: file.fileSize,
        fileType: file.fileType
      },
      notes: file.notes || [],
      totalNotes: file.notes ? file.notes.length : 0,
      category: categoryPath,
      period: `${month}/${year}`
    };

    // Create activity log for viewing file notes
    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "VIEWED_FILE_NOTES",
        details: `Employee viewed notes for file "${fileName}" in ${categoryPath} for client ${client.name}`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientId,
          year,
          month,
          categoryType,
          categoryName,
          fileName,
          totalNotes: response.totalNotes,
          clientName: client.name
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
        action: "VIEWED_FILE_NOTES",
        employeeId: employeeId,
        clientId: clientId,
        fileName: fileName
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employeeId
      });
    }

    logToConsole("SUCCESS", "FILE_NOTES_FETCHED", {
      clientId,
      year,
      month,
      categoryPath,
      fileName,
      totalNotes: response.totalNotes,
      timestamp: new Date().toISOString()
    });

    res.json(response);

  } catch (error) {
    logToConsole("ERROR", "GET_FILE_NOTES_ERROR", {
      error: error.message,
      stack: error.stack,
      query: req.query,
      ip: req.ip
    });

    res.status(500).json({
      message: "Error fetching file notes",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});




/* ===============================
   CHECK IF FILE IS VIEWED BY EMPLOYEE
================================ */
router.get("/check-file-viewed", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName
    } = req.query;

    // Console log
    logToConsole("INFO", "CHECK_FILE_VIEWED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month || !categoryType || !fileName) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName"
      });
    }

    // Get employee from token
    const token = req.cookies?.employeeToken;
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Check if file exists in viewedFiles
    const viewedFile = employee.viewedFiles.find(f =>
      f.clientId === clientId &&
      f.year === parseInt(year) &&
      f.month === parseInt(month) &&
      f.categoryType === categoryType &&
      f.fileName === fileName &&
      (!categoryName || f.categoryName === categoryName)
    );

    logToConsole("DEBUG", "FILE_VIEWED_STATUS", {
      employeeId: employee.employeeId,
      clientId,
      fileName,
      isViewed: !!viewedFile,
      viewedAt: viewedFile?.viewedAt
    });

    res.json({
      isViewed: !!viewedFile,
      viewedAt: viewedFile?.viewedAt,
      lastCheckedAt: viewedFile?.lastCheckedAt
    });

  } catch (error) {
    logToConsole("ERROR", "CHECK_FILE_VIEWED_ERROR", {
      error: error.message,
      query: req.query,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid token", clearedCookie: true });
    }

    res.status(500).json({
      message: "Error checking file viewed status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


/* ===============================
   MARK FILE AS VIEWED/UNVIEWED (TOGGLE)
================================ */
router.post("/toggle-file-viewed", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,
      task
    } = req.body;

    // Console log
    logToConsole("INFO", "TOGGLE_FILE_VIEWED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl: !!fileUrl,
      task,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month || !categoryType || !fileName) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName"
      });
    }

    // Get employee from token
    const token = req.cookies?.employeeToken;
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Check if already viewed
    const existingIndex = employee.viewedFiles.findIndex(f =>
      f.clientId === clientId &&
      f.year === parseInt(year) &&
      f.month === parseInt(month) &&
      f.categoryType === categoryType &&
      f.fileName === fileName &&
      (!categoryName || f.categoryName === categoryName)
    );

    let action = "";
    let viewedFile = null;

    if (existingIndex !== -1) {
      // Remove from viewed files (mark as not viewed)
      employee.viewedFiles.splice(existingIndex, 1);
      action = "REMOVED";

      logToConsole("DEBUG", "FILE_REMOVED_FROM_VIEWED", {
        employeeId: employee.employeeId,
        clientId,
        fileName,
        action: "unchecked"
      });
    } else {
      // Add to viewed files
      viewedFile = {
        clientId,
        year: parseInt(year),
        month: parseInt(month),
        categoryType,
        fileName,
        fileUrl,
        viewedAt: new Date(),
        lastCheckedAt: new Date()
      };

      // Add categoryName for 'other' category
      if (categoryType === 'other' && categoryName) {
        viewedFile.categoryName = categoryName;
      }

      // Add task if provided
      if (task) {
        viewedFile.task = task;
      }

      employee.viewedFiles.push(viewedFile);
      action = "ADDED";

      logToConsole("DEBUG", "FILE_ADDED_TO_VIEWED", {
        employeeId: employee.employeeId,
        clientId,
        fileName,
        action: "checked"
      });
    }

    await employee.save();

    // Create activity log
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId,
        action: action === "ADDED" ? "FILE_MARKED_VIEWED" : "FILE_MARKED_UNVIEWED",
        details: `Employee ${action === "ADDED" ? 'marked' : 'unmarked'} file "${fileName}" as viewed for client ${clientId}`,
        // dateTime: new Date().toLocaleString("en-IN"),
        metadata: {
          clientId,
          year,
          month,
          categoryType,
          categoryName,
          fileName,
          action,
          timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED_TOGGLE_FILE", {
        error: logError.message
      });
    }

    logToConsole("SUCCESS", "FILE_VIEWED_TOGGLED", {
      employeeId: employee.employeeId,
      clientId,
      fileName,
      action,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: action === "ADDED" ? "File marked as viewed" : "File marked as not viewed",
      isViewed: action === "ADDED",
      action,
      viewedAt: viewedFile?.viewedAt
    });

  } catch (error) {
    logToConsole("ERROR", "TOGGLE_FILE_VIEWED_ERROR", {
      error: error.message,
      body: req.body,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid token", clearedCookie: true });
    }

    res.status(500).json({
      message: "Error toggling file viewed status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;