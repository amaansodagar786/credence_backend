const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const ActivityLog = require("../models/ActivityLog");
const auth = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");
const EmployeeTaskLog = require("../models/EmployeeTaskLog");

const router = express.Router();

const Client = require("../models/Client");

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

// Old log function for compatibility (saves to ActivityLog AND logs to console)
const log = async (name, action, details) => {
  try {
    // Save to ActivityLog collection
    await ActivityLog.create({
      userName: name,
      role: "ADMIN",
      action,
      details,
      dateTime: new Date().toLocaleString("en-IN")
    });

    // Also log to console
    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      userName: name,
      action,
      details
    });
  } catch (logError) {
    logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
      error: logError.message,
      userName: name,
      action
    });
  }
};

/* ===============================
   ADMIN REGISTER
================================ */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Console log: Admin registration attempt
    logToConsole("INFO", "ADMIN_REGISTER_REQUEST", {
      email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!name || !email || !password) {
      logToConsole("WARN", "MISSING_FIELDS_ADMIN_REGISTER", {
        name: !!name,
        email: !!email,
        password: !!password
      });

      // Save warning to ActivityLog
      await log("SYSTEM", "ADMIN_REGISTER_VALIDATION_FAILED", `Missing fields for admin register: ${email}`);

      return res.status(400).json({ message: "All fields are required" });
    }

    const exists = await Admin.findOne({ email });
    if (exists) {
      logToConsole("WARN", "ADMIN_ALREADY_EXISTS", { email });

      // Save warning to ActivityLog
      await log("SYSTEM", "ADMIN_REGISTER_DUPLICATE", `Admin already exists: ${email}`);

      return res.status(400).json({ message: "Admin exists" });
    }

    // Console log: Creating admin
    logToConsole("INFO", "CREATING_ADMIN_ACCOUNT", { name, email });

    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ name, email, password: hashed });

    // Console log: Admin created
    logToConsole("SUCCESS", "ADMIN_CREATED_SUCCESSFULLY", {
      adminId: admin._id,
      name: admin.name,
      email: admin.email
    });

    // Save success to ActivityLog
    await log(name, "ADMIN_REGISTER", `Admin ${email} registered successfully`);

    // Console log: Registration complete
    logToConsole("SUCCESS", "ADMIN_REGISTRATION_COMPLETE", {
      name,
      email,
      timestamp: new Date().toISOString()
    });

    res.json({ message: "Admin registered" });

  } catch (error) {
    // Console log: Registration error
    logToConsole("ERROR", "ADMIN_REGISTER_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/register",
      body: req.body
    });

    // Save error to ActivityLog
    await log("SYSTEM", "ADMIN_REGISTER_ERROR", `Error registering admin: ${error.message}`);

    res.status(500).json({
      message: "Error registering admin",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   ADMIN LOGIN
================================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Console log: Admin login attempt
    logToConsole("INFO", "ADMIN_LOGIN_REQUEST", {
      email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!email || !password) {
      logToConsole("WARN", "MISSING_CREDENTIALS_ADMIN_LOGIN", {
        email: !!email,
        password: !!password
      });

      // Save warning to ActivityLog
      await log("SYSTEM", "ADMIN_LOGIN_VALIDATION_FAILED", `Missing credentials for admin login: ${email}`);

      return res.status(400).json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      logToConsole("WARN", "ADMIN_NOT_FOUND", { email });

      // Save warning to ActivityLog
      await log("SYSTEM", "ADMIN_LOGIN_NOT_FOUND", `Admin not found: ${email}`);

      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ===== DEBUG: Check what's actually in admin document =====
    console.log("DEBUG ADMIN DATA:", {
      _id: admin._id,
      adminId: admin.adminId, // This should be "a22c72f6-9f23-4200-ba88-941290e300dc"
      hasAdminIdField: !!admin.adminId,
      name: admin.name,
      email: admin.email
    });

    // Console log: Admin found
    logToConsole("DEBUG", "ADMIN_FOUND", {
      _id: admin._id, // Changed from adminId to _id for clarity
      adminId: admin.adminId, // Add this to see actual adminId
      name: admin.name
    });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) {
      logToConsole("WARN", "INVALID_ADMIN_PASSWORD", {
        email,
        adminId: admin._id
      });

      // Save warning to ActivityLog
      await log(admin.name, "ADMIN_LOGIN_FAILED", `Invalid password attempt for admin: ${email}`);

      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Console log: Password match successful
    logToConsole("SUCCESS", "ADMIN_PASSWORD_MATCH", {
      adminId: admin._id,
      name: admin.name
    });

    // ===== FIXED JWT GENERATION =====
    // Use admin.adminId if it exists, otherwise fallback to admin._id
    const tokenAdminId = admin.adminId || admin._id.toString();

    console.log("JWT PAYLOAD WILL CONTAIN:", {
      adminId: tokenAdminId,
      type: typeof tokenAdminId,
      isUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenAdminId),
      isObjectId: /^[0-9a-f]{24}$/i.test(tokenAdminId)
    });

    const token = jwt.sign(
      {
        adminId: tokenAdminId, // This should be the UUID
        name: admin.name,
        role: "ADMIN",
        email: admin.email // Add email for extra verification
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // ===== DEBUG: Verify what's in the token =====
    const decodedToken = jwt.decode(token);
    console.log("ACTUAL JWT DECODED:", decodedToken);

    // Console log: JWT token created
    logToConsole("DEBUG", "ADMIN_JWT_TOKEN_CREATED", {
      adminIdInToken: decodedToken.adminId, // Log what's actually in token
      adminIdFromDB: admin.adminId,
      _idFromDB: admin._id,
      expiresIn: "1d"
    });

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: true,        // REQUIRED on HTTPS
      sameSite: "none",    // REQUIRED for Vercel ↔ Render
      maxAge: 24 * 60 * 60 * 1000
    });


    // Console log: Cookie set
    logToConsole("INFO", "ADMIN_COOKIE_SET", {
      adminId: admin._id,
      cookieName: "accessToken"
    });

    // Save success to ActivityLog
    await log(admin.name, "ADMIN_LOGIN", "Admin logged in successfully");

    // Console log: Login successful
    logToConsole("SUCCESS", "ADMIN_LOGIN_SUCCESS", {
      adminId: admin._id,
      adminUUID: admin.adminId, // Add UUID to log
      name: admin.name,
      email: admin.email,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Login success",
      admin: {
        name: admin.name,
        email: admin.email,
        adminId: admin.adminId || admin._id // Send both to frontend for debugging
      }
    });

  } catch (error) {
    // Console log: Login error
    logToConsole("ERROR", "ADMIN_LOGIN_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/login",
      email: req.body?.email
    });

    // Save error to ActivityLog
    await log("SYSTEM", "ADMIN_LOGIN_ERROR", `Error during admin login: ${error.message}`);

    res.status(500).json({
      message: "Error during login",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   CHECK ADMIN LOGIN (GET CURRENT USER)
================================ */
router.get("/me", auth, async (req, res) => {
  try {


    console.log("🔍 /me ENDPOINT DEBUG:");
    console.log("Full req.user:", req.user);
    console.log("req.user.adminId:", req.user?.adminId);
    console.log("req.user.id:", req.user?.id);
    console.log("req.user type:", typeof req.user?.adminId);

    // Console log: Admin auth check request
    logToConsole("INFO", "ADMIN_AUTH_CHECK_REQUEST", {
      adminId: req.user?.adminId || req.user?.id,  // ← FIXED!
      adminName: req.user?.name,
      ip: req.ip
    });

    const admin = await Admin.findOne({ adminId: req.user.adminId }).select("-password");

    if (!admin) {
      logToConsole("ERROR", "ADMIN_NOT_FOUND_IN_DB", {
        requestedId: req.user.id,
        adminName: req.user.name
      });

      // Save error to ActivityLog
      await log("SYSTEM", "ADMIN_NOT_FOUND_IN_DB", `Admin not found in database: ${req.user.id}`);

      // Clear invalid cookie
      res.clearCookie("accessToken");

      return res.status(404).json({
        message: "Admin not found in database",
        clearedCookie: true
      });
    }

    // Console log: Admin data fetched
    logToConsole("SUCCESS", "ADMIN_DATA_FETCHED", {
      adminId: admin._id,
      name: admin.name,
      email: admin.email
    });

    // Save success to ActivityLog
    await log(admin.name, "ADMIN_AUTH_CHECK", "Admin authentication checked successfully");

    res.json(admin);

  } catch (error) {
    // Console log: Auth check error
    logToConsole("ERROR", "ADMIN_ME_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/me",
      adminId: req.user?.id
    });

    // Save error to ActivityLog
    await log("SYSTEM", "ADMIN_AUTH_CHECK_ERROR", `Error checking admin authentication: ${error.message}`);

    res.status(500).json({
      message: "Error checking authentication",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   ADMIN LOGOUT
================================ */

router.post("/logout", async (req, res) => {
  try {
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/api"   // 🔥 THIS IS THE FIX
    });


    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    // even if error, force clear
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/"
    });

    return res.status(200).json({
      success: true,
      message: "Logged out (forced)"
    });
  }
});


/* ===============================
   GET ALL EMPLOYEE TASK LOGS (ADMIN ONLY)
================================ */
router.get("/task-logs", auth, async (req, res) => {
  try {
    // Console log: Admin task logs request
    logToConsole("INFO", "ADMIN_TASK_LOGS_REQUEST", {
      adminId: req.user.id,
      adminName: req.user.name,
      ip: req.ip
    });

    // Console log: Fetching task logs
    logToConsole("INFO", "FETCHING_EMPLOYEE_TASK_LOGS", {
      adminId: req.user.id
    });

    const logs = await EmployeeTaskLog.find()
      .sort({ createdAt: -1 });

    // Console log: Task logs fetched
    logToConsole("SUCCESS", "TASK_LOGS_FETCHED_SUCCESSFULLY", {
      adminId: req.user.id,
      totalLogs: logs.length,
      completedLogs: logs.filter(l => l.status === "COMPLETED").length,
      inProgressLogs: logs.filter(l => l.status === "IN_PROGRESS").length,
      uniqueEmployees: [...new Set(logs.map(l => l.employeeId))].length
    });

    // Save success to ActivityLog
    await log(req.user.name, "FETCHED_EMPLOYEE_TASK_LOGS", `Fetched ${logs.length} employee task logs`);

    // Console log: Response sent
    logToConsole("SUCCESS", "TASK_LOGS_RESPONSE_SENT", {
      adminId: req.user.id,
      totalLogs: logs.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      total: logs.length,
      logs
    });

  } catch (error) {
    // Console log: Task logs error
    logToConsole("ERROR", "ADMIN_TASK_LOGS_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/task-logs",
      adminId: req.user?.id
    });

    // Save error to ActivityLog
    await log(req.user?.name || "SYSTEM", "TASK_LOGS_FETCH_ERROR", `Error fetching employee task logs: ${error.message}`);

    res.status(500).json({
      message: "Error fetching employee task logs",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   GET ALL CLIENTS
================================ */
router.get("/clients", auth, async (req, res) => {
  try {
    // Console log: Admin clients request
    logToConsole("INFO", "ADMIN_CLIENTS_REQUEST", {
      adminId: req.user.id,
      adminName: req.user.name,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Console log: Fetching all clients
    logToConsole("INFO", "FETCHING_ALL_CLIENTS", {
      adminId: req.user.id,
      adminName: req.user.name
    });

    const clients = await Client.find()
      .select("clientId name email phone isActive createdAt")
      .sort({ createdAt: -1 });

    // Console log: Clients fetched successfully
    logToConsole("SUCCESS", "CLIENTS_FETCHED_SUCCESSFULLY", {
      adminId: req.user.id,
      totalClients: clients.length,
      activeClients: clients.filter(c => c.isActive).length,
      inactiveClients: clients.filter(c => !c.isActive).length
    });

    // Save success to ActivityLog
    await log(req.user.name, "FETCHED_ALL_CLIENTS", `Fetched ${clients.length} clients`);

    // Console log: Response sent
    logToConsole("SUCCESS", "CLIENTS_RESPONSE_SENT", {
      adminId: req.user.id,
      totalClients: clients.length,
      timestamp: new Date().toISOString()
    });

    res.json(clients);

  } catch (error) {
    // Console log: Get clients error
    logToConsole("ERROR", "GET_ALL_CLIENTS_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/clients",
      adminId: req.user?.id,
      adminName: req.user?.name
    });

    // Save error to ActivityLog
    await log(req.user?.name || "SYSTEM", "CLIENTS_FETCH_ERROR", `Error fetching clients: ${error.message}`);

    res.status(500).json({
      message: "Error fetching clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   GET SINGLE CLIENT (MONTH DATA) - UPDATED FOR MULTIPLE FILES STRUCTURE
================================ */
router.get("/clients/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Console log: Single client request
    logToConsole("INFO", "SINGLE_CLIENT_REQUEST", {
      adminId: req.user.id,
      adminName: req.user.name,
      clientId,
      ip: req.ip
    });

    // Find client
    const client = await Client.findOne({ clientId });

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND", { clientId });
      await log(req.user.name, "CLIENT_NOT_FOUND", `Client not found: ${clientId}`);
      return res.status(404).json({ message: "Client not found", clientId });
    }

    // Convert client to plain object to modify - THIS IS IMPORTANT!
    let clientData = client.toObject();

    console.log("🔍 DEBUG: Original client data documents:",
      clientData.documents ? Object.keys(clientData.documents) : "No documents");

    // Get all unique employeeIds from ALL notes in the entire document structure
    const employeeIds = new Set();

    // Helper function to collect employeeIds from notes
    const collectEmployeeIds = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;
      notesArray.forEach(note => {
        if (note.employeeId) {
          employeeIds.add(note.employeeId);
        }
        // Also check addedBy field (some notes might have employeeId in addedBy)
        if (note.addedBy && !note.employeeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
          employeeIds.add(note.addedBy);
        }
      });
    };

    // Traverse through the ENTIRE documents structure to collect ALL employeeIds
    if (clientData.documents) {
      // Convert Map to object if needed
      if (clientData.documents instanceof Map) {
        const documentsObj = {};
        for (const [yearKey, yearMap] of clientData.documents.entries()) {
          if (yearMap instanceof Map) {
            const monthObj = {};
            for (const [monthKey, monthData] of yearMap.entries()) {
              monthObj[monthKey] = monthData;
            }
            documentsObj[yearKey] = monthObj;
          } else {
            documentsObj[yearKey] = yearMap;
          }
        }
        clientData.documents = documentsObj;
      }

      console.log("🔍 DEBUG: Converted documents structure:",
        Object.keys(clientData.documents).length, "years found");

      // Iterate through all years
      for (const yearKey in clientData.documents) {
        const yearData = clientData.documents[yearKey];

        // Iterate through all months
        for (const monthKey in yearData) {
          const monthData = yearData[monthKey];

          console.log(`🔍 DEBUG: Processing ${yearKey}-${monthKey}:`,
            monthData ? "Has data" : "No data");

          // Process main categories: sales, purchase, bank
          ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
              const categoryData = monthData[category];

              // 1. Collect employeeIds from category-level notes (client notes)
              if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                collectEmployeeIds(categoryData.categoryNotes);
              }

              // 2. Process each file in the category
              if (categoryData.files && Array.isArray(categoryData.files)) {
                categoryData.files.forEach(file => {
                  // Collect employeeIds from file-level notes (employee notes)
                  if (file.notes && Array.isArray(file.notes)) {
                    collectEmployeeIds(file.notes);
                  }
                });
              }
            }
          });

          // Process 'other' categories
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
              if (otherCategory.document) {
                const otherDoc = otherCategory.document;

                // 1. Collect employeeIds from other category-level notes
                if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                  collectEmployeeIds(otherDoc.categoryNotes);
                }

                // 2. Process each file in other category
                if (otherDoc.files && Array.isArray(otherDoc.files)) {
                  otherDoc.files.forEach(file => {
                    // Collect employeeIds from file-level notes
                    if (file.notes && Array.isArray(file.notes)) {
                      collectEmployeeIds(file.notes);
                    }
                  });
                }
              }
            });
          }
        }
      }
    }

    console.log("🔍 DEBUG: Found employeeIds:", Array.from(employeeIds));

    // Fetch employee names for all collected IDs
    const employeeIdArray = Array.from(employeeIds);
    let employeeMap = new Map();

    if (employeeIdArray.length > 0) {
      try {
        const Employee = require("../models/Employee");
        const employees = await Employee.find(
          { employeeId: { $in: employeeIdArray } },
          { employeeId: 1, name: 1 }
        );

        console.log("🔍 DEBUG: Fetched employees:", employees.map(e => ({ id: e.employeeId, name: e.name })));

        employees.forEach(emp => {
          employeeMap.set(emp.employeeId, emp.name);
        });

        logToConsole("DEBUG", "EMPLOYEES_FETCHED_FOR_NOTES", {
          totalEmployeesFound: employees.length,
          employeeIdsRequested: employeeIdArray.length
        });
      } catch (empError) {
        logToConsole("ERROR", "EMPLOYEE_FETCH_ERROR", {
          error: empError.message,
          employeeIds: employeeIdArray
        });
      }
    }

    // Helper function to populate employee names in notes
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
          note.employeeName = note.addedBy || 'Unknown Employee';
        }
      });
    };

    // Traverse AGAIN to populate employee names in ALL notes
    if (clientData.documents) {
      // Iterate through all years
      for (const yearKey in clientData.documents) {
        const yearData = clientData.documents[yearKey];

        // Iterate through all months
        for (const monthKey in yearData) {
          const monthData = yearData[monthKey];

          // Process main categories
          ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
              const categoryData = monthData[category];

              // 1. Populate employee names in category-level notes (client notes)
              if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                populateEmployeeNames(categoryData.categoryNotes);
              }

              // 2. Process each file in the category
              if (categoryData.files && Array.isArray(categoryData.files)) {
                categoryData.files.forEach(file => {
                  // Populate employee names in file-level notes
                  if (file.notes && Array.isArray(file.notes)) {
                    populateEmployeeNames(file.notes);
                  }
                });
              }
            }
          });

          // Process 'other' categories
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
              if (otherCategory.document) {
                const otherDoc = otherCategory.document;

                // 1. Populate employee names in other category-level notes
                if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                  populateEmployeeNames(otherDoc.categoryNotes);
                }

                // 2. Process each file in other category
                if (otherDoc.files && Array.isArray(otherDoc.files)) {
                  otherDoc.files.forEach(file => {
                    // Populate employee names in file-level notes
                    if (file.notes && Array.isArray(file.notes)) {
                      populateEmployeeNames(file.notes);
                    }
                  });
                }
              }
            });
          }
        }
      }
    }

    // Also process employee assignments to get employee names
    if (clientData.employeeAssignments && Array.isArray(clientData.employeeAssignments)) {
      const assignmentEmployeeIds = clientData.employeeAssignments
        .filter(assignment => assignment.employeeId)
        .map(assignment => assignment.employeeId);

      if (assignmentEmployeeIds.length > 0) {
        try {
          const Employee = require("../models/Employee");
          const assignmentEmployees = await Employee.find(
            { employeeId: { $in: assignmentEmployeeIds } },
            { employeeId: 1, name: 1 }
          );

          const assignmentEmployeeMap = new Map();
          assignmentEmployees.forEach(emp => {
            assignmentEmployeeMap.set(emp.employeeId, emp.name);
          });

          // Populate employee names in assignments
          clientData.employeeAssignments.forEach(assignment => {
            if (assignment.employeeId && assignmentEmployeeMap.has(assignment.employeeId)) {
              assignment.employeeName = assignmentEmployeeMap.get(assignment.employeeId);
            }
          });
        } catch (empError) {
          logToConsole("WARN", "ASSIGNMENT_EMPLOYEE_FETCH_ERROR", {
            error: empError.message
          });
        }
      }
    }

    // Log success
    logToConsole("SUCCESS", "CLIENT_DATA_WITH_EMPLOYEE_NAMES", {
      clientId,
      clientName: clientData.name,
      totalEmployeesFound: employeeMap.size,
      uniqueEmployeeIds: employeeIdArray.length,
      noteTypesProcessed: ['file-level notes', 'category-level notes'],
      monthNotesExcluded: true // As per requirement
    });

    // Save to ActivityLog
    await log(req.user.name, "VIEWED_CLIENT_DETAILS",
      `Viewed details for client: ${clientData.name} with ${employeeMap.size} employee names populated for notes`);

    // FIX: Create a clean response object that includes all processed data
    const responseData = {
      _id: clientData._id,
      clientId: clientData.clientId,
      name: clientData.name,
      email: clientData.email,
      phone: clientData.phone,
      isActive: clientData.isActive,
      documents: clientData.documents || {}, // THIS IS THE KEY FIX - include processed documents
      employeeAssignments: clientData.employeeAssignments || [],
      createdAt: clientData.createdAt,
      updatedAt: clientData.updatedAt,
      __v: clientData.__v
    };

    // Send response - Use the processed clientData
    res.json({
      success: true,
      client: responseData, // Send the FULL processed data including documents
      metadata: {
        employeeNamesPopulated: employeeMap.size,
        totalEmployeeIdsFound: employeeIdArray.length,
        noteTypes: {
          fileLevelNotes: true,
          categoryLevelNotes: true,
          monthLevelNotes: false // Excluded as per requirement
        }
      }
    });

  } catch (error) {
    // Console log: Error
    logToConsole("ERROR", "GET_SINGLE_CLIENT_ERROR", {
      error: error.message,
      stack: error.stack,
      clientId: req.params.clientId,
      adminId: req.user?.id
    });

    // Save error to ActivityLog
    await log(req.user?.name || "SYSTEM", "CLIENT_DETAILS_ERROR",
      `Error fetching client details: ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error fetching client details",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


/* ===============================
   LOCK / UNLOCK ENTIRE MONTH (UPDATED TO CASCADE TO FILES)
================================ */
router.post("/clients/:clientId/month-lock", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month, lock } = req.body;

    // Console log: Month lock request
    logToConsole("INFO", "MONTH_LOCK_REQUEST", {
      adminId: req.user.id,
      adminName: req.user.name,
      clientId,
      year,
      month,
      lockAction: lock ? "LOCK" : "UNLOCK",
      ip: req.ip
    });

    // Validate required fields
    if (!year || !month || typeof lock !== 'boolean') {
      logToConsole("WARN", "INVALID_MONTH_LOCK_DATA", {
        clientId,
        year: !!year,
        month: !!month,
        lock: typeof lock,
        providedData: req.body
      });

      // Save warning to ActivityLog
      await log(req.user.name, "MONTH_LOCK_VALIDATION_FAILED", `Invalid month lock data for client: ${clientId}, year: ${year}, month: ${month}`);

      return res.status(400).json({
        message: "Year, month, and lock (boolean) are required"
      });
    }

    // Console log: Searching for client
    logToConsole("INFO", "SEARCHING_CLIENT_FOR_MONTH_LOCK", {
      clientId,
      adminId: req.user.id,
      year,
      month
    });

    const client = await Client.findOne({ clientId });

    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_MONTH_LOCK", {
        clientId,
        adminId: req.user.id,
        year,
        month,
        lockAction: lock ? "LOCK" : "UNLOCK"
      });

      // Save error to ActivityLog
      await log(req.user.name, "CLIENT_NOT_FOUND_MONTH_LOCK", `Client not found for month lock: ${clientId}`);

      return res.status(404).json({
        message: "Client not found",
        clientId
      });
    }

    // Console log: Client found, processing month lock
    logToConsole("INFO", "PROCESSING_MONTH_LOCK", {
      clientId,
      clientName: client.name,
      year,
      month,
      lockAction: lock ? "LOCK" : "UNLOCK",
      previousLockStatus: client.documents?.get(String(year))?.get(String(month))?.isLocked || false
    });

    const yearKey = String(year);
    const monthKey = String(month);

    // Initialize year and month if not exists
    if (!client.documents.has(yearKey)) {
      client.documents.set(yearKey, new Map());
      logToConsole("DEBUG", "CREATED_NEW_YEAR_ENTRY", {
        clientId,
        year: yearKey
      });
    }

    if (!client.documents.get(yearKey).has(monthKey)) {
      client.documents.get(yearKey).set(monthKey, {});
      logToConsole("DEBUG", "CREATED_NEW_MONTH_ENTRY", {
        clientId,
        year: yearKey,
        month: monthKey
      });
    }

    const monthData = client.documents.get(yearKey).get(monthKey);

    // Track which files were locked/unlocked
    const fileLockStatus = {
      sales: false,
      purchase: false,
      bank: false,
      otherCategories: []
    };

    // CASCADE LOCK/UNLOCK TO ALL FILES
    // 1. Main document types (sales, purchase, bank)
    const mainDocTypes = ['sales', 'purchase', 'bank'];

    mainDocTypes.forEach(docType => {
      if (monthData[docType]) {
        monthData[docType].isLocked = lock;
        monthData[docType].lockedAt = lock ? new Date() : null;
        monthData[docType].lockedBy = lock ? req.user.name : null;
        fileLockStatus[docType] = true;

        logToConsole("DEBUG", `${docType.toUpperCase()}_FILE_${lock ? 'LOCKED' : 'UNLOCKED'}`, {
          clientId,
          year,
          month,
          docType
        });
      }
    });

    // 2. Other categories
    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach((otherCategory, index) => {
        if (otherCategory.document) {
          otherCategory.document.isLocked = lock;
          otherCategory.document.lockedAt = lock ? new Date() : null;
          otherCategory.document.lockedBy = lock ? req.user.name : null;
          fileLockStatus.otherCategories.push(otherCategory.categoryName);

          logToConsole("DEBUG", `OTHER_FILE_${lock ? 'LOCKED' : 'UNLOCKED'}`, {
            clientId,
            year,
            month,
            categoryName: otherCategory.categoryName,
            index
          });
        }
      });
    }

    // 3. Set month-level lock status
    monthData.isLocked = lock;
    monthData.lockedAt = lock ? new Date() : null;
    monthData.lockedBy = lock ? req.user.name : null;

    // Save the updated data
    client.documents.get(yearKey).set(monthKey, monthData);
    await client.save();

    // Console log: Month lock successful
    logToConsole("SUCCESS", "MONTH_LOCK_SUCCESSFUL_WITH_CASCADE", {
      clientId,
      clientName: client.name,
      year,
      month,
      monthLockStatus: lock,
      filesLocked: {
        sales: fileLockStatus.sales,
        purchase: fileLockStatus.purchase,
        bank: fileLockStatus.bank,
        otherCategoriesCount: fileLockStatus.otherCategories.length,
        otherCategories: fileLockStatus.otherCategories
      },
      lockedAt: monthData.lockedAt,
      lockedBy: monthData.lockedBy,
      adminId: req.user.id
    });

    // Save success to ActivityLog
    const actionType = lock ? "LOCKED_MONTH_CASCADE" : "UNLOCKED_MONTH_CASCADE";
    const actionDetails = lock ?
      `Locked month ${month}/${year} for client ${client.name} and ${fileLockStatus.otherCategories.length + (fileLockStatus.sales ? 1 : 0) + (fileLockStatus.purchase ? 1 : 0) + (fileLockStatus.bank ? 1 : 0)} files` :
      `Unlocked month ${month}/${year} for client ${client.name} and ${fileLockStatus.otherCategories.length + (fileLockStatus.sales ? 1 : 0) + (fileLockStatus.purchase ? 1 : 0) + (fileLockStatus.bank ? 1 : 0)} files`;

    await log(req.user.name, actionType, actionDetails);

    // Console log: Response sent
    logToConsole("SUCCESS", "MONTH_LOCK_RESPONSE_SENT", {
      adminId: req.user.id,
      clientId,
      year,
      month,
      lockStatus: lock,
      filesAffected: fileLockStatus.otherCategories.length + 3, // sales, purchase, bank + other categories
      timestamp: new Date().toISOString()
    });

    res.json({
      message: lock ?
        "Month and all files locked successfully" :
        "Month and all files unlocked successfully",
      clientId,
      year,
      month,
      isLocked: lock,
      lockedAt: monthData.lockedAt,
      lockedBy: monthData.lockedBy,
      filesAffected: {
        sales: fileLockStatus.sales,
        purchase: fileLockStatus.purchase,
        bank: fileLockStatus.bank,
        otherCategories: fileLockStatus.otherCategories,
        totalFiles: fileLockStatus.otherCategories.length +
          (fileLockStatus.sales ? 1 : 0) +
          (fileLockStatus.purchase ? 1 : 0) +
          (fileLockStatus.bank ? 1 : 0)
      }
    });

  } catch (error) {
    // Console log: Month lock error
    logToConsole("ERROR", "MONTH_LOCK_CASCADE_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/clients/:clientId/month-lock",
      clientId: req.params.clientId,
      adminId: req.user?.id,
      requestBody: req.body
    });

    // Save error to ActivityLog
    await log(req.user?.name || "SYSTEM", "MONTH_LOCK_CASCADE_ERROR",
      `Error processing month lock/unlock with cascade for client: ${clientId} - ${error.message}`);

    res.status(500).json({
      message: "Error processing month lock/unlock",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   LOCK / UNLOCK FILE - UPDATED TO HANDLE NON-EXISTENT FILES
================================ */
router.post("/clients/file-lock/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month, type, categoryName, lock } = req.body;

    // Validate required fields
    if (!year || !month || !type || typeof lock !== 'boolean') {
      return res.status(400).json({
        message: "Year, month, type, and lock (boolean) are required"
      });
    }

    // Additional validation for 'other' type
    if (type === "other" && !categoryName) {
      return res.status(400).json({
        message: "categoryName is required when type is 'other'"
      });
    }

    const client = await Client.findOne({ clientId });

    if (!client) {
      return res.status(404).json({
        message: "Client not found",
        clientId
      });
    }

    const yearKey = String(year);
    const monthKey = String(month);

    // Initialize year and month if not exists
    if (!client.documents.has(yearKey)) {
      client.documents.set(yearKey, new Map());
    }

    if (!client.documents.get(yearKey).has(monthKey)) {
      client.documents.get(yearKey).set(monthKey, {});
    }

    const monthData = client.documents.get(yearKey).get(monthKey);

    // Handle file locking for different types
    if (type === "other") {
      // Handle other documents
      if (!monthData.other) {
        monthData.other = [];
      }

      let otherCategory = monthData.other.find(
        (o) => o.categoryName === categoryName
      );

      if (!otherCategory) {
        // Create the category if it doesn't exist
        otherCategory = {
          categoryName,
          document: {
            url: null,
            fileName: null,
            uploadedAt: null,
            uploadedBy: null,
            isLocked: false,
            lockedAt: null,
            lockedBy: null
          }
        };
        monthData.other.push(otherCategory);
      }

      // Update lock status
      otherCategory.document.isLocked = lock;
      otherCategory.document.lockedAt = lock ? new Date() : null;
      otherCategory.document.lockedBy = lock ? req.user.adminId : null;

    } else {
      // Handle main document types (sales, purchase, bank)
      if (!monthData[type]) {
        // Create the file structure if it doesn't exist
        monthData[type] = {
          url: null,
          fileName: null,
          uploadedAt: null,
          uploadedBy: null,
          isLocked: false,
          lockedAt: null,
          lockedBy: null
        };
      }

      // Update lock status
      monthData[type].isLocked = lock;
      monthData[type].lockedAt = lock ? new Date() : null;
      monthData[type].lockedBy = lock ? req.user.name : null;
    }

    // Save the updated data
    client.documents.get(yearKey).set(monthKey, monthData);
    await client.save();

    // Log the action
    const actionType = lock ? "LOCKED_FILE" : "UNLOCKED_FILE";
    const actionDetails = lock ?
      `Locked file ${type}${categoryName ? ' (' + categoryName + ')' : ''} for client ${client.name} (${month}/${year})` :
      `Unlocked file ${type}${categoryName ? ' (' + categoryName + ')' : ''} for client ${client.name} (${month}/${year})`;

    await log(req.user.name, actionType, actionDetails);

    res.json({
      message: lock ? "File locked successfully" : "File unlocked successfully",
      clientId,
      year,
      month,
      type,
      categoryName,
      isLocked: lock,
      lockedAt: lock ? new Date() : null,
      lockedBy: lock ? req.user.adminId : null
    });

  } catch (error) {
    console.error("File lock error:", error);

    await log(req.user?.name || "SYSTEM", "FILE_LOCK_ERROR",
      `Error processing file lock/unlock for client: ${clientId} - ${error.message}`);

    res.status(500).json({
      message: "Error processing file lock/unlock",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});





module.exports = router;