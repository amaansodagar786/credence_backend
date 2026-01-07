const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000
    });

    // Console log: Cookie set
    logToConsole("INFO", "COOKIE_SET", {
      employeeId: employee.employeeId,
      cookieName: "employeeToken"
    });

    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "EMPLOYEE_LOGIN",
        details: "Employee logged in",
        dateTime: new Date().toLocaleString("en-IN")
      });

      // Console log: Activity log created
      logToConsole("INFO", "LOGIN_ACTIVITY_LOG_CREATED", {
        employeeId: employee.employeeId,
        action: "EMPLOYEE_LOGIN"
      });
    } catch (logError) {
      // Console log: Activity log error (non-critical)
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
    // Console log: Login error
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

    // Console log: Employee data fetched
    logToConsole("SUCCESS", "EMPLOYEE_DATA_FETCHED", {
      employeeId: employee.employeeId,
      name: employee.name
    });

    res.json(employee);

  } catch (error) {
    // Console log: Check login error
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
            details: "Employee logged out",
            dateTime: new Date().toLocaleString("en-IN")
          });

          // Console log: Logout activity log created
          logToConsole("INFO", "LOGOUT_ACTIVITY_LOG_CREATED", {
            employeeId: decoded.employeeId,
            action: "EMPLOYEE_LOGOUT"
          });
        }
      } catch (logError) {
        // Console log: Activity log error (non-critical)
        logToConsole("ERROR", "LOGOUT_ACTIVITY_LOG_FAILED", {
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
    // Console log: Logout error
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
   EMPLOYEE GET ASSIGNED CLIENTS
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

        const yearKey = String(assign.year);
        const monthKey = String(assign.month);

        // Get month data from client documents
        let monthData = {
          sales: null,
          purchase: null,
          bank: null,
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

          // Ensure accountingDone is boolean
          monthData.accountingDone = Boolean(monthData.accountingDone);
        }

        // Determine if this is the current active month
        const isCurrentMonth = (assign.year === currentYear && assign.month === currentMonth);

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
          clientName: assign.clientName || client.name,
          isLocked: assign.isLocked || monthData.isLocked || false,
          accountingDone: assign.accountingDone || monthData.accountingDone || false,
          accountingDoneAt: assign.accountingDoneAt || monthData.accountingDoneAt,
          accountingDoneBy: assign.accountingDoneBy || monthData.accountingDoneBy,
          isCurrentMonth: isCurrentMonth,
          documentsCount: monthData.other?.length || 0,
          hasSalesDoc: !!monthData.sales?.url,
          hasPurchaseDoc: !!monthData.purchase?.url,
          hasBankDoc: !!monthData.bank?.url,
          monthData
        };

        response.push(assignmentObj);

        logToConsole("DEBUG", "ASSIGNMENT_PROCESSED", {
          employeeId: employee.employeeId,
          clientId: assign.clientId,
          year: assign.year,
          month: assign.month,
          isCurrentMonth: isCurrentMonth,
          accountingDone: assignmentObj.accountingDone
        });

      } catch (assignError) {
        logToConsole("ERROR", "ASSIGNMENT_PROCESSING_ERROR", {
          error: assignError.message,
          employeeId: employee.employeeId,
          clientId: assign.clientId,
          year: assign.year,
          month: assign.month
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

    // Log activity
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "FETCHED_ASSIGNED_CLIENTS",
        details: `Fetched ${response.length} assigned clients`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      logToConsole("INFO", "ASSIGNED_CLIENTS_ACTIVITY_LOG_CREATED", {
        employeeId: employee.employeeId,
        assignmentCount: response.length
      });
    } catch (logError) {
      logToConsole("ERROR", "ASSIGNED_CLIENTS_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    // Console log: Success response
    logToConsole("SUCCESS", "ASSIGNED_CLIENTS_FETCHED_SUCCESS", {
      employeeId: employee.employeeId,
      name: employee.name,
      totalAssignments: response.length,
      currentMonthAssignments: response.filter(a => a.isCurrentMonth).length,
      accountingDoneCount: response.filter(a => a.accountingDone).length,
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
   TOGGLE ACCOUNTING DONE STATUS
================================ */
router.put("/toggle-accounting-done", async (req, res) => {
  try {
    const { clientId, year, month, accountingDone } = req.body;
    const token = req.cookies?.employeeToken;

    // Console log: Toggle request
    logToConsole("INFO", "TOGGLE_ACCOUNTING_DONE_REQUEST", {
      clientId,
      year,
      month,
      accountingDone,
      ip: req.ip
    });

    // Validation
    if (!clientId || !year || !month) {
      logToConsole("WARN", "MISSING_PARAMETERS_ACCOUNTING", {
        clientId: !!clientId,
        year: !!year,
        month: !!month
      });
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month"
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

    // Find the assignment using composite key (clientId + year + month)
    const assignmentIndex = employee.assignedClients.findIndex(
      a => a.clientId === clientId &&
        a.year === parseInt(year) &&
        a.month === parseInt(month)
    );

    if (assignmentIndex === -1) {
      logToConsole("WARN", "ASSIGNMENT_NOT_FOUND_IN_EMPLOYEE", {
        clientId,
        year,
        month,
        employeeId: employee.employeeId
      });
      return res.status(404).json({
        message: `Assignment not found for client ${clientId}, ${month}/${year}`
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
      accountingDone,
      employeeId: employee.employeeId
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
          a.employeeId === employee.employeeId
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
          monthData.accountingDone = accountingDone;
          monthData.accountingDoneAt = new Date();
          monthData.accountingDoneBy = employee.employeeId;

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
          accountingDone
        });
      }
    }

    // Log activity
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId: clientId,
        action: accountingDone ? "ACCOUNTING_MARKED_DONE" : "ACCOUNTING_MARKED_PENDING",
        details: `Accounting ${accountingDone ? 'marked as done' : 'marked as pending'} for client ${clientId}, ${month}/${year}`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      logToConsole("INFO", "ACCOUNTING_ACTIVITY_LOG_CREATED", {
        employeeId: employee.employeeId,
        clientId: clientId,
        accountingDone
      });
    } catch (logError) {
      logToConsole("ERROR", "ACCOUNTING_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    logToConsole("SUCCESS", "ACCOUNTING_STATUS_UPDATED", {
      clientId,
      year,
      month,
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

module.exports = router;