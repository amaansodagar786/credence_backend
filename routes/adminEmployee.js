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
// Add this with other requires at the top of employeeRoutes.js
const EmployeeAssignment = require("../models/EmployeeAssignment");

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
            phone,
            adminId: req.user.adminId
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
            logToConsole("INFO", "CREDENTIALS_EMAIL_SENT", {
                email,
                adminId: req.user.adminId
            });
        } catch (emailError) {
            // Console log: Email error (non-critical)
            logToConsole("WARN", "EMAIL_SEND_FAILED", {
                email,
                error: emailError.message,
                adminId: req.user.adminId
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
            dateTime: new Date()  // FIXED: Use Date object instead of String
        });

        // Console log: Activity log created
        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_CREATED",
            employeeId,
            adminId: req.user.adminId
        });

        res.json({ message: "Employee created successfully" });

        // Console log: Request completed successfully
        logToConsole("SUCCESS", "CREATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success",
            adminId: req.user.adminId
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

        // Create activity log for listing employees
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            action: "EMPLOYEES_LISTED",
            details: `Admin listed all employees (${employees.length} employees)`,
            dateTime: new Date()  // FIXED: Use Date object instead of String
        });

        // Console log: Activity log created
        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEES_LISTED",
            adminId: req.user.adminId,
            employeeCount: employees.length
        });

        res.json(employees);

        // Console log: Request completed
        logToConsole("INFO", "LIST_EMPLOYEES_COMPLETE", {
            count: employees.length,
            status: "success",
            adminId: req.user.adminId
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
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
                employeeId,
                adminId: req.user.adminId
            });

            return res.status(404).json({ message: "Employee not found" });
        }

        // Console log: Current employee data
        logToConsole("DEBUG", "CURRENT_EMPLOYEE_DATA", {
            currentName: employee.name,
            currentEmail: employee.email,
            currentPhone: employee.phone,
            adminId: req.user.adminId
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
            logToConsole("INFO", "PASSWORD_CHANGE", {
                employeeId,
                adminId: req.user.adminId
            });

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
                logToConsole("INFO", "PASSWORD_CHANGE_EMAIL_SENT", {
                    email,
                    adminId: req.user.adminId
                });
            } catch (emailError) {
                // Console log: Email error
                logToConsole("WARN", "PASSWORD_CHANGE_EMAIL_FAILED", {
                    email,
                    error: emailError.message,
                    adminId: req.user.adminId
                });
            }
        }

        await employee.save();

        // Console log: Employee updated successfully
        logToConsole("SUCCESS", "EMPLOYEE_UPDATED", {
            employeeId,
            passwordChanged,
            emailChanged: oldEmail !== email,
            adminId: req.user.adminId
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
            dateTime: new Date()  // FIXED: Use Date object instead of String
        });

        // Console log: Activity log created
        logToConsole("INFO", "UPDATE_ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_UPDATED",
            employeeId,
            passwordChanged,
            adminId: req.user.adminId
        });

        res.json({ message: "Employee updated successfully" });

        // Console log: Request completed
        logToConsole("SUCCESS", "UPDATE_EMPLOYEE_COMPLETE", {
            employeeId,
            status: "success",
            adminId: req.user.adminId
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
        // Console log: Request received
        logToConsole("INFO", "LIST_CLIENTS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name
        });

        const clients = await Client.find()
            .select("clientId name email phone isActive createdAt")
            .sort({ createdAt: -1 });

        // Console log: Clients fetched
        logToConsole("SUCCESS", "CLIENTS_FETCHED", {
            count: clients.length,
            adminId: req.user.adminId
        });

        // Create activity log for listing clients
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            action: "CLIENTS_LISTED",
            details: `Admin listed all clients (${clients.length} clients)`,
            dateTime: new Date()  // FIXED: Use Date object instead of String
        });

        // Console log: Activity log created
        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "CLIENTS_LISTED",
            adminId: req.user.adminId,
            clientCount: clients.length
        });

        res.json(clients);

        // Console log: Request completed
        logToConsole("INFO", "LIST_CLIENTS_COMPLETE", {
            count: clients.length,
            status: "success",
            adminId: req.user.adminId
        });
    } catch (error) {
        console.error("ADMIN_CLIENT_LIST_ERROR:", error.message);

        // Console log: Error occurred
        logToConsole("ERROR", "LIST_CLIENTS_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId
        });

        res.status(500).json({
            message: "Error fetching clients"
        });
    }
});


/* ===============================
   ASSIGN CLIENT TO EMPLOYEE (UPDATED FOR MULTIPLE TASKS)
   DOCUMENT CHECK REMOVED - ASSIGNMENT ALLOWED WITHOUT DOCUMENTS
================================ */
router.post("/assign-client", auth, async (req, res) => {
    const { clientId, employeeId, year, month, tasks } = req.body;

    // ===== BASIC VALIDATION =====
    if (!clientId || !employeeId || !year || !month || !tasks) {
        logToConsole("WARN", "ASSIGN_CLIENT_MISSING_FIELDS", {
            ...req.body,
            adminId: req.user.adminId
        });
        return res.status(400).json({
            message: "Missing required fields: clientId, employeeId, year, month, tasks"
        });
    }

    // Ensure tasks is an array
    if (!Array.isArray(tasks) || tasks.length === 0) {
        logToConsole("WARN", "INVALID_TASKS_ARRAY", {
            tasks,
            adminId: req.user.adminId
        });
        return res.status(400).json({
            message: "Tasks must be a non-empty array"
        });
    }

    // Validate each task
    const validTasks = ['Bookkeeping', 'VAT Filing Computation', 'VAT Filing', 'Financial Statement Generation', 'Audit'];
    const invalidTasks = tasks.filter(task => !validTasks.includes(task));

    if (invalidTasks.length > 0) {
        logToConsole("WARN", "INVALID_TASKS_FOUND", {
            invalidTasks,
            validTasks,
            adminId: req.user.adminId
        });
        return res.status(400).json({
            message: `Invalid tasks found: ${invalidTasks.join(', ')}. Must be one of: ${validTasks.join(", ")}`
        });
    }

    try {
        logToConsole("INFO", "ASSIGN_MULTIPLE_TASKS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            employeeId,
            year,
            month,
            tasks
        });

        // ===== FETCH CLIENT =====
        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND", {
                clientId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Client not found" });
        }

        // ===== FETCH EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
                employeeId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Employee not found" });
        }

        // ===== VALIDATE YEAR-MONTH =====
        const numericMonth = parseInt(month);
        const numericYear = parseInt(year);

        if (numericMonth < 1 || numericMonth > 12) {
            logToConsole("WARN", "INVALID_MONTH", {
                month,
                adminId: req.user.adminId
            });
            return res.status(400).json({ message: "Invalid month (1-12)" });
        }

        if (numericYear < 2020 || numericYear > 2100) {
            logToConsole("WARN", "INVALID_YEAR", {
                year,
                adminId: req.user.adminId
            });
            return res.status(400).json({ message: "Invalid year" });
        }

        // ===== DOCUMENT CHECK REMOVED - NO LONGER VALIDATING DOCUMENTS =====

        // ===== CHECK FOR DUPLICATE AND ALREADY ASSIGNED TASKS =====
        const alreadyAssignedTasks = [];
        const assignableTasks = [];

        for (const task of tasks) {
            // Check in CLIENT first
            const taskAlreadyAssigned = client.employeeAssignments.some(
                (a) => a.year === numericYear &&
                    a.month === numericMonth &&
                    a.task === task &&
                    !a.isRemoved
            );

            // Check in NEW COLLECTION (EmployeeAssignment)
            const EmployeeAssignment = require("../models/EmployeeAssignment");
            const newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });
            const employeeAlreadyHasTask = newDoc?.assignedClients?.some(
                (ac) => ac.clientId === clientId &&
                    ac.year === numericYear &&
                    ac.month === numericMonth &&
                    ac.task === task &&
                    !ac.isRemoved
            ) || false;

            if (taskAlreadyAssigned || employeeAlreadyHasTask) {
                alreadyAssignedTasks.push(task);
            } else {
                assignableTasks.push(task);
            }
        }

        if (assignableTasks.length === 0) {
            logToConsole("WARN", "ALL_TASKS_ALREADY_ASSIGNED", {
                clientId,
                year: numericYear,
                month: numericMonth,
                tasks,
                adminId: req.user.adminId
            });
            return res.status(409).json({
                message: `All selected tasks are already assigned: ${alreadyAssignedTasks.join(', ')}`
            });
        }

        const existingAssignments = client.employeeAssignments.filter(
            a => a.year === numericYear && a.month === numericMonth && !a.isRemoved
        );

        // ===== PREPARE ASSIGNMENT OBJECTS FOR EACH TASK =====
        const assignmentDate = new Date();
        const clientAssignments = [];
        const employeeAssignments = [];

        for (const task of assignableTasks) {
            const clientAssignment = {
                year: numericYear,
                month: numericMonth,
                employeeId,
                employeeName: employee.name,
                assignedAt: assignmentDate,
                assignedBy: req.user.adminId,
                adminName: req.user.name,
                task: task,
                accountingDone: false,
                isRemoved: false
            };
            const employeeAssignment = {
                clientId,
                clientName: client.name,
                year: numericYear,
                month: numericMonth,
                assignedAt: assignmentDate,
                assignedBy: req.user.adminId,
                adminName: req.user.name,
                task: task,
                accountingDone: false,
                isRemoved: false
            };
            clientAssignments.push(clientAssignment);
            employeeAssignments.push(employeeAssignment);
        }

        // ===== SAVE TO CLIENT FIRST =====
        client.employeeAssignments.push(...clientAssignments);
        await client.save();

        // ===== [ONLY] SAVE TO NEW COLLECTION (NOT to Employee.assignedClients) =====
        try {
            const EmployeeAssignment = require("../models/EmployeeAssignment");
            let newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });

            if (!newDoc) {
                newDoc = new EmployeeAssignment({
                    employeeId: employee.employeeId,
                    employeeName: employee.name,
                    employeeEmail: employee.email,
                    assignedClients: []
                });
            }

            // Update name/email
            newDoc.employeeName = employee.name;
            newDoc.employeeEmail = employee.email;

            // Add new assignments
            for (const empAssign of employeeAssignments) {
                const existingIndex = newDoc.assignedClients.findIndex(
                    a => a.clientId === empAssign.clientId &&
                        a.year === empAssign.year &&
                        a.month === empAssign.month &&
                        a.task === empAssign.task
                );
                if (existingIndex !== -1) {
                    newDoc.assignedClients[existingIndex] = { ...newDoc.assignedClients[existingIndex], ...empAssign };
                } else {
                    newDoc.assignedClients.push(empAssign);
                }
            }

            await newDoc.save();
            logToConsole("INFO", "SAVED_TO_NEW_COLLECTION_ONLY", {
                employeeId: employee.employeeId,
                tasks: assignableTasks,
                message: "NOT saved to Employee.assignedClients (old array)"
            });
        } catch (newCollectionError) {
            logToConsole("ERROR", "NEW_COLLECTION_SAVE_FAILED", {
                error: newCollectionError.message,
                employeeId: employee.employeeId
            });
            return res.status(500).json({
                message: "Assignment failed. Could not save to new collection.",
                error: process.env.NODE_ENV === "development" ? newCollectionError.message : undefined
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
                action: "TASKS_ASSIGNED_BULK",
                details: `Tasks [${assignableTasks.join(', ')}] assigned to employee "${employee.name}" for client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')}) - Document check skipped`,
                dateTime: new Date(),
                metadata: {
                    tasks: assignableTasks,
                    year: numericYear,
                    month: numericMonth,
                    totalTasksAssigned: existingAssignments.length + assignableTasks.length,
                    documentsVerified: false,  // CHANGED: No longer verifying documents
                    alreadyAssignedTasks: alreadyAssignedTasks.length > 0 ? alreadyAssignedTasks : undefined,
                    storageLocation: "EmployeeAssignment collection (new)"
                }
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        // ===== SEND EMAIL =====
        try {
            const taskListHtml = assignableTasks.map(task => `<li><b>${task}</b></li>`).join('');
            await sendEmail(
                employee.email,
                `${assignableTasks.length} New Task${assignableTasks.length > 1 ? 's' : ''} Assigned`,
                `
          <p>Hello ${employee.name},</p>
          <p>You have been assigned ${assignableTasks.length} new task${assignableTasks.length > 1 ? 's' : ''}.</p>
          <h3>Tasks Assigned:</h3>
          <ul>${taskListHtml}</ul>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p><b>Assigned By:</b> ${req.user.name}</p>
          <p>Please check your dashboard and complete the assigned tasks.</p>
          ${alreadyAssignedTasks.length > 0 ? `<p><small>Note: These tasks were already assigned and were skipped: ${alreadyAssignedTasks.join(', ')}</small></p>` : ''}
        `
            );
        } catch (emailError) {
            logToConsole("WARN", "EMAIL_FAILED", { error: emailError.message });
        }

        let responseMessage = `${assignableTasks.length} task${assignableTasks.length > 1 ? 's' : ''} assigned successfully`;
        if (alreadyAssignedTasks.length > 0) {
            responseMessage += `. ${alreadyAssignedTasks.length} task${alreadyAssignedTasks.length > 1 ? 's were' : ' was'} already assigned and skipped.`;
        }

        res.json({
            message: responseMessage,
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                tasksAssigned: assignableTasks,
                tasksSkipped: alreadyAssignedTasks,
                assignedAt: assignmentDate,
                totalTasksForMonth: existingAssignments.length + assignableTasks.length,
                documentsVerified: false,  // CHANGED: No longer verifying documents
                storageLocation: "EmployeeAssignment collection (new)"
            }
        });
    } catch (error) {
        logToConsole("ERROR", "ASSIGN_MULTIPLE_TASKS_FAILED", {
            error: error.message,
            stack: error.stack,
            requestBody: req.body,
            adminId: req.user.adminId
        });
        res.status(500).json({
            message: "Error assigning tasks",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});


// Helper function for month name
function getMonthName(month) {
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    return months[month - 1] || `Month ${month}`;
}

/* ===============================
   CHECK IF CLIENT HAS DOCUMENTS FOR MONTH
   NOW CHECKS BOTH OLD AND NEW COLLECTIONS
================================ */
router.get("/check-client-documents/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { year, month } = req.query;

        if (!year || !month) {
            logToConsole("WARN", "CHECK_DOCUMENTS_MISSING_PARAMS", {
                clientId,
                year,
                month,
                adminId: req.user.adminId
            });
            return res.status(400).json({
                message: "Missing required query parameters: year, month"
            });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        logToConsole("INFO", "CHECK_CLIENT_DOCUMENTS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            year: numericYear,
            month: numericMonth
        });

        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_DOCUMENTS", {
                clientId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Client not found" });
        }

        let hasAnyDocuments = false;
        const documentCategories = [];
        const yearKey = numericYear.toString();
        const monthKey = numericMonth.toString();

        // ===== 1. CHECK OLD client.documents (Map structure) =====
        if (client.documents && client.documents instanceof Map) {
            const yearMap = client.documents.get(yearKey);
            if (yearMap && yearMap instanceof Map) {
                const monthData = yearMap.get(monthKey);
                if (monthData) {
                    // Check sales category
                    if (monthData.sales && monthData.sales.files && monthData.sales.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "sales",
                            fileCount: monthData.sales.files.length,
                            isLocked: monthData.sales.isLocked || false,
                            structure: "map-year-month-category",
                            source: "old"
                        });
                    }

                    // Check purchase category
                    if (monthData.purchase && monthData.purchase.files && monthData.purchase.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "purchase",
                            fileCount: monthData.purchase.files.length,
                            isLocked: monthData.purchase.isLocked || false,
                            structure: "map-year-month-category",
                            source: "old"
                        });
                    }

                    // Check bank category
                    if (monthData.bank && monthData.bank.files && monthData.bank.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "bank",
                            fileCount: monthData.bank.files.length,
                            isLocked: monthData.bank.isLocked || false,
                            structure: "map-year-month-category",
                            source: "old"
                        });
                    }

                    // Check other categories
                    if (monthData.other && Array.isArray(monthData.other)) {
                        for (const category of monthData.other) {
                            if (category.document && category.document.files && category.document.files.length > 0) {
                                hasAnyDocuments = true;
                                documentCategories.push({
                                    category: `other: ${category.categoryName}`,
                                    fileCount: category.document.files.length,
                                    isLocked: category.document.isLocked || false,
                                    structure: "map-year-month-category",
                                    source: "old"
                                });
                            }
                        }
                    }
                }
            }
        }

        // ===== 2. IF NOT FOUND IN OLD, CHECK NEW ClientMonthlyData collection =====
        if (!hasAnyDocuments) {
            try {
                const ClientMonthlyData = require("../models/ClientMonthlyData");
                const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });

                if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
                    const monthData = newDoc.months.find(m => m.year === numericYear && m.month === numericMonth);

                    if (monthData) {
                        // Check sales category
                        if (monthData.sales && monthData.sales.files && monthData.sales.files.length > 0) {
                            hasAnyDocuments = true;
                            documentCategories.push({
                                category: "sales",
                                fileCount: monthData.sales.files.length,
                                isLocked: monthData.sales.isLocked || false,
                                structure: "new-collection-array",
                                source: "new"
                            });
                        }

                        // Check purchase category
                        if (monthData.purchase && monthData.purchase.files && monthData.purchase.files.length > 0) {
                            hasAnyDocuments = true;
                            documentCategories.push({
                                category: "purchase",
                                fileCount: monthData.purchase.files.length,
                                isLocked: monthData.purchase.isLocked || false,
                                structure: "new-collection-array",
                                source: "new"
                            });
                        }

                        // Check bank category
                        if (monthData.bank && monthData.bank.files && monthData.bank.files.length > 0) {
                            hasAnyDocuments = true;
                            documentCategories.push({
                                category: "bank",
                                fileCount: monthData.bank.files.length,
                                isLocked: monthData.bank.isLocked || false,
                                structure: "new-collection-array",
                                source: "new"
                            });
                        }

                        // Check other categories
                        if (monthData.other && Array.isArray(monthData.other)) {
                            for (const category of monthData.other) {
                                if (category.document && category.document.files && category.document.files.length > 0) {
                                    hasAnyDocuments = true;
                                    documentCategories.push({
                                        category: `other: ${category.categoryName}`,
                                        fileCount: category.document.files.length,
                                        isLocked: category.document.isLocked || false,
                                        structure: "new-collection-array",
                                        source: "new"
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (newDocError) {
                logToConsole("WARN", "ERROR_CHECKING_NEW_COLLECTION", { error: newDocError.message });
            }
        }

        const response = {
            hasDocuments: hasAnyDocuments,
            message: hasAnyDocuments
                ? `Documents found for ${getMonthName(numericMonth)} ${numericYear}`
                : `No documents uploaded for ${getMonthName(numericMonth)} ${numericYear}`,
            details: {
                clientId,
                clientName: client.name,
                year: numericYear,
                month: numericMonth,
                period: `${numericYear}-${numericMonth.toString().padStart(2, '0')}`,
                documentCategories,
                totalFiles: documentCategories.reduce((sum, cat) => sum + cat.fileCount, 0),
                categoriesWithFiles: documentCategories.length,
                structureType: client.documents instanceof Map ? 'Map + New Collection' : 'Object + New Collection'
            }
        };

        // Create activity log for checking documents
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            clientId,
            clientName: client.name,
            action: "CLIENT_DOCUMENTS_CHECKED",
            details: `Admin checked documents for client "${client.name}" - ${hasAnyDocuments ? 'Documents found' : 'No documents'} for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`,
            dateTime: new Date(),
            metadata: {
                hasDocuments: hasAnyDocuments,
                year: numericYear,
                month: numericMonth,
                totalFiles: response.details.totalFiles,
                categoriesCount: documentCategories.length
            }
        });

        logToConsole("INFO", "CLIENT_DOCUMENTS_CHECK_COMPLETE", {
            clientId,
            hasDocuments: hasAnyDocuments,
            categoriesCount: documentCategories.length,
            adminId: req.user.adminId
        });

        res.json(response);

    } catch (error) {
        logToConsole("ERROR", "CHECK_CLIENT_DOCUMENTS_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user.adminId
        });

        res.status(500).json({
            message: "Error checking client documents",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});


/* ===============================
   REMOVE ASSIGNMENT (UPDATED FOR TASK-SPECIFIC REMOVAL)
   NOW WITH DUAL UPDATE TO NEW COLLECTION
================================ */
router.delete("/remove-assignment", auth, async (req, res) => {
    const { clientId, employeeId, year, month, task } = req.body;

    if (!clientId || !employeeId || !year || !month || !task) {
        logToConsole("WARN", "REMOVE_ASSIGNMENT_MISSING_FIELDS", {
            ...req.body,
            adminId: req.user.adminId
        });
        return res.status(400).json({
            message: "Missing required fields: clientId, employeeId, year, month, task"
        });
    }

    try {
        logToConsole("INFO", "REMOVE_TASK_ASSIGNMENT_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            employeeId,
            year,
            month,
            task
        });

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_REMOVAL", { clientId, adminId: req.user.adminId });
            return res.status(404).json({ message: "Client not found" });
        }

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND_FOR_REMOVAL", { employeeId, adminId: req.user.adminId });
            return res.status(404).json({ message: "Employee not found" });
        }

        const clientAssignment = client.employeeAssignments.find(
            a => a.year === numericYear && a.month === numericMonth && a.employeeId === employeeId && a.task === task && !a.isRemoved
        );

        if (!clientAssignment) {
            logToConsole("WARN", "TASK_ASSIGNMENT_NOT_FOUND_IN_CLIENT", { clientId, employeeId, year: numericYear, month: numericMonth, task, adminId: req.user.adminId });
            return res.status(404).json({ message: `Task "${task}" assignment not found for specified employee` });
        }

        if (clientAssignment.accountingDone) {
            logToConsole("WARN", "CANNOT_REMOVE_DONE_TASK", { clientId, employeeId, task, adminId: req.user.adminId });
            return res.status(400).json({ message: `Cannot remove "${task}" assignment because it's already marked as DONE` });
        }

        const employeeAssignment = employee.assignedClients.find(
            a => a.clientId === clientId && a.year === numericYear && a.month === numericMonth && a.task === task && !a.isRemoved
        );

        if (!employeeAssignment) {
            logToConsole("WARN", "TASK_ASSIGNMENT_NOT_FOUND_IN_EMPLOYEE", { clientId, employeeId, year: numericYear, month: numericMonth, task, adminId: req.user.adminId });
            return res.status(404).json({ message: `Task "${task}" assignment not found in employee records` });
        }

        // Save to history
        try {
            const removalDate = new Date();
            const originallyAssignedAt = clientAssignment.assignedAt;
            const durationDays = originallyAssignedAt ? Math.floor((removalDate - originallyAssignedAt) / (1000 * 60 * 60 * 24)) : null;
            await RemovedAssignment.create({
                clientId, clientName: client.name, employeeId, employeeName: employee.name,
                year: numericYear, month: numericMonth, task: task,
                originallyAssignedAt: clientAssignment.assignedAt, originallyAssignedBy: clientAssignment.assignedBy,
                adminName: clientAssignment.adminName, removedAt: removalDate, removedBy: req.user.adminId,
                removerName: req.user.name, removalReason: `Admin removed "${task}" assignment`,
                wasAccountingDone: clientAssignment.accountingDone, durationDays,
                notes: `Task "${task}" removed by admin ${req.user.name}`
            });
        } catch (historyError) {
            logToConsole("ERROR", "REMOVED_TASK_ASSIGNMENT_HISTORY_FAILED", { error: historyError.message });
        }

        // Mark as removed in CLIENT
        clientAssignment.isRemoved = true;
        clientAssignment.removedAt = new Date();
        clientAssignment.removedBy = req.user.adminId;
        clientAssignment.removalReason = `Admin removed "${task}" assignment`;
        await client.save();

        // Mark as removed in EMPLOYEE (OLD COLLECTION)
        employeeAssignment.isRemoved = true;
        employeeAssignment.removedAt = new Date();
        employeeAssignment.removedBy = req.user.adminId;
        employeeAssignment.removalReason = `Admin removed "${task}" assignment`;
        await employee.save();

        // ===== [NEW] ALSO UPDATE NEW COLLECTION =====
        try {
            const EmployeeAssignment = require("../models/EmployeeAssignment");
            await EmployeeAssignment.updateOne(
                { employeeId: employee.employeeId },
                {
                    $set: {
                        "assignedClients.$[elem].isRemoved": true,
                        "assignedClients.$[elem].removedAt": new Date(),
                        "assignedClients.$[elem].removedBy": req.user.adminId,
                        "assignedClients.$[elem].removalReason": `Admin removed "${task}" assignment`
                    }
                },
                {
                    arrayFilters: [{
                        "elem.clientId": clientId,
                        "elem.year": numericYear,
                        "elem.month": numericMonth,
                        "elem.task": task
                    }]
                }
            );
            logToConsole("INFO", "NEW_COLLECTION_UPDATE_SUCCESS", { employeeId: employee.employeeId, task });
        } catch (newErr) {
            logToConsole("WARN", "NEW_COLLECTION_UPDATE_FAILED", { error: newErr.message, employeeId: employee.employeeId });
        }

        // Activity log
        await ActivityLog.create({
            userName: req.user.name, role: "ADMIN", adminId: req.user.adminId,
            employeeId, employeeName: employee.name, clientId, clientName: client.name,
            action: "TASK_ASSIGNMENT_REMOVED",
            details: `Task "${task}" assignment removed: Employee "${employee.name}" from client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')})`,
            dateTime: new Date(), metadata: { task, year: numericYear, month: numericMonth, wasAccountingDone: false }
        });

        // Send email
        try {
            await sendEmail(employee.email, `Task Assignment Removed: ${task}`, `
                <p>Hello ${employee.name},</p>
                <p>Your task assignment has been removed by admin.</p>
                <p><b>Task:</b> ${task}</p>
                <p><b>Client:</b> ${client.name}</p>
                <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
                <p><b>Removed By:</b> ${req.user.name}</p>
                <p><b>Removed At:</b> ${new Date().toLocaleString("en-IN")}</p>
            `);
        } catch (emailError) {
            logToConsole("WARN", "EMAIL_FAILED", { error: emailError.message });
        }

        res.json({
            message: `Task "${task}" assignment removed successfully`,
            data: {
                clientId, clientName: client.name, employeeId, employeeName: employee.name,
                year: numericYear, month: numericMonth, task,
                removedAt: new Date(), removedBy: req.user.name,
                remainingTasksForMonth: client.employeeAssignments.filter(a => a.year === numericYear && a.month === numericMonth && !a.isRemoved).length
            }
        });
    } catch (error) {
        logToConsole("ERROR", "REMOVE_TASK_ASSIGNMENT_FAILED", { error: error.message, stack: error.stack, adminId: req.user?.adminId, requestBody: req.body });
        res.status(500).json({ message: "Error removing task assignment", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
});

/* ===============================
   GET CLIENT TASK STATUS PER MONTH (UPDATED & FIXED)
================================ */
router.get("/client-tasks-status/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { year, month } = req.query;

        // DEBUG LOG
        console.log("🔍 CLIENT_TASKS_STATUS_REQUEST:", {
            clientId,
            year,
            month,
            adminId: req.user?.adminId,
            timestamp: new Date().toISOString()
        });

        logToConsole("INFO", "CLIENT_TASKS_STATUS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            year,
            month
        });

        if (!year || !month) {
            logToConsole("WARN", "CLIENT_TASKS_MISSING_PARAMS", {
                clientId,
                year,
                month,
                adminId: req.user.adminId
            });
            return res.status(400).json({
                message: "Missing required query parameters: year, month"
            });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        // VALIDATE INPUTS
        if (isNaN(numericYear) || isNaN(numericMonth)) {
            logToConsole("WARN", "CLIENT_TASKS_INVALID_PARAMS", {
                clientId,
                year,
                month,
                adminId: req.user.adminId
            });
            return res.status(400).json({
                message: "Invalid year or month format"
            });
        }

        if (numericMonth < 1 || numericMonth > 12) {
            logToConsole("WARN", "CLIENT_TASKS_INVALID_MONTH", {
                clientId,
                month: numericMonth,
                adminId: req.user.adminId
            });
            return res.status(400).json({
                message: "Month must be between 1-12"
            });
        }

        const client = await Client.findOne({ clientId });
        if (!client) {
            console.log("❌ CLIENT_NOT_FOUND:", { clientId });
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_TASKS", {
                clientId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Client not found" });
        }



        // SAFELY GET ASSIGNMENTS (FIXED NULL CHECK)
        const assignments = (client.employeeAssignments || []).filter(a => {
            // Check if assignment exists and has required fields
            if (!a) return false;

            // STRICT COMPARISON WITH TYPE CONVERSION
            const assignmentYear = Number(a.year);
            const assignmentMonth = Number(a.month);

            return assignmentYear === numericYear &&
                assignmentMonth === numericMonth &&
                a.isRemoved !== true; // Explicitly check for true
        });

        console.log("🎯 FILTERED_ASSIGNMENTS:", {
            searchCriteria: { numericYear, numericMonth },
            foundCount: assignments.length,
            assignmentsDetails: assignments.map(a => ({
                task: a.task,
                year: a.year,
                month: a.month,
                isRemoved: a.isRemoved,
                employeeId: a.employeeId,
                employeeName: a.employeeName,
                accountingDone: a.accountingDone
            }))
        });

        // Define all possible tasks (EXACT MATCH REQUIRED)
        const allTasks = [
            'Bookkeeping',
            'VAT Filing Computation',
            'VAT Filing',
            'Financial Statement Generation',
            'Audit'
        ];

        // Create status for each task (CASE SENSITIVE MATCH)
        const taskStatus = allTasks.map(task => {
            // Find exact task match (case sensitive)
            const assignment = assignments.find(a => {
                if (!a.task) return false;
                return a.task.trim() === task.trim();
            });

            return {
                task,
                isAssigned: !!assignment,
                assignedTo: assignment ? {
                    employeeId: assignment.employeeId,
                    employeeName: assignment.employeeName,
                    assignedAt: assignment.assignedAt
                } : null,
                accountingDone: assignment ? (assignment.accountingDone === true) : false,
                accountingDoneAt: assignment ? assignment.accountingDoneAt : null
            };
        });

        // DEBUG: Show final task status
        console.log("📋 FINAL_TASK_STATUS:", {
            clientId,
            year: numericYear,
            month: numericMonth,
            taskStatus: taskStatus.map(t => ({
                task: t.task,
                isAssigned: t.isAssigned,
                employee: t.assignedTo?.employeeName || 'none'
            }))
        });

        const response = {
            clientId,
            clientName: client.name,
            year: numericYear,
            month: numericMonth,
            period: `${numericYear}-${numericMonth.toString().padStart(2, '0')}`,
            totalAssigned: assignments.length,
            maxTasks: 4,
            taskStatus,
            assignments: assignments.map(a => ({
                task: a.task,
                employeeId: a.employeeId,
                employeeName: a.employeeName,
                assignedAt: a.assignedAt,
                accountingDone: a.accountingDone === true,
                accountingDoneAt: a.accountingDoneAt,
                isRemoved: a.isRemoved
            })),
            // ADD DEBUG INFO
            _debug: {
                rawAssignmentsCount: client.employeeAssignments?.length || 0,
                filteredAssignmentsCount: assignments.length,
                allTasksList: allTasks,
                queryParams: { year, month },
                timestamp: new Date().toISOString()
            }
        };

        console.log("✅ CLIENT_TASKS_STATUS_SUCCESS:", {
            clientId,
            totalAssigned: assignments.length,
            tasksAssigned: assignments.map(a => a.task)
        });

        // Create activity log for checking client tasks status
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            clientId,
            clientName: client.name,
            action: "CLIENT_TASKS_STATUS_CHECKED",
            details: `Admin checked task status for client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')}) - ${assignments.length} tasks assigned`,
            dateTime: new Date(),  // FIXED: Use Date object instead of String
            metadata: {
                year: numericYear,
                month: numericMonth,
                totalTasks: assignments.length,
                tasks: assignments.map(a => a.task)
            }
        });

        logToConsole("INFO", "CLIENT_TASKS_STATUS_COMPLETE", {
            clientId,
            totalAssigned: assignments.length,
            adminId: req.user.adminId
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "CLIENT_TASKS_STATUS_CHECKED",
            clientId,
            adminId: req.user.adminId
        });

        res.json(response);

    } catch (error) {
        console.error("❌ CLIENT_TASKS_STATUS_ERROR:", {
            error: error.message,
            stack: error.stack,
            clientId: req.params.clientId,
            query: req.query,
            timestamp: new Date().toISOString()
        });

        logToConsole("ERROR", "CLIENT_TASKS_STATUS_FAILED", {
            error: error.message,
            stack: error.stack,
            clientId: req.params.clientId,
            adminId: req.user.adminId
        });

        res.status(500).json({
            message: "Error fetching client task status",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
            _errorDetails: {
                timestamp: new Date().toISOString(),
                operation: "get_client_tasks_status"
            }
        });
    }
});

/* ===============================
   DEACTIVATE EMPLOYEE (UPDATED - REMOVE ONLY THEIR TASKS)
================================ */
router.post("/deactivate/:employeeId", auth, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        logToConsole("INFO", "DEACTIVATE_EMPLOYEE_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            employeeId
        });

        // ===== 1. FIND EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
                employeeId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Employee not found" });
        }

        // ===== 2. FIND CURRENT MONTH TASK ASSIGNMENTS =====
        const currentTaskAssignments = employee.assignedClients?.filter(
            assignment => assignment.year === currentYear &&
                assignment.month === currentMonth &&
                !assignment.isRemoved
        ) || [];

        logToConsole("INFO", "CURRENT_TASK_ASSIGNMENTS_FOUND", {
            employeeId,
            currentTasksCount: currentTaskAssignments.length,
            tasks: currentTaskAssignments.map(a => a.task),
            currentYear,
            currentMonth,
            adminId: req.user.adminId
        });

        // ===== 3. REMOVE TASK ASSIGNMENTS FROM CLIENTS =====
        let removedFromClients = 0;
        const removedTasks = [];

        if (currentTaskAssignments.length > 0) {
            for (const assignment of currentTaskAssignments) {
                try {
                    const client = await Client.findOne({ clientId: assignment.clientId });
                    if (client) {
                        // Find and mark THIS SPECIFIC TASK as removed
                        const taskAssignment = client.employeeAssignments.find(
                            empAssignment =>
                                empAssignment.year === currentYear &&
                                empAssignment.month === currentMonth &&
                                empAssignment.employeeId === employeeId &&
                                empAssignment.task === assignment.task &&
                                !empAssignment.isRemoved
                        );

                        if (taskAssignment) {
                            taskAssignment.isRemoved = true;
                            taskAssignment.removedAt = new Date();
                            taskAssignment.removedBy = req.user.adminId;
                            taskAssignment.removalReason = "Employee deactivated";

                            await client.save();
                            removedFromClients++;
                            removedTasks.push(assignment.task);

                            logToConsole("INFO", "CLIENT_TASK_REMOVED", {
                                clientId: assignment.clientId,
                                clientName: client.name,
                                task: assignment.task,
                                employeeId,
                                adminId: req.user.adminId
                            });
                        }
                    }
                } catch (clientError) {
                    logToConsole("ERROR", "CLIENT_TASK_UPDATE_FAILED", {
                        clientId: assignment.clientId,
                        task: assignment.task,
                        error: clientError.message,
                        employeeId,
                        adminId: req.user.adminId
                    });
                }
            }
        }

        // ===== 4. UPDATE EMPLOYEE STATUS =====
        employee.isActive = false;
        employee.updatedAt = new Date();
        await employee.save();

        logToConsole("SUCCESS", "EMPLOYEE_DEACTIVATED", {
            employeeId,
            employeeName: employee.name,
            currentTasksRemoved: currentTaskAssignments.length,
            removedTasks,
            removedFromClients,
            adminId: req.user.adminId
        });

        // ===== 5. ACTIVITY LOG =====
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            employeeName: employee.name,
            action: "EMPLOYEE_DEACTIVATED",
            details: `Employee "${employee.name}" deactivated. Removed ${removedTasks.length} task assignments: ${removedTasks.join(', ')}`,
            dateTime: new Date(),  // FIXED: Use Date object instead of String
            metadata: {
                tasksRemoved: removedTasks,
                count: removedTasks.length
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_DEACTIVATED",
            employeeId,
            adminId: req.user.adminId
        });

        res.json({
            message: `Employee deactivated successfully. Removed ${removedTasks.length} task assignments.`,
            data: {
                employeeId,
                employeeName: employee.name,
                tasksRemoved: removedTasks,
                tasksRemovedCount: removedTasks.length,
                clientsAffected: removedFromClients,
                deactivatedAt: new Date()
            }
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
   GET EMPLOYEE TASK ASSIGNMENTS (NEW ENDPOINT)
================================ */
router.get("/employee-tasks/:employeeId", auth, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { year, month, status } = req.query;

        logToConsole("INFO", "GET_EMPLOYEE_TASKS_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            employeeId,
            year,
            month,
            status
        });

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND_FOR_TASKS", {
                employeeId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Employee not found" });
        }

        let tasks = employee.assignedClients.filter(ac => !ac.isRemoved);

        // Apply filters
        if (year) {
            const numericYear = parseInt(year);
            tasks = tasks.filter(t => t.year === numericYear);
        }

        if (month) {
            const numericMonth = parseInt(month);
            tasks = tasks.filter(t => t.month === numericMonth);
        }

        if (status === 'pending') {
            tasks = tasks.filter(t => !t.accountingDone);
        } else if (status === 'completed') {
            tasks = tasks.filter(t => t.accountingDone);
        }

        // Sort by year, month, task
        tasks.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            if (a.month !== b.month) return b.month - a.month;
            return a.task.localeCompare(b.task);
        });

        // Group by client-month
        const groupedTasks = {};
        tasks.forEach(task => {
            const key = `${task.clientId}-${task.year}-${task.month}`;
            if (!groupedTasks[key]) {
                groupedTasks[key] = {
                    clientId: task.clientId,
                    clientName: task.clientName,
                    year: task.year,
                    month: task.month,
                    period: `${task.year}-${task.month.toString().padStart(2, '0')}`,
                    tasks: []
                };
            }
            groupedTasks[key].tasks.push({
                task: task.task,
                accountingDone: task.accountingDone,
                accountingDoneAt: task.accountingDoneAt,
                assignedAt: task.assignedAt
            });
        });

        const response = {
            employeeId,
            employeeName: employee.name,
            totalTasks: tasks.length,
            pendingTasks: tasks.filter(t => !t.accountingDone).length,
            completedTasks: tasks.filter(t => t.accountingDone).length,
            groupedAssignments: Object.values(groupedTasks)
        };

        logToConsole("INFO", "EMPLOYEE_TASKS_FETCHED", {
            employeeId,
            totalTasks: tasks.length,
            adminId: req.user.adminId
        });

        // Create activity log for viewing employee tasks
        await ActivityLog.create({
            userName: req.user.name,
            role: "ADMIN",
            adminId: req.user.adminId,
            employeeId,
            employeeName: employee.name,
            action: "EMPLOYEE_TASKS_VIEWED",
            details: `Admin viewed tasks for employee "${employee.name}" - Total: ${tasks.length}, Pending: ${response.pendingTasks}, Completed: ${response.completedTasks}`,
            dateTime: new Date(),  // FIXED: Use Date object instead of String
            metadata: {
                totalTasks: tasks.length,
                pendingTasks: response.pendingTasks,
                completedTasks: response.completedTasks,
                filters: { year, month, status }
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_TASKS_VIEWED",
            employeeId,
            adminId: req.user.adminId
        });

        res.json(response);

    } catch (error) {
        logToConsole("ERROR", "GET_EMPLOYEE_TASKS_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user.adminId
        });

        res.status(500).json({
            message: "Error fetching employee tasks",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});

/* ===============================
   REMOVE ASSIGNMENT (UPDATED FOR TASK-SPECIFIC REMOVAL)
   NOW CHECKS BOTH COLLECTIONS
================================ */
router.delete("/remove-assignment", auth, async (req, res) => {
    const { clientId, employeeId, year, month, task } = req.body;

    if (!clientId || !employeeId || !year || !month || !task) {
        logToConsole("WARN", "REMOVE_ASSIGNMENT_MISSING_FIELDS", {
            ...req.body,
            adminId: req.user.adminId
        });
        return res.status(400).json({
            message: "Missing required fields: clientId, employeeId, year, month, task"
        });
    }

    try {
        logToConsole("INFO", "REMOVE_TASK_ASSIGNMENT_REQUEST", {
            adminId: req.user.adminId,
            adminName: req.user.name,
            clientId,
            employeeId,
            year,
            month,
            task
        });

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        // ===== FETCH CLIENT =====
        const client = await Client.findOne({ clientId });
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_REMOVAL", { clientId, adminId: req.user.adminId });
            return res.status(404).json({ message: "Client not found" });
        }

        // ===== FETCH EMPLOYEE =====
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND_FOR_REMOVAL", { employeeId, adminId: req.user.adminId });
            return res.status(404).json({ message: "Employee not found" });
        }

        const EmployeeAssignment = require("../models/EmployeeAssignment");
        let newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });

        let assignmentFound = false;
        let removedFromNew = false;
        let removedFromOld = false;

        // ===== FIRST: Try to remove from NEW COLLECTION =====
        if (newDoc) {
            const newAssignmentIndex = newDoc.assignedClients.findIndex(
                a => a.clientId === clientId &&
                    a.year === numericYear &&
                    a.month === numericMonth &&
                    a.task === task &&
                    !a.isRemoved
            );

            if (newAssignmentIndex !== -1) {
                // Check if accounting is done
                if (newDoc.assignedClients[newAssignmentIndex].accountingDone) {
                    logToConsole("WARN", "CANNOT_REMOVE_DONE_TASK_FROM_NEW", {
                        clientId, employeeId, task,
                        accountingDone: true
                    });
                    return res.status(400).json({
                        message: `Cannot remove "${task}" assignment because it's already marked as DONE`
                    });
                }

                newDoc.assignedClients[newAssignmentIndex].isRemoved = true;
                newDoc.assignedClients[newAssignmentIndex].removedAt = new Date();
                newDoc.assignedClients[newAssignmentIndex].removedBy = req.user.adminId;
                newDoc.assignedClients[newAssignmentIndex].removalReason = `Admin removed "${task}" assignment`;
                await newDoc.save();
                assignmentFound = true;
                removedFromNew = true;
                logToConsole("INFO", "REMOVED_FROM_NEW_COLLECTION", { employeeId, task });
            }
        }

        // ===== SECOND: Try to remove from OLD COLLECTION =====
        const oldAssignmentIndex = employee.assignedClients.findIndex(
            a => a.clientId === clientId &&
                a.year === numericYear &&
                a.month === numericMonth &&
                a.task === task &&
                !a.isRemoved
        );

        if (oldAssignmentIndex !== -1) {
            if (employee.assignedClients[oldAssignmentIndex].accountingDone) {
                logToConsole("WARN", "CANNOT_REMOVE_DONE_TASK_FROM_OLD", {
                    clientId, employeeId, task,
                    accountingDone: true
                });
                if (!removedFromNew) {
                    return res.status(400).json({
                        message: `Cannot remove "${task}" assignment because it's already marked as DONE`
                    });
                }
            } else {
                employee.assignedClients[oldAssignmentIndex].isRemoved = true;
                employee.assignedClients[oldAssignmentIndex].removedAt = new Date();
                employee.assignedClients[oldAssignmentIndex].removedBy = req.user.adminId;
                employee.assignedClients[oldAssignmentIndex].removalReason = `Admin removed "${task}" assignment`;
                await employee.save();
                assignmentFound = true;
                removedFromOld = true;
                logToConsole("INFO", "REMOVED_FROM_OLD_COLLECTION", { employeeId, task });
            }
        }

        if (!assignmentFound) {
            logToConsole("WARN", "TASK_ASSIGNMENT_NOT_FOUND_IN_EITHER", {
                clientId, employeeId, year: numericYear, month: numericMonth, task
            });
            return res.status(404).json({
                message: `Task "${task}" assignment not found for specified employee`
            });
        }

        // ===== ALSO REMOVE FROM CLIENT =====
        const clientAssignmentIndex = client.employeeAssignments.findIndex(
            a => a.year === numericYear &&
                a.month === numericMonth &&
                a.employeeId === employeeId &&
                a.task === task &&
                !a.isRemoved
        );

        if (clientAssignmentIndex !== -1) {
            client.employeeAssignments[clientAssignmentIndex].isRemoved = true;
            client.employeeAssignments[clientAssignmentIndex].removedAt = new Date();
            client.employeeAssignments[clientAssignmentIndex].removedBy = req.user.adminId;
            client.employeeAssignments[clientAssignmentIndex].removalReason = `Admin removed "${task}" assignment`;
            await client.save();
            logToConsole("INFO", "REMOVED_FROM_CLIENT", { clientId, task });
        }

        // ===== SAVE TO REMOVED ASSIGNMENTS HISTORY =====
        try {
            await RemovedAssignment.create({
                clientId, clientName: client.name, employeeId, employeeName: employee.name,
                year: numericYear, month: numericMonth, task: task,
                originallyAssignedAt: new Date(),
                originallyAssignedBy: req.user.adminId,
                adminName: req.user.name,
                removedAt: new Date(),
                removedBy: req.user.adminId,
                removerName: req.user.name,
                removalReason: `Admin removed "${task}" assignment`,
                wasAccountingDone: false,
                notes: `Task "${task}" removed by admin ${req.user.name}`
            });
        } catch (historyError) {
            logToConsole("ERROR", "REMOVED_TASK_ASSIGNMENT_HISTORY_FAILED", { error: historyError.message });
        }

        // ===== ACTIVITY LOG =====
        await ActivityLog.create({
            userName: req.user.name, role: "ADMIN", adminId: req.user.adminId,
            employeeId, employeeName: employee.name, clientId, clientName: client.name,
            action: "TASK_ASSIGNMENT_REMOVED",
            details: `Task "${task}" assignment removed: Employee "${employee.name}" from client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')})`,
            dateTime: new Date(),
            metadata: { task, year: numericYear, month: numericMonth, removedFromNew, removedFromOld }
        });

        // ===== SEND EMAIL =====
        try {
            await sendEmail(employee.email, `Task Assignment Removed: ${task}`, `
                <p>Hello ${employee.name},</p>
                <p>Your task assignment has been removed by admin.</p>
                <p><b>Task:</b> ${task}</p>
                <p><b>Client:</b> ${client.name}</p>
                <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
                <p><b>Removed By:</b> ${req.user.name}</p>
            `);
        } catch (emailError) {
            logToConsole("WARN", "EMAIL_FAILED", { error: emailError.message });
        }

        res.json({
            message: `Task "${task}" assignment removed successfully`,
            data: {
                clientId, clientName: client.name, employeeId, employeeName: employee.name,
                year: numericYear, month: numericMonth, task,
                removedAt: new Date(), removedBy: req.user.name,
                removedFrom: removedFromNew ? "new_collection" : (removedFromOld ? "old_collection" : "none")
            }
        });
    } catch (error) {
        logToConsole("ERROR", "REMOVE_TASK_ASSIGNMENT_FAILED", {
            error: error.message, stack: error.stack, adminId: req.user?.adminId, requestBody: req.body
        });
        res.status(500).json({
            message: "Error removing task assignment",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
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
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
                employeeId,
                adminId: req.user.adminId
            });
            return res.status(404).json({ message: "Employee not found" });
        }

        // Console log: Employee found
        logToConsole("DEBUG", "EMPLOYEE_FOUND", {
            employeeId,
            employeeName: employee.name,
            isActive: employee.isActive,
            adminId: req.user.adminId
        });

        // ===== 2. ACTIVATE EMPLOYEE =====
        employee.isActive = true;
        employee.updatedAt = new Date();
        await employee.save();

        // Console log: Employee activated
        logToConsole("SUCCESS", "EMPLOYEE_ACTIVATED", {
            employeeId,
            employeeName: employee.name,
            adminId: req.user.adminId
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
            dateTime: new Date()  // FIXED: Use Date object instead of String
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_ACTIVATED",
            employeeId,
            adminId: req.user.adminId
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
            status: "success",
            adminId: req.user.adminId
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