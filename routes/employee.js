const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");

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

module.exports = router;