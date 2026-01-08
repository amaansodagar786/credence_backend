const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");
const sendEmail = require("../utils/sendEmail");

const auth = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");

const Client = require("../models/Client");
const RemovedAssignment = require("../models/RemovedAssignment");



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
   ASSIGN CLIENT TO EMPLOYEE (UPDATED WITH TASK)
================================ */
router.post("/assign-client", auth, async (req, res) => {
    const { clientId, employeeId, year, month, task } = req.body;

    // ===== BASIC VALIDATION =====
    if (!clientId || !employeeId || !year || !month || !task) {
        logToConsole("WARN", "ASSIGN_CLIENT_MISSING_FIELDS", req.body);
        return res.status(400).json({
            message: "Missing required fields: clientId, employeeId, year, month, task"
        });
    }

    // Validate task
    const validTasks = ['Bookkeeping', 'VAT Filing Computation', 'VAT Filing', 'Financial Statement Generation'];
    if (!validTasks.includes(task)) {
        logToConsole("WARN", "INVALID_TASK", { task, validTasks });
        return res.status(400).json({
            message: "Invalid task. Must be one of: " + validTasks.join(", ")
        });
    }

    try {
        logToConsole("INFO", "ASSIGN_CLIENT_WITH_TASK_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            employeeId,
            year,
            month,
            task
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

        // ===== DUPLICATE CHECK =====
        const alreadyAssigned = client.employeeAssignments.some(
            (a) => a.year === numericYear && a.month === numericMonth && !a.isRemoved
        );

        if (alreadyAssigned) {
            logToConsole("WARN", "DUPLICATE_ASSIGNMENT", {
                clientId,
                year: numericYear,
                month: numericMonth
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
                ac.month === numericMonth &&
                !ac.isRemoved
        );

        if (employeeAlreadyHas) {
            logToConsole("WARN", "EMPLOYEE_ALREADY_HAS_CLIENT", {
                employeeId,
                clientId,
                year: numericYear,
                month: numericYear
            });
            return res.status(409).json({
                message: `Employee already has this client for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`
            });
        }

        logToConsole("DEBUG", "VALIDATION_PASSED", {
            clientId,
            employeeId,
            year: numericYear,
            month: numericMonth,
            task
        });

        // ===== PREPARE ASSIGNMENT OBJECTS =====
        const assignmentDate = new Date();

        // For Client Schema
        const clientAssignment = {
            year: numericYear,
            month: numericMonth,
            employeeId,
            employeeName: employee.name,
            assignedAt: assignmentDate,
            assignedBy: req.user.adminId,
            adminName: req.user.name,
            task: task, // NEW: Added task
            accountingDone: false,
            isRemoved: false
        };

        // For Employee Schema
        const employeeAssignment = {
            clientId,
            clientName: client.name,
            year: numericYear,
            month: numericMonth,
            assignedAt: assignmentDate,
            assignedBy: req.user.adminId,
            adminName: req.user.name,
            task: task, // NEW: Added task
            accountingDone: false,
            isRemoved: false
        };

        // ===== SAVE TO CLIENT FIRST =====
        client.employeeAssignments.push(clientAssignment);
        await client.save();

        logToConsole("INFO", "CLIENT_ASSIGNMENT_SAVED_WITH_TASK", {
            clientId: client.clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth,
            task
        });

        try {
            // ===== SAVE TO EMPLOYEE =====
            employee.assignedClients.push(employeeAssignment);
            await employee.save();

            logToConsole("INFO", "EMPLOYEE_ASSIGNMENT_SAVED_WITH_TASK", {
                employeeId: employee.employeeId,
                employeeName: employee.name,
                clientId,
                clientName: client.name,
                year: numericYear,
                month: numericMonth,
                task
            });
        } catch (employeeSaveError) {
            // ===== ROLLBACK CLIENT UPDATE =====
            client.employeeAssignments = client.employeeAssignments.filter(
                (a) => !(a.year === numericYear && a.month === numericMonth)
            );
            await client.save();

            logToConsole("ERROR", "EMPLOYEE_SAVE_FAILED_ROLLBACK_DONE", {
                clientId,
                employeeId,
                error: employeeSaveError.message
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
                action: "CLIENT_ASSIGNED_TO_EMPLOYEE_WITH_TASK",
                details: `Client "${client.name}" assigned to employee "${employee.name}" for ${numericYear}-${numericMonth.toString().padStart(2, '0')} with task: ${task}`,
                dateTime: new Date().toLocaleString("en-IN"),
                metadata: { task, year: numericYear, month: numericMonth }
            });

            logToConsole("INFO", "ACTIVITY_LOG_CREATED_WITH_TASK", {
                action: "CLIENT_ASSIGNED_TO_EMPLOYEE_WITH_TASK",
                clientId,
                employeeId,
                task
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED", {
                error: logError.message
            });
        }

        // ===== SEND NOTIFICATION EMAIL =====
        try {
            await sendEmail(
                employee.email,
                "New Client Assignment with Task",
                `
          <p>Hello ${employee.name},</p>
          <p>You have been assigned a new client with specific task.</p>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Client ID:</b> ${clientId}</p>
          <p><b>Assigned Task:</b> ${task}</p>
          <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p><b>Assigned By:</b> ${req.user.name}</p>
          <p>Please check your dashboard and complete the assigned task.</p>
        `
            );

            logToConsole("INFO", "ASSIGNMENT_EMAIL_SENT_WITH_TASK", {
                employeeEmail: employee.email
            });
        } catch (emailError) {
            logToConsole("WARN", "ASSIGNMENT_EMAIL_FAILED", {
                error: emailError.message
            });
        }

        logToConsole("SUCCESS", "CLIENT_ASSIGNED_SUCCESSFULLY_WITH_TASK", {
            clientId,
            employeeId,
            task,
            timestamp: assignmentDate.toISOString()
        });

        res.json({
            message: "Client assigned to employee with task successfully",
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                task,
                assignedAt: assignmentDate
            }
        });
    } catch (error) {
        logToConsole("ERROR", "ASSIGN_CLIENT_WITH_TASK_FAILED", {
            error: error.message,
            stack: error.stack,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error assigning client with task",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});

/* ===============================
   REMOVE ASSIGNMENT (NEW ENDPOINT)
   Only for pending assignments (accountingDone: false)
================================ */
router.delete("/remove-assignment", auth, async (req, res) => {
    const { clientId, employeeId, year, month } = req.body;

    // ===== VALIDATION =====
    if (!clientId || !employeeId || !year || !month) {
        logToConsole("WARN", "REMOVE_ASSIGNMENT_MISSING_FIELDS", req.body);
        return res.status(400).json({
            message: "Missing required fields: clientId, employeeId, year, month"
        });
    }

    try {
        logToConsole("INFO", "REMOVE_ASSIGNMENT_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            employeeId,
            year,
            month
        });

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        // ===== FETCH CLIENT AND EMPLOYEE =====
        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_REMOVAL", { clientId });
            return res.status(404).json({ message: "Client not found" });
        }

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND_FOR_REMOVAL", { employeeId });
            return res.status(404).json({ message: "Employee not found" });
        }

        // ===== FIND ASSIGNMENT IN CLIENT =====
        const clientAssignment = client.employeeAssignments.find(
            a => a.year === numericYear &&
                a.month === numericMonth &&
                a.employeeId === employeeId &&
                !a.isRemoved
        );

        if (!clientAssignment) {
            logToConsole("WARN", "ASSIGNMENT_NOT_FOUND_IN_CLIENT", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth
            });
            return res.status(404).json({ message: "Assignment not found in client records" });
        }

        // ===== CHECK IF ACCOUNTING IS DONE =====
        if (clientAssignment.accountingDone) {
            logToConsole("WARN", "CANNOT_REMOVE_DONE_ASSIGNMENT", {
                clientId,
                employeeId,
                accountingDone: true,
                accountingDoneAt: clientAssignment.accountingDoneAt
            });
            return res.status(400).json({
                message: "Cannot remove assignment because accounting is already marked as DONE"
            });
        }

        // ===== FIND ASSIGNMENT IN EMPLOYEE =====
        const employeeAssignment = employee.assignedClients.find(
            a => a.clientId === clientId &&
                a.year === numericYear &&
                a.month === numericMonth &&
                !a.isRemoved
        );

        if (!employeeAssignment) {
            logToConsole("WARN", "ASSIGNMENT_NOT_FOUND_IN_EMPLOYEE", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth
            });
            return res.status(404).json({ message: "Assignment not found in employee records" });
        }

        // ===== SAVE TO REMOVED ASSIGNMENTS HISTORY =====
        try {
            const removalDate = new Date();
            const originallyAssignedAt = clientAssignment.assignedAt;
            const durationDays = originallyAssignedAt ?
                Math.floor((removalDate - originallyAssignedAt) / (1000 * 60 * 60 * 24)) : null;

            await RemovedAssignment.create({
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                task: clientAssignment.task,
                originallyAssignedAt: clientAssignment.assignedAt,
                originallyAssignedBy: clientAssignment.assignedBy,
                adminName: clientAssignment.adminName,
                removedAt: removalDate,
                removedBy: req.user.adminId,
                removerName: req.user.name,
                removalReason: "Admin removed pending assignment",
                wasAccountingDone: clientAssignment.accountingDone,
                durationDays,
                notes: `Assignment removed by admin ${req.user.name}`
            });

            logToConsole("INFO", "REMOVED_ASSIGNMENT_HISTORY_SAVED", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth,
                task: clientAssignment.task
            });
        } catch (historyError) {
            logToConsole("ERROR", "REMOVED_ASSIGNMENT_HISTORY_FAILED", {
                error: historyError.message
            });
            // Continue with removal even if history fails
        }

        // ===== MARK AS REMOVED IN CLIENT =====
        clientAssignment.isRemoved = true;
        clientAssignment.removedAt = new Date();
        clientAssignment.removedBy = req.user.adminId;
        clientAssignment.removalReason = "Admin removed assignment";

        await client.save();

        // ===== MARK AS REMOVED IN EMPLOYEE =====
        employeeAssignment.isRemoved = true;
        employeeAssignment.removedAt = new Date();
        employeeAssignment.removedBy = req.user.adminId;
        employeeAssignment.removalReason = "Admin removed assignment";

        await employee.save();

        logToConsole("SUCCESS", "ASSIGNMENT_REMOVED_SUCCESSFULLY", {
            clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth,
            task: clientAssignment.task,
            removedBy: req.user.name
        });

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
                action: "ASSIGNMENT_REMOVED",
                details: `Assignment removed: Client "${client.name}" from employee "${employee.name}" for ${numericYear}-${numericMonth.toString().padStart(2, '0')} (Task: ${clientAssignment.task})`,
                dateTime: new Date().toLocaleString("en-IN"),
                metadata: {
                    task: clientAssignment.task,
                    year: numericYear,
                    month: numericMonth,
                    wasAccountingDone: false
                }
            });

            logToConsole("INFO", "REMOVAL_ACTIVITY_LOG_CREATED", {
                action: "ASSIGNMENT_REMOVED",
                clientId,
                employeeId
            });
        } catch (logError) {
            logToConsole("ERROR", "REMOVAL_ACTIVITY_LOG_FAILED", {
                error: logError.message
            });
        }

        // ===== SEND NOTIFICATION EMAIL =====
        try {
            await sendEmail(
                employee.email,
                "Assignment Removed",
                `
          <p>Hello ${employee.name},</p>
          <p>Your assignment has been removed by admin.</p>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Task:</b> ${clientAssignment.task}</p>
          <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p><b>Removed By:</b> ${req.user.name}</p>
          <p><b>Removed At:</b> ${new Date().toLocaleString("en-IN")}</p>
          <p>This assignment will no longer appear in your active tasks.</p>
        `
            );

            logToConsole("INFO", "REMOVAL_EMAIL_SENT", {
                employeeEmail: employee.email
            });
        } catch (emailError) {
            logToConsole("WARN", "REMOVAL_EMAIL_FAILED", {
                error: emailError.message
            });
        }

        res.json({
            message: "Assignment removed successfully",
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                task: clientAssignment.task,
                removedAt: new Date(),
                removedBy: req.user.name
            }
        });

    } catch (error) {
        logToConsole("ERROR", "REMOVE_ASSIGNMENT_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error removing assignment",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});

/* ===============================
   GET ALL REMOVED ASSIGNMENTS (Optional - for admin view)
================================ */
router.get("/removed-assignments", auth, async (req, res) => {
    try {
        logToConsole("INFO", "GET_REMOVED_ASSIGNMENTS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name
        });

        const { page = 1, limit = 50, clientId, employeeId, year, month } = req.query;

        const query = {};
        if (clientId) query.clientId = clientId;
        if (employeeId) query.employeeId = employeeId;
        if (year) query.year = parseInt(year);
        if (month) query.month = parseInt(month);

        const removedAssignments = await RemovedAssignment.find(query)
            .sort({ removedAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await RemovedAssignment.countDocuments(query);

        logToConsole("INFO", "REMOVED_ASSIGNMENTS_FETCHED", {
            count: removedAssignments.length,
            total,
            page,
            limit
        });

        res.json({
            success: true,
            data: removedAssignments,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logToConsole("ERROR", "GET_REMOVED_ASSIGNMENTS_FAILED", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            message: "Error fetching removed assignments",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});




/* ===============================
   DEACTIVATE EMPLOYEE (SOFT DELETE)
================================ */
router.post("/deactivate/:employeeId", auth, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Console log: Request received
        logToConsole("INFO", "DEACTIVATE_EMPLOYEE_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            employeeId
        });

        // ===== 1. FIND EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { employeeId });
            return res.status(404).json({ message: "Employee not found" });
        }

        // Console log: Employee found
        logToConsole("DEBUG", "EMPLOYEE_FOUND", {
            employeeId,
            employeeName: employee.name,
            isActive: employee.isActive
        });

        // ===== 2. FIND CURRENT MONTH ASSIGNMENTS =====
        const currentAssignments = employee.assignedClients?.filter(
            assignment => assignment.year === currentYear && assignment.month === currentMonth
        ) || [];

        logToConsole("INFO", "CURRENT_ASSIGNMENTS_FOUND", {
            employeeId,
            currentAssignmentsCount: currentAssignments.length,
            currentYear,
            currentMonth
        });

        // ===== 3. REMOVE ASSIGNMENTS FROM CLIENTS =====
        let removedFromClients = 0;

        if (currentAssignments.length > 0) {
            for (const assignment of currentAssignments) {
                try {
                    // Find client
                    const client = await Client.findOne({ clientId: assignment.clientId });
                    if (client) {
                        // Remove this employee from client's assignments for current month
                        const originalCount = client.employeeAssignments.length;
                        client.employeeAssignments = client.employeeAssignments.filter(
                            empAssignment =>
                                !(empAssignment.year === currentYear &&
                                    empAssignment.month === currentMonth &&
                                    empAssignment.employeeId === employeeId)
                        );

                        await client.save();
                        const removedCount = originalCount - client.employeeAssignments.length;
                        removedFromClients += removedCount;

                        logToConsole("INFO", "CLIENT_ASSIGNMENT_REMOVED", {
                            clientId: assignment.clientId,
                            clientName: client.name,
                            removedCount,
                            employeeId
                        });
                    }
                } catch (clientError) {
                    logToConsole("ERROR", "CLIENT_UPDATE_FAILED", {
                        clientId: assignment.clientId,
                        error: clientError.message,
                        employeeId
                    });
                    // Continue with other clients even if one fails
                }
            }
        }

        // ===== 4. UPDATE EMPLOYEE STATUS =====
        employee.isActive = false;
        employee.updatedAt = new Date();
        await employee.save();

        // Console log: Employee deactivated
        logToConsole("SUCCESS", "EMPLOYEE_DEACTIVATED", {
            employeeId,
            employeeName: employee.name,
            currentAssignmentsRemoved: currentAssignments.length,
            removedFromClients
        });

        // ===== 5. ACTIVITY LOG =====
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            employeeName: employee.name,
            action: "EMPLOYEE_DEACTIVATED",
            details: `Employee "${employee.name}" deactivated. Removed from ${removedFromClients} client assignments for ${currentYear}-${currentMonth.toString().padStart(2, '0')}`,
            dateTime: new Date().toLocaleString("en-IN")
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_DEACTIVATED",
            employeeId
        });

        res.json({
            message: `Employee deactivated successfully. Removed from ${removedFromClients} current month client assignments.`,
            data: {
                employeeId,
                employeeName: employee.name,
                assignmentsRemoved: removedFromClients,
                deactivatedAt: new Date()
            }
        });

        logToConsole("SUCCESS", "DEACTIVATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success",
            assignmentsRemoved: removedFromClients
        });
    } catch (error) {
        logToConsole("ERROR", "DEACTIVATE_EMPLOYEE_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            employeeId: req.params.employeeId
        });

        res.status(500).json({
            message: "Error deactivating employee",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   ACTIVATE EMPLOYEE
================================ */
router.post("/activate/:employeeId", auth, async (req, res) => {
    try {
        const { employeeId } = req.params;

        // Console log: Request received
        logToConsole("INFO", "ACTIVATE_EMPLOYEE_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            employeeId
        });

        // ===== 1. FIND EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { employeeId });
            return res.status(404).json({ message: "Employee not found" });
        }

        // Console log: Employee found
        logToConsole("DEBUG", "EMPLOYEE_FOUND", {
            employeeId,
            employeeName: employee.name,
            isActive: employee.isActive
        });

        // ===== 2. ACTIVATE EMPLOYEE =====
        employee.isActive = true;
        employee.updatedAt = new Date();
        await employee.save();

        // Console log: Employee activated
        logToConsole("SUCCESS", "EMPLOYEE_ACTIVATED", {
            employeeId,
            employeeName: employee.name
        });

        // ===== 3. ACTIVITY LOG =====
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            employeeName: employee.name,
            action: "EMPLOYEE_ACTIVATED",
            details: `Employee "${employee.name}" activated`,
            dateTime: new Date().toLocaleString("en-IN")
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_ACTIVATED",
            employeeId
        });

        res.json({
            message: "Employee activated successfully",
            data: {
                employeeId,
                employeeName: employee.name,
                activatedAt: new Date()
            }
        });

        logToConsole("SUCCESS", "ACTIVATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success"
        });
    } catch (error) {
        logToConsole("ERROR", "ACTIVATE_EMPLOYEE_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            employeeId: req.params.employeeId
        });

        res.status(500).json({
            message: "Error activating employee",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;