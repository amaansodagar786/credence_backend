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
   ASSIGN CLIENT TO EMPLOYEE (FIXED DOCUMENT CHECK)
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

        // ===== CHECK IF CLIENT HAS DOCUMENTS FOR SELECTED MONTH =====
        let hasDocuments = false;
        const yearKey = numericYear.toString();
        const monthKey = numericMonth.toString();

        // Debug: Check what type of structure we have
        logToConsole("DEBUG", "DOCUMENT_STRUCTURE_CHECK", {
            clientId,
            hasDocumentsField: !!client.documents,
            documentsType: client.documents ? client.documents.constructor.name : 'none',
            isMap: client.documents instanceof Map,
            mapSize: client.documents instanceof Map ? client.documents.size : 'N/A'
        });

        // ===== CHECK MAP STRUCTURE (YOUR ACTUAL STRUCTURE) =====
        if (client.documents && client.documents instanceof Map) {
            // Get the year Map
            const yearMap = client.documents.get(yearKey);

            if (yearMap && yearMap instanceof Map) {
                // Get the month data
                const monthData = yearMap.get(monthKey);

                if (monthData) {
                    logToConsole("DEBUG", "FOUND_MONTH_DATA_IN_MAP", {
                        yearKey,
                        monthKey,
                        monthDataExists: !!monthData
                    });

                    // Check standard categories
                    const standardCategories = ['sales', 'purchase', 'bank'];
                    for (const category of standardCategories) {
                        if (monthData[category] &&
                            monthData[category].files &&
                            Array.isArray(monthData[category].files) &&
                            monthData[category].files.length > 0) {
                            hasDocuments = true;
                            logToConsole("DEBUG", "FOUND_FILES_IN_CATEGORY", {
                                category,
                                fileCount: monthData[category].files.length
                            });
                            break;
                        }
                    }

                    // Check other categories if no standard files found
                    if (!hasDocuments && monthData.other && Array.isArray(monthData.other)) {
                        for (const otherCat of monthData.other) {
                            if (otherCat.document &&
                                otherCat.document.files &&
                                Array.isArray(otherCat.document.files) &&
                                otherCat.document.files.length > 0) {
                                hasDocuments = true;
                                logToConsole("DEBUG", "FOUND_FILES_IN_OTHER_CATEGORY", {
                                    categoryName: otherCat.categoryName,
                                    fileCount: otherCat.document.files.length
                                });
                                break;
                            }
                        }
                    }
                } else {
                    logToConsole("DEBUG", "NO_MONTH_DATA_IN_MAP", {
                        yearKey,
                        monthKey,
                        monthDataExists: false
                    });
                }
            } else {
                logToConsole("DEBUG", "NO_YEAR_MAP_IN_DOCUMENTS", {
                    yearKey,
                    yearMapExists: !!yearMap,
                    yearMapIsMap: yearMap instanceof Map
                });
            }
        }
        // ===== CHECK PLAIN OBJECT STRUCTURE (BACKUP CHECK) =====
        else if (client.documents && typeof client.documents === 'object' && !(client.documents instanceof Map)) {
            // Check if documents is a plain object with year keys
            if (client.documents[yearKey] && client.documents[yearKey][monthKey]) {
                const monthData = client.documents[yearKey][monthKey];

                // Check standard categories
                const standardCategories = ['sales', 'purchase', 'bank'];
                for (const category of standardCategories) {
                    if (monthData[category] &&
                        monthData[category].files &&
                        Array.isArray(monthData[category].files) &&
                        monthData[category].files.length > 0) {
                        hasDocuments = true;
                        break;
                    }
                }

                // Check other categories
                if (!hasDocuments && monthData.other && Array.isArray(monthData.other)) {
                    for (const otherCat of monthData.other) {
                        if (otherCat.document &&
                            otherCat.document.files &&
                            Array.isArray(otherCat.document.files) &&
                            otherCat.document.files.length > 0) {
                            hasDocuments = true;
                            break;
                        }
                    }
                }
            }
        }

        // Log final document check result
        logToConsole("DEBUG", "DOCUMENT_CHECK_FINAL_RESULT", {
            clientId,
            year: numericYear,
            month: numericMonth,
            hasDocuments,
            documentsExist: !!client.documents,
            structureType: client.documents ?
                (client.documents instanceof Map ? 'Map' : 'Object') : 'None'
        });

        if (!hasDocuments) {
            logToConsole("WARN", "NO_DOCUMENTS_FOR_MONTH", {
                clientId,
                clientName: client.name,
                year: numericYear,
                month: numericMonth,
                monthName: getMonthName(numericMonth)
            });
            return res.status(400).json({
                message: `Cannot assign task. No documents uploaded for ${getMonthName(numericMonth)} ${numericYear}. Please upload documents first.`
            });
        }

        // ===== DUPLICATE TASK CHECK (UPDATED) =====
        const taskAlreadyAssigned = client.employeeAssignments.some(
            (a) => a.year === numericYear &&
                a.month === numericMonth &&
                a.task === task &&
                !a.isRemoved
        );

        if (taskAlreadyAssigned) {
            logToConsole("WARN", "TASK_ALREADY_ASSIGNED", {
                clientId,
                year: numericYear,
                month: numericMonth,
                task
            });
            return res.status(409).json({
                message: `Task "${task}" already assigned for ${numericYear}-${numericMonth.toString().padStart(2, '0')}`
            });
        }

        // ===== CHECK MAX 4 TASKS PER MONTH =====
        const existingAssignments = client.employeeAssignments.filter(
            a => a.year === numericYear &&
                a.month === numericMonth &&
                !a.isRemoved
        );

        if (existingAssignments.length >= 4) {
            logToConsole("WARN", "MAX_TASKS_REACHED", {
                clientId,
                year: numericYear,
                month: numericMonth,
                existingCount: existingAssignments.length
            });
            return res.status(409).json({
                message: `Maximum 4 tasks already assigned for ${numericYear}-${numericMonth.toString().padStart(2, '0')}. Remove a task first.`
            });
        }

        // ===== CHECK IF EMPLOYEE ALREADY HAS THIS TASK =====
        const employeeAlreadyHasTask = employee.assignedClients.some(
            (ac) => ac.clientId === clientId &&
                ac.year === numericYear &&
                ac.month === numericMonth &&
                ac.task === task &&
                !ac.isRemoved
        );

        if (employeeAlreadyHasTask) {
            logToConsole("WARN", "EMPLOYEE_ALREADY_HAS_TASK", {
                employeeId,
                clientId,
                year: numericYear,
                month: numericMonth,
                task
            });
            return res.status(409).json({
                message: `Employee already has "${task}" task for this client-month`
            });
        }

        logToConsole("DEBUG", "VALIDATION_PASSED", {
            clientId,
            employeeId,
            year: numericYear,
            month: numericMonth,
            task,
            existingTasks: existingAssignments.map(a => a.task),
            hasDocuments: true,
            totalAssignments: existingAssignments.length
        });

        // ===== PREPARE ASSIGNMENT OBJECTS =====
        const assignmentDate = new Date();

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

        // ===== SAVE TO CLIENT FIRST =====
        client.employeeAssignments.push(clientAssignment);
        await client.save();

        logToConsole("INFO", "CLIENT_TASK_ASSIGNMENT_SAVED", {
            clientId: client.clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth,
            task,
            totalTasksNow: client.employeeAssignments.filter(a =>
                a.year === numericYear && a.month === numericMonth && !a.isRemoved
            ).length
        });

        try {
            // ===== SAVE TO EMPLOYEE =====
            employee.assignedClients.push(employeeAssignment);
            await employee.save();

            logToConsole("INFO", "EMPLOYEE_TASK_ASSIGNMENT_SAVED", {
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
            client.employeeAssignments.pop();
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
                action: "TASK_ASSIGNED_TO_EMPLOYEE",
                details: `Task "${task}" assigned to employee "${employee.name}" for client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')}) - Documents verified`,
                dateTime: new Date().toLocaleString("en-IN"),
                metadata: {
                    task,
                    year: numericYear,
                    month: numericMonth,
                    totalTasksAssigned: existingAssignments.length + 1,
                    documentsVerified: true
                }
            });

            logToConsole("INFO", "TASK_ASSIGNMENT_ACTIVITY_LOG_CREATED", {
                action: "TASK_ASSIGNED_TO_EMPLOYEE",
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
                `New Task Assignment: ${task}`,
                `
          <p>Hello ${employee.name},</p>
          <p>You have been assigned a new task.</p>
          <p><b>Task:</b> ${task}</p>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Client ID:</b> ${clientId}</p>
          <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p><b>Assigned By:</b> ${req.user.name}</p>
          <p>Please check your dashboard and complete the assigned task.</p>
          <p><small>Note: Client documents have been verified for this period.</small></p>
        `
            );

            logToConsole("INFO", "TASK_ASSIGNMENT_EMAIL_SENT", {
                employeeEmail: employee.email,
                task
            });
        } catch (emailError) {
            logToConsole("WARN", "TASK_ASSIGNMENT_EMAIL_FAILED", {
                error: emailError.message
            });
        }

        logToConsole("SUCCESS", "TASK_ASSIGNED_SUCCESSFULLY", {
            clientId,
            employeeId,
            task,
            timestamp: assignmentDate.toISOString(),
            assignedTasksCount: existingAssignments.length + 1,
            documentsVerified: true
        });

        res.json({
            message: `Task "${task}" assigned successfully`,
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                task,
                assignedAt: assignmentDate,
                totalTasksForMonth: existingAssignments.length + 1,
                documentsVerified: true
            }
        });
    } catch (error) {
        logToConsole("ERROR", "ASSIGN_CLIENT_TASK_FAILED", {
            error: error.message,
            stack: error.stack,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error assigning task",
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
   CHECK IF CLIENT HAS DOCUMENTS FOR MONTH (FIXED)
================================ */
router.get("/check-client-documents/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                message: "Missing required query parameters: year, month"
            });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        logToConsole("INFO", "CHECK_CLIENT_DOCUMENTS_REQUEST", {
            adminId: req.user.adminId,
            clientId,
            year: numericYear,
            month: numericMonth
        });

        const client = await Client.findOne({ clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        // Check if client has documents structure (FIXED FOR MAPS)
        if (!client.documents ||
            (client.documents instanceof Map && client.documents.size === 0) ||
            (typeof client.documents === 'object' && !(client.documents instanceof Map) && Object.keys(client.documents).length === 0)) {

            logToConsole("INFO", "NO_DOCUMENTS_STRUCTURE_FOUND", { clientId });
            return res.json({
                hasDocuments: false,
                message: "Client has no document structure",
                details: {
                    clientId,
                    clientName: client.name,
                    year: numericYear,
                    month: numericMonth,
                    documentsExist: false
                }
            });
        }

        let hasAnyDocuments = false;
        const documentCategories = [];
        const yearKey = numericYear.toString();
        const monthKey = numericMonth.toString();

        // ===== CHECK MAP STRUCTURE (YOUR ACTUAL STRUCTURE) =====
        if (client.documents instanceof Map) {
            // Get the year Map
            const yearMap = client.documents.get(yearKey);

            if (yearMap && yearMap instanceof Map) {
                // Get the month data
                const monthData = yearMap.get(monthKey);

                if (monthData) {
                    // Check sales category
                    if (monthData.sales && monthData.sales.files && monthData.sales.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "sales",
                            fileCount: monthData.sales.files.length,
                            isLocked: monthData.sales.isLocked || false,
                            structure: "map-year-month-category"
                        });
                    }

                    // Check purchase category
                    if (monthData.purchase && monthData.purchase.files && monthData.purchase.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "purchase",
                            fileCount: monthData.purchase.files.length,
                            isLocked: monthData.purchase.isLocked || false,
                            structure: "map-year-month-category"
                        });
                    }

                    // Check bank category
                    if (monthData.bank && monthData.bank.files && monthData.bank.files.length > 0) {
                        hasAnyDocuments = true;
                        documentCategories.push({
                            category: "bank",
                            fileCount: monthData.bank.files.length,
                            isLocked: monthData.bank.isLocked || false,
                            structure: "map-year-month-category"
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
                                    structure: "map-year-month-category"
                                });
                            }
                        }
                    }
                }
            }
        }
        // ===== CHECK PLAIN OBJECT STRUCTURE =====
        else if (client.documents && typeof client.documents === 'object' && !(client.documents instanceof Map)) {
            // Structure: documents -> year -> month -> category
            if (client.documents[yearKey] && client.documents[yearKey][monthKey]) {
                const monthData = client.documents[yearKey][monthKey];

                // Check sales category
                if (monthData.sales && monthData.sales.files && monthData.sales.files.length > 0) {
                    hasAnyDocuments = true;
                    documentCategories.push({
                        category: "sales",
                        fileCount: monthData.sales.files.length,
                        isLocked: monthData.sales.isLocked || false,
                        structure: "object-year-month-category"
                    });
                }

                // Check purchase category
                if (monthData.purchase && monthData.purchase.files && monthData.purchase.files.length > 0) {
                    hasAnyDocuments = true;
                    documentCategories.push({
                        category: "purchase",
                        fileCount: monthData.purchase.files.length,
                        isLocked: monthData.purchase.isLocked || false,
                        structure: "object-year-month-category"
                    });
                }

                // Check bank category
                if (monthData.bank && monthData.bank.files && monthData.bank.files.length > 0) {
                    hasAnyDocuments = true;
                    documentCategories.push({
                        category: "bank",
                        fileCount: monthData.bank.files.length,
                        isLocked: monthData.bank.isLocked || false,
                        structure: "object-year-month-category"
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
                                structure: "object-year-month-category"
                            });
                        }
                    }
                }
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
                structureType: client.documents instanceof Map ? 'Map' : 'Object'
            }
        };

        logToConsole("INFO", "CLIENT_DOCUMENTS_CHECK_COMPLETE", {
            clientId,
            hasDocuments: hasAnyDocuments,
            categoriesCount: documentCategories.length,
            structureFound: documentCategories[0]?.structure || "none",
            structureType: client.documents instanceof Map ? 'Map' : 'Object'
        });

        res.json(response);

    } catch (error) {
        logToConsole("ERROR", "CHECK_CLIENT_DOCUMENTS_FAILED", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            message: "Error checking client documents",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});

/* ===============================
   REMOVE ASSIGNMENT (UPDATED FOR TASK-SPECIFIC REMOVAL)
================================ */
router.delete("/remove-assignment", auth, async (req, res) => {
    const { clientId, employeeId, year, month, task } = req.body;

    // ===== VALIDATION =====
    if (!clientId || !employeeId || !year || !month || !task) {
        logToConsole("WARN", "REMOVE_ASSIGNMENT_MISSING_FIELDS", req.body);
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

        // ===== FIND SPECIFIC TASK ASSIGNMENT IN CLIENT =====
        const clientAssignment = client.employeeAssignments.find(
            a => a.year === numericYear &&
                a.month === numericMonth &&
                a.employeeId === employeeId &&
                a.task === task &&
                !a.isRemoved
        );

        if (!clientAssignment) {
            logToConsole("WARN", "TASK_ASSIGNMENT_NOT_FOUND_IN_CLIENT", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth,
                task
            });
            return res.status(404).json({
                message: `Task "${task}" assignment not found for specified employee`
            });
        }

        // ===== CHECK IF ACCOUNTING IS DONE =====
        if (clientAssignment.accountingDone) {
            logToConsole("WARN", "CANNOT_REMOVE_DONE_TASK", {
                clientId,
                employeeId,
                task,
                accountingDone: true,
                accountingDoneAt: clientAssignment.accountingDoneAt
            });
            return res.status(400).json({
                message: `Cannot remove "${task}" assignment because it's already marked as DONE`
            });
        }

        // ===== FIND SPECIFIC TASK ASSIGNMENT IN EMPLOYEE =====
        const employeeAssignment = employee.assignedClients.find(
            a => a.clientId === clientId &&
                a.year === numericYear &&
                a.month === numericMonth &&
                a.task === task &&
                !a.isRemoved
        );

        if (!employeeAssignment) {
            logToConsole("WARN", "TASK_ASSIGNMENT_NOT_FOUND_IN_EMPLOYEE", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth,
                task
            });
            return res.status(404).json({
                message: `Task "${task}" assignment not found in employee records`
            });
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
                task: task,
                originallyAssignedAt: clientAssignment.assignedAt,
                originallyAssignedBy: clientAssignment.assignedBy,
                adminName: clientAssignment.adminName,
                removedAt: removalDate,
                removedBy: req.user.adminId,
                removerName: req.user.name,
                removalReason: `Admin removed "${task}" assignment`,
                wasAccountingDone: clientAssignment.accountingDone,
                durationDays,
                notes: `Task "${task}" removed by admin ${req.user.name}`
            });

            logToConsole("INFO", "REMOVED_TASK_ASSIGNMENT_HISTORY_SAVED", {
                clientId,
                employeeId,
                year: numericYear,
                month: numericMonth,
                task
            });
        } catch (historyError) {
            logToConsole("ERROR", "REMOVED_TASK_ASSIGNMENT_HISTORY_FAILED", {
                error: historyError.message
            });
        }

        // ===== MARK AS REMOVED IN CLIENT (SPECIFIC TASK ONLY) =====
        clientAssignment.isRemoved = true;
        clientAssignment.removedAt = new Date();
        clientAssignment.removedBy = req.user.adminId;
        clientAssignment.removalReason = `Admin removed "${task}" assignment`;

        await client.save();

        // ===== MARK AS REMOVED IN EMPLOYEE (SPECIFIC TASK ONLY) =====
        employeeAssignment.isRemoved = true;
        employeeAssignment.removedAt = new Date();
        employeeAssignment.removedBy = req.user.adminId;
        employeeAssignment.removalReason = `Admin removed "${task}" assignment`;

        await employee.save();

        logToConsole("SUCCESS", "TASK_ASSIGNMENT_REMOVED_SUCCESSFULLY", {
            clientId,
            clientName: client.name,
            employeeId,
            employeeName: employee.name,
            year: numericYear,
            month: numericMonth,
            task,
            removedBy: req.user.name,
            remainingTasks: client.employeeAssignments.filter(a =>
                a.year === numericYear && a.month === numericMonth && !a.isRemoved
            ).length
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
                action: "TASK_ASSIGNMENT_REMOVED",
                details: `Task "${task}" assignment removed: Employee "${employee.name}" from client "${client.name}" (${numericYear}-${numericMonth.toString().padStart(2, '0')})`,
                dateTime: new Date().toLocaleString("en-IN"),
                metadata: {
                    task,
                    year: numericYear,
                    month: numericMonth,
                    wasAccountingDone: false
                }
            });

            logToConsole("INFO", "TASK_REMOVAL_ACTIVITY_LOG_CREATED", {
                action: "TASK_ASSIGNMENT_REMOVED",
                clientId,
                employeeId,
                task
            });
        } catch (logError) {
            logToConsole("ERROR", "TASK_REMOVAL_ACTIVITY_LOG_FAILED", {
                error: logError.message
            });
        }

        // ===== SEND NOTIFICATION EMAIL =====
        try {
            await sendEmail(
                employee.email,
                `Task Assignment Removed: ${task}`,
                `
          <p>Hello ${employee.name},</p>
          <p>Your task assignment has been removed by admin.</p>
          <p><b>Task:</b> ${task}</p>
          <p><b>Client:</b> ${client.name}</p>
          <p><b>Period:</b> ${numericYear}-${numericMonth.toString().padStart(2, '0')}</p>
          <p><b>Removed By:</b> ${req.user.name}</p>
          <p><b>Removed At:</b> ${new Date().toLocaleString("en-IN")}</p>
          <p>This task assignment will no longer appear in your active tasks.</p>
          <p><small>Note: Other tasks for this client-month may still be assigned to you or other employees.</small></p>
        `
            );

            logToConsole("INFO", "TASK_REMOVAL_EMAIL_SENT", {
                employeeEmail: employee.email,
                task
            });
        } catch (emailError) {
            logToConsole("WARN", "TASK_REMOVAL_EMAIL_FAILED", {
                error: emailError.message
            });
        }

        res.json({
            message: `Task "${task}" assignment removed successfully`,
            data: {
                clientId,
                clientName: client.name,
                employeeId,
                employeeName: employee.name,
                year: numericYear,
                month: numericMonth,
                task,
                removedAt: new Date(),
                removedBy: req.user.name,
                remainingTasksForMonth: client.employeeAssignments.filter(a =>
                    a.year === numericYear && a.month === numericMonth && !a.isRemoved
                ).length
            }
        });

    } catch (error) {
        logToConsole("ERROR", "REMOVE_TASK_ASSIGNMENT_FAILED", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            requestBody: req.body
        });

        res.status(500).json({
            message: "Error removing task assignment",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});




/* ===============================
   GET CLIENT TASK STATUS PER MONTH (NEW ENDPOINT)
================================ */
router.get("/client-tasks-status/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                message: "Missing required query parameters: year, month"
            });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        logToConsole("INFO", "GET_CLIENT_TASKS_STATUS_REQUEST", {
            adminId: req.user.adminId,
            clientId,
            year: numericYear,
            month: numericMonth
        });

        const client = await Client.findOne({ clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        // Get all active assignments for this client-month
        const assignments = client.employeeAssignments.filter(
            a => a.year === numericYear &&
                a.month === numericMonth &&
                !a.isRemoved
        );

        // Define all possible tasks
        const allTasks = [
            'Bookkeeping',
            'VAT Filing Computation',
            'VAT Filing',
            'Financial Statement Generation'
        ];

        // Create status for each task
        const taskStatus = allTasks.map(task => {
            const assignment = assignments.find(a => a.task === task);
            return {
                task,
                isAssigned: !!assignment,
                assignedTo: assignment ? {
                    employeeId: assignment.employeeId,
                    employeeName: assignment.employeeName,
                    assignedAt: assignment.assignedAt
                } : null,
                accountingDone: assignment ? assignment.accountingDone : false,
                accountingDoneAt: assignment ? assignment.accountingDoneAt : null
            };
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
                accountingDone: a.accountingDone,
                accountingDoneAt: a.accountingDoneAt
            }))
        };

        logToConsole("INFO", "CLIENT_TASKS_STATUS_FETCHED", {
            clientId,
            totalAssigned: assignments.length
        });

        res.json(response);

    } catch (error) {
        logToConsole("ERROR", "GET_CLIENT_TASKS_STATUS_FAILED", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            message: "Error fetching client task status",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
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
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", { employeeId });
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
            currentMonth
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
                                employeeId
                            });
                        }
                    }
                } catch (clientError) {
                    logToConsole("ERROR", "CLIENT_TASK_UPDATE_FAILED", {
                        clientId: assignment.clientId,
                        task: assignment.task,
                        error: clientError.message,
                        employeeId
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
            details: `Employee "${employee.name}" deactivated. Removed ${removedTasks.length} task assignments: ${removedTasks.join(', ')}`,
            dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
                tasksRemoved: removedTasks,
                count: removedTasks.length
            }
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
            employeeId,
            year,
            month,
            status
        });

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
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
            totalTasks: tasks.length
        });

        res.json(response);

    } catch (error) {
        logToConsole("ERROR", "GET_EMPLOYEE_TASKS_FAILED", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            message: "Error fetching employee tasks",
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