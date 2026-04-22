const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const Client = require("../models/Client");
// Add this with other requires at the top of employeeRoutes.js
const EmployeeAssignment = require("../models/EmployeeAssignment");
// Add these with other requires at the top
const EmployeeViewedFile = require("../models/EmployeeViewedFile");
const EmployeeAuditedFile = require("../models/EmployeeAuditedFile");

const router = express.Router();

// Console logging utility
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Europe/Helsinki"
  });
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

    // Clear any stale tokens from previous sessions before setting new one
    res.clearCookie("clientToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
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

    // Clear employeeToken
    res.clearCookie("employeeToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });

    // Also clear clientToken and accessToken as safety measure
    res.clearCookie("clientToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });

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



router.get("/assigned-clients", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    logToConsole("INFO", "GET_ASSIGNED_CLIENTS_REQUEST", { ip: req.ip, userAgent: req.get('User-Agent') });

    if (!token) {
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid or expired token", clearedCookie: true });
    }

    const employee = await Employee.findOne({ employeeId: decoded.employeeId });
    if (!employee) {
      res.clearCookie("employeeToken");
      return res.status(404).json({ message: "Employee not found", clearedCookie: true });
    }

    // ============= STEP 1: Get ALL assignments from BOTH sources =============
    const EmployeeAssignment = require("../models/EmployeeAssignment");
    const newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });

    const oldAssignments = employee.assignedClients || [];
    const newAssignments = newDoc?.assignedClients || [];

    // MERGE both - new collection takes priority (newer assignedAt wins)
    const mergedMap = new Map();

    for (const assign of oldAssignments) {
      if (assign.isRemoved) continue;
      const key = `${assign.clientId}-${assign.year}-${assign.month}-${assign.task}`;
      if (!mergedMap.has(key) || new Date(assign.assignedAt) > new Date(mergedMap.get(key).assignedAt)) {
        mergedMap.set(key, assign);
      }
    }

    for (const assign of newAssignments) {
      if (assign.isRemoved) continue;
      const key = `${assign.clientId}-${assign.year}-${assign.month}-${assign.task}`;
      if (!mergedMap.has(key) || new Date(assign.assignedAt) > new Date(mergedMap.get(key).assignedAt)) {
        mergedMap.set(key, assign);
      }
    }

    const allAssignments = Array.from(mergedMap.values());

    logToConsole("DEBUG", "MERGED_ASSIGNMENTS", {
      oldCount: oldAssignments.length,
      newCount: newAssignments.length,
      mergedCount: allAssignments.length,
      employeeId: employee.employeeId
    });

    if (allAssignments.length === 0) {
      return res.json([]);
    }

    // ============= STEP 2: Get ALL unique client IDs =============
    const uniqueClientIds = [...new Set(allAssignments.map(a => a.clientId))];

    // ============= STEP 3: Get ALL clients in ONE batch query =============
    const clients = await Client.find(
      { clientId: { $in: uniqueClientIds } }
    ).lean();

    const clientMap = new Map();
    clients.forEach(client => {
      clientMap.set(client.clientId, client);
    });

    logToConsole("DEBUG", "CLIENTS_FETCHED", {
      totalClients: clients.length,
      uniqueClientIds: uniqueClientIds.length
    });

    // ============= STEP 4: Get ALL unique month combinations for batch query =============
    const uniqueMonthKeys = new Set();
    for (const assign of allAssignments) {
      uniqueMonthKeys.add(`${assign.clientId}-${assign.year}-${assign.month}`);
    }

    logToConsole("DEBUG", "UNIQUE_MONTH_COMBINATIONS", {
      totalMonths: uniqueMonthKeys.size
    });

    // ============= STEP 5: BATCH QUERY - Get ALL month data in ONE go =============
    const ClientMonthlyData = require("../models/ClientMonthlyData");

    // Get all monthly data for all relevant clients
    const allMonthlyData = await ClientMonthlyData.find({
      clientId: { $in: uniqueClientIds }
    }).lean();

    // Build a Map for fast O(1) lookup: key = "clientId-year-month"
    const monthDataMap = new Map();

    for (const record of allMonthlyData) {
      if (record.months && Array.isArray(record.months)) {
        for (const month of record.months) {
          const key = `${record.clientId}-${month.year}-${month.month}`;

          // Convert to same format as old structure for compatibility
          const formattedMonthData = {
            sales: month.sales || { files: [], isLocked: false },
            purchase: month.purchase || { files: [], isLocked: false },
            bank: month.bank || { files: [], isLocked: false },
            other: month.other || [],
            isLocked: month.isLocked || false,
            lockedAt: month.lockedAt || null,
            lockedBy: month.lockedBy || null,
            autoLockDate: month.autoLockDate || null,
            accountingDone: month.accountingDone || false,
            accountingDoneAt: month.accountingDoneAt || null,
            accountingDoneBy: month.accountingDoneBy || null
          };

          monthDataMap.set(key, formattedMonthData);
        }
      }
    }

    // ============= STEP 6: For months not found in NEW collection, check OLD documents =============
    // Get all clients with their documents for OLD collection fallback
    const clientsWithDocs = await Client.find(
      { clientId: { $in: uniqueClientIds } },
      { clientId: 1, documents: 1 }
    ).lean();

    const oldDocMap = new Map();
    for (const client of clientsWithDocs) {
      if (client.documents && typeof client.documents === 'object') {
        for (const [yearKey, yearData] of Object.entries(client.documents)) {
          if (yearData && typeof yearData === 'object') {
            for (const [monthKey, monthData] of Object.entries(yearData)) {
              const key = `${client.clientId}-${yearKey}-${monthKey}`;
              if (!monthDataMap.has(key)) {
                // Format old data to match new structure
                const formattedData = {
                  sales: monthData.sales || { files: [], isLocked: false },
                  purchase: monthData.purchase || { files: [], isLocked: false },
                  bank: monthData.bank || { files: [], isLocked: false },
                  other: monthData.other || [],
                  isLocked: monthData.isLocked || false,
                  lockedAt: monthData.lockedAt || null,
                  lockedBy: monthData.lockedBy || null,
                  autoLockDate: monthData.autoLockDate || null,
                  accountingDone: monthData.accountingDone || false,
                  accountingDoneAt: monthData.accountingDoneAt || null,
                  accountingDoneBy: monthData.accountingDoneBy || null
                };

                if (formattedData.other && !Array.isArray(formattedData.other)) {
                  formattedData.other = Array.from(formattedData.other?.values() || []);
                }

                oldDocMap.set(key, formattedData);
              }
            }
          }
        }
      }
    }

    // Merge old data into main map (new collection takes priority)
    for (const [key, value] of oldDocMap) {
      if (!monthDataMap.has(key)) {
        monthDataMap.set(key, value);
      }
    }

    logToConsole("DEBUG", "MONTH_DATA_LOADED", {
      fromNewCollection: monthDataMap.size - oldDocMap.size,
      fromOldCollection: oldDocMap.size,
      total: monthDataMap.size
    });

    // ============= STEP 7: Helper function to get total files count (in memory - FAST!) =============
    const getTotalFilesCount = (monthData) => {
      if (!monthData) return 0;
      let count = 0;

      ['sales', 'purchase', 'bank'].forEach(categoryType => {
        const category = monthData[categoryType];
        if (category && category.files && Array.isArray(category.files)) {
          count += category.files.length;
        }
      });

      if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCat => {
          if (otherCat.document && otherCat.document.files && Array.isArray(otherCat.document.files)) {
            count += otherCat.document.files.length;
          } else if (otherCat.files && Array.isArray(otherCat.files)) {
            count += otherCat.files.length;
          }
        });
      }

      return count;
    };

    const getSalesFilesCount = (monthData) => {
      if (!monthData) return 0;
      return monthData.sales?.files?.length || 0;
    };

    const getPurchaseFilesCount = (monthData) => {
      if (!monthData) return 0;
      return monthData.purchase?.files?.length || 0;
    };

    const getBankFilesCount = (monthData) => {
      if (!monthData) return 0;
      return monthData.bank?.files?.length || 0;
    };

    const getOtherCategoriesCount = (monthData) => {
      if (!monthData) return 0;
      return monthData.other?.length || 0;
    };

    // ============= STEP 8: Process assignments in memory (NO MORE DATABASE CALLS!) =============
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const response = [];

    for (const assign of allAssignments) {
      const client = clientMap.get(assign.clientId);
      if (!client) {
        logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_ASSIGNMENT", {
          clientId: assign.clientId,
          task: assign.task
        });
        continue;
      }

      const monthKey = `${assign.clientId}-${assign.year}-${assign.month}`;
      const monthData = monthDataMap.get(monthKey);

      const isCurrentMonth = (assign.year === currentYear && assign.month === currentMonth);
      const totalFiles = monthData ? getTotalFilesCount(monthData) : 0;

      const assignmentObj = {
        _id: assign._id,
        client: {
          clientId: client.clientId,
          name: client.name || assign.clientName,
          email: client.email,
          phone: client.phone,
          address: client.address,
          isActive: client.isActive,
          currentPlan: client.currentPlan,
          planSelected: client.planSelected,
          nextMonthPlan: client.nextMonthPlan
        },
        year: assign.year,
        month: assign.month,
        assignedAt: assign.assignedAt,
        assignedBy: assign.assignedBy,
        adminName: assign.adminName,
        task: assign.task,
        clientName: assign.clientName || client.name,
        isLocked: assign.isLocked || (monthData?.isLocked) || false,
        accountingDone: assign.accountingDone || false,
        accountingDoneAt: assign.accountingDoneAt || monthData?.accountingDoneAt || null,
        accountingDoneBy: assign.accountingDoneBy || monthData?.accountingDoneBy || null,
        isCurrentMonth: isCurrentMonth,
        totalFiles: totalFiles,
        salesFilesCount: monthData ? getSalesFilesCount(monthData) : 0,
        purchaseFilesCount: monthData ? getPurchaseFilesCount(monthData) : 0,
        bankFilesCount: monthData ? getBankFilesCount(monthData) : 0,
        otherCategoriesCount: monthData ? getOtherCategoriesCount(monthData) : 0,
        monthData: monthData || null
      };

      response.push(assignmentObj);
    }

    // Sort assignments
    response.sort((a, b) => {
      if (a.isCurrentMonth && !b.isCurrentMonth) return -1;
      if (!a.isCurrentMonth && b.isCurrentMonth) return 1;
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    // ============= STEP 9: Activity Log =============
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "VIEWED_ASSIGNED_CLIENTS",
        details: `Employee viewed assigned clients - ${response.length} active assignments`,
        metadata: {
          activeAssignments: response.length,
          totalFiles: response.reduce((sum, a) => sum + (a.totalFiles || 0), 0),
          performance: {
            assignmentsProcessed: response.length,
            monthDataLoaded: monthDataMap.size,
            clientsFetched: clients.length
          }
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
    }

    logToConsole("SUCCESS", "ASSIGNED_CLIENTS_FETCHED_OPTIMIZED", {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      totalAssignments: response.length,
      totalClients: clients.length,
      monthDataLoaded: monthDataMap.size,
      timestamp: new Date().toISOString()
    });

    res.json(response);

  } catch (error) {
    logToConsole("ERROR", "ASSIGNED_CLIENTS_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    res.status(500).json({
      message: "Error fetching assigned clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});



router.put("/toggle-accounting-done", async (req, res) => {
  try {
    const { clientId, year, month, task, accountingDone } = req.body;
    const token = req.cookies?.employeeToken;

    logToConsole("INFO", "TOGGLE_ACCOUNTING_DONE_REQUEST", { clientId, year, month, task, accountingDone, ip: req.ip });

    if (!clientId || !year || !month || !task) {
      return res.status(400).json({ message: "Missing required parameters: clientId, year, month, task" });
    }

    if (!token) {
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const employee = await Employee.findOne({ employeeId: decoded.employeeId });
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const EmployeeAssignment = require("../models/EmployeeAssignment");
    let newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });

    let assignmentFound = false;
    let updatedInNewCollection = false;

    // ===== FIRST: Try to update in NEW COLLECTION =====
    if (newDoc) {
      const newAssignmentIndex = newDoc.assignedClients.findIndex(
        a => a.clientId === clientId &&
          a.year === parseInt(year) &&
          a.month === parseInt(month) &&
          a.task === task &&
          !a.isRemoved
      );

      if (newAssignmentIndex !== -1) {
        newDoc.assignedClients[newAssignmentIndex].accountingDone = accountingDone;
        newDoc.assignedClients[newAssignmentIndex].accountingDoneAt = new Date();
        newDoc.assignedClients[newAssignmentIndex].accountingDoneBy = employee.employeeId;
        await newDoc.save();
        assignmentFound = true;
        updatedInNewCollection = true;
        logToConsole("INFO", "UPDATED_IN_NEW_COLLECTION", { employeeId: employee.employeeId, task, accountingDone });
      }
    }

    // ===== SECOND: Try to update in OLD COLLECTION (for backward compatibility) =====
    const assignmentIndex = employee.assignedClients.findIndex(
      a => a.clientId === clientId &&
        a.year === parseInt(year) &&
        a.month === parseInt(month) &&
        a.task === task &&
        !a.isRemoved
    );

    if (assignmentIndex !== -1) {
      employee.assignedClients[assignmentIndex].accountingDone = accountingDone;
      employee.assignedClients[assignmentIndex].accountingDoneAt = new Date();
      employee.assignedClients[assignmentIndex].accountingDoneBy = employee.employeeId;
      await employee.save();
      assignmentFound = true;
      logToConsole("INFO", "UPDATED_IN_OLD_COLLECTION", { employeeId: employee.employeeId, task, accountingDone });
    }

    // ===== If not found in either collection =====
    if (!assignmentFound) {
      logToConsole("WARN", "ASSIGNMENT_NOT_FOUND_IN_EITHER_COLLECTION", {
        clientId, year, month, task,
        employeeId: employee.employeeId,
        hasNewDoc: !!newDoc,
        newDocAssignmentsCount: newDoc?.assignedClients?.length || 0,
        oldAssignmentsCount: employee.assignedClients?.length || 0
      });
      return res.status(404).json({
        message: `Assignment not found for client ${clientId}, ${month}/${year}, task: ${task}`,
        debug: {
          hasNewCollection: !!newDoc,
          oldAssignmentsCount: employee.assignedClients?.length || 0,
          newAssignmentsCount: newDoc?.assignedClients?.length || 0
        }
      });
    }

    // ===== Update CLIENT (always do this) =====
    const client = await Client.findOne({ clientId });
    if (client) {
      const clientAssignmentIndex = client.employeeAssignments.findIndex(
        a => a.year === parseInt(year) &&
          a.month === parseInt(month) &&
          a.employeeId === employee.employeeId &&
          a.task === task &&
          a.isRemoved !== true
      );

      if (clientAssignmentIndex !== -1) {
        client.employeeAssignments[clientAssignmentIndex].accountingDone = accountingDone;
        client.employeeAssignments[clientAssignmentIndex].accountingDoneAt = new Date();
        client.employeeAssignments[clientAssignmentIndex].accountingDoneBy = employee.employeeId;

        const yearKey = String(year);
        const monthKey = String(month);

        if (client.documents &&
          client.documents.get(yearKey) &&
          client.documents.get(yearKey).get(monthKey)) {

          const monthData = client.documents.get(yearKey).get(monthKey);
          const allTasksForMonth = client.employeeAssignments.filter(
            a => a.year === parseInt(year) &&
              a.month === parseInt(month) &&
              a.employeeId === employee.employeeId &&
              a.isRemoved !== true
          );

          const allDone = allTasksForMonth.every(t => t.accountingDone);
          if (allDone) {
            monthData.accountingDone = true;
            monthData.accountingDoneAt = new Date();
            monthData.accountingDoneBy = employee.employeeId;
          }

          if (!client.documents.get(yearKey)) client.documents.set(yearKey, new Map());
          client.documents.get(yearKey).set(monthKey, monthData);
        }
        await client.save();
        logToConsole("INFO", "UPDATED_IN_CLIENT", { clientId, task, accountingDone });
      }
    }

    // ===== Activity log =====
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId,
        action: accountingDone ? "ACCOUNTING_MARKED_DONE" : "ACCOUNTING_MARKED_PENDING",
        details: `Accounting ${accountingDone ? 'marked as done' : 'marked as pending'} for client ${clientId}, ${month}/${year}, task: ${task}`,
        metadata: {
          clientId,
          year,
          month,
          task,
          accountingDone,
          changeTime: new Date().toISOString(),
          updatedInNewCollection
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
    }

    logToConsole("SUCCESS", "ACCOUNTING_STATUS_UPDATED", {
      clientId, year, month, task,
      employeeId: employee.employeeId,
      accountingDone,
      updatedInNewCollection,
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
        accountingDoneBy: employee.employeeId,
        updatedIn: updatedInNewCollection ? "new_collection" : "old_collection"
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

router.post("/add-file-note", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      note
    } = req.body;

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

    if (!clientId || !year || !month || !categoryType || !fileName || !note?.trim()) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, note"
      });
    }

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

    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const numericYear = parseInt(year);
    const numericMonth = parseInt(month);
    let dataSource = null;
    let newDocRef = null;
    let monthData = null;

    // FIRST: Try to get from NEW ClientMonthlyData collection
    try {
      const ClientMonthlyData = require("../models/ClientMonthlyData");
      newDocRef = await ClientMonthlyData.findOne({ clientId: client.clientId });

      if (newDocRef && newDocRef.months) {
        const foundMonthIndex = newDocRef.months.findIndex(m => m.year === numericYear && m.month === numericMonth);
        if (foundMonthIndex !== -1) {
          monthData = newDocRef.months[foundMonthIndex];
          dataSource = 'new';
          logToConsole("DEBUG", "ADD_NOTE_TO_NEW_COLLECTION", { clientId, year, month });
        }
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_GETTING_NEW_MONTH_DATA_FOR_NOTE", { error: err.message });
    }

    // SECOND: If not found in NEW, get from OLD client.documents
    if (!monthData) {
      const yearKey = String(year);
      const monthKey = String(month);

      if (client.documents && client.documents.get(yearKey) && client.documents.get(yearKey).get(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        dataSource = 'old';
        if (monthData.other && !Array.isArray(monthData.other)) {
          monthData.other = Array.from(monthData.other?.values() || []);
        }
        logToConsole("DEBUG", "ADD_NOTE_TO_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    let file = null;
    let categoryPath = "";

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

      file = otherCategory.document.files?.find(f => f.fileName === fileName);
      categoryPath = `other.${categoryName}`;

    } else {
      const category = monthData[categoryType];
      if (!category) {
        return res.status(404).json({
          message: `Category '${categoryType}' not found`
        });
      }

      file = category.files?.find(f => f.fileName === fileName);
      categoryPath = categoryType;
    }

    if (!file) {
      return res.status(404).json({
        message: `File '${fileName}' not found in ${categoryPath}`
      });
    }

    if (!file.notes) {
      file.notes = [];
    }

    const newNote = {
      note: note.trim(),
      addedBy: employeeName,
      employeeId: employeeId,
      addedAt: new Date(),
      isViewedByClient: false,
      isViewedByEmployee: false,
      isViewedByAdmin: false,
      viewedBy: []
    };

    file.notes.push(newNote);

    // SAVE to appropriate location (ONLY ONCE!)
    if (dataSource === 'new' && newDocRef) {
      // Save to NEW collection - monthData is already the reference to the array item
      await newDocRef.save();
      logToConsole("DEBUG", "NOTE_SAVED_TO_NEW_COLLECTION", { clientId, year, month });
    } else {
      // Save to OLD client.documents
      await client.save();
      logToConsole("DEBUG", "NOTE_SAVED_TO_OLD_COLLECTION", { clientId, year, month });
    }

    // ===== SEND EMAIL NOTIFICATIONS (keep as is) =====
    // ... (your existing email code)

    logToConsole("SUCCESS", "FILE_NOTE_ADDED_SUCCESS", {
      clientId,
      year,
      month,
      categoryPath,
      fileName,
      employeeId: employeeId,
      savedTo: dataSource === 'new' ? 'new_collection' : 'old_collection'
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


router.get("/assignment-files", async (req, res) => {
  try {
    const { clientId, year, month } = req.query;

    logToConsole("INFO", "GET_ASSIGNMENT_FILES_REQUEST", {
      clientId,
      year,
      month,
      ip: req.ip
    });

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

    const token = req.cookies?.employeeToken;
    let employeeId = "unknown";
    let employeeName = "Employee";

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        employeeId = decoded.employeeId;
        employeeName = decoded.name;
      } catch (error) {
        logToConsole("WARN", "TOKEN_FAILED_FOR_ASSIGNMENT_FILES", { error: error.message });
      }
    }

    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_FILES", { clientId });
      return res.status(404).json({ message: "Client not found" });
    }

    const numericYear = parseInt(year);
    const numericMonth = parseInt(month);
    let monthData = null;
    let dataSource = null;

    // FIRST: Try to get from NEW ClientMonthlyData collection
    try {
      const ClientMonthlyData = require("../models/ClientMonthlyData");
      const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });

      if (newDoc && newDoc.months) {
        const foundMonth = newDoc.months.find(m => m.year === numericYear && m.month === numericMonth);
        if (foundMonth) {
          // Convert to same format as old structure for compatibility
          monthData = {
            sales: foundMonth.sales || { files: [], isLocked: false },
            purchase: foundMonth.purchase || { files: [], isLocked: false },
            bank: foundMonth.bank || { files: [], isLocked: false },
            other: foundMonth.other || [],
            isLocked: foundMonth.isLocked || false,
            lockedAt: foundMonth.lockedAt || null,
            lockedBy: foundMonth.lockedBy || null,
            autoLockDate: foundMonth.autoLockDate || null,
            accountingDone: foundMonth.accountingDone || false,
            accountingDoneAt: foundMonth.accountingDoneAt || null,
            accountingDoneBy: foundMonth.accountingDoneBy || null
          };
          dataSource = 'new';
          logToConsole("DEBUG", "MONTH_DATA_FROM_NEW_COLLECTION", { clientId, year, month });
        }
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_GETTING_NEW_MONTH_DATA", { error: err.message });
    }

    // SECOND: If not found in NEW, get from OLD client.documents
    if (!monthData) {
      const yearKey = String(year);
      const monthKey = String(month);

      if (client.documents && client.documents.get(yearKey) && client.documents.get(yearKey).get(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        dataSource = 'old';
        if (monthData.other && !Array.isArray(monthData.other)) {
          monthData.other = Array.from(monthData.other?.values() || []);
        }
        ['sales', 'purchase', 'bank'].forEach(categoryType => {
          if (monthData[categoryType] && !monthData[categoryType].files) {
            monthData[categoryType].files = [];
          }
        });
        logToConsole("DEBUG", "MONTH_DATA_FROM_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      logToConsole("WARN", "MONTH_DATA_NOT_FOUND_FILES", {
        clientId,
        year,
        month
      });
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    // Get employee names for all notes (rest of the function remains SAME)
    const employeeMap = new Map();
    const employeeIds = new Set();

    const collectEmployeeIds = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;
      notesArray.forEach(note => {
        if (note.employeeId) employeeIds.add(note.employeeId);
        if (note.addedBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
          employeeIds.add(note.addedBy);
        }
      });
    };

    ['sales', 'purchase', 'bank'].forEach(categoryType => {
      const category = monthData[categoryType];
      if (category && category.categoryNotes) {
        collectEmployeeIds(category.categoryNotes);
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat.document && otherCat.document.categoryNotes) {
          collectEmployeeIds(otherCat.document.categoryNotes);
        }
      });
    }

    ['sales', 'purchase', 'bank'].forEach(categoryType => {
      const category = monthData[categoryType];
      if (category && category.files && Array.isArray(category.files)) {
        category.files.forEach(file => {
          collectEmployeeIds(file.notes);
        });
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat.document && otherCat.document.files && Array.isArray(otherCat.document.files)) {
          otherCat.document.files.forEach(file => {
            collectEmployeeIds(file.notes);
          });
        }
      });
    }

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

    const populateEmployeeNames = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;

      notesArray.forEach(note => {
        if (note.employeeId && employeeMap.has(note.employeeId)) {
          note.employeeName = employeeMap.get(note.employeeId);
        }
        else if (!note.employeeName && note.addedBy) {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
            if (employeeMap.has(note.addedBy)) {
              note.employeeName = employeeMap.get(note.addedBy);
            }
          }
          else if (typeof note.addedBy === 'string' && note.addedBy.trim().length > 0) {
            note.employeeName = note.addedBy;
          }
        }

        if (!note.employeeName) {
          note.employeeName = note.addedBy || 'Unknown';
        }
      });
    };

    const response = {
      period: `${month}/${year}`,
      clientId,
      clientName: client.name,
      categories: {}
    };

    const mainCategories = ['sales', 'purchase', 'bank'];
    mainCategories.forEach(categoryType => {
      const category = monthData[categoryType];
      if (category) {
        let categoryNotes = [];
        let totalCategoryNotes = 0;

        if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
          categoryNotes = [...category.categoryNotes];
          totalCategoryNotes = categoryNotes.length;
          populateEmployeeNames(categoryNotes);
        }

        let filesData = [];
        let totalFileNotes = 0;

        if (category.files && Array.isArray(category.files)) {
          filesData = category.files.map(file => {
            const fileNotes = file.notes ? [...file.notes] : [];
            totalFileNotes += fileNotes.length;
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
          categoryNotes: categoryNotes,
          totalCategoryNotes: totalCategoryNotes,
          totalFileNotes: totalFileNotes,
          totalNotes: totalCategoryNotes + totalFileNotes,
          isLocked: category.isLocked || false
        };
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      response.categories.other = monthData.other.map(otherCat => {
        const document = otherCat.document || {};

        let categoryNotes = [];
        let totalCategoryNotes = 0;

        if (document.categoryNotes && Array.isArray(document.categoryNotes)) {
          categoryNotes = [...document.categoryNotes];
          totalCategoryNotes = categoryNotes.length;
          populateEmployeeNames(categoryNotes);
        }

        let filesData = [];
        let totalFileNotes = 0;

        if (document.files && Array.isArray(document.files)) {
          filesData = document.files.map(file => {
            const fileNotes = file.notes ? [...file.notes] : [];
            totalFileNotes += fileNotes.length;
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
          categoryNotes: categoryNotes,
          totalCategoryNotes: totalCategoryNotes,
          totalFileNotes: totalFileNotes,
          totalNotes: totalCategoryNotes + totalFileNotes,
          isLocked: document.isLocked || false
        };
      });
    }

    let totalFiles = 0;
    let totalFileNotes = 0;
    let totalCategoryNotes = 0;

    Object.values(response.categories).forEach(cat => {
      if (Array.isArray(cat)) {
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


    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "VIEWED_ASSIGNMENT_FILES",
        details: `Employee viewed files for client ${client.name} (${month}/${year})`,
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
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
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

    logToConsole("INFO", "GET_FILE_NOTES_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      ip: req.ip
    });

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

    const client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_GET_NOTES", { clientId });
      return res.status(404).json({ message: "Client not found" });
    }

    const numericYear = parseInt(year);
    const numericMonth = parseInt(month);
    let monthData = null;

    // FIRST: Try to get from NEW ClientMonthlyData collection
    try {
      const ClientMonthlyData = require("../models/ClientMonthlyData");
      const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });

      if (newDoc && newDoc.months) {
        const foundMonth = newDoc.months.find(m => m.year === numericYear && m.month === numericMonth);
        if (foundMonth) {
          monthData = {
            sales: foundMonth.sales || { files: [], isLocked: false },
            purchase: foundMonth.purchase || { files: [], isLocked: false },
            bank: foundMonth.bank || { files: [], isLocked: false },
            other: foundMonth.other || [],
            isLocked: foundMonth.isLocked || false
          };
          if (monthData.other && !Array.isArray(monthData.other)) {
            monthData.other = Array.from(monthData.other?.values() || []);
          }
          logToConsole("DEBUG", "FILE_NOTES_FROM_NEW_COLLECTION", { clientId, year, month });
        }
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_GETTING_NEW_MONTH_DATA_FOR_NOTES", { error: err.message });
    }

    // SECOND: If not found in NEW, get from OLD client.documents
    if (!monthData) {
      const yearKey = String(year);
      const monthKey = String(month);

      if (client.documents && client.documents.get(yearKey) && client.documents.get(yearKey).get(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        if (monthData.other && !Array.isArray(monthData.other)) {
          monthData.other = Array.from(monthData.other?.values() || []);
        }
        logToConsole("DEBUG", "FILE_NOTES_FROM_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      logToConsole("WARN", "MONTH_DATA_NOT_FOUND_GET_NOTES", {
        clientId,
        year,
        month
      });
      return res.status(404).json({
        message: `No data found for ${month}/${year}`
      });
    }

    let file = null;
    let categoryPath = "";

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

    try {
      await ActivityLog.create({
        userName: employeeName,
        role: "EMPLOYEE",
        employeeId: employeeId,
        clientId: clientId,
        action: "VIEWED_FILE_NOTES",
        details: `Employee viewed notes for file "${fileName}" in ${categoryPath} for client ${client.name}`,
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
   NOW USES fileUrl AS UNIQUE IDENTIFIER
================================ */
router.get("/check-file-viewed", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl  // ← NEW: Required parameter
    } = req.query;

    logToConsole("INFO", "CHECK_FILE_VIEWED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,
      ip: req.ip
    });

    // VALIDATION: fileUrl is now required
    if (!clientId || !year || !month || !categoryType || !fileName || !fileUrl) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, fileUrl"
      });
    }

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

    let isViewed = false;
    let viewedAt = null;
    let lastCheckedAt = null;
    let foundIn = null;

    // ===== FIRST: Check NEW COLLECTION using fileUrl =====
    const viewedDoc = await EmployeeViewedFile.findOne({ employeeId: employee.employeeId });

    if (viewedDoc) {
      const viewedFile = viewedDoc.viewedFiles.find(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );

      if (viewedFile) {
        isViewed = true;
        viewedAt = viewedFile.viewedAt;
        lastCheckedAt = viewedFile.lastCheckedAt;
        foundIn = "new_collection";
      }
    }

    // ===== SECOND: If not found, check OLD COLLECTION using fileUrl =====
    if (!isViewed) {
      const oldViewedFile = employee.viewedFiles.find(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );

      if (oldViewedFile) {
        isViewed = true;
        viewedAt = oldViewedFile.viewedAt;
        lastCheckedAt = oldViewedFile.lastCheckedAt;
        foundIn = "old_collection";
      }
    }



    res.json({
      isViewed,
      viewedAt,
      lastCheckedAt,
      foundIn
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
   NOW USES fileUrl AS UNIQUE IDENTIFIER
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
      fileUrl,  // ← NOW REQUIRED for unique identification
      task
    } = req.body;

    logToConsole("INFO", "TOGGLE_FILE_VIEWED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,
      task,
      ip: req.ip
    });

    // VALIDATION: fileUrl is now required
    if (!clientId || !year || !month || !categoryType || !fileName || !fileUrl) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, fileUrl"
      });
    }

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

    let action = "";
    let viewedFileObj = null;
    let updatedIn = null;

    // ===== CHECK OLD COLLECTION (Employee.viewedFiles) using fileUrl =====
    const oldIndex = employee.viewedFiles.findIndex(f =>
      f.clientId === clientId &&
      f.year === parseInt(year) &&
      f.month === parseInt(month) &&
      f.categoryType === categoryType &&
      f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
    );

    const existsInOld = oldIndex !== -1;

    // ===== CHECK NEW COLLECTION (EmployeeViewedFile) using fileUrl =====
    let viewedDoc = await EmployeeViewedFile.findOne({ employeeId: employee.employeeId });
    let newIndex = -1;

    if (viewedDoc) {
      newIndex = viewedDoc.viewedFiles.findIndex(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );
    }

    const existsInNew = newIndex !== -1;



    // ===== DECISION LOGIC =====
    if (existsInOld && !existsInNew) {
      // File exists ONLY in OLD - toggle in OLD
      employee.viewedFiles.splice(oldIndex, 1);
      await employee.save();
      action = "REMOVED";
      updatedIn = "old_collection";
      logToConsole("DEBUG", "REMOVED_FROM_OLD_VIEWED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else if (!existsInOld && existsInNew) {
      // File exists ONLY in NEW - toggle in NEW
      viewedDoc.viewedFiles.splice(newIndex, 1);
      await viewedDoc.save();
      action = "REMOVED";
      updatedIn = "new_collection";
      logToConsole("DEBUG", "REMOVED_FROM_NEW_VIEWED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else if (existsInOld && existsInNew) {
      // File exists in BOTH - toggle in BOTH
      employee.viewedFiles.splice(oldIndex, 1);
      viewedDoc.viewedFiles.splice(newIndex, 1);
      await employee.save();
      await viewedDoc.save();
      action = "REMOVED";
      updatedIn = "both_collections";
      logToConsole("DEBUG", "REMOVED_FROM_BOTH_VIEWED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else {
      // File exists in NEITHER - ADD to NEW collection only
      if (!viewedDoc) {
        viewedDoc = new EmployeeViewedFile({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          employeeEmail: employee.email,
          viewedFiles: []
        });
      }

      viewedFileObj = {
        clientId,
        year: parseInt(year),
        month: parseInt(month),
        categoryType,
        fileName,
        fileUrl,  // ← Store fileUrl as unique identifier
        viewedAt: new Date(),
        lastCheckedAt: new Date()
      };

      if (categoryType === 'other' && categoryName) {
        viewedFileObj.categoryName = categoryName;
      }

      if (task) {
        viewedFileObj.task = task;
      }

      viewedDoc.viewedFiles.push(viewedFileObj);
      viewedDoc.employeeName = employee.name;
      viewedDoc.employeeEmail = employee.email;
      await viewedDoc.save();
      action = "ADDED";
      updatedIn = "new_collection";
      logToConsole("DEBUG", "ADDED_TO_NEW_VIEWED", { employeeId: employee.employeeId, fileName, fileUrl });
    }

    // Create activity log
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId,
        action: action === "ADDED" ? "FILE_MARKED_VIEWED" : "FILE_MARKED_UNVIEWED",
        details: `Employee ${action === "ADDED" ? 'marked' : 'unmarked'} file "${fileName}" as viewed`,
        metadata: {
          clientId, year, month, categoryType, categoryName, fileName, fileUrl,
          action, updatedIn, timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
    }

    logToConsole("SUCCESS", "FILE_VIEWED_TOGGLED", {
      employeeId: employee.employeeId,
      fileName,
      fileUrl,
      action,
      updatedIn
    });

    res.json({
      message: action === "ADDED" ? "File marked as viewed" : "File marked as not viewed",
      isViewed: action === "ADDED",
      action,
      updatedIn,
      viewedAt: viewedFileObj?.viewedAt
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



/* ===============================
   CHECK IF FILE IS AUDITED BY EMPLOYEE
   NOW USES fileUrl AS UNIQUE IDENTIFIER
================================ */
router.get("/check-file-audited", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl  // ← NEW: Required parameter
    } = req.query;

    logToConsole("INFO", "CHECK_FILE_AUDITED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,
      ip: req.ip
    });

    // VALIDATION: fileUrl is now required
    if (!clientId || !year || !month || !categoryType || !fileName || !fileUrl) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, fileUrl"
      });
    }

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

    let isAudited = false;
    let auditedAt = null;
    let lastCheckedAt = null;
    let foundIn = null;

    // ===== FIRST: Check NEW COLLECTION using fileUrl =====
    const auditedDoc = await EmployeeAuditedFile.findOne({ employeeId: employee.employeeId });

    if (auditedDoc) {
      const auditedFile = auditedDoc.auditedFiles.find(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );

      if (auditedFile) {
        isAudited = true;
        auditedAt = auditedFile.auditedAt;
        lastCheckedAt = auditedFile.lastCheckedAt;
        foundIn = "new_collection";
      }
    }

    // ===== SECOND: If not found, check OLD COLLECTION using fileUrl =====
    if (!isAudited) {
      const oldAuditedFile = employee.auditedFiles.find(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );

      if (oldAuditedFile) {
        isAudited = true;
        auditedAt = oldAuditedFile.auditedAt;
        lastCheckedAt = oldAuditedFile.lastCheckedAt;
        foundIn = "old_collection";
      }
    }



    res.json({
      isAudited,
      auditedAt,
      lastCheckedAt,
      foundIn
    });

  } catch (error) {
    logToConsole("ERROR", "CHECK_FILE_AUDITED_ERROR", {
      error: error.message,
      query: req.query,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid token", clearedCookie: true });
    }

    res.status(500).json({
      message: "Error checking file audited status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


/* ===============================
   MARK FILE AS AUDITED/UN-AUDITED (TOGGLE)
   NOW USES fileUrl AS UNIQUE IDENTIFIER
================================ */
router.post("/toggle-file-audited", async (req, res) => {
  try {
    const {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,  // ← NOW REQUIRED for unique identification
      task
    } = req.body;

    logToConsole("INFO", "TOGGLE_FILE_AUDITED_REQUEST", {
      clientId,
      year,
      month,
      categoryType,
      categoryName,
      fileName,
      fileUrl,
      task,
      ip: req.ip
    });

    // VALIDATION: fileUrl is now required
    if (!clientId || !year || !month || !categoryType || !fileName || !fileUrl) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month, categoryType, fileName, fileUrl"
      });
    }

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

    let action = "";
    let auditedFileObj = null;
    let updatedIn = null;

    // ===== CHECK OLD COLLECTION (Employee.auditedFiles) using fileUrl =====
    const oldIndex = employee.auditedFiles.findIndex(f =>
      f.clientId === clientId &&
      f.year === parseInt(year) &&
      f.month === parseInt(month) &&
      f.categoryType === categoryType &&
      f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
    );

    const existsInOld = oldIndex !== -1;

    // ===== CHECK NEW COLLECTION (EmployeeAuditedFile) using fileUrl =====
    let auditedDoc = await EmployeeAuditedFile.findOne({ employeeId: employee.employeeId });
    let newIndex = -1;

    if (auditedDoc) {
      newIndex = auditedDoc.auditedFiles.findIndex(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month) &&
        f.categoryType === categoryType &&
        f.fileUrl === fileUrl  // ← USE fileUrl INSTEAD OF fileName
      );
    }

    const existsInNew = newIndex !== -1;



    // ===== DECISION LOGIC =====
    if (existsInOld && !existsInNew) {
      // File exists ONLY in OLD - toggle in OLD
      employee.auditedFiles.splice(oldIndex, 1);
      await employee.save();
      action = "REMOVED";
      updatedIn = "old_collection";
      logToConsole("DEBUG", "REMOVED_FROM_OLD_AUDITED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else if (!existsInOld && existsInNew) {
      // File exists ONLY in NEW - toggle in NEW
      auditedDoc.auditedFiles.splice(newIndex, 1);
      await auditedDoc.save();
      action = "REMOVED";
      updatedIn = "new_collection";
      logToConsole("DEBUG", "REMOVED_FROM_NEW_AUDITED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else if (existsInOld && existsInNew) {
      // File exists in BOTH - toggle in BOTH
      employee.auditedFiles.splice(oldIndex, 1);
      auditedDoc.auditedFiles.splice(newIndex, 1);
      await employee.save();
      await auditedDoc.save();
      action = "REMOVED";
      updatedIn = "both_collections";
      logToConsole("DEBUG", "REMOVED_FROM_BOTH_AUDITED", { employeeId: employee.employeeId, fileName, fileUrl });
    }
    else {
      // File exists in NEITHER - ADD to NEW collection only
      if (!auditedDoc) {
        auditedDoc = new EmployeeAuditedFile({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          employeeEmail: employee.email,
          auditedFiles: []
        });
      }

      auditedFileObj = {
        clientId,
        year: parseInt(year),
        month: parseInt(month),
        categoryType,
        fileName,
        fileUrl,  // ← Store fileUrl as unique identifier
        auditedAt: new Date(),
        lastCheckedAt: new Date()
      };

      if (categoryType === 'other' && categoryName) {
        auditedFileObj.categoryName = categoryName;
      }

      if (task) {
        auditedFileObj.task = task;
      }

      auditedDoc.auditedFiles.push(auditedFileObj);
      auditedDoc.employeeName = employee.name;
      auditedDoc.employeeEmail = employee.email;
      await auditedDoc.save();
      action = "ADDED";
      updatedIn = "new_collection";
      logToConsole("DEBUG", "ADDED_TO_NEW_AUDITED", { employeeId: employee.employeeId, fileName, fileUrl });
    }

    // Create activity log
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        clientId,
        action: action === "ADDED" ? "FILE_MARKED_AUDITED" : "FILE_MARKED_UNAUDITED",
        details: `Employee ${action === "ADDED" ? 'marked' : 'unmarked'} file "${fileName}" as audited`,
        metadata: {
          clientId, year, month, categoryType, categoryName, fileName, fileUrl,
          action, updatedIn, timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
    }

    logToConsole("SUCCESS", "FILE_AUDITED_TOGGLED", {
      employeeId: employee.employeeId,
      fileName,
      fileUrl,
      action,
      updatedIn
    });

    res.json({
      message: action === "ADDED" ? "File marked as audited" : "File marked as not audited",
      isAudited: action === "ADDED",
      action,
      updatedIn,
      auditedAt: auditedFileObj?.auditedAt
    });

  } catch (error) {
    logToConsole("ERROR", "TOGGLE_FILE_AUDITED_ERROR", {
      error: error.message,
      body: req.body,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid token", clearedCookie: true });
    }

    res.status(500).json({
      message: "Error toggling file audited status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


/* ===============================
   GET ALL AUDITED FILES FOR AN ASSIGNMENT
   NOW READS FROM BOTH OLD AND NEW COLLECTIONS
================================ */
router.get("/assignment-audited-files", async (req, res) => {
  try {
    const { clientId, year, month } = req.query;

    logToConsole("INFO", "GET_ASSIGNMENT_AUDITED_FILES_REQUEST", {
      clientId,
      year,
      month,
      ip: req.ip
    });

    if (!clientId || !year || !month) {
      return res.status(400).json({
        message: "Missing required parameters: clientId, year, month"
      });
    }

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

    const auditedFilesList = [];
    const auditedMap = {};

    // ===== FIRST: Get from OLD COLLECTION =====
    const oldAuditedFiles = employee.auditedFiles.filter(f =>
      f.clientId === clientId &&
      f.year === parseInt(year) &&
      f.month === parseInt(month)
    );

    for (const file of oldAuditedFiles) {
      const key = `${file.categoryType}-${file.categoryName || 'main'}-${file.fileName}`;
      auditedMap[key] = { ...file.toObject?.() || file, source: 'old' };
      auditedFilesList.push({ ...file.toObject?.() || file, source: 'old' });
    }

    // ===== SECOND: Get from NEW COLLECTION =====
    const auditedDoc = await EmployeeAuditedFile.findOne({ employeeId: employee.employeeId });

    if (auditedDoc) {
      const newAuditedFiles = auditedDoc.auditedFiles.filter(f =>
        f.clientId === clientId &&
        f.year === parseInt(year) &&
        f.month === parseInt(month)
      );

      for (const file of newAuditedFiles) {
        const key = `${file.categoryType}-${file.categoryName || 'main'}-${file.fileName}`;
        // New collection overrides old if same key exists
        auditedMap[key] = { ...file, source: 'new' };
      }
    }

    // Convert map back to array (unique, new collection takes priority)
    const finalAuditedFiles = Object.values(auditedMap);

    

    res.json({
      success: true,
      auditedFiles: finalAuditedFiles,
      auditedMap: auditedMap,
      totalAudited: finalAuditedFiles.length
    });

  } catch (error) {
    logToConsole("ERROR", "GET_ASSIGNMENT_AUDITED_FILES_ERROR", {
      error: error.message,
      query: req.query,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid token", clearedCookie: true });
    }

    res.status(500).json({
      message: "Error fetching audited files",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});





/* ===============================
   GET ALL CLIENTS WITH LAST 6 MONTHS PAYMENT STATUS - OPTIMIZED
   NOW USES BATCH QUERIES (600 queries → 3 queries)
================================ */
router.get("/all-clients-payment-status", async (req, res) => {
  try {
    const { search } = req.query;
    const token = req.cookies?.employeeToken;

    logToConsole("INFO", "GET_ALL_CLIENTS_PAYMENT_REQUEST_OPTIMIZED", {
      search: search || 'none',
      ip: req.ip
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_CLIENTS_PAYMENT", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized - No token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_CLIENTS_PAYMENT", {
        error: jwtError.message
      });
      res.clearCookie("employeeToken");
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      logToConsole("ERROR", "EMPLOYEE_NOT_FOUND_CLIENTS_PAYMENT", {
        employeeId: decoded.employeeId
      });
      return res.status(404).json({ message: "Employee not found" });
    }

    // ============= STEP 1: Generate last 6 months =============
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    const last6Months = [];
    for (let i = 0; i < 6; i++) {
      let year = currentYear;
      let month = currentMonth - i;

      if (month <= 0) {
        month += 12;
        year -= 1;
      }

      last6Months.push({
        year,
        month,
        key: `${year}-${month}`
      });
    }

    logToConsole("DEBUG", "LAST_6_MONTHS_GENERATED", {
      months: last6Months.map(m => `${m.month}/${m.year}`)
    });

    // ============= STEP 2: Build search query =============
    const query = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { clientId: searchRegex }
      ];
    }

    // ============= STEP 3: Get ALL clients in ONE query =============
    const clients = await Client.find(query)
      .select('name email clientId documents')
      .lean();

    logToConsole("DEBUG", "CLIENTS_FETCHED", {
      totalClients: clients.length,
      searchApplied: !!search
    });

    if (clients.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: {
          total: 0,
          months: last6Months.map(m => ({ year: m.year, month: m.month })),
          searchApplied: !!search
        }
      });
    }

    const clientIds = clients.map(c => c.clientId);

    // ============= STEP 4: BATCH QUERY - Get ALL payment statuses from NEW collection in ONE go =============
    const ClientMonthlyData = require("../models/ClientMonthlyData");
    const allMonthlyData = await ClientMonthlyData.find({
      clientId: { $in: clientIds }
    }).lean();

    // Build payment map for O(1) lookup
    // Key format: "clientId-year-month"
    const paymentMap = new Map();

    for (const record of allMonthlyData) {
      if (record.months && Array.isArray(record.months)) {
        for (const month of record.months) {
          if (month.paymentStatus !== undefined) {
            const key = `${record.clientId}-${month.year}-${month.month}`;
            paymentMap.set(key, month.paymentStatus === true);
          }
        }
      }
    }

    logToConsole("DEBUG", "PAYMENT_DATA_LOADED_FROM_NEW_COLLECTION", {
      totalRecords: allMonthlyData.length,
      paymentMapSize: paymentMap.size
    });

    // ============= STEP 5: Build OLD documents payment map (fallback) =============
    // Process OLD client.documents for clients where payment not found in NEW collection
    const oldPaymentMap = new Map();

    for (const client of clients) {
      if (client.documents && typeof client.documents === 'object') {
        for (const [yearKey, yearData] of Object.entries(client.documents)) {
          if (yearData && typeof yearData === 'object') {
            for (const [monthKey, monthData] of Object.entries(yearData)) {
              if (monthData && monthData.paymentStatus !== undefined) {
                const key = `${client.clientId}-${yearKey}-${monthKey}`;
                // Only add if not already in new collection
                if (!paymentMap.has(key)) {
                  oldPaymentMap.set(key, monthData.paymentStatus === true);
                }
              }
            }
          }
        }
      }
    }

    // Merge old into main map (new collection takes priority)
    for (const [key, value] of oldPaymentMap) {
      if (!paymentMap.has(key)) {
        paymentMap.set(key, value);
      }
    }

    logToConsole("DEBUG", "TOTAL_PAYMENT_DATA_LOADED", {
      fromNewCollection: allMonthlyData.length,
      fromOldCollection: oldPaymentMap.size,
      totalUnique: paymentMap.size
    });

    // ============= STEP 6: Process all clients in memory (NO PER-CLIENT DB CALLS!) =============
    const response = [];

    for (const client of clients) {
      const paymentStatus = {};

      // For each of the last 6 months, lookup in map (O(1) operation)
      for (const { year, month, key } of last6Months) {
        const lookupKey = `${client.clientId}-${year}-${month}`;
        const isPaid = paymentMap.get(lookupKey) || false;
        paymentStatus[key] = isPaid;
      }

      response.push({
        clientId: client.clientId,
        name: client.name || 'No Name',
        email: client.email || 'No Email',
        paymentStatus
      });
    }

    // Sort clients by name
    response.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // ============= STEP 7: Activity Log =============
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "VIEWED_ALL_CLIENTS_PAYMENT_STATUS",
        details: `Employee viewed payment status for all clients (last 6 months)`,
        metadata: {
          totalClients: response.length,
          searchApplied: !!search,
          searchTerm: search || null,
          monthsRequested: last6Months.map(m => `${m.month}/${m.year}`),
          performance: {
            paymentRecordsLoaded: paymentMap.size,
            clientsProcessed: response.length
          }
        }
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
    }

    logToConsole("SUCCESS", "ALL_CLIENTS_PAYMENT_STATUS_FETCHED_OPTIMIZED", {
      employeeId: employee.employeeId,
      totalClients: response.length,
      monthsIncluded: last6Months.length,
      paymentRecordsLoaded: paymentMap.size,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      data: response,
      meta: {
        total: response.length,
        months: last6Months.map(m => ({ year: m.year, month: m.month })),
        searchApplied: !!search
      },
      performance: {
        paymentRecordsLoaded: paymentMap.size,
        clientsProcessed: response.length
      }
    });

  } catch (error) {
    logToConsole("ERROR", "ALL_CLIENTS_PAYMENT_STATUS_ERROR", {
      error: error.message,
      stack: error.stack,
      query: req.query,
      ip: req.ip
    });

    res.status(500).json({
      success: false,
      message: "Error fetching clients payment status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;