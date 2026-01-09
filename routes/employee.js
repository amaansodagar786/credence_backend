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
          isCurrentMonth: isCurrentMonth,
          accountingDone: assignmentObj.accountingDone,
          totalFiles: totalFiles
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
        details: `Fetched ${response.length} assigned clients with multiple files support`,
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

/* ===============================
   ADD NOTE TO FILE
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
        // If token fails, still proceed but with unknown employee
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

    // Log activity
    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "ADDED_FILE_NOTE",
        details: `Added note to file ${fileName} in ${categoryPath} for ${month}/${year}`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      logToConsole("INFO", "ADD_NOTE_ACTIVITY_LOG_CREATED", {
        employeeId: employeeId,
        clientId: clientId
      });
    } catch (logError) {
      logToConsole("ERROR", "ADD_NOTE_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employeeId
      });
    }

    logToConsole("SUCCESS", "FILE_NOTE_ADDED_SUCCESS", {
      clientId,
      year,
      month,
      categoryPath,
      fileName,
      employeeId: employeeId,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Note added successfully",
      note: newNote,
      file: {
        fileName: file.fileName,
        totalNotes: file.notes.length
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
   GET ALL FILES FOR ASSIGNMENT (WITH NOTES)
================================ */
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

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        employeeId = decoded.employeeId;
      } catch (error) {
        // If token fails, still proceed
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
    const Employee = require("../models/Employee");
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



module.exports = router;