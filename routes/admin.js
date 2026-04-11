const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const ActivityLog = require("../models/ActivityLog");
const auth = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");
const EmployeeTaskLog = require("../models/EmployeeTaskLog");
const ClientMonthlyData = require("../models/ClientMonthlyData");

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

  const colors = {
    INFO: '\x1b[36m',
    SUCCESS: '\x1b[32m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    DEBUG: '\x1b[35m',
    RESET: '\x1b[0m'
  };

  const color = colors[type] || colors.RESET;
  console.log(`${color}[${timestamp}] ${type}: ${operation}${colors.RESET}`, data);

  return logEntry;
};

// Helper function to get month data from BOTH collections
const getMonthDataFromBoth = async (clientId, year, month) => {
  const numericYear = parseInt(year);
  const numericMonth = parseInt(month);

  // FIRST: Check NEW ClientMonthlyData collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      const foundMonth = newDoc.months.find(m => m.year === numericYear && m.month === numericMonth);
      if (foundMonth) {
        return { data: foundMonth, source: 'new', doc: newDoc, monthIndex: newDoc.months.findIndex(m => m.year === numericYear && m.month === numericMonth) };
      }
    }
  } catch (err) {
    logToConsole("WARN", "ERROR_CHECKING_NEW_COLLECTION", { error: err.message });
  }

  return { data: null, source: null, doc: null, monthIndex: -1 };
};

// Helper function to save/update month data in the appropriate collection
const saveMonthDataToBoth = async (clientId, year, month, monthData, existingSource, context) => {
  const numericYear = parseInt(year);
  const numericMonth = parseInt(month);

  if (existingSource === 'old') {
    // Update in OLD client.documents
    if (context.client) {
      const y = String(numericYear);
      const m = String(numericMonth);
      if (!context.client.documents.has(y)) {
        context.client.documents.set(y, new Map());
      }
      context.client.documents.get(y).set(m, monthData);
      await context.client.save();
      logToConsole("INFO", "SAVED_TO_OLD_COLLECTION", { clientId, year, month });
      return { savedTo: 'old' };
    }
  } else {
    // Save to NEW collection
    let doc = context.newDoc;
    if (!doc) {
      doc = await ClientMonthlyData.findOne({ clientId });
      if (!doc) {
        const client = await Client.findOne({ clientId });
        doc = new ClientMonthlyData({
          clientId: clientId,
          clientName: client?.name || '',
          clientEmail: client?.email || '',
          months: []
        });
      }
    }

    const existingIndex = doc.months.findIndex(m => m.year === numericYear && m.month === numericMonth);

    if (existingIndex !== -1) {
      doc.months[existingIndex] = monthData;
    } else {
      doc.months.push(monthData);
    }

    doc.months.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    await doc.save();
    logToConsole("INFO", "SAVED_TO_NEW_COLLECTION", { clientId, year, month });
    return { savedTo: 'new' };
  }
};

/* ===============================
   HELPER: SEND EMAIL TO CLIENT
================================ */
const sendEmailToClient = async (client, actionType, additionalInfo = {}) => {
  try {
    const sendEmail = require("../utils/sendEmail");

    if (!client.email) {
      logToConsole("WARN", "NO_CLIENT_EMAIL_FOUND", {
        clientName: client.name,
        actionType
      });
      return { sent: false, reason: "No client email" };
    }

    const isLock = actionType === "MONTH_LOCKED" || actionType === "CATEGORY_LOCKED";
    const isMonth = actionType === "MONTH_LOCKED" || actionType === "MONTH_UNLOCKED";

    let subject = "";
    let categoryName = additionalInfo.categoryName || additionalInfo.categoryType || "";

    if (isMonth) {
      subject = `${isLock ? "🔒 Locked" : "🔓 Unlocked"}: Month ${additionalInfo.month}/${additionalInfo.year} - ${client.name}`;
    } else {
      subject = `${isLock ? "🔒 Locked" : "🔓 Unlocked"}: ${categoryName} - ${client.name}`;
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
            background-color: ${isLock ? '#4CAF50' : '#2196F3'}; 
            color: white; 
            padding: 20px; 
            text-align: center; 
            border-radius: 5px 5px 0 0; 
          }
          .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .action-box { 
            background-color: ${isLock ? '#e8f5e9' : '#e3f2fd'}; 
            padding: 15px; 
            margin: 15px 0; 
            border-left: 4px solid ${isLock ? '#4CAF50' : '#2196F3'};
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${isLock ? '🔒 Document Locked' : '🔓 Document Unlocked'}</h2>
          </div>
          <div class="content">
            <p>Dear ${client.name},</p>
            <div class="action-box">
              <p><strong>Status:</strong> ${isLock ? 'Locked' : 'Unlocked'}</p>
              ${additionalInfo.month ? `<p><strong>Period:</strong> ${additionalInfo.month}/${additionalInfo.year}</p>` : ''}
              ${categoryName ? `<p><strong>Category:</strong> ${categoryName}</p>` : ''}
              <p><strong>Date:</strong> ${new Date().toLocaleString("en-IN")}</p>
            </div>
            <p>
              ${isLock
        ? 'Your documents have been locked and are now being processed by our accounting team.'
        : 'Your documents have been unlocked. You can now upload new files or make changes.'
      }
            </p>
            <p>Thank you for using our Credence Enterprise Accounting Services.</p>
            <div class="footer">
              <p>This is an automated notification from Credence Enterprise Accounting Services.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendEmail(client.email, subject, emailHtml);

    logToConsole("SUCCESS", "CLIENT_EMAIL_SENT", {
      clientName: client.name,
      clientEmail: client.email,
      actionType,
      isLock: isLock ? "LOCK" : "UNLOCK"
    });

    return { sent: true, clientEmail: client.email };

  } catch (emailError) {
    logToConsole("ERROR", "CLIENT_EMAIL_FAILED", {
      error: emailError.message,
      clientName: client.name,
      actionType
    });
    return { sent: false, reason: emailError.message };
  }
};

const log = async (name, adminId, action, details) => {
  try {
    await ActivityLog.create({
      userName: name,
      role: "ADMIN",
      adminId: adminId,
      action,
      details,
      dateTime: new Date()
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      userName: name,
      adminId: adminId,
      action,
      details
    });
  } catch (logError) {
    logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
      error: logError.message,
      userName: name,
      adminId: adminId,
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

      await log("SYSTEM", "SYSTEM", "ADMIN_REGISTER_VALIDATION_FAILED", `Missing fields for admin register: ${email}`);

      return res.status(400).json({ message: "All fields are required" });
    }

    const exists = await Admin.findOne({ email });
    if (exists) {
      logToConsole("WARN", "ADMIN_ALREADY_EXISTS", { email });

      await log("SYSTEM", "SYSTEM", "ADMIN_REGISTER_DUPLICATE", `Admin already exists: ${email}`);

      return res.status(400).json({ message: "Admin exists" });
    }

    logToConsole("INFO", "CREATING_ADMIN_ACCOUNT", { name, email });

    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ name, email, password: hashed });

    logToConsole("SUCCESS", "ADMIN_CREATED_SUCCESSFULLY", {
      adminId: admin._id,
      name: admin.name,
      email: admin.email
    });

    await log(name, admin.adminId || admin._id.toString(), "ADMIN_REGISTER", `Admin ${email} registered successfully`);

    logToConsole("SUCCESS", "ADMIN_REGISTRATION_COMPLETE", {
      name,
      email,
      timestamp: new Date().toISOString()
    });

    res.json({ message: "Admin registered" });

  } catch (error) {
    logToConsole("ERROR", "ADMIN_REGISTER_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/register",
      body: req.body
    });

    await log("SYSTEM", "SYSTEM", "ADMIN_REGISTER_ERROR", `Error registering admin: ${error.message}`);

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

      await log("SYSTEM", "SYSTEM", "ADMIN_LOGIN_VALIDATION_FAILED", `Missing credentials for admin login: ${email}`);

      return res.status(400).json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      logToConsole("WARN", "ADMIN_NOT_FOUND", { email });

      await log("SYSTEM", "SYSTEM", "ADMIN_LOGIN_NOT_FOUND", `Admin not found: ${email}`);

      return res.status(401).json({ message: "Invalid credentials" });
    }

    console.log("DEBUG ADMIN DATA:", {
      _id: admin._id,
      adminId: admin.adminId,
      hasAdminIdField: !!admin.adminId,
      name: admin.name,
      email: admin.email
    });

    logToConsole("DEBUG", "ADMIN_FOUND", {
      _id: admin._id,
      adminId: admin.adminId,
      name: admin.name
    });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) {
      logToConsole("WARN", "INVALID_ADMIN_PASSWORD", {
        email,
        adminId: admin._id
      });

      await log(admin.name, admin.adminId || admin._id.toString(), "ADMIN_LOGIN_FAILED", `Invalid password attempt for admin: ${email}`);

      return res.status(401).json({ message: "Invalid credentials" });
    }

    logToConsole("SUCCESS", "ADMIN_PASSWORD_MATCH", {
      adminId: admin._id,
      name: admin.name
    });

    const tokenAdminId = admin.adminId || admin._id.toString();

    console.log("JWT PAYLOAD WILL CONTAIN:", {
      adminId: tokenAdminId,
      type: typeof tokenAdminId,
      isUUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenAdminId),
      isObjectId: /^[0-9a-f]{24}$/i.test(tokenAdminId)
    });

    const token = jwt.sign(
      {
        adminId: tokenAdminId,
        name: admin.name,
        role: "ADMIN",
        email: admin.email
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    const decodedToken = jwt.decode(token);
    console.log("ACTUAL JWT DECODED:", decodedToken);

    logToConsole("DEBUG", "ADMIN_JWT_TOKEN_CREATED", {
      adminIdInToken: decodedToken.adminId,
      adminIdFromDB: admin.adminId,
      _idFromDB: admin._id,
      expiresIn: "1d"
    });

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000
    });

    logToConsole("INFO", "ADMIN_COOKIE_SET", {
      adminId: admin._id,
      cookieName: "accessToken"
    });

    await log(admin.name, admin.adminId || admin._id.toString(), "ADMIN_LOGIN", "Admin logged in successfully");

    logToConsole("SUCCESS", "ADMIN_LOGIN_SUCCESS", {
      adminId: admin._id,
      adminUUID: admin.adminId,
      name: admin.name,
      email: admin.email,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Login success",
      admin: {
        name: admin.name,
        email: admin.email,
        adminId: admin.adminId || admin._id
      }
    });

  } catch (error) {
    logToConsole("ERROR", "ADMIN_LOGIN_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/login",
      email: req.body?.email
    });

    await log("SYSTEM", "SYSTEM", "ADMIN_LOGIN_ERROR", `Error during admin login: ${error.message}`);

    res.status(500).json({
      message: "Error during login",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   CHECK ADMIN LOGIN
================================ */
router.get("/me", auth, async (req, res) => {
  try {
    console.log("🔍 /me ENDPOINT DEBUG:");
    console.log("Full req.user:", req.user);
    console.log("req.user.adminId:", req.user?.adminId);
    console.log("req.user.id:", req.user?.id);
    console.log("req.user type:", typeof req.user?.adminId);

    logToConsole("INFO", "ADMIN_AUTH_CHECK_REQUEST", {
      adminId: req.user?.adminId,
      adminName: req.user?.name,
      ip: req.ip
    });

    const admin = await Admin.findOne({ adminId: req.user.adminId }).select("-password");

    if (!admin) {
      logToConsole("ERROR", "ADMIN_NOT_FOUND_IN_DB", {
        requestedId: req.user.adminId,
        adminName: req.user.name
      });

      await log("SYSTEM", req.user?.adminId || "SYSTEM", "ADMIN_NOT_FOUND_IN_DB", `Admin not found in database: ${req.user.adminId}`);

      res.clearCookie("accessToken");

      return res.status(404).json({
        message: "Admin not found in database",
        clearedCookie: true
      });
    }

    logToConsole("SUCCESS", "ADMIN_DATA_FETCHED", {
      adminId: admin._id,
      name: admin.name,
      email: admin.email
    });

    await log(admin.name, admin.adminId || admin._id.toString(), "ADMIN_AUTH_CHECK", "Admin authentication checked successfully");

    res.json(admin);

  } catch (error) {
    logToConsole("ERROR", "ADMIN_ME_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/me",
      adminId: req.user?.adminId
    });

    await log("SYSTEM", req.user?.adminId || "SYSTEM", "ADMIN_AUTH_CHECK_ERROR", `Error checking admin authentication: ${error.message}`);

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
  console.log("🔥 LOGOUT API HIT");

  try {
    console.log("➡️ Cookies BEFORE clear:", req.headers.cookie);

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });

    console.log("✅ clearCookie() CALLED");

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.log("❌ LOGOUT ERROR:", error);

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });

    return res.status(200).json({
      success: true,
      message: "Logged out (forced)"
    });
  }
});

/* ===============================
   GET ALL CLIENTS
================================ */
router.get("/clients", auth, async (req, res) => {
  try {
    logToConsole("INFO", "ADMIN_CLIENTS_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    logToConsole("INFO", "FETCHING_ALL_CLIENTS", {
      adminId: req.user.adminId,
      adminName: req.user.name
    });

    // ✅ ONLY CHANGE: Added "planSelected" to the select fields
    const clients = await Client.find()
      .select("clientId name email phone isActive createdAt planSelected")
      .sort({ createdAt: -1 });

    logToConsole("SUCCESS", "CLIENTS_FETCHED_SUCCESSFULLY", {
      adminId: req.user.adminId,
      totalClients: clients.length,
      activeClients: clients.filter(c => c.isActive).length,
      inactiveClients: clients.filter(c => !c.isActive).length
    });

    await log(req.user.name, req.user.adminId, "FETCHED_ALL_CLIENTS", `Fetched ${clients.length} clients`);

    logToConsole("SUCCESS", "CLIENTS_RESPONSE_SENT", {
      adminId: req.user.adminId,
      totalClients: clients.length,
      timestamp: new Date().toISOString()
    });

    res.json(clients);

  } catch (error) {
    logToConsole("ERROR", "GET_ALL_CLIENTS_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/clients",
      adminId: req.user?.adminId,
      adminName: req.user?.name
    });

    await log(req.user?.name || "SYSTEM", req.user?.adminId || "SYSTEM", "CLIENTS_FETCH_ERROR", `Error fetching clients: ${error.message}`);

    res.status(500).json({
      message: "Error fetching clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   GET SINGLE CLIENT (MONTH DATA) - UPDATED FOR BOTH COLLECTIONS
   NOW MERGES OLD client.documents AND NEW ClientMonthlyData
================================ */
router.get("/clients/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;

    logToConsole("INFO", "SINGLE_CLIENT_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      clientId,
      ip: req.ip
    });

    const client = await Client.findOne({ clientId });

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND", { clientId });
      await log(req.user.name, req.user.adminId, "CLIENT_NOT_FOUND", `Client not found: ${clientId}`);
      return res.status(404).json({ message: "Client not found", clientId });
    }

    let clientData = client.toObject();

    console.log("🔍 DEBUG: Original client data documents:", clientData.documents ? Object.keys(clientData.documents) : "No documents");

    // ===== GET NEW COLLECTION DATA =====
    const newDoc = await ClientMonthlyData.findOne({ clientId });

    // ===== MERGE OLD AND NEW DOCUMENTS =====
    let mergedDocuments = {};

    // Step 1: Convert OLD Map to object
    if (clientData.documents) {
      if (clientData.documents instanceof Map) {
        for (const [yearKey, yearMap] of clientData.documents.entries()) {
          if (yearMap instanceof Map) {
            const monthObj = {};
            for (const [monthKey, monthData] of yearMap.entries()) {
              monthObj[monthKey] = monthData;
            }
            mergedDocuments[yearKey] = monthObj;
          } else {
            mergedDocuments[yearKey] = yearMap;
          }
        }
      } else if (typeof clientData.documents === 'object') {
        mergedDocuments = JSON.parse(JSON.stringify(clientData.documents));
      }
    }

    // Step 2: Merge NEW collection data (overrides OLD if same month exists)
    if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
      for (const monthData of newDoc.months) {
        const yearKey = monthData.year.toString();
        const monthKey = monthData.month.toString();

        if (!mergedDocuments[yearKey]) {
          mergedDocuments[yearKey] = {};
        }

        // Preserve the year and month in the data for frontend
        const monthDataCopy = JSON.parse(JSON.stringify(monthData));
        monthDataCopy.year = monthData.year;
        monthDataCopy.month = monthData.month;

        mergedDocuments[yearKey][monthKey] = monthDataCopy;
        console.log(`🔍 DEBUG: Merged NEW month ${yearKey}-${monthKey} from new collection`);
      }
    }

    // Step 3: Replace clientData.documents with merged data
    clientData.documents = mergedDocuments;

    console.log("🔍 DEBUG: After merge - years found:", Object.keys(mergedDocuments).length);

    // Rest of the function for employee name fetching etc.
    const employeeIds = new Set();

    const collectEmployeeIds = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;
      notesArray.forEach(note => {
        if (note.employeeId) {
          employeeIds.add(note.employeeId);
        }
        if (note.addedBy && !note.employeeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
          employeeIds.add(note.addedBy);
        }
      });
    };

    if (clientData.documents) {
      for (const yearKey in clientData.documents) {
        const yearData = clientData.documents[yearKey];
        for (const monthKey in yearData) {
          const monthData = yearData[monthKey];

          console.log(`🔍 DEBUG: Processing ${yearKey}-${monthKey}:`, monthData ? "Has data" : "No data");

          ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
              const categoryData = monthData[category];
              if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                collectEmployeeIds(categoryData.categoryNotes);
              }
              if (categoryData.files && Array.isArray(categoryData.files)) {
                categoryData.files.forEach(file => {
                  if (file.notes && Array.isArray(file.notes)) {
                    collectEmployeeIds(file.notes);
                  }
                });
              }
            }
          });

          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
              if (otherCategory.document) {
                const otherDoc = otherCategory.document;
                if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                  collectEmployeeIds(otherDoc.categoryNotes);
                }
                if (otherDoc.files && Array.isArray(otherDoc.files)) {
                  otherDoc.files.forEach(file => {
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

    console.log("🔍 DEBUG: Found employeeIds from notes:", Array.from(employeeIds));

    const employeeIdArray = Array.from(employeeIds);
    let employeeMap = new Map();

    if (employeeIdArray.length > 0) {
      try {
        const Employee = require("../models/Employee");
        const employees = await Employee.find(
          { employeeId: { $in: employeeIdArray } },
          { employeeId: 1, name: 1, phone: 1 }
        );

        console.log("🔍 DEBUG: Fetched employees for notes:", employees.map(e => ({ id: e.employeeId, name: e.name })));

        employees.forEach(emp => {
          employeeMap.set(emp.employeeId, {
            name: emp.name,
            phone: emp.phone || "N/A"
          });
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

    const populateEmployeeNames = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return;

      notesArray.forEach(note => {
        if (note.employeeId && employeeMap.has(note.employeeId)) {
          note.employeeName = employeeMap.get(note.employeeId).name;
        }
        else if (!note.employeeName && note.addedBy) {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.addedBy)) {
            if (employeeMap.has(note.addedBy)) {
              note.employeeName = employeeMap.get(note.addedBy).name;
            }
          }
          else if (typeof note.addedBy === 'string' && note.addedBy.trim().length > 0) {
            note.employeeName = note.addedBy;
          }
        }

        if (!note.employeeName) {
          note.employeeName = note.addedBy || 'Unknown Employee';
        }
      });
    };

    if (clientData.documents) {
      for (const yearKey in clientData.documents) {
        const yearData = clientData.documents[yearKey];
        for (const monthKey in yearData) {
          const monthData = yearData[monthKey];
          ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
              const categoryData = monthData[category];
              if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                populateEmployeeNames(categoryData.categoryNotes);
              }
              if (categoryData.files && Array.isArray(categoryData.files)) {
                categoryData.files.forEach(file => {
                  if (file.notes && Array.isArray(file.notes)) {
                    populateEmployeeNames(file.notes);
                  }
                });
              }
            }
          });
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
              if (otherCategory.document) {
                const otherDoc = otherCategory.document;
                if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                  populateEmployeeNames(otherDoc.categoryNotes);
                }
                if (otherDoc.files && Array.isArray(otherDoc.files)) {
                  otherDoc.files.forEach(file => {
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

    console.log("🔍 DEBUG: Processing employee assignments...");

    const allAssignments = clientData.employeeAssignments || [];
    console.log("🔍 DEBUG: Total assignments found:", allAssignments.length);

    if (allAssignments.length > 0) {
      const assignmentEmployeeIds = allAssignments
        .filter(assignment => assignment.employeeId && !assignment.isRemoved)
        .map(assignment => assignment.employeeId);

      const uniqueEmployeeIds = [...new Set(assignmentEmployeeIds)];

      console.log("🔍 DEBUG: Unique employeeIds from assignments:", uniqueEmployeeIds);

      if (uniqueEmployeeIds.length > 0) {
        try {
          const Employee = require("../models/Employee");
          const assignmentEmployees = await Employee.find(
            { employeeId: { $in: uniqueEmployeeIds } },
            { employeeId: 1, name: 1, phone: 1 }
          );

          console.log("🔍 DEBUG: Fetched assignment employees:", assignmentEmployees.map(e => ({ id: e.employeeId, name: e.name })));

          const assignmentEmployeeMap = new Map();
          assignmentEmployees.forEach(emp => {
            assignmentEmployeeMap.set(emp.employeeId, {
              name: emp.name,
              phone: emp.phone || "N/A"
            });
          });

          clientData.employeeAssignments = allAssignments
            .filter(assignment => !assignment.isRemoved)
            .map(assignment => {
              const empInfo = assignmentEmployeeMap.get(assignment.employeeId);
              return {
                ...assignment,
                employeeName: empInfo?.name || "Unknown Employee",
                employeePhone: empInfo?.phone || "N/A",
                assignedAt: assignment.assignedAt ? assignment.assignedAt.toISOString() : null,
                accountingDoneAt: assignment.accountingDoneAt ? assignment.accountingDoneAt.toISOString() : null
              };
            });

          console.log("🔍 DEBUG: Enriched assignments:", clientData.employeeAssignments.map(a => ({
            year: a.year,
            month: a.month,
            task: a.task,
            employeeName: a.employeeName,
            accountingDone: a.accountingDone
          })));

        } catch (empError) {
          logToConsole("WARN", "ASSIGNMENT_EMPLOYEE_FETCH_ERROR", {
            error: empError.message
          });
          clientData.employeeAssignments = allAssignments.filter(a => !a.isRemoved);
        }
      } else {
        clientData.employeeAssignments = allAssignments.filter(a => !a.isRemoved);
      }
    } else {
      clientData.employeeAssignments = [];
    }

    console.log("🔍 DEBUG: Organizing assignments by month...");

    const assignmentsByMonth = {};

    clientData.employeeAssignments.forEach(assignment => {
      const monthKey = `${assignment.year}-${assignment.month}`;
      if (!assignmentsByMonth[monthKey]) {
        assignmentsByMonth[monthKey] = [];
      }
      assignmentsByMonth[monthKey].push({
        task: assignment.task || "Not specified",
        employeeId: assignment.employeeId,
        employeeName: assignment.employeeName || "Unknown Employee",
        employeePhone: assignment.employeePhone || "N/A",
        accountingDone: assignment.accountingDone || false,
        accountingDoneAt: assignment.accountingDoneAt,
        accountingDoneBy: assignment.accountingDoneBy,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
        adminName: assignment.adminName
      });
    });

    console.log("🔍 DEBUG: Assignments by month:", assignmentsByMonth);

    logToConsole("SUCCESS", "CLIENT_DATA_WITH_MULTIPLE_EMPLOYEE_ASSIGNMENTS", {
      clientId,
      clientName: clientData.name,
      totalAssignments: clientData.employeeAssignments.length,
      assignmentsByMonthCount: Object.keys(assignmentsByMonth).length,
      noteTypesProcessed: ['file-level notes', 'category-level notes'],
      employeeNamesPopulated: employeeMap.size
    });

    await log(req.user.name, req.user.adminId, "VIEWED_CLIENT_DETAILS",
      `Viewed details for client: ${clientData.name} with ${clientData.employeeAssignments.length} employee assignments`);

    const responseData = {
      _id: clientData._id,
      clientId: clientData.clientId,
      name: clientData.name,
      email: clientData.email,
      phone: clientData.phone,
      address: clientData.address,
      firstName: clientData.firstName,
      lastName: clientData.lastName,
      businessName: clientData.businessName,
      businessAddress: clientData.businessAddress,
      businessNature: clientData.businessNature,
      registerTrade: clientData.registerTrade,
      bankAccount: clientData.bankAccount,
      bicCode: clientData.bicCode,
      vatPeriod: clientData.vatPeriod,
      planSelected: clientData.planSelected,
      visaType: clientData.visaType,
      hasStrongId: clientData.hasStrongId,
      isActive: clientData.isActive,
      enrollmentId: clientData.enrollmentId,
      enrollmentDate: clientData.enrollmentDate,
      documents: clientData.documents || {},
      employeeAssignments: clientData.employeeAssignments,
      assignmentsByMonth: assignmentsByMonth,
      createdAt: clientData.createdAt,
      updatedAt: clientData.updatedAt,
      __v: clientData.__v
    };

    res.json({
      success: true,
      client: responseData,
      metadata: {
        employeeNamesPopulated: employeeMap.size,
        totalAssignments: clientData.employeeAssignments.length,
        assignmentsByMonth: Object.keys(assignmentsByMonth).length,
        noteTypes: {
          fileLevelNotes: true,
          categoryLevelNotes: true,
          monthLevelNotes: false
        },
        documentsMerged: true,
        newCollectionDataFound: !!newDoc
      }
    });

  } catch (error) {
    logToConsole("ERROR", "GET_SINGLE_CLIENT_ERROR", {
      error: error.message,
      stack: error.stack,
      clientId: req.params.clientId,
      adminId: req.user?.adminId
    });

    await log(req.user?.name || "SYSTEM", req.user?.adminId || "SYSTEM", "CLIENT_DETAILS_ERROR",
      `Error fetching client details: ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error fetching client details",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   LOCK / UNLOCK ENTIRE MONTH - UPDATED FOR BOTH COLLECTIONS
================================ */
router.post("/clients/:clientId/month-lock", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month, lock } = req.body;

    logToConsole("INFO", "MONTH_LOCK_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      clientId,
      year,
      month,
      lockAction: lock ? "LOCK" : "UNLOCK",
      ip: req.ip
    });

    if (!year || !month || typeof lock !== 'boolean') {
      logToConsole("WARN", "INVALID_MONTH_LOCK_DATA", {
        clientId,
        year: !!year,
        month: !!month,
        lock: typeof lock,
        providedData: req.body
      });

      await log(req.user.name, req.user.adminId, "MONTH_LOCK_VALIDATION_FAILED", `Invalid month lock data for client: ${clientId}, year: ${year}, month: ${month}`);

      return res.status(400).json({
        success: false,
        message: "Year, month, and lock (boolean) are required"
      });
    }

    logToConsole("INFO", "SEARCHING_CLIENT_FOR_MONTH_LOCK", {
      clientId,
      adminId: req.user.adminId,
      year,
      month
    });

    const client = await Client.findOne({ clientId });

    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND_MONTH_LOCK", {
        clientId,
        adminId: req.user.adminId
      });

      await log(req.user.name, req.user.adminId, "CLIENT_NOT_FOUND_MONTH_LOCK", `Client not found for month lock: ${clientId}`);

      return res.status(404).json({
        success: false,
        message: "Client not found",
        clientId
      });
    }

    // Enrollment date validation
    if (lock === false) {
      const enrollDate = new Date(client.enrollmentDate);
      const enrollYear = enrollDate.getFullYear();
      const enrollMonth = enrollDate.getMonth() + 1;

      const isPreEnrollment = (year < enrollYear) || (year === enrollYear && month < enrollMonth);

      if (isPreEnrollment) {
        const targetMonthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
        const enrollMonthName = new Date(enrollYear, enrollMonth - 1).toLocaleString('default', { month: 'long' });

        logToConsole("WARN", "PRE_ENROLLMENT_MONTH_UNLOCK_ATTEMPT", {
          clientId,
          clientName: client.name,
          targetMonth: `${targetMonthName} ${year}`,
          enrollmentMonth: `${enrollMonthName} ${enrollYear}`,
          adminId: req.user.adminId,
          adminName: req.user.name
        });

        await log(req.user.name, req.user.adminId, "PRE_ENROLLMENT_UNLOCK_BLOCKED",
          `Attempted to unlock ${targetMonthName} ${year} for client ${client.name} who enrolled in ${enrollMonthName} ${enrollYear}`);

        return res.status(403).json({
          success: false,
          message: "Cannot unlock months before client enrollment date",
          error: "PRE_ENROLLMENT_MONTH",
          details: {
            targetMonth: month,
            targetYear: year,
            targetDisplay: `${targetMonthName} ${year}`,
            enrollmentMonth: enrollMonth,
            enrollmentYear: enrollYear,
            enrollmentDisplay: `${enrollMonthName} ${enrollYear}`,
            explanation: `Client enrolled in ${enrollMonthName} ${enrollYear}. Months before this cannot be unlocked.`
          }
        });
      }
    }

    logToConsole("INFO", "PROCESSING_MONTH_LOCK", {
      clientId,
      clientName: client.name,
      year,
      month,
      lockAction: lock ? "LOCK" : "UNLOCK"
    });

    // ===== CHECK WHERE THE MONTH DATA EXISTS =====
    const newMonthResult = await getMonthDataFromBoth(clientId, year, month);
    let monthData = null;
    let source = null;
    let context = { client, newDoc: newMonthResult.doc };

    if (newMonthResult.data) {
      monthData = newMonthResult.data;
      source = newMonthResult.source;
      context.newDoc = newMonthResult.doc;
      logToConsole("DEBUG", "MONTH_FOUND_IN_NEW_COLLECTION", { clientId, year, month });
    } else {
      // Check OLD collection
      const yearKey = String(year);
      const monthKey = String(month);
      if (client.documents.has(yearKey) && client.documents.get(yearKey).has(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        source = 'old';
        logToConsole("DEBUG", "MONTH_FOUND_IN_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      // Create new month data if doesn't exist
      monthData = {};
      source = null;
      logToConsole("DEBUG", "CREATING_NEW_MONTH_DATA", { clientId, year, month });
    }

    // Track which files were locked/unlocked
    const fileLockStatus = {
      sales: false,
      purchase: false,
      bank: false,
      otherCategories: []
    };

    const mainDocTypes = ['sales', 'purchase', 'bank'];

    mainDocTypes.forEach(docType => {
      if (monthData[docType]) {
        monthData[docType].isLocked = lock;
        monthData[docType].lockedAt = lock ? new Date() : null;
        monthData[docType].lockedBy = lock ? req.user.name : null;
        fileLockStatus[docType] = true;
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach((otherCategory, index) => {
        if (otherCategory.document) {
          otherCategory.document.isLocked = lock;
          otherCategory.document.lockedAt = lock ? new Date() : null;
          otherCategory.document.lockedBy = lock ? req.user.name : null;
          fileLockStatus.otherCategories.push(otherCategory.categoryName);
        }
      });
    }

    monthData.isLocked = lock;
    monthData.lockedAt = lock ? new Date() : null;
    monthData.lockedBy = lock ? req.user.name : null;

    // Save to appropriate collection
    await saveMonthDataToBoth(clientId, year, month, monthData, source, context);

    // Send email to client
    try {
      const actionType = lock ? "MONTH_LOCKED" : "MONTH_UNLOCKED";
      const additionalInfo = { year, month };
      await sendEmailToClient(client, actionType, additionalInfo);
    } catch (emailError) {
      logToConsole("ERROR", "CLIENT_EMAIL_FAILED_MONTH_LOCK", {
        error: emailError.message,
        clientId
      });
    }

    logToConsole("SUCCESS", "MONTH_LOCK_SUCCESSFUL_WITH_CASCADE", {
      clientId,
      clientName: client.name,
      year,
      month,
      monthLockStatus: lock
    });

    const actionType = lock ? "LOCKED_MONTH_CASCADE" : "UNLOCKED_MONTH_CASCADE";
    const actionDetails = lock ?
      `Locked month ${month}/${year} for client ${client.name}` :
      `Unlocked month ${month}/${year} for client ${client.name}`;

    await log(req.user.name, req.user.adminId, actionType, actionDetails);

    res.json({
      success: true,
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
        totalFiles: fileLockStatus.otherCategories.length + 3
      }
    });

  } catch (error) {
    logToConsole("ERROR", "MONTH_LOCK_CASCADE_ERROR", {
      error: error.message,
      stack: error.stack,
      clientId: req.params.clientId,
      adminId: req.user?.adminId
    });

    await log(req.user?.name || "SYSTEM", req.user?.adminId || "SYSTEM", "MONTH_LOCK_CASCADE_ERROR",
      `Error processing month lock/unlock for client: ${req.params.clientId} - ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error processing month lock/unlock",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   LOCK / UNLOCK FILE - UPDATED FOR BOTH COLLECTIONS
================================ */
router.post("/clients/file-lock/:clientId", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month, type, categoryName, lock } = req.body;

    if (!year || !month || !type || typeof lock !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Year, month, type, and lock (boolean) are required"
      });
    }

    if (type === "other" && !categoryName) {
      return res.status(400).json({
        success: false,
        message: "categoryName is required when type is 'other'"
      });
    }

    const client = await Client.findOne({ clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
        clientId
      });
    }

    if (lock === false) {
      const enrollDate = new Date(client.enrollmentDate);
      const enrollYear = enrollDate.getFullYear();
      const enrollMonth = enrollDate.getMonth() + 1;

      const isPreEnrollment = (year < enrollYear) || (year === enrollYear && month < enrollMonth);

      if (isPreEnrollment) {
        const targetMonthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
        const enrollMonthName = new Date(enrollYear, enrollMonth - 1).toLocaleString('default', { month: 'long' });
        const categoryDisplay = type === "other" ? categoryName : type;

        logToConsole("WARN", "PRE_ENROLLMENT_FILE_UNLOCK_ATTEMPT", {
          clientId,
          clientName: client.name,
          targetMonth: `${targetMonthName} ${year}`,
          enrollmentMonth: `${enrollMonthName} ${enrollYear}`,
          category: categoryDisplay,
          adminId: req.user.adminId
        });

        await log(req.user.name, req.user.adminId, "PRE_ENROLLMENT_FILE_UNLOCK_BLOCKED",
          `Attempted to unlock ${categoryDisplay} in ${targetMonthName} ${year} for client ${client.name} who enrolled in ${enrollMonthName} ${enrollYear}`);

        return res.status(403).json({
          success: false,
          message: "Cannot unlock files in months before client enrollment date",
          error: "PRE_ENROLLMENT_MONTH",
          details: {
            targetMonth: month,
            targetYear: year,
            targetDisplay: `${targetMonthName} ${year}`,
            enrollmentMonth: enrollMonth,
            enrollmentYear: enrollYear,
            enrollmentDisplay: `${enrollMonthName} ${enrollYear}`,
            category: categoryDisplay,
            explanation: `Client enrolled in ${enrollMonthName} ${enrollYear}. Files in months before this cannot be unlocked.`
          }
        });
      }
    }

    // ===== CHECK WHERE THE MONTH DATA EXISTS =====
    const newMonthResult = await getMonthDataFromBoth(clientId, year, month);
    let monthData = null;
    let source = null;
    let context = { client, newDoc: newMonthResult.doc };

    if (newMonthResult.data) {
      monthData = newMonthResult.data;
      source = newMonthResult.source;
      context.newDoc = newMonthResult.doc;
      logToConsole("DEBUG", "MONTH_FOUND_IN_NEW_COLLECTION", { clientId, year, month });
    } else {
      const yearKey = String(year);
      const monthKey = String(month);
      if (client.documents.has(yearKey) && client.documents.get(yearKey).has(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        source = 'old';
        logToConsole("DEBUG", "MONTH_FOUND_IN_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      monthData = {};
      source = null;
    }

    // Handle file locking
    if (type === "other") {
      if (!monthData.other) {
        monthData.other = [];
      }

      let otherCategory = monthData.other.find(
        (o) => o.categoryName === categoryName
      );

      if (!otherCategory) {
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

      otherCategory.document.isLocked = lock;
      otherCategory.document.lockedAt = lock ? new Date() : null;
      otherCategory.document.lockedBy = lock ? req.user.adminId : null;

    } else {
      if (!monthData[type]) {
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

      monthData[type].isLocked = lock;
      monthData[type].lockedAt = lock ? new Date() : null;
      monthData[type].lockedBy = lock ? req.user.name : null;
    }

    // Save to appropriate collection
    await saveMonthDataToBoth(clientId, year, month, monthData, source, context);

    // Send email to client
    try {
      const actionType = lock ? "CATEGORY_LOCKED" : "CATEGORY_UNLOCKED";
      const categoryDisplayName = type === "other" ? categoryName : type;
      const additionalInfo = { year, month, categoryType: categoryDisplayName };
      await sendEmailToClient(client, actionType, additionalInfo);
    } catch (emailError) {
      logToConsole("ERROR", "CLIENT_EMAIL_FAILED_FILE_LOCK", {
        error: emailError.message,
        clientId
      });
    }

    const actionTypeLog = lock ? "LOCKED_FILE" : "UNLOCKED_FILE";
    const categoryDisplay = type === "other" ? categoryName : type;
    const actionDetails = lock ?
      `Locked file ${categoryDisplay} for client ${client.name} (${month}/${year})` :
      `Unlocked file ${categoryDisplay} for client ${client.name} (${month}/${year})`;

    await log(req.user.name, req.user.adminId, actionTypeLog, actionDetails);

    res.json({
      success: true,
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

    await log(req.user?.name || "SYSTEM", req.user?.adminId || "SYSTEM", "FILE_LOCK_ERROR",
      `Error processing file lock/unlock for client: ${req.params.clientId} - ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error processing file lock/unlock",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   GET PAYMENT STATUS FOR A MONTH - UPDATED FOR BOTH COLLECTIONS
================================ */
router.get("/clients/:clientId/payment-status", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        message: "Year and month are required"
      });
    }

    logToConsole("INFO", "GET_PAYMENT_STATUS_REQUEST", {
      adminId: req.user.adminId,
      clientId,
      year,
      month
    });

    const client = await Client.findOne({ clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ===== CHECK BOTH COLLECTIONS =====
    const newMonthResult = await getMonthDataFromBoth(clientId, year, month);
    let monthData = null;

    if (newMonthResult.data) {
      monthData = newMonthResult.data;
      logToConsole("DEBUG", "PAYMENT_STATUS_FROM_NEW_COLLECTION", { clientId, year, month });
    } else {
      const yearKey = String(year);
      const monthKey = String(month);
      if (client.documents.has(yearKey) && client.documents.get(yearKey).has(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        logToConsole("DEBUG", "PAYMENT_STATUS_FROM_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      return res.json({
        success: true,
        paymentStatus: false,
        paymentHistory: [],
        message: "No month data found for this period"
      });
    }

    logToConsole("SUCCESS", "GET_PAYMENT_STATUS_SUCCESS", {
      clientId,
      year,
      month,
      paymentStatus: monthData.paymentStatus || false
    });

    res.json({
      success: true,
      paymentStatus: monthData.paymentStatus || false,
      paymentUpdatedAt: monthData.paymentUpdatedAt,
      paymentUpdatedBy: monthData.paymentUpdatedBy,
      paymentUpdatedByName: monthData.paymentUpdatedByName,
      paymentNotes: monthData.paymentNotes,
      paymentHistory: monthData.paymentHistory || []
    });

  } catch (error) {
    logToConsole("ERROR", "GET_PAYMENT_STATUS_ERROR", {
      error: error.message,
      clientId: req.params.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching payment status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   UPDATE PAYMENT STATUS FOR A MONTH - UPDATED FOR BOTH COLLECTIONS
================================ */
router.post("/clients/:clientId/payment-status", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month, status, notes } = req.body;

    if (!year || !month || typeof status !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Year, month, and status (boolean) are required"
      });
    }

    logToConsole("INFO", "UPDATE_PAYMENT_STATUS_REQUEST", {
      adminId: req.user.adminId,
      adminName: req.user.name,
      clientId,
      year,
      month,
      newStatus: status,
      notes: notes || 'No notes'
    });

    const client = await Client.findOne({ clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ===== CHECK WHERE THE MONTH DATA EXISTS =====
    const newMonthResult = await getMonthDataFromBoth(clientId, year, month);
    let monthData = null;
    let source = null;
    let context = { client, newDoc: newMonthResult.doc };

    if (newMonthResult.data) {
      monthData = newMonthResult.data;
      source = newMonthResult.source;
      context.newDoc = newMonthResult.doc;
      logToConsole("DEBUG", "PAYMENT_UPDATE_IN_NEW_COLLECTION", { clientId, year, month });
    } else {
      const yearKey = String(year);
      const monthKey = String(month);
      if (!client.documents.has(yearKey)) {
        client.documents.set(yearKey, new Map());
      }
      if (!client.documents.get(yearKey).has(monthKey)) {
        client.documents.get(yearKey).set(monthKey, {
          paymentStatus: false,
          paymentHistory: []
        });
      }
      monthData = client.documents.get(yearKey).get(monthKey);
      source = 'old';
      logToConsole("DEBUG", "PAYMENT_UPDATE_IN_OLD_COLLECTION", { clientId, year, month });
    }

    const previousStatus = monthData.paymentStatus || false;

    if (previousStatus === status) {
      return res.json({
        success: true,
        message: `Payment status already ${status ? 'PAID' : 'PENDING'}`,
        paymentStatus: status,
        unchanged: true
      });
    }

    if (!monthData.paymentHistory) {
      monthData.paymentHistory = [];
    }

    monthData.paymentStatus = status;
    monthData.paymentUpdatedAt = new Date();
    monthData.paymentUpdatedBy = req.user.adminId;
    monthData.paymentUpdatedByName = req.user.name;

    if (notes) {
      monthData.paymentNotes = notes;
    }

    monthData.paymentHistory.push({
      status: status,
      changedAt: new Date(),
      changedBy: req.user.adminId,
      changedByName: req.user.name,
      notes: notes || `Changed from ${previousStatus ? 'PAID' : 'PENDING'} to ${status ? 'PAID' : 'PENDING'}`
    });

    if (monthData.paymentHistory.length > 50) {
      monthData.paymentHistory = monthData.paymentHistory.slice(-50);
    }

    // Save to appropriate collection
    await saveMonthDataToBoth(clientId, year, month, monthData, source, context);

    const actionDetails = status ?
      `Marked payment as PAID for ${client.name} - ${month}/${year}` :
      `Marked payment as PENDING for ${client.name} - ${month}/${year}`;

    await log(req.user.name, req.user.adminId, "PAYMENT_STATUS_UPDATED", actionDetails);

    logToConsole("SUCCESS", "PAYMENT_STATUS_UPDATED_SUCCESSFULLY", {
      clientId,
      clientName: client.name,
      year,
      month,
      previousStatus: previousStatus ? 'PAID' : 'PENDING',
      newStatus: status ? 'PAID' : 'PENDING',
      updatedBy: req.user.name,
      historyLength: monthData.paymentHistory.length
    });

    res.json({
      success: true,
      message: `Payment status updated to ${status ? 'PAID' : 'PENDING'} successfully`,
      paymentStatus: status,
      paymentUpdatedAt: monthData.paymentUpdatedAt,
      paymentUpdatedBy: monthData.paymentUpdatedBy,
      paymentUpdatedByName: monthData.paymentUpdatedByName,
      paymentHistory: monthData.paymentHistory,
      previousStatus: previousStatus
    });

  } catch (error) {
    logToConsole("ERROR", "UPDATE_PAYMENT_STATUS_ERROR", {
      error: error.message,
      stack: error.stack,
      clientId: req.params.clientId,
      adminId: req.user?.adminId,
      requestBody: req.body
    });

    await log(req.user?.name || "SYSTEM", req.user?.adminId || "SYSTEM", "PAYMENT_STATUS_UPDATE_ERROR",
      `Error updating payment status: ${error.message}`);

    res.status(500).json({
      success: false,
      message: "Error updating payment status",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   GET PAYMENT HISTORY FOR A MONTH - UPDATED FOR BOTH COLLECTIONS
================================ */
router.get("/clients/:clientId/payment-history", auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        message: "Year and month are required"
      });
    }

    const client = await Client.findOne({ clientId });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // ===== CHECK BOTH COLLECTIONS =====
    const newMonthResult = await getMonthDataFromBoth(clientId, year, month);
    let monthData = null;

    if (newMonthResult.data) {
      monthData = newMonthResult.data;
      logToConsole("DEBUG", "PAYMENT_HISTORY_FROM_NEW_COLLECTION", { clientId, year, month });
    } else {
      const yearKey = String(year);
      const monthKey = String(month);
      if (client.documents.has(yearKey) && client.documents.get(yearKey).has(monthKey)) {
        monthData = client.documents.get(yearKey).get(monthKey);
        logToConsole("DEBUG", "PAYMENT_HISTORY_FROM_OLD_COLLECTION", { clientId, year, month });
      }
    }

    if (!monthData) {
      return res.json({
        success: true,
        paymentHistory: [],
        currentStatus: false,
        message: "No payment history found for this month"
      });
    }

    res.json({
      success: true,
      paymentHistory: monthData.paymentHistory || [],
      currentStatus: monthData.paymentStatus || false
    });

  } catch (error) {
    logToConsole("ERROR", "GET_PAYMENT_HISTORY_ERROR", {
      error: error.message,
      clientId: req.params.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching payment history",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   ADMIN MANUAL TRIGGER PLAN CHANGE
================================ */
router.post("/trigger-plan-change", auth, async (req, res) => {
  try {
    const { processScheduledPlanChanges } = require('../utils/planChangeCron');

    await processScheduledPlanChanges();

    logToConsole("INFO", "MANUAL_PLAN_CHANGE_TRIGGERED", {
      adminId: req.user.adminId,
      adminName: req.user.name
    });

    res.json({
      success: true,
      message: "Plan change cron job executed manually",
      triggeredBy: req.user.name,
      timestamp: new Date().toLocaleString('en-IN')
    });

  } catch (error) {
    logToConsole("ERROR", "MANUAL_PLAN_CHANGE_FAILED", {
      error: error.message,
      adminId: req.user?.adminId
    });

    res.status(500).json({
      success: false,
      message: "Failed to trigger plan changes",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;