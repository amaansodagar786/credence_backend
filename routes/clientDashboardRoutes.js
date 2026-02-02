const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");

const Client = require("../models/Client");
const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// Console logging
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   HELPER: GET MONTH RANGE BASED ON FILTER
================================ */
const getMonthRange = (timeFilter, customStart = null, customEnd = null) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let months = [];

    switch (timeFilter) {
        case 'this_month':
            months = [{ year: currentYear, month: currentMonth }];
            break;

        case 'last_month':
            let lastYear = currentYear;
            let lastMonth = currentMonth - 1;
            if (lastMonth === 0) {
                lastMonth = 12;
                lastYear = currentYear - 1;
            }
            months = [{ year: lastYear, month: lastMonth }];
            break;

        case 'last_3_months':
            for (let i = 0; i < 3; i++) {
                let year = currentYear;
                let month = currentMonth - i;
                if (month <= 0) {
                    month += 12;
                    year -= 1;
                }
                months.push({ year, month });
            }
            break;

        case 'custom':
            if (customStart && customEnd) {
                const start = new Date(customStart);
                const end = new Date(customEnd);

                // Generate all months between start and end
                const current = new Date(start.getFullYear(), start.getMonth(), 1);
                const last = new Date(end.getFullYear(), end.getMonth(), 1);

                while (current <= last) {
                    months.push({
                        year: current.getFullYear(),
                        month: current.getMonth() + 1
                    });
                    current.setMonth(current.getMonth() + 1);
                }
            } else {
                // Default to this month
                months = [{ year: currentYear, month: currentMonth }];
            }
            break;

        default:
            months = [{ year: currentYear, month: currentMonth }];
    }

    // Sort months: newest first
    months.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
    });

    return months;
};

/* ===============================
   HELPER: GET DOCUMENT STATUS FOR CATEGORY
================================ */
const getCategoryDocumentStatus = (categoryData, categoryName) => {
    if (!categoryData) {
        return {
            category: categoryName,
            status: 'not_uploaded',
            files: [],
            totalFiles: 0,
            uploadedFiles: 0
        };
    }

    const files = categoryData.files || [];
    const uploadedFiles = files.filter(file => file.url && file.fileName);

    return {
        category: categoryName,
        status: uploadedFiles.length > 0 ? 'uploaded' : 'not_uploaded',
        files: uploadedFiles.map(file => ({
            fileName: file.fileName,
            uploadedAt: file.uploadedAt,
            uploadedBy: file.uploadedBy
        })),
        totalFiles: files.length,
        uploadedFiles: uploadedFiles.length,
        isLocked: categoryData.isLocked || false,
        notes: categoryData.categoryNotes || []
    };
};

/* ===============================
   HELPER: GET OTHER CATEGORIES STATUS
================================ */
const getOtherCategoriesStatus = (otherCategories = []) => {
    return otherCategories.map(cat => {
        if (!cat.document) {
            return {
                categoryName: cat.categoryName,
                status: 'not_uploaded',
                files: [],
                uploadedFiles: 0
            };
        }

        const files = cat.document.files || [];
        const uploadedFiles = files.filter(file => file.url && file.fileName);

        return {
            categoryName: cat.categoryName,
            status: uploadedFiles.length > 0 ? 'uploaded' : 'not_uploaded',
            files: uploadedFiles.map(file => ({
                fileName: file.fileName,
                uploadedAt: file.uploadedAt,
                uploadedBy: file.uploadedBy
            })),
            uploadedFiles: uploadedFiles.length,
            notes: cat.document.categoryNotes || []
        };
    });
};

/* ===============================
   HELPER: GET TASK STATUS FOR MONTH
================================ */
const getTaskStatusForMonth = async (employeeAssignments = [], year, month) => {
    const allTasks = [
        { id: 'bookkeeping', name: 'Bookkeeping', required: true },
        { id: 'vat_computation', name: 'VAT Filing Computation', required: true },
        { id: 'vat_filing', name: 'VAT Filing', required: true },
        { id: 'financial_statements', name: 'Financial Statement Generation', required: true }
    ];

    // Get assignments for this month (not removed)
    const monthAssignments = employeeAssignments.filter(assignment =>
        assignment.year === year &&
        assignment.month === month &&
        assignment.isRemoved === false
    );

    const taskStatus = allTasks.map(task => {
        const assignment = monthAssignments.find(a => a.task === task.name);

        if (assignment) {
            return {
                taskId: task.id,
                taskName: task.name,
                status: 'assigned',
                accountingDone: assignment.accountingDone || false,
                accountingDoneAt: assignment.accountingDoneAt,
                accountingDoneBy: assignment.accountingDoneBy,
                employeeId: assignment.employeeId,
                employeeName: assignment.employeeName,
                assignedAt: assignment.assignedAt,
                assignedBy: assignment.assignedBy
            };
        }

        return {
            taskId: task.id,
            taskName: task.name,
            status: 'not_assigned',
            accountingDone: false
        };
    });

    // Get employee details for assigned tasks
    const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
    const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];

    let employees = [];
    if (employeeIds.length > 0) {
        employees = await Employee.find(
            { employeeId: { $in: employeeIds } },
            { employeeId: 1, name: 1, email: 1, phone: 1 }
        ).lean();
    }

    // Add employee contact info to tasks
    return taskStatus.map(task => {
        if (task.status === 'assigned') {
            const employee = employees.find(emp => emp.employeeId === task.employeeId);
            return {
                ...task,
                employeeEmail: employee?.email || null,
                employeePhone: employee?.phone || null
            };
        }
        return task;
    });
};

/* ===============================
   HELPER: GET NOTES FOR MONTH
================================ */
const getNotesForMonth = (monthData) => {
    const allNotes = [];

    if (!monthData) {
        return { total: 0, notes: [] };
    }

    // 1. Month-level notes → ALWAYS CLIENT
    if (monthData.monthNotes && monthData.monthNotes.length > 0) {
        monthData.monthNotes.forEach(note => {
            allNotes.push({
                type: 'month_note',
                category: 'General',
                note: note.note,
                addedBy: note.addedBy || 'Client',
                addedAt: note.addedAt,
                addedById: note.employeeId, // This might be clientId when addedBy is Client
                source: 'client' // ALWAYS CLIENT
            });
        });
    }

    // 2. Category notes for required categories → ALWAYS CLIENT (delete reasons)
    ['sales', 'purchase', 'bank'].forEach(category => {
        const categoryData = monthData[category];
        if (categoryData && categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
            categoryData.categoryNotes.forEach(note => {
                allNotes.push({
                    type: 'delete_reason',
                    category: category.charAt(0).toUpperCase() + category.slice(1),
                    note: note.note,
                    addedBy: note.addedBy || 'Client',
                    addedAt: note.addedAt,
                    addedById: note.employeeId,
                    source: 'client' // ALWAYS CLIENT (delete reasons)
                });
            });
        }
    });

    // 3. File notes (inside files array) → ALWAYS EMPLOYEE
    ['sales', 'purchase', 'bank'].forEach(category => {
        const categoryData = monthData[category];
        if (categoryData && categoryData.files) {
            categoryData.files.forEach(file => {
                if (file.notes && file.notes.length > 0) {
                    file.notes.forEach(note => {
                        allNotes.push({
                            type: 'file_feedback',
                            category: category.charAt(0).toUpperCase() + category.slice(1),
                            fileName: file.fileName,
                            note: note.note,
                            addedBy: note.addedBy || 'Employee',
                            addedAt: note.addedAt,
                            addedById: note.employeeId,
                            source: 'employee' // ALWAYS EMPLOYEE (feedback on uploaded files)
                        });
                    });
                }
            });
        }
    });

    // 4. Other categories → Same pattern
    if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCat => {
            if (otherCat.document) {
                // Category notes for other categories → CLIENT (delete reasons)
                if (otherCat.document.categoryNotes && otherCat.document.categoryNotes.length > 0) {
                    otherCat.document.categoryNotes.forEach(note => {
                        allNotes.push({
                            type: 'delete_reason',
                            category: otherCat.categoryName,
                            note: note.note,
                            addedBy: note.addedBy || 'Client',
                            addedAt: note.addedAt,
                            addedById: note.employeeId,
                            source: 'client' // ALWAYS CLIENT
                        });
                    });
                }

                // File notes for other categories → EMPLOYEE
                if (otherCat.document.files) {
                    otherCat.document.files.forEach(file => {
                        if (file.notes && file.notes.length > 0) {
                            file.notes.forEach(note => {
                                allNotes.push({
                                    type: 'file_feedback',
                                    category: otherCat.categoryName,
                                    fileName: file.fileName,
                                    note: note.note,
                                    addedBy: note.addedBy || 'Employee',
                                    addedAt: note.addedAt,
                                    addedById: note.employeeId,
                                    source: 'employee' // ALWAYS EMPLOYEE
                                });
                            });
                        }
                    });
                }
            }
        });
    }

    // Sort by date (newest first)
    allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    return {
        total: allNotes.length,
        notes: allNotes
    };
};

/* ===============================
   1. GET CLIENT DASHBOARD OVERVIEW
================================ */
router.get("/dashboard/overview", auth, async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;

        logToConsole("INFO", "CLIENT_DASHBOARD_REQUEST", {
            clientId,
            timeFilter,
            customStart,
            customEnd
        });

        // Get client data with all fields
        const client = await Client.findOne(
            { clientId },
            {
                clientId: 1,
                name: 1,
                email: 1,
                phone: 1,
                address: 1,
                firstName: 1,
                lastName: 1,
                visaType: 1,
                businessAddress: 1,
                businessName: 1,
                vatPeriod: 1,
                businessNature: 1,
                planSelected: 1,
                enrollmentDate: 1,
                createdAt: 1,
                documents: 1,
                employeeAssignments: 1
            }
        ).lean();

        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_DASHBOARD", {
                clientId
            });
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Create activity log for dashboard view
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            action: "DASHBOARD_VIEWED",
            details: `Client viewed dashboard overview with filter: ${timeFilter}`,
            dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
                timeFilter,
                customStart,
                customEnd,
                clientName: client.name
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "DASHBOARD_VIEWED",
            clientId: client.clientId
        });

        // Get month range based on filter
        const months = getMonthRange(timeFilter, customStart, customEnd);

        const monthData = [];
        const allTasksSummary = {
            totalAssigned: 0,
            totalCompleted: 0,
            totalTasks: 0
        };
        const allNotesSummary = {
            totalNotes: 0,
            clientNotes: 0,
            employeeNotes: 0
        };

        // Process each month
        for (const month of months) {
            const yearKey = String(month.year);
            const monthKey = String(month.month);
            const monthDocuments = client.documents?.[yearKey]?.[monthKey];

            // 1. Document Status
            const requiredCategories = ['sales', 'purchase', 'bank'];
            const categoryStatus = requiredCategories.map(cat =>
                getCategoryDocumentStatus(monthDocuments?.[cat], cat)
            );

            const otherCategories = getOtherCategoriesStatus(monthDocuments?.other);

            const totalRequiredFiles = categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0);
            const totalRequiredCategories = categoryStatus.filter(cat => cat.uploadedFiles > 0).length;

            // 2. Task Status
            const taskStatus = await getTaskStatusForMonth(
                client.employeeAssignments || [],
                month.year,
                month.month
            );

            const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
            const completedTasks = taskStatus.filter(task => task.accountingDone === true);

            // 3. Notes
            const notes = getNotesForMonth(monthDocuments);
            const clientNotes = notes.notes.filter(note => note.source === 'client');
            const employeeNotes = notes.notes.filter(note => note.source === 'employee');

            // Update summaries
            allTasksSummary.totalAssigned += assignedTasks.length;
            allTasksSummary.totalCompleted += completedTasks.length;
            allTasksSummary.totalTasks += taskStatus.length;

            allNotesSummary.totalNotes += notes.total;
            allNotesSummary.clientNotes += clientNotes.length;
            allNotesSummary.employeeNotes += employeeNotes.length;

            // Month summary
            monthData.push({
                year: month.year,
                month: month.month,
                monthName: new Date(month.year, month.month - 1).toLocaleString('default', { month: 'long' }),

                // Document Summary
                documents: {
                    requiredCategories: categoryStatus,
                    otherCategories: otherCategories,
                    summary: {
                        totalUploadedFiles: totalRequiredFiles,
                        uploadedCategories: totalRequiredCategories,
                        totalRequiredCategories: requiredCategories.length,
                        status: totalRequiredCategories === requiredCategories.length ? 'complete' :
                            totalRequiredCategories > 0 ? 'partial' : 'none'
                    }
                },

                // Task Summary
                tasks: {
                    list: taskStatus,
                    summary: {
                        totalTasks: taskStatus.length,
                        assignedTasks: assignedTasks.length,
                        completedTasks: completedTasks.length,
                        completionRate: taskStatus.length > 0 ? Math.round((completedTasks.length / taskStatus.length) * 100) : 0
                    }
                },

                // Notes Summary
                notes: {
                    list: notes.notes.slice(0, 5), // Show only latest 5 notes
                    summary: {
                        totalNotes: notes.total,
                        clientNotes: clientNotes.length,
                        employeeNotes: employeeNotes.length
                    }
                },

                // Month Status
                monthStatus: {
                    isLocked: monthDocuments?.isLocked || false,
                    accountingDone: monthDocuments?.accountingDone || false,
                    accountingDoneAt: monthDocuments?.accountingDoneAt,
                    accountingDoneBy: monthDocuments?.accountingDoneBy
                }
            });
        }

        // Enhanced client info with all fields
        const clientInfo = {
            clientId: client.clientId,
            name: client.name,
            firstName: client.firstName || "",
            lastName: client.lastName || "",
            email: client.email,
            phone: client.phone,
            address: client.address,
            businessName: client.businessName || "Not specified",
            businessNature: client.businessNature || "Not specified",
            vatPeriod: client.vatPeriod || "Monthly",
            visaType: client.visaType || "Not specified",
            businessAddress: client.businessAddress || "Not specified",
            planSelected: client.planSelected || "Basic Accounting Services",
            activeSince: client.enrollmentDate
                ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                })
                : new Date(client.createdAt).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }),
            enrollmentDate: client.enrollmentDate
                ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                })
                : "Not available"
        };

        logToConsole("SUCCESS", "CLIENT_DASHBOARD_FETCHED", {
            clientId,
            monthsCount: monthData.length,
            totalTasks: allTasksSummary.totalTasks
        });

        res.json({
            success: true,
            client: clientInfo,
            timeFilter,
            months: months.map(m => ({
                year: m.year,
                month: m.month,
                display: `${new Date(m.year, m.month - 1).toLocaleString('default', { month: 'long' })} ${m.year}`
            })),
            data: monthData,
            summaries: {
                tasks: allTasksSummary,
                notes: allNotesSummary
            }
        });

    } catch (error) {
        logToConsole("ERROR", "CLIENT_DASHBOARD_FAILED", {
            error: error.message,
            stack: error.stack,
            clientId: req.user?.clientId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching client dashboard data"
        });
    }
});

/* ===============================
   2. GET SPECIFIC MONTH DETAILS
================================ */
router.get("/dashboard/month-details", auth, async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { year, month } = req.query;

        if (!year || !month) {
            logToConsole("WARN", "MONTH_DETAILS_MISSING_PARAMS", {
                clientId,
                year,
                month
            });
            return res.status(400).json({
                success: false,
                message: "Year and month are required"
            });
        }

        logToConsole("INFO", "CLIENT_MONTH_DETAILS_REQUEST", {
            clientId,
            year,
            month
        });

        const client = await Client.findOne(
            { clientId },
            {
                clientId: 1,
                name: 1,
                email: 1,
                documents: 1,
                employeeAssignments: 1
            }
        ).lean();

        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_MONTH_DETAILS", {
                clientId
            });
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Create activity log for month details view
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            action: "MONTH_DETAILS_VIEWED",
            details: `Client viewed details for ${year}-${month}`,
            dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
                year,
                month,
                clientName: client.name
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "MONTH_DETAILS_VIEWED",
            clientId: client.clientId
        });

        const yearKey = String(year);
        const monthKey = String(month);
        const monthData = client.documents?.[yearKey]?.[monthKey];

        // Document Status
        const requiredCategories = ['sales', 'purchase', 'bank'];
        const categoryStatus = requiredCategories.map(cat =>
            getCategoryDocumentStatus(monthData?.[cat], cat)
        );

        const otherCategories = getOtherCategoriesStatus(monthData?.other);

        // Task Status with employee details
        const taskStatus = await getTaskStatusForMonth(
            client.employeeAssignments || [],
            parseInt(year),
            parseInt(month)
        );

        // All Notes for this month
        const notes = getNotesForMonth(monthData);

        // Get employee details for assigned tasks
        const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
        const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];

        let employees = [];
        if (employeeIds.length > 0) {
            employees = await Employee.find(
                { employeeId: { $in: employeeIds } },
                { employeeId: 1, name: 1, email: 1, phone: 1 }
            ).lean();
        }

        logToConsole("SUCCESS", "MONTH_DETAILS_FETCHED", {
            clientId,
            year,
            month,
            totalTasks: taskStatus.length,
            assignedTasks: assignedTasks.length,
            notesCount: notes.total
        });

        res.json({
            success: true,
            client: {
                clientId: client.clientId,
                name: client.name,
                email: client.email
            },
            month: {
                year: parseInt(year),
                month: parseInt(month),
                monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
            },

            // Documents
            documents: {
                requiredCategories,
                status: categoryStatus,
                otherCategories,
                summary: {
                    totalRequiredCategories: requiredCategories.length,
                    uploadedCategories: categoryStatus.filter(cat => cat.uploadedFiles > 0).length,
                    totalFiles: categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0),
                    status: categoryStatus.every(cat => cat.uploadedFiles > 0) ? 'complete' :
                        categoryStatus.some(cat => cat.uploadedFiles > 0) ? 'partial' : 'none'
                }
            },

            // Tasks
            tasks: {
                list: taskStatus,
                assignedEmployees: employees.map(emp => ({
                    employeeId: emp.employeeId,
                    name: emp.name,
                    email: emp.email,
                    phone: emp.phone,
                    assignedTasks: assignedTasks
                        .filter(task => task.employeeId === emp.employeeId)
                        .map(task => task.taskName)
                })),
                summary: {
                    totalTasks: taskStatus.length,
                    assignedTasks: assignedTasks.length,
                    completedTasks: taskStatus.filter(task => task.accountingDone).length,
                    notAssignedTasks: taskStatus.filter(task => task.status === 'not_assigned').length
                }
            },

            // Notes with corrected source types
            notes: {
                total: notes.total,
                list: notes.notes,
                summary: {
                    clientNotes: notes.notes.filter(n => n.source === 'client').length,
                    employeeNotes: notes.notes.filter(n => n.source === 'employee').length,
                    byType: {
                        month: notes.notes.filter(n => n.type === 'month').length,
                        category_note: notes.notes.filter(n => n.type === 'category_note').length,
                        file: notes.notes.filter(n => n.type === 'file').length
                    }
                }
            },

            // Month Status
            monthStatus: {
                isLocked: monthData?.isLocked || false,
                wasLockedOnce: monthData?.wasLockedOnce || false,
                lockedAt: monthData?.lockedAt,
                lockedBy: monthData?.lockedBy,
                accountingDone: monthData?.accountingDone || false,
                accountingDoneAt: monthData?.accountingDoneAt,
                accountingDoneBy: monthData?.accountingDoneBy,
                autoLockDate: monthData?.autoLockDate
            }
        });

    } catch (error) {
        logToConsole("ERROR", "MONTH_DETAILS_FAILED", {
            error: error.message,
            stack: error.stack,
            clientId: req.user?.clientId,
            year: req.query?.year,
            month: req.query?.month
        });

        res.status(500).json({
            success: false,
            message: "Error fetching month details"
        });
    }
});

/* ===============================
   3. GET EMPLOYEE CONTACT FOR SPECIFIC TASK
================================ */
router.get("/dashboard/employee-contact", auth, async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { employeeId } = req.query;

        if (!employeeId) {
            logToConsole("WARN", "EMPLOYEE_CONTACT_MISSING_ID", {
                clientId
            });
            return res.status(400).json({
                success: false,
                message: "Employee ID is required"
            });
        }

        logToConsole("INFO", "EMPLOYEE_CONTACT_REQUEST", {
            clientId,
            employeeId
        });

        const client = await Client.findOne({ clientId }).lean();
        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_EMPLOYEE_CONTACT", {
                clientId
            });
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        const employee = await Employee.findOne(
            { employeeId },
            {
                employeeId: 1,
                name: 1,
                email: 1,
                phone: 1,
                isActive: 1
            }
        ).lean();

        if (!employee) {
            logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
                clientId,
                employeeId
            });
            return res.status(404).json({
                success: false,
                message: "Employee not found"
            });
        }

        // Create activity log for employee contact view
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            employeeId: employee.employeeId,
            employeeName: employee.name,
            action: "EMPLOYEE_CONTACT_VIEWED",
            details: `Client viewed contact details for employee: ${employee.name}`,
            dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
                employeeId,
                employeeName: employee.name,
                clientName: client.name
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "EMPLOYEE_CONTACT_VIEWED",
            clientId: client.clientId,
            employeeId: employee.employeeId
        });

        logToConsole("SUCCESS", "EMPLOYEE_CONTACT_FETCHED", {
            clientId,
            employeeId,
            employeeName: employee.name
        });

        res.json({
            success: true,
            employee: {
                employeeId: employee.employeeId,
                name: employee.name,
                email: employee.email,
                phone: employee.phone || "Not provided",
                isActive: employee.isActive
            }
        });

    } catch (error) {
        logToConsole("ERROR", "EMPLOYEE_CONTACT_FAILED", {
            error: error.message,
            stack: error.stack,
            clientId: req.user?.clientId,
            employeeId: req.query?.employeeId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching employee contact"
        });
    }
});

/* ===============================
   4. GET DOCUMENT UPLOAD HISTORY
================================ */
router.get("/dashboard/upload-history", auth, async (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { limit = 10 } = req.query;

        logToConsole("INFO", "UPLOAD_HISTORY_REQUEST", {
            clientId,
            limit
        });

        const client = await Client.findOne(
            { clientId },
            {
                documents: 1,
                name: 1,
                clientId: 1
            }
        ).lean();

        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_UPLOAD_HISTORY", {
                clientId
            });
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Create activity log for upload history view
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            action: "UPLOAD_HISTORY_VIEWED",
            details: `Client viewed document upload history (limit: ${limit})`,
            dateTime: new Date().toLocaleString("en-IN"),
            metadata: {
                limit,
                clientName: client.name
            }
        });

        logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
            action: "UPLOAD_HISTORY_VIEWED",
            clientId: client.clientId
        });

        const uploadHistory = [];
        const documents = client.documents || {};

        // Extract all uploads from all months
        Object.keys(documents).forEach(year => {
            Object.keys(documents[year]).forEach(month => {
                const monthData = documents[year][month];

                // Check required categories
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (categoryData && categoryData.files) {
                        categoryData.files.forEach(file => {
                            if (file.uploadedAt && file.fileName) {
                                uploadHistory.push({
                                    year: parseInt(year),
                                    month: parseInt(month),
                                    monthName: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
                                    category: category.charAt(0).toUpperCase() + category.slice(1),
                                    fileName: file.fileName,
                                    uploadedAt: file.uploadedAt,
                                    uploadedBy: file.uploadedBy || "System",
                                    fileType: file.fileType,
                                    fileSize: file.fileSize
                                });
                            }
                        });
                    }
                });

                // Check other categories
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCat => {
                        if (otherCat.document && otherCat.document.files) {
                            otherCat.document.files.forEach(file => {
                                if (file.uploadedAt && file.fileName) {
                                    uploadHistory.push({
                                        year: parseInt(year),
                                        month: parseInt(month),
                                        monthName: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
                                        category: otherCat.categoryName,
                                        fileName: file.fileName,
                                        uploadedAt: file.uploadedAt,
                                        uploadedBy: file.uploadedBy || "System",
                                        fileType: file.fileType,
                                        fileSize: file.fileSize
                                    });
                                }
                            });
                        }
                    });
                }
            });
        });

        // Sort by upload date (newest first)
        uploadHistory.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

        // Limit results
        const limitedHistory = uploadHistory.slice(0, parseInt(limit));

        logToConsole("SUCCESS", "UPLOAD_HISTORY_FETCHED", {
            clientId,
            totalUploads: uploadHistory.length,
            returnedUploads: limitedHistory.length
        });

        res.json({
            success: true,
            totalUploads: uploadHistory.length,
            uploads: limitedHistory,
            summary: {
                byCategory: uploadHistory.reduce((acc, upload) => {
                    acc[upload.category] = (acc[upload.category] || 0) + 1;
                    return acc;
                }, {}),
                byMonth: uploadHistory.reduce((acc, upload) => {
                    const key = `${upload.year}-${upload.month}`;
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        logToConsole("ERROR", "UPLOAD_HISTORY_FAILED", {
            error: error.message,
            stack: error.stack,
            clientId: req.user?.clientId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching upload history"
        });
    }
});

module.exports = router;