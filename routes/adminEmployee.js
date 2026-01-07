const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const sendEmail = require("../utils/sendEmail");

const auth = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");

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

    console.log(`[${timestamp}] ${type}: ${operation}`, data);

    return logEntry;
};

/* ===============================
   CREATE EMPLOYEE (ADMIN ONLY)
================================ */
router.post("/create", auth, async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const employeeId = uuidv4();

        // Console log: Request received
        logToConsole("INFO", "CREATE_EMPLOYEE_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            email,
            phone
        });

        const hashedPassword = await bcrypt.hash(password, 10);

        // Console log: Before creating employee
        logToConsole("DEBUG", "CREATING_EMPLOYEE", {
            employeeId,
            name,
            email,
            phone
        });

        const employee = await Employee.create({
            employeeId,
            name,
            email,
            phone,
            password: hashedPassword,
            createdBy: req.user.adminId
        });

        // Console log: Employee created successfully
        logToConsole("SUCCESS", "EMPLOYEE_CREATED", {
            employeeId,
            email,
            createdBy: req.user.adminId
        });

        try {
            await sendEmail(
                email,
                "Your Employee Account Credentials",
                `
          <p>Hello ${name},</p>
          <p>Your employee account has been created.</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Password:</b> ${password}</p>
        `
            );

            // Console log: Email sent
            logToConsole("INFO", "CREDENTIALS_EMAIL_SENT", { email });
        } catch (emailError) {
            // Console log: Email error (non-critical)
            logToConsole("WARN", "EMAIL_SEND_FAILED", {
                email,
                error: emailError.message
            });
            // Don't fail the whole request if email fails
        }

        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            action: "EMPLOYEE_CREATED",
            details: "Employee created by admin",
            dateTime: new Date().toLocaleString("en-IN")
        });

        // Console log: Activity log created
        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_CREATED",
            employeeId
        });

        res.json({ message: "Employee created successfully" });

        // Console log: Request completed successfully
        logToConsole("SUCCESS", "CREATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success"
        });
    } catch (error) {
        // Console log: Error occurred
        logToConsole("ERROR", "CREATE_EMPLOYEE_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error creating employee",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   LIST EMPLOYEES (ADMIN ONLY)
================================ */
router.get("/all", auth, async (req, res) => {
    try {
        // Console log: Request received
        logToConsole("INFO", "LIST_EMPLOYEES_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name
        });

        const employees = await Employee.find().select("-password");

        // Console log: Employees fetched
        logToConsole("SUCCESS", "EMPLOYEES_FETCHED", {
            count: employees.length,
            adminId: req.user.adminId
        });

        res.json(employees);

        // Console log: Request completed
        logToConsole("INFO", "LIST_EMPLOYEES_COMPLETE", {
            count: employees.length,
            status: "success"
        });
    } catch (error) {
        // Console log: Error occurred
        logToConsole("ERROR", "LIST_EMPLOYEES_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId
        });

        res.status(500).json({
            message: "Error fetching employees",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   UPDATE EMPLOYEE (ADMIN ONLY)
================================ */
router.put("/update/:employeeId", auth, async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const { employeeId } = req.params;

        // Console log: Request received
        logToConsole("INFO", "UPDATE_EMPLOYEE_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            employeeId,
            updates: { name, email, phone, passwordChanged: !!password }
        });

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            // Console log: Employee not found
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { employeeId });

            return res.status(404).json({ message: "Employee not found" });
        }

        // Console log: Current employee data
        logToConsole("DEBUG", "CURRENT_EMPLOYEE_DATA", {
            currentName: employee.name,
            currentEmail: employee.email,
            currentPhone: employee.phone
        });

        let passwordChanged = false;
        const oldEmail = employee.email;

        employee.name = name;
        employee.email = email;
        employee.phone = phone;

        if (password && password.trim() !== "") {
            employee.password = await bcrypt.hash(password, 10);
            passwordChanged = true;

            // Console log: Password being changed
            logToConsole("INFO", "PASSWORD_CHANGE", { employeeId });

            try {
                await sendEmail(
                    email,
                    "Updated Employee Password",
                    `
            <p>Your employee account password has been updated.</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>New Password:</b> ${password}</p>
          `
                );

                // Console log: Password change email sent
                logToConsole("INFO", "PASSWORD_CHANGE_EMAIL_SENT", { email });
            } catch (emailError) {
                // Console log: Email error
                logToConsole("WARN", "PASSWORD_CHANGE_EMAIL_FAILED", {
                    email,
                    error: emailError.message
                });
            }
        }

        await employee.save();

        // Console log: Employee updated successfully
        logToConsole("SUCCESS", "EMPLOYEE_UPDATED", {
            employeeId,
            passwordChanged,
            emailChanged: oldEmail !== email
        });

        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            action: "EMPLOYEE_UPDATED",
            details: passwordChanged
                ? "Employee updated (password changed)"
                : "Employee updated",
            dateTime: new Date().toLocaleString("en-IN")
        });

        // Console log: Activity log created
        logToConsole("INFO", "UPDATE_ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_UPDATED",
            employeeId,
            passwordChanged
        });

        res.json({ message: "Employee updated successfully" });

        // Console log: Request completed
        logToConsole("SUCCESS", "UPDATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success"
        });
    } catch (error) {
        // Console log: Error occurred
        logToConsole("ERROR", "UPDATE_EMPLOYEE_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            employeeId: req.params.employeeId,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error updating employee",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});



router.get("/all-clients", auth, async (req, res) => {
    try {
        const clients = await Client.find()
            .select("clientId name email phone isActive createdAt")
            .sort({ createdAt: -1 });

        res.json(clients);
    } catch (error) {
        console.error("ADMIN_CLIENT_LIST_ERROR:", error.message);
        res.status(500).json({
            message: "Error fetching clients"
        });
    }
});
/* ===============================
   ASSIGN CLIENT TO EMPLOYEE
   (ADMIN ONLY | MONTH-WISE)
================================ */




router.post("/assign-client", auth, async (req, res) => {
    const { clientId, employeeId, year, month } = req.body;

    // ===== BASIC VALIDATION =====
    if (!clientId || !employeeId || !year || !month) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        logToConsole("INFO", "ASSIGN_CLIENT_REQUEST", {
            adminId: req.user.adminId,
            clientId,
            employeeId,
            year,
            month
        });

        // ===== FETCH CLIENT =====
        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND", { clientId });
            return res.status(404).json({ message: "Client not found" });
        }

        // ===== FETCH EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { employeeId });
            return res.status(404).json({ message: "Employee not found" });
        }

        // ===== VALIDATE YEAR-MONTH =====
        const numericMonth = parseInt(month);
        const numericYear = parseInt(year);

        if (numericMonth < 1 || numericMonth > 12) {
            logToConsole("WARN", "INVALID_MONTH", { month });
            return res.status(400).json({ message: "Invalid month (1-12)" });
        }

        if (numericYear < 2020 || numericYear > 2100) {
            logToConsole("WARN", "INVALID_YEAR", { year });
            return res.status(400).json({ message: "Invalid year" });
        }

        // ===== DUPLICATE CHECK (CRITICAL) =====
        const alreadyAssigned = client.employeeAssignments.some(
            (a) => a.year === numericYear && a.month === numericMonth
        );

        if (alreadyAssigned) {
            logToConsole("WARN", "DUPLICATE_ASSIGNMENT", {
                clientId,
                year: numericYear,
                month: numericMonth,
                existingAssignment: client.employeeAssignments.find(
                    a => a.year === numericYear && a.month === numericMonth
                )
            });
            return res.status(409).json({
                message: `Client already assigned for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`
            });
        }

        // ===== CHECK IF EMPLOYEE ALREADY HAS THIS CLIENT THIS MONTH =====
        const employeeAlreadyHas = employee.assignedClients.some(
            (ac) =>
                ac.clientId === clientId &&
                ac.year === numericYear &&
                ac.month === numericMonth
        );

        if (employeeAlreadyHas) {
            logToConsole("WARN", "EMPLOYEE_ALREADY_HAS_CLIENT", {
                employeeId,
                clientId,
                year: numericYear,
                month: numericMonth
            });
            return res.status(409).json({
                message: `Employee already has this client for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`
            });
        }

        logToConsole("DEBUG", "VALIDATION_PASSED", {
            clientId,
            employeeId,
            year: numericYear,
            month: numericMonth
        });

        // ===== PREPARE ASSIGNMENT OBJECT =====
        const assignmentPayload = {
            year: numericYear,
            month: numericMonth,
            employeeId,
            assignedBy: req.user.adminId,
            assignedAt: new Date(),
            employeeName: employee.name,
            adminName: req.user.name
        };

        const employeePayload = {
            clientId,
            clientName: client.name,
            year: numericYear,
            month: numericMonth,
            assignedBy: req.user.adminId,
            assignedAt: new Date(),
            adminName: req.user.name
        };

        // ===== SAVE TO CLIENT FIRST =====
        client.employeeAssignments.push(assignmentPayload);
        await client.save();

        logToConsole("INFO", "CLIENT_ASSIGNMENT_SAVED", {
            clientId: client.clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth
        });

        try {
            // ===== SAVE TO EMPLOYEE =====
            employee.assignedClients.push(employeePayload);
            await employee.save();

            logToConsole("INFO", "EMPLOYEE_ASSIGNMENT_SAVED", {
                employeeId: employee.employeeId,
                employeeName: employee.name,
                clientId,
                clientName: client.name,
                year: numericYear,
                month: numericMonth
            });
        } catch (employeeSaveError) {
            // ===== ROLLBACK CLIENT UPDATE =====
            const originalLength = client.employeeAssignments.length;
            client.employeeAssignments = client.employeeAssignments.filter(
                (a) =>
                    !(
                        a.year === numericYear &&
                        a.month === numericMonth &&
                        a.employeeId === employeeId
                    )
            );
            await client.save();

            logToConsole("ERROR", "EMPLOYEE_SAVE_FAILED_ROLLBACK_DONE", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth,
                error: employeeSaveError.message,
                rollbackRemoved: originalLength - client.employeeAssignments.length
            });

            return res.status(500).json({
                message: "Assignment failed, rollback completed",
                error: process.env.NODE_ENV === "development" ? employeeSaveError.message : undefined
            });
        }

        // ===== ACTIVITY LOG =====
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,
                employeeId,
                employeeName: employee.name,
                clientId,
                clientName: client.name,
                action: "CLIENT_ASSIGNED_TO_EMPLOYEE",
                details: `Client "${client.name}" (${clientId}) assigned to employee "${employee.name}" (${employeeId}) for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`,
                dateTime: new Date().toLocaleString("en-IN")
            });

            logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
                action: "CLIENT_ASSIGNED_TO_EMPLOYEE",
                clientId,
                employeeId
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
                error: logError.message,
                clientId,
                employeeId
            });
            // Don't fail the whole operation if activity log fails
        }

        // ===== SEND NOTIFICATION EMAIL (OPTIONAL) =====
        try {
            await sendEmail(
                employee.email,
                "New Client Assignment",
                `
          <p>Hello ${employee.name},</p>
          <p>You have been assigned a new client for ${numericYear}-${numericMonth.toString().padStart(2, '0')}.</p>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Client ID:</b> ${clientId}</p>
          <p><b>Assigned By:</b> ${req.user.name}</p>
          <p><b>Assigned For:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p>Please check your dashboard for more details.</p>
        `
            );

            logToConsole("INFO", "ASSIGNMENT_EMAIL_SENT", {
                employeeEmail: employee.email,
                employeeName: employee.name
            });
        } catch (emailError) {
            logToConsole("WARN", "ASSIGNMENT_EMAIL_FAILED", {
                employeeEmail: employee.email,
                error: emailError.message
            });
            // Don't fail the operation if email fails
        }

        logToConsole("SUCCESS", "CLIENT_ASSIGNED_SUCCESSFULLY", {
            clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth,
            timestamp: new Date().toISOString()
        });

        res.json({
            message: "Client assigned to employee successfully",
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                assignedAt: new Date()
            }
        });
    } catch (error) {
        logToConsole("ERROR", "ASSIGN_CLIENT_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            clientId: req.body?.clientId,
            employeeId: req.body?.employeeId,
            year: req.body?.year,
            month: req.body?.month
        });

        res.status(500).json({
            message: "Error assigning client",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});


module.exports = router;