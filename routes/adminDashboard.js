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
   HELPER: GET DATE RANGE BASED ON FILTER
================================ */
const getDateRange = (timeFilter, customStart = null, customEnd = null) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let startDate, endDate, months = [];

    switch (timeFilter) {
        case 'today':
            startDate = startOfDay;
            endDate = endOfDay;
            months = [{ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }];
            break;

        case 'this_week':
            // Get start of week (Monday)
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const startOfWeek = new Date(now.setDate(diff));
            startOfWeek.setHours(0, 0, 0, 0);
            startDate = startOfWeek;
            endDate = endOfDay;

            // Get all days in this week
            for (let i = 0; i < 7; i++) {
                const date = new Date(startOfWeek);
                date.setDate(startOfWeek.getDate() + i);
                if (date <= endOfDay) {
                    months.push({
                        year: date.getFullYear(),
                        month: date.getMonth() + 1,
                        day: date.getDate()
                    });
                }
            }
            break;

        case 'this_month':
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            startDate = new Date(currentYear, currentMonth - 1, 1);
            endDate = endOfDay;
            months = [{ year: currentYear, month: currentMonth }];
            break;

        case 'last_month':
            let lastYear = now.getFullYear();
            let lastMonth = now.getMonth();
            if (lastMonth === 0) {
                lastMonth = 12;
                lastYear = now.getFullYear() - 1;
            }
            startDate = new Date(lastYear, lastMonth - 1, 1);
            endDate = new Date(lastYear, lastMonth, 0, 23, 59, 59, 999);
            months = [{ year: lastYear, month: lastMonth }];
            break;

        case 'last_3_months':
            startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            endDate = endOfDay;
            for (let i = 0; i < 3; i++) {
                let year = now.getFullYear();
                let month = now.getMonth() + 1 - i;
                if (month <= 0) {
                    month += 12;
                    year -= 1;
                }
                months.push({ year, month });
            }
            break;

        case 'custom':
            if (customStart && customEnd) {
                startDate = new Date(customStart);
                endDate = new Date(customEnd);
                endDate.setHours(23, 59, 59, 999);

                // Generate months between custom dates
                const start = new Date(startDate);
                const end = new Date(endDate);
                const current = new Date(start.getFullYear(), start.getMonth(), 1);

                while (current <= end) {
                    months.push({
                        year: current.getFullYear(),
                        month: current.getMonth() + 1
                    });
                    current.setMonth(current.getMonth() + 1);
                }
            } else {
                // Default to this month if no custom dates
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth() + 1;
                startDate = new Date(currentYear, currentMonth - 1, 1);
                endDate = endOfDay;
                months = [{ year: currentYear, month: currentMonth }];
            }
            break;

        default:
            const defaultYear = now.getFullYear();
            const defaultMonth = now.getMonth() + 1;
            startDate = new Date(defaultYear, defaultMonth - 1, 1);
            endDate = endOfDay;
            months = [{ year: defaultYear, month: defaultMonth }];
    }

    return {
        startDate,
        endDate,
        months,
        timeFilter
    };
};

/* ===============================
   HELPER: GET CURRENT MONTH FROM DATE RANGE
================================ */
const getCurrentMonthFromRange = (dateRange) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Find current month in the range, or use first month
    const currentInRange = dateRange.months.find(m =>
        m.year === currentYear && m.month === currentMonth
    );

    return currentInRange || dateRange.months[0] || { year: currentYear, month: currentMonth };
};

/* ===============================
   1. GET DASHBOARD OVERVIEW METRICS
================================ */
router.get("/dashboard/overview", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;

        logToConsole("INFO", "DASHBOARD_OVERVIEW_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd
        });

        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        // 1. Active Clients Count (always total, not filtered by time)
        const activeClientsCount = await Client.countDocuments({ isActive: true });

        // 2. Active Employees Count (always total, not filtered by time)
        const activeEmployeesCount = await Employee.countDocuments({ isActive: true });

        // 3. Unassigned Clients Count (clients without any assignment for current month)
        const unassignedClients = await Client.aggregate([
            { $match: { isActive: true } },
            {
                $project: {
                    clientId: 1,
                    name: 1,
                    employeeAssignments: {
                        $filter: {
                            input: "$employeeAssignments",
                            as: "assignment",
                            cond: {
                                $and: [
                                    { $eq: ["$$assignment.year", currentMonth.year] },
                                    { $eq: ["$$assignment.month", currentMonth.month] },
                                    { $eq: ["$$assignment.isRemoved", false] }
                                ]
                            }
                        }
                    }
                }
            },
            { $match: { employeeAssignments: { $size: 0 } } },
            { $count: "count" }
        ]);
        const unassignedClientsCount = unassignedClients[0]?.count || 0;

        // 4. Idle Employees Count (employees without any assignment for current month)
        const idleEmployees = await Employee.aggregate([
            { $match: { isActive: true } },
            {
                $project: {
                    employeeId: 1,
                    name: 1,
                    assignedClients: {
                        $filter: {
                            input: "$assignedClients",
                            as: "assignment",
                            cond: {
                                $and: [
                                    { $eq: ["$$assignment.year", currentMonth.year] },
                                    { $eq: ["$$assignment.month", currentMonth.month] },
                                    { $eq: ["$$assignment.isRemoved", false] }
                                ]
                            }
                        }
                    }
                }
            },
            { $match: { assignedClients: { $size: 0 } } },
            { $count: "count" }
        ]);
        const idleEmployeesCount = idleEmployees[0]?.count || 0;

        // 5. Clients with Incomplete Tasks (for current month)
        const clientsWithIncompleteTasks = await Client.aggregate([
            { $match: { isActive: true } },
            { $unwind: { path: "$employeeAssignments", preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $or: [
                        { employeeAssignments: null },
                        {
                            "employeeAssignments.year": currentMonth.year,
                            "employeeAssignments.month": currentMonth.month,
                            "employeeAssignments.isRemoved": false,
                            "employeeAssignments.accountingDone": false
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: "$_id",
                    clientId: { $first: "$clientId" },
                    name: { $first: "$name" },
                    email: { $first: "$email" },
                    phone: { $first: "$phone" },
                    incompleteTasks: {
                        $push: {
                            task: "$employeeAssignments.task",
                            accountingDone: "$employeeAssignments.accountingDone",
                            employeeName: "$employeeAssignments.employeeName"
                        }
                    }
                }
            },
            {
                $project: {
                    clientId: 1,
                    name: 1,
                    email: 1,
                    phone: 1,
                    incompleteTasks: {
                        $filter: {
                            input: "$incompleteTasks",
                            as: "task",
                            cond: { $eq: ["$$task.accountingDone", false] }
                        }
                    }
                }
            },
            { $match: { $expr: { $gt: [{ $size: "$incompleteTasks" }, 0] } } },
            { $count: "count" }
        ]);
        const incompleteTasksCount = clientsWithIncompleteTasks[0]?.count || 0;

        // 6. Recent Notes Count (filtered by date range)
        let recentNotesCount = 0;

        // Get all active clients
        const allClients = await Client.find(
            { isActive: true },
            {
                clientId: 1,
                name: 1,
                email: 1,
                documents: 1
            }
        ).lean();

        // Count notes within date range
        allClients.forEach(client => {
            if (!client.documents) return;

            // Check each year/month in the date range
            dateRange.months.forEach(monthRange => {
                const yearKey = String(monthRange.year);
                const monthKey = String(monthRange.month);
                const monthData = client.documents?.[yearKey]?.[monthKey];
                if (!monthData) return;

                // Count notes in this month
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (!categoryData) return;

                    // Category notes
                    if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                        recentNotesCount += categoryData.categoryNotes.length;
                    }

                    // File notes
                    if (categoryData.files && Array.isArray(categoryData.files)) {
                        categoryData.files.forEach(file => {
                            if (file.notes && file.notes.length > 0) {
                                recentNotesCount += file.notes.length;
                            }
                        });
                    }
                });

                // Check other categories
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory.document) {
                            const otherDoc = otherCategory.document;

                            // Category notes
                            if (otherDoc.categoryNotes && otherDoc.categoryNotes.length > 0) {
                                recentNotesCount += otherDoc.categoryNotes.length;
                            }

                            // File notes
                            if (otherDoc.files && Array.isArray(otherDoc.files)) {
                                otherDoc.files.forEach(file => {
                                    if (file.notes && file.notes.length > 0) {
                                        recentNotesCount += file.notes.length;
                                    }
                                });
                            }
                        }
                    });
                }
            });
        });

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "DASHBOARD_OVERVIEW_VIEWED",
                details: `Viewed dashboard overview with filter: ${timeFilter}. Metrics: ${activeClientsCount} active clients, ${activeEmployeesCount} active employees`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    customStart,
                    customEnd,
                    activeClientsCount,
                    activeEmployeesCount,
                    unassignedClientsCount,
                    idleEmployeesCount,
                    incompleteTasksCount,
                    recentNotesCount
                }
            });

            logToConsole("INFO", "DASHBOARD_OVERVIEW_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "DASHBOARD_OVERVIEW_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "DASHBOARD_OVERVIEW_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "DASHBOARD_OVERVIEW_FETCHED", {
            adminId: req.user.adminId,
            activeClientsCount,
            activeEmployeesCount,
            timeFilter
        });

        res.json({
            success: true,
            metrics: {
                activeClients: activeClientsCount,
                activeEmployees: activeEmployeesCount,
                unassignedClients: unassignedClientsCount,
                idleEmployees: idleEmployeesCount,
                incompleteTasks: incompleteTasksCount,
                recentNotes: recentNotesCount
            },
            timeFilter: dateRange.timeFilter,
            currentMonth,
            dateRange: {
                startDate: dateRange.startDate.toISOString(),
                endDate: dateRange.endDate.toISOString(),
                monthsCount: dateRange.months.length
            }
        });

    } catch (error) {
        logToConsole("ERROR", "DASHBOARD_OVERVIEW_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching dashboard overview"
        });
    }
});

/* ===============================
   2. GET ACTIVE CLIENTS (FOR TABLE MODAL)
================================ */
router.get("/dashboard/active-clients", auth, async (req, res) => {
    try {
        logToConsole("INFO", "ACTIVE_CLIENTS_REQUEST", {
            adminId: req.user.adminId
        });

        const clients = await Client.find(
            { isActive: true },
            {
                clientId: 1,
                name: 1,
                email: 1,
                phone: 1,
                planSelected: 1,
                createdAt: 1
            }
        )
            .sort({ name: 1 })
            .lean();

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "ACTIVE_CLIENTS_VIEWED",
                details: `Viewed list of active clients. Total: ${clients.length} clients`,
                dateTime: new Date(),
                metadata: {
                    totalClients: clients.length
                }
            });

            logToConsole("INFO", "ACTIVE_CLIENTS_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "ACTIVE_CLIENTS_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVE_CLIENTS_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "ACTIVE_CLIENTS_FETCHED", {
            adminId: req.user.adminId,
            count: clients.length
        });

        res.json({
            success: true,
            count: clients.length,
            clients: clients.map(client => ({
                clientId: client.clientId,
                name: client.name,
                email: client.email,
                phone: client.phone || "N/A",
                plan: client.planSelected || "N/A",
                joined: new Date(client.createdAt).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                })
            }))
        });

    } catch (error) {
        logToConsole("ERROR", "ACTIVE_CLIENTS_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching active clients"
        });
    }
});

/* ===============================
   3. GET ACTIVE EMPLOYEES (FOR TABLE MODAL)
================================ */
router.get("/dashboard/active-employees", auth, async (req, res) => {
    try {
        logToConsole("INFO", "ACTIVE_EMPLOYEES_REQUEST", {
            adminId: req.user.adminId
        });

        const employees = await Employee.find(
            { isActive: true },
            {
                employeeId: 1,
                name: 1,
                email: 1,
                phone: 1,
                createdAt: 1
            }
        )
            .sort({ name: 1 })
            .lean();

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "ACTIVE_EMPLOYEES_VIEWED",
                details: `Viewed list of active employees. Total: ${employees.length} employees`,
                dateTime: new Date(),
                metadata: {
                    totalEmployees: employees.length
                }
            });

            logToConsole("INFO", "ACTIVE_EMPLOYEES_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "ACTIVE_EMPLOYEES_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVE_EMPLOYEES_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "ACTIVE_EMPLOYEES_FETCHED", {
            adminId: req.user.adminId,
            count: employees.length
        });

        res.json({
            success: true,
            count: employees.length,
            employees: employees.map(emp => ({
                employeeId: emp.employeeId,
                name: emp.name,
                email: emp.email,
                phone: emp.phone || "N/A",
                joined: new Date(emp.createdAt).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                })
            }))
        });

    } catch (error) {
        logToConsole("ERROR", "ACTIVE_EMPLOYEES_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching active employees"
        });
    }
});

/* ===============================
   4. GET UNASSIGNED CLIENTS WITH MISSING TASKS
================================ */
router.get("/dashboard/unassigned-clients", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        logToConsole("INFO", "UNASSIGNED_CLIENTS_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd
        });

        // All tasks that should be assigned
        const allTasks = [
            'Bookkeeping',
            'VAT Filing Computation',
            'VAT Filing',
            'Financial Statement Generation'
        ];

        // Get all active clients
        const allClients = await Client.find(
            { isActive: true },
            {
                clientId: 1,
                name: 1,
                email: 1,
                phone: 1,
                planSelected: 1,
                employeeAssignments: 1
            }
        ).lean();

        // Find unassigned clients and their missing tasks
        const unassignedClients = allClients
            .map(client => {
                const currentAssignments = (client.employeeAssignments || []).filter(assignment =>
                    assignment.year === currentMonth.year &&
                    assignment.month === currentMonth.month &&
                    assignment.isRemoved === false
                );

                // Find which tasks are missing
                const assignedTasks = currentAssignments.map(a => a.task);
                const missingTasks = allTasks.filter(task => !assignedTasks.includes(task));

                // Only include clients with missing tasks
                if (missingTasks.length > 0) {
                    return {
                        clientId: client.clientId,
                        name: client.name,
                        email: client.email,
                        phone: client.phone || "N/A",
                        plan: client.planSelected || "N/A",
                        missingTasks,
                        totalMissing: missingTasks.length
                    };
                }
                return null;
            })
            .filter(client => client !== null);

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "UNASSIGNED_CLIENTS_VIEWED",
                details: `Viewed unassigned clients for ${currentMonth.month}/${currentMonth.year}. Found ${unassignedClients.length} clients with missing tasks`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    year: currentMonth.year,
                    month: currentMonth.month,
                    totalClients: unassignedClients.length,
                    totalTasksMissing: unassignedClients.reduce((sum, client) => sum + client.totalMissing, 0)
                }
            });

            logToConsole("INFO", "UNASSIGNED_CLIENTS_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "UNASSIGNED_CLIENTS_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "UNASSIGNED_CLIENTS_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "UNASSIGNED_CLIENTS_FETCHED", {
            adminId: req.user.adminId,
            count: unassignedClients.length,
            timeFilter
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: unassignedClients.length,
            clients: unassignedClients
        });

    } catch (error) {
        logToConsole("ERROR", "UNASSIGNED_CLIENTS_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching unassigned clients"
        });
    }
});

/* ===============================
   5. GET IDLE EMPLOYEES (NO ASSIGNMENTS)
================================ */
router.get("/dashboard/idle-employees", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        logToConsole("INFO", "IDLE_EMPLOYEES_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd
        });

        const employees = await Employee.find(
            { isActive: true },
            {
                employeeId: 1,
                name: 1,
                email: 1,
                phone: 1,
                assignedClients: 1
            }
        ).lean();

        // Find employees with no assignments for current month
        const idleEmployees = employees
            .map(employee => {
                const currentAssignments = (employee.assignedClients || []).filter(assignment =>
                    assignment.year === currentMonth.year &&
                    assignment.month === currentMonth.month &&
                    assignment.isRemoved === false
                );

                if (currentAssignments.length === 0) {
                    return {
                        employeeId: employee.employeeId,
                        name: employee.name,
                        email: employee.email,
                        phone: employee.phone || "N/A"
                    };
                }
                return null;
            })
            .filter(emp => emp !== null);

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "IDLE_EMPLOYEES_VIEWED",
                details: `Viewed idle employees for ${currentMonth.month}/${currentMonth.year}. Found ${idleEmployees.length} employees without assignments`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    year: currentMonth.year,
                    month: currentMonth.month,
                    totalIdleEmployees: idleEmployees.length
                }
            });

            logToConsole("INFO", "IDLE_EMPLOYEES_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "IDLE_EMPLOYEES_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "IDLE_EMPLOYEES_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "IDLE_EMPLOYEES_FETCHED", {
            adminId: req.user.adminId,
            count: idleEmployees.length,
            timeFilter
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: idleEmployees.length,
            employees: idleEmployees
        });

    } catch (error) {
        logToConsole("ERROR", "IDLE_EMPLOYEES_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching idle employees"
        });
    }
});

/* ===============================
   6. GET CLIENTS WITH INCOMPLETE TASKS
================================ */
router.get("/dashboard/incomplete-tasks", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        logToConsole("INFO", "INCOMPLETE_TASKS_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd
        });

        const clients = await Client.aggregate([
            { $match: { isActive: true } },
            { $unwind: { path: "$employeeAssignments", preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $or: [
                        { employeeAssignments: null },
                        {
                            "employeeAssignments.year": currentMonth.year,
                            "employeeAssignments.month": currentMonth.month,
                            "employeeAssignments.isRemoved": false,
                            "employeeAssignments.accountingDone": false
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: "$_id",
                    clientId: { $first: "$clientId" },
                    name: { $first: "$name" },
                    email: { $first: "$email" },
                    phone: { $first: "$phone" },
                    incompleteAssignments: {
                        $push: {
                            task: "$employeeAssignments.task",
                            accountingDone: "$employeeAssignments.accountingDone",
                            employeeName: "$employeeAssignments.employeeName",
                            employeeId: "$employeeAssignments.employeeId"
                        }
                    }
                }
            },
            {
                $project: {
                    clientId: 1,
                    name: 1,
                    email: 1,
                    phone: 1,
                    incompleteTasks: {
                        $filter: {
                            input: "$incompleteAssignments",
                            as: "assignment",
                            cond: {
                                $and: [
                                    { $ne: ["$$assignment.task", null] },
                                    { $eq: ["$$assignment.accountingDone", false] }
                                ]
                            }
                        }
                    }
                }
            },
            { $match: { $expr: { $gt: [{ $size: "$incompleteTasks" }, 0] } } },
            { $sort: { name: 1 } }
        ]);

        // Format the response
        const formattedClients = clients.map(client => ({
            clientId: client.clientId,
            name: client.name,
            email: client.email,
            phone: client.phone || "N/A",
            incompleteTasks: client.incompleteTasks.map(task => ({
                task: task.task,
                assignedTo: task.employeeName || "Not assigned",
                status: "Pending"
            })),
            totalIncomplete: client.incompleteTasks.length
        }));

        // Add Activity Log
        try {
            const totalIncompleteTasks = formattedClients.reduce((sum, client) => sum + client.totalIncomplete, 0);

            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "INCOMPLETE_TASKS_VIEWED",
                details: `Viewed incomplete tasks for ${currentMonth.month}/${currentMonth.year}. Found ${formattedClients.length} clients with ${totalIncompleteTasks} incomplete tasks`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    year: currentMonth.year,
                    month: currentMonth.month,
                    totalClients: formattedClients.length,
                    totalIncompleteTasks: totalIncompleteTasks
                }
            });

            logToConsole("INFO", "INCOMPLETE_TASKS_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "INCOMPLETE_TASKS_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "INCOMPLETE_TASKS_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "INCOMPLETE_TASKS_FETCHED", {
            adminId: req.user.adminId,
            count: formattedClients.length,
            timeFilter
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: formattedClients.length,
            clients: formattedClients
        });

    } catch (error) {
        logToConsole("ERROR", "INCOMPLETE_TASKS_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching incomplete tasks"
        });
    }
});

/* ===============================
   7. GET RECENT NOTES GROUPED BY CLIENT
================================ */
router.get("/dashboard/recent-notes", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd, limit = 10 } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        logToConsole("INFO", "RECENT_NOTES_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd,
            limit
        });

        // Get all active clients
        const clients = await Client.find(
            { isActive: true },
            {
                clientId: 1,
                name: 1,
                email: 1,
                documents: 1
            }
        ).lean();

        const notesByClient = [];

        // Check each client for notes within date range
        clients.forEach(client => {
            if (!client.documents) return;

            let clientNotes = {
                clientId: client.clientId,
                clientName: client.name,
                clientEmail: client.email,
                totalNotes: 0,
                fileNotes: [],
                categoryNotes: []
            };

            // Check each month in the date range
            dateRange.months.forEach(monthRange => {
                const yearKey = String(monthRange.year);
                const monthKey = String(monthRange.month);
                const monthData = client.documents?.[yearKey]?.[monthKey];
                if (!monthData) return;

                // Check main categories
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (!categoryData) return;

                    // Category notes (added by client)
                    if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                        categoryData.categoryNotes.forEach(note => {
                            clientNotes.categoryNotes.push({
                                category,
                                note: note.note,
                                addedBy: note.addedBy || "Client",
                                addedAt: note.addedAt,
                                type: "Client Note"
                            });
                            clientNotes.totalNotes++;
                        });
                    }

                    // File notes (added by employee)
                    if (categoryData.files && Array.isArray(categoryData.files)) {
                        categoryData.files.forEach(file => {
                            if (file.notes && file.notes.length > 0) {
                                file.notes.forEach(note => {
                                    clientNotes.fileNotes.push({
                                        category,
                                        fileName: file.fileName || "Unnamed file",
                                        note: note.note,
                                        addedBy: note.addedBy || "Employee",
                                        addedAt: note.addedAt,
                                        type: "Employee Note"
                                    });
                                    clientNotes.totalNotes++;
                                });
                            }
                        });
                    }
                });

                // Check other categories
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory.document) {
                            const otherDoc = otherCategory.document;

                            // Category notes for other categories
                            if (otherDoc.categoryNotes && otherDoc.categoryNotes.length > 0) {
                                otherDoc.categoryNotes.forEach(note => {
                                    clientNotes.categoryNotes.push({
                                        category: otherCategory.categoryName,
                                        note: note.note,
                                        addedBy: note.addedBy || "Client",
                                        addedAt: note.addedAt,
                                        type: "Client Note"
                                    });
                                    clientNotes.totalNotes++;
                                });
                            }

                            // File notes for other categories
                            if (otherDoc.files && Array.isArray(otherDoc.files)) {
                                otherDoc.files.forEach(file => {
                                    if (file.notes && file.notes.length > 0) {
                                        file.notes.forEach(note => {
                                            clientNotes.fileNotes.push({
                                                category: otherCategory.categoryName,
                                                fileName: file.fileName || "Unnamed file",
                                                note: note.note,
                                                addedBy: note.addedBy || "Employee",
                                                addedAt: note.addedAt,
                                                type: "Employee Note"
                                            });
                                            clientNotes.totalNotes++;
                                        });
                                    }
                                });
                            }
                        }
                    });
                }
            });

            // Only include clients with notes
            if (clientNotes.totalNotes > 0) {
                notesByClient.push(clientNotes);
            }
        });

        // Sort by total notes (descending)
        notesByClient.sort((a, b) => b.totalNotes - a.totalNotes);

        // Limit results
        const limitedNotes = notesByClient.slice(0, parseInt(limit));

        // Add Activity Log
        try {
            const totalNotes = limitedNotes.reduce((sum, client) => sum + client.totalNotes, 0);

            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                action: "RECENT_NOTES_VIEWED",
                details: `Viewed recent notes for ${timeFilter}. Found ${limitedNotes.length} clients with ${totalNotes} total notes`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    year: currentMonth.year,
                    month: currentMonth.month,
                    clientsCount: limitedNotes.length,
                    totalNotes: totalNotes,
                    limit: parseInt(limit)
                }
            });

            logToConsole("INFO", "RECENT_NOTES_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "RECENT_NOTES_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "RECENT_NOTES_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "RECENT_NOTES_FETCHED", {
            adminId: req.user.adminId,
            clientsCount: limitedNotes.length,
            totalNotes: limitedNotes.reduce((sum, client) => sum + client.totalNotes, 0),
            timeFilter
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: limitedNotes.length,
            notesByClient: limitedNotes.map(clientNotes => ({
                clientId: clientNotes.clientId,
                clientName: clientNotes.clientName,
                clientEmail: clientNotes.clientEmail,
                totalNotes: clientNotes.totalNotes,
                fileNotesCount: clientNotes.fileNotes.length,
                categoryNotesCount: clientNotes.categoryNotes.length,
                latestNote: [...clientNotes.fileNotes, ...clientNotes.categoryNotes]
                    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0]
            }))
        });

    } catch (error) {
        logToConsole("ERROR", "RECENT_NOTES_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching recent notes"
        });
    }
});

/* ===============================
   8. GET CLIENT NOTES DETAILS
================================ */
router.get("/dashboard/client-notes/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);
        const currentMonth = getCurrentMonthFromRange(dateRange);

        logToConsole("INFO", "CLIENT_NOTES_DETAILS_REQUEST", {
            adminId: req.user.adminId,
            clientId,
            timeFilter,
            customStart,
            customEnd
        });

        const client = await Client.findOne(
            { clientId },
            {
                clientId: 1,
                name: 1,
                email: 1,
                documents: 1
            }
        ).lean();

        if (!client) {
            logToConsole("WARN", "CLIENT_NOT_FOUND_FOR_NOTES", {
                adminId: req.user.adminId,
                clientId
            });

            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        const allNotes = [];

        // Check each month in the date range
        dateRange.months.forEach(monthRange => {
            const yearKey = String(monthRange.year);
            const monthKey = String(monthRange.month);
            const monthData = client.documents?.[yearKey]?.[monthKey];
            if (!monthData) return;

            // Process main categories
            ['sales', 'purchase', 'bank'].forEach(category => {
                const categoryData = monthData[category];
                if (!categoryData) return;

                // Category notes
                if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                    categoryData.categoryNotes.forEach(note => {
                        allNotes.push({
                            type: "CLIENT_NOTE",
                            category,
                            fileName: null,
                            note: note.note,
                            addedBy: note.addedBy || "Client",
                            addedAt: note.addedAt,
                            level: "Category"
                        });
                    });
                }

                // File notes
                if (categoryData.files && Array.isArray(categoryData.files)) {
                    categoryData.files.forEach(file => {
                        if (file.notes && file.notes.length > 0) {
                            file.notes.forEach(note => {
                                allNotes.push({
                                    type: "EMPLOYEE_NOTE",
                                    category,
                                    fileName: file.fileName || "Unnamed file",
                                    note: note.note,
                                    addedBy: note.addedBy || "Employee",
                                    addedAt: note.addedAt,
                                    level: "File"
                                });
                            });
                        }
                    });
                }
            });

            // Process other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCategory => {
                    if (otherCategory.document) {
                        const otherDoc = otherCategory.document;

                        // Category notes
                        if (otherDoc.categoryNotes && otherDoc.categoryNotes.length > 0) {
                            otherDoc.categoryNotes.forEach(note => {
                                allNotes.push({
                                    type: "CLIENT_NOTE",
                                    category: otherCategory.categoryName,
                                    fileName: null,
                                    note: note.note,
                                    addedBy: note.addedBy || "Client",
                                    addedAt: note.addedAt,
                                    level: "Category"
                                });
                            });
                        }

                        // File notes
                        if (otherDoc.files && Array.isArray(otherDoc.files)) {
                            otherDoc.files.forEach(file => {
                                if (file.notes && file.notes.length > 0) {
                                    file.notes.forEach(note => {
                                        allNotes.push({
                                            type: "EMPLOYEE_NOTE",
                                            category: otherCategory.categoryName,
                                            fileName: file.fileName || "Unnamed file",
                                            note: note.note,
                                            addedBy: note.addedBy || "Employee",
                                            addedAt: note.addedAt,
                                            level: "File"
                                        });
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });

        // Sort by date (newest first)
        allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,  // ← CHANGED TO req.user.adminId
                clientId: clientId,
                action: "CLIENT_NOTES_DETAILS_VIEWED",
                details: `Viewed notes details for client ${client.name} (${clientId}) for ${timeFilter}. Found ${allNotes.length} notes`,
                dateTime: new Date(),
                metadata: {
                    clientId,
                    clientName: client.name,
                    timeFilter,
                    year: currentMonth.year,
                    month: currentMonth.month,
                    totalNotes: allNotes.length,
                    clientNotes: allNotes.filter(n => n.type === "CLIENT_NOTE").length,
                    employeeNotes: allNotes.filter(n => n.type === "EMPLOYEE_NOTE").length
                }
            });

            logToConsole("INFO", "CLIENT_NOTES_DETAILS_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                clientId,
                action: "CLIENT_NOTES_DETAILS_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "CLIENT_NOTES_DETAILS_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId,
                clientId
            });
        }

        logToConsole("SUCCESS", "CLIENT_NOTES_DETAILS_FETCHED", {
            adminId: req.user.adminId,
            clientId,
            totalNotes: allNotes.length,
            timeFilter
        });

        res.json({
            success: true,
            client: {
                clientId: client.clientId,
                name: client.name,
                email: client.email
            },
            timeFilter: dateRange.timeFilter,
            currentMonth,
            totalNotes: allNotes.length,
            notes: allNotes,
            summary: {
                clientNotes: allNotes.filter(n => n.type === "CLIENT_NOTE").length,
                employeeNotes: allNotes.filter(n => n.type === "EMPLOYEE_NOTE").length
            }
        });

    } catch (error) {
        logToConsole("ERROR", "CLIENT_NOTES_DETAILS_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            clientId: req.params.clientId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching client notes"
        });
    }
});



/* ===============================
   9. GET CLIENTS WITH UPLOADED DOCS BUT MONTH LOCKED (GROUPED BY MONTH)
================================ */
router.get("/dashboard/uploaded-but-locked", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);

        logToConsole("INFO", "UPLOADED_BUT_LOCKED_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            customStart,
            customEnd,
            monthsCount: dateRange.months.length
        });

        const allClients = await Client.find(
            { isActive: true },
            {
                clientId: 1,
                name: 1,
                email: 1,
                phone: 1,
                documents: 1
            }
        ).lean();

        // Initialize monthsData array
        const monthsData = [];

        // For EACH month in the date range
        for (const monthInfo of dateRange.months) {
            const yearKey = String(monthInfo.year);
            const monthKey = String(monthInfo.month);
            const monthClients = [];

            // Check each client for this specific month
            allClients.forEach(client => {
                if (!client.documents) return;

                const monthData = client.documents?.[yearKey]?.[monthKey];
                if (!monthData) return;

                // Check if month is locked
                if (!monthData.isLocked) return;

                // Check if ANY file exists in ANY category
                let hasAnyFile = false;

                // Check main categories
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (categoryData?.files && categoryData.files.length > 0) {
                        hasAnyFile = true;
                    }
                });

                // Check other categories
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory.document?.files && otherCategory.document.files.length > 0) {
                            hasAnyFile = true;
                        }
                    });
                }

                // If month is locked AND has at least one file
                if (hasAnyFile) {
                    // Count total files
                    let fileCount = 0;
                    ['sales', 'purchase', 'bank'].forEach(category => {
                        const categoryData = monthData[category];
                        if (categoryData?.files) {
                            fileCount += categoryData.files.length;
                        }
                    });
                    if (monthData.other && Array.isArray(monthData.other)) {
                        monthData.other.forEach(otherCategory => {
                            if (otherCategory.document?.files) {
                                fileCount += otherCategory.document.files.length;
                            }
                        });
                    }

                    monthClients.push({
                        clientId: client.clientId,
                        name: client.name,
                        email: client.email,
                        phone: client.phone || "N/A",
                        lockedAt: monthData.lockedAt || null,
                        lockedBy: monthData.lockedBy || "Unknown",
                        totalFiles: fileCount
                    });
                }
            });

            // Only add month to results if there are clients
            if (monthClients.length > 0) {
                const monthName = new Date(monthInfo.year, monthInfo.month - 1, 1)
                    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

                monthsData.push({
                    year: monthInfo.year,
                    month: monthInfo.month,
                    monthName: monthName,
                    count: monthClients.length,
                    clients: monthClients
                });
            }
        }

        // Calculate total clients across all months
        const totalClients = monthsData.reduce((sum, month) => sum + month.count, 0);

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,
                action: "UPLOADED_BUT_LOCKED_VIEWED",
                details: `Viewed clients with uploaded docs but month locked for ${timeFilter}. Found ${totalClients} clients across ${monthsData.length} months`,
                dateTime: new Date(),
                metadata: {
                    timeFilter,
                    totalMonths: monthsData.length,
                    totalClients: totalClients
                }
            });

            logToConsole("INFO", "UPLOADED_BUT_LOCKED_ACTIVITY_LOG_CREATED", {
                adminId: req.user.adminId,
                action: "UPLOADED_BUT_LOCKED_VIEWED"
            });
        } catch (logError) {
            logToConsole("ERROR", "UPLOADED_BUT_LOCKED_ACTIVITY_LOG_FAILED", {
                error: logError.message,
                adminId: req.user.adminId
            });
        }

        logToConsole("SUCCESS", "UPLOADED_BUT_LOCKED_FETCHED", {
            adminId: req.user.adminId,
            totalClients: totalClients,
            monthsCount: monthsData.length,
            timeFilter
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            totalClients: totalClients,
            monthsData: monthsData,
            summary: {
                monthsCount: monthsData.length,
                hasData: monthsData.length > 0
            }
        });

    } catch (error) {
        logToConsole("ERROR", "UPLOADED_BUT_LOCKED_ERROR", {
            error: error.message,
            stack: error.stack,
            adminId: req.user?.adminId,
            timeFilter: req.query.timeFilter
        });

        res.status(500).json({
            success: false,
            message: "Error fetching clients with uploaded but locked docs"
        });
    }
});


/* ===============================
   10. GET UNVIEWED NOTES SUMMARY (FOR ALERT MODAL - CLIENT LIST) - FIXED
================================ */
router.get("/dashboard/unviewed-notes-summary", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);

        logToConsole("INFO", "UNVIEWED_NOTES_SUMMARY_REQUEST", {
            adminId: req.user.adminId,
            timeFilter,
            monthsCount: dateRange.months.length
        });

        // Get all active clients
        const clients = await Client.find({ isActive: true }, {
            clientId: 1, name: 1, email: 1, phone: 1, documents: 1
        }).lean();

        const clientsWithUnviewedNotes = [];

        // Check each client for unviewed notes within date range
        clients.forEach(client => {
            if (!client.documents) return;

            let totalUnviewed = 0;
            const unviewedByMonth = {};

            // Check each month in the date range
            dateRange.months.forEach(monthRange => {
                const yearKey = String(monthRange.year);
                const monthKey = String(monthRange.month); // Keep as string number
                const monthData = client.documents?.[yearKey]?.[monthKey];
                if (!monthData) return;

                let monthUnviewed = 0;
                const monthName = new Date(monthRange.year, monthRange.month - 1, 1)
                    .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

                // Helper function to count unviewed notes
                const countUnviewedNotes = (notesArray) => {
                    if (!notesArray || !Array.isArray(notesArray)) return 0;
                    return notesArray.filter(note =>
                        note && typeof note === 'object' && note.note && !note.isViewedByAdmin
                    ).length;
                };

                // Count month-level notes
                if (monthData.monthNotes && monthData.monthNotes.length > 0) {
                    monthUnviewed += countUnviewedNotes(monthData.monthNotes);
                }

                // Count main categories notes
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (!categoryData) return;

                    // Category notes
                    if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                        monthUnviewed += countUnviewedNotes(categoryData.categoryNotes);
                    }

                    // File notes
                    if (categoryData.files && Array.isArray(categoryData.files)) {
                        categoryData.files.forEach(file => {
                            if (file.notes && file.notes.length > 0) {
                                monthUnviewed += countUnviewedNotes(file.notes);
                            }
                        });
                    }
                });

                // Count other categories notes
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory.document) {
                            const otherDoc = otherCategory.document;

                            // Category notes
                            if (otherDoc.categoryNotes && otherDoc.categoryNotes.length > 0) {
                                monthUnviewed += countUnviewedNotes(otherDoc.categoryNotes);
                            }

                            // File notes
                            if (otherDoc.files && Array.isArray(otherDoc.files)) {
                                otherDoc.files.forEach(file => {
                                    if (file.notes && file.notes.length > 0) {
                                        monthUnviewed += countUnviewedNotes(file.notes);
                                    }
                                });
                            }
                        }
                    });
                }

                // Add to month breakdown if there are unviewed notes
                if (monthUnviewed > 0) {
                    unviewedByMonth[monthName] = monthUnviewed;
                    totalUnviewed += monthUnviewed;
                }
            });

            // Only include clients with unviewed notes
            if (totalUnviewed > 0) {
                clientsWithUnviewedNotes.push({
                    clientId: client.clientId,
                    name: client.name,
                    email: client.email,
                    phone: client.phone || "N/A",
                    totalUnviewedNotes: totalUnviewed,
                    unviewedByMonth,
                    monthsWithNotes: Object.keys(unviewedByMonth).length
                });
            }
        });

        // Sort by most unviewed notes first
        clientsWithUnviewedNotes.sort((a, b) => b.totalUnviewedNotes - a.totalUnviewedNotes);

        // Calculate totals
        const totalUnviewedNotes = clientsWithUnviewedNotes.reduce((sum, client) => sum + client.totalUnviewedNotes, 0);
        const totalClientsWithNotes = clientsWithUnviewedNotes.length;

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,
                action: "UNVIEWED_NOTES_SUMMARY_VIEWED",
                details: `Viewed unviewed notes summary for ${timeFilter}. Found ${totalUnviewedNotes} notes across ${totalClientsWithNotes} clients`,
                dateTime: new Date(),
                metadata: { timeFilter, totalClients: totalClientsWithNotes, totalNotes: totalUnviewedNotes }
            });
        } catch (logError) {
            logToConsole("ERROR", "UNVIEWED_NOTES_SUMMARY_ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        logToConsole("SUCCESS", "UNVIEWED_NOTES_SUMMARY_FETCHED", {
            totalClients: totalClientsWithNotes,
            totalNotes: totalUnviewedNotes
        });

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            summary: {
                totalUnviewedNotes,
                totalClientsWithNotes,
                averageNotesPerClient: totalClientsWithNotes > 0
                    ? Math.round(totalUnviewedNotes / totalClientsWithNotes)
                    : 0
            },
            clients: clientsWithUnviewedNotes
        });

    } catch (error) {
        logToConsole("ERROR", "UNVIEWED_NOTES_SUMMARY_ERROR", { error: error.message });
        res.status(500).json({ success: false, message: "Error fetching unviewed notes summary" });
    }
});

/* ===============================
   11. GET CLIENT'S UNVIEWED NOTES DETAILS (INDIVIDUAL CLIENT VIEW) - FIXED
================================ */
router.get("/dashboard/client-unviewed-notes/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { timeFilter = 'this_month', customStart, customEnd } = req.query;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);

        logToConsole("INFO", "CLIENT_UNVIEWED_NOTES_DETAILS_REQUEST", {
            adminId: req.user.adminId,
            clientId,
            timeFilter
        });

        const client = await Client.findOne({ clientId }, {
            clientId: 1, name: 1, email: 1, phone: 1, documents: 1
        }).lean();

        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        const unviewedNotesByMonth = [];
        let totalUnviewed = 0;

        // Check each month in the date range
        dateRange.months.forEach(monthRange => {
            const yearKey = String(monthRange.year);
            const monthKey = String(monthRange.month); // Keep as string number
            const monthData = client.documents?.[yearKey]?.[monthKey];
            if (!monthData) return;

            const monthName = new Date(monthRange.year, monthRange.month - 1, 1)
                .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

            const monthNotes = [];
            let monthUnviewed = 0;

            // Helper function to extract unviewed notes with TRACKABLE IDs
            const extractUnviewedNotes = (notesArray, source, type, category, fileName = null, fileIndex = null) => {
                if (!notesArray || !Array.isArray(notesArray)) return [];

                return notesArray
                    .filter(note => note && typeof note === 'object' && note.note && !note.isViewedByAdmin)
                    .map((note, index) => {
                        monthUnviewed++;
                        // Create a trackable ID that can be used to find this note later
                        const notePath = `${yearKey}_${monthKey}_${category}_${type}_${index}`;
                        if (fileIndex !== null) {
                            notePath += `_${fileIndex}`;
                        }

                        return {
                            noteId: notePath, // Use path as ID for tracking
                            note: note.note,
                            addedBy: note.addedBy || (source === 'client' ? 'Client' : 'Employee'),
                            addedAt: note.addedAt,
                            source: source,
                            type: type, // 'month', 'category', 'file'
                            category: category,
                            fileName: fileName,
                            year: parseInt(yearKey),
                            month: parseInt(monthKey),
                            noteIndex: index,
                            fileIndex: fileIndex,
                            isUnviewedByAdmin: true,
                            noteType: fileName ? 'file_note' : 'category_note'
                        };
                    });
            };

            // Month-level notes (always client)
            const monthLevelNotes = extractUnviewedNotes(
                monthData.monthNotes,
                'client',
                'month',
                'General'
            );
            monthNotes.push(...monthLevelNotes);

            // Main categories notes
            ['sales', 'purchase', 'bank'].forEach(category => {
                const categoryData = monthData[category];
                if (!categoryData) return;

                // Category notes (delete reasons - client)
                const categoryLevelNotes = extractUnviewedNotes(
                    categoryData.categoryNotes,
                    'client',
                    'category',
                    category.charAt(0).toUpperCase() + category.slice(1)
                );
                monthNotes.push(...categoryLevelNotes);

                // File notes (employee feedback)
                if (categoryData.files && Array.isArray(categoryData.files)) {
                    categoryData.files.forEach((file, fileIndex) => {
                        const fileNotes = extractUnviewedNotes(
                            file.notes,
                            'employee',
                            'file',
                            category.charAt(0).toUpperCase() + category.slice(1),
                            file.fileName || "Unnamed file",
                            fileIndex
                        );
                        monthNotes.push(...fileNotes);
                    });
                }
            });

            // Other categories notes
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCategory => {
                    if (otherCategory.document) {
                        const otherDoc = otherCategory.document;

                        // Category notes for other categories (client)
                        const otherCategoryNotes = extractUnviewedNotes(
                            otherDoc.categoryNotes,
                            'client',
                            'category',
                            otherCategory.categoryName
                        );
                        monthNotes.push(...otherCategoryNotes);

                        // File notes for other categories (employee)
                        if (otherDoc.files && Array.isArray(otherDoc.files)) {
                            otherDoc.files.forEach((file, fileIndex) => {
                                const otherFileNotes = extractUnviewedNotes(
                                    file.notes,
                                    'employee',
                                    'file',
                                    otherCategory.categoryName,
                                    file.fileName || "Unnamed file",
                                    fileIndex
                                );
                                monthNotes.push(...otherFileNotes);
                            });
                        }
                    }
                });
            }

            // Only add month if there are unviewed notes
            if (monthUnviewed > 0) {
                unviewedNotesByMonth.push({
                    year: parseInt(yearKey),
                    month: parseInt(monthKey),
                    monthName: monthName,
                    notes: monthNotes,
                    totalNotes: monthUnviewed
                });
                totalUnviewed += monthUnviewed;
            }
        });

        // Sort months by date (newest first)
        unviewedNotesByMonth.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        // Add Activity Log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: req.user.adminId,
                clientId: clientId,
                clientName: client.name,
                action: "CLIENT_UNVIEWED_NOTES_VIEWED",
                details: `Viewed unviewed notes for client ${client.name}. Found ${totalUnviewed} unviewed notes`,
                dateTime: new Date(),
                metadata: { clientId, clientName: client.name, totalUnviewedNotes: totalUnviewed }
            });
        } catch (logError) {
            logToConsole("ERROR", "CLIENT_UNVIEWED_NOTES_ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        logToConsole("SUCCESS", "CLIENT_UNVIEWED_NOTES_FETCHED", {
            clientId,
            totalUnviewed,
            monthsCount: unviewedNotesByMonth.length
        });

        res.json({
            success: true,
            client: {
                clientId: client.clientId,
                name: client.name,
                email: client.email,
                phone: client.phone || "N/A"
            },
            totalUnviewedNotes: totalUnviewed,
            notesByMonth: unviewedNotesByMonth,
            summary: {
                clientNotes: unviewedNotesByMonth.reduce((sum, month) =>
                    sum + month.notes.filter(n => n.source === 'client').length, 0),
                employeeNotes: unviewedNotesByMonth.reduce((sum, month) =>
                    sum + month.notes.filter(n => n.source === 'employee').length, 0)
            }
        });

    } catch (error) {
        logToConsole("ERROR", "CLIENT_UNVIEWED_NOTES_ERROR", { error: error.message });
        res.status(500).json({ success: false, message: "Error fetching client's unviewed notes" });
    }
});

/* ===============================
   12. MARK SPECIFIC NOTE AS READ (BY ADMIN) - SIMPLIFIED FIXED VERSION
================================ */
router.post("/dashboard/notes/mark-note-read", auth, async (req, res) => {
    try {
        const { clientId, notePath } = req.body;

        if (!clientId || !notePath) {
            return res.status(400).json({ success: false, message: "Client ID and note path required" });
        }

        logToConsole("INFO", "MARK_NOTE_READ_REQUEST", { adminId: req.user.adminId, clientId, notePath });

        // Parse note path: format "2026_2_sales_category_0" or "2026_2_sales_file_0_1"
        const pathParts = notePath.split('_');
        if (pathParts.length < 5) {
            return res.status(400).json({ success: false, message: "Invalid note path" });
        }

        const yearKey = pathParts[0];
        const monthKey = pathParts[1]; // Already string number
        const category = pathParts[2];
        const noteType = pathParts[3]; // 'category', 'file', 'month'
        const noteIndex = parseInt(pathParts[4]);
        const fileIndex = pathParts[5] ? parseInt(pathParts[5]) : null;

        // Find client
        const client = await Client.findOne({ clientId });
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        // Get documents
        const documents = client.documents || {};
        const monthData = documents[yearKey]?.[monthKey];

        if (!monthData) {
            return res.status(404).json({ success: false, message: "Month data not found" });
        }

        let noteFound = false;
        const now = new Date();
        const adminId = req.user.adminId;

        // Mark note based on type
        if (noteType === 'month') {
            // Month-level notes
            if (monthData.monthNotes && monthData.monthNotes[noteIndex]) {
                const note = monthData.monthNotes[noteIndex];
                if (!note.isViewedByAdmin) {
                    note.isViewedByAdmin = true;
                    note.viewedBy = note.viewedBy || [];
                    note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                    noteFound = true;
                }
            }
        } else if (noteType === 'category') {
            // Category notes
            const categoryLower = category.toLowerCase();
            if (['sales', 'purchase', 'bank'].includes(categoryLower)) {
                const categoryData = monthData[categoryLower];
                if (categoryData && categoryData.categoryNotes && categoryData.categoryNotes[noteIndex]) {
                    const note = categoryData.categoryNotes[noteIndex];
                    if (!note.isViewedByAdmin) {
                        note.isViewedByAdmin = true;
                        note.viewedBy = note.viewedBy || [];
                        note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                        noteFound = true;
                    }
                }
            }
        } else if (noteType === 'file') {
            // File notes
            const categoryLower = category.toLowerCase();
            if (['sales', 'purchase', 'bank'].includes(categoryLower)) {
                const categoryData = monthData[categoryLower];
                if (categoryData && categoryData.files &&
                    categoryData.files[fileIndex] &&
                    categoryData.files[fileIndex].notes &&
                    categoryData.files[fileIndex].notes[noteIndex]) {
                    const note = categoryData.files[fileIndex].notes[noteIndex];
                    if (!note.isViewedByAdmin) {
                        note.isViewedByAdmin = true;
                        note.viewedBy = note.viewedBy || [];
                        note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                        noteFound = true;
                    }
                }
            }
        }

        if (!noteFound) {
            return res.status(404).json({ success: false, message: "Note not found or already read" });
        }

        // Save changes
        client.markModified('documents');
        await client.save();

        // Activity log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: adminId,
                clientId: clientId,
                clientName: client.name,
                action: "NOTE_MARKED_AS_READ",
                details: `Admin marked note as read for client ${client.name}`,
                dateTime: now
            });
        } catch (logError) {
            logToConsole("ERROR", "NOTE_MARKED_READ_ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        logToConsole("SUCCESS", "NOTE_MARKED_AS_READ", { clientId, notePath });

        res.json({
            success: true,
            message: "Note marked as read",
            clientId,
            notePath,
            markedAt: now.toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "MARK_NOTE_READ_ERROR", { error: error.message });
        res.status(500).json({ success: false, message: "Error marking note as read" });
    }
});

/* ===============================
   13. MARK ALL CLIENT'S NOTES AS READ (FOR CURRENT TIME FILTER) - FIXED
================================ */
router.post("/dashboard/notes/mark-client-read/:clientId", auth, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { timeFilter = 'this_month', customStart, customEnd } = req.body;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);

        logToConsole("INFO", "MARK_CLIENT_NOTES_READ_REQUEST", { adminId: req.user.adminId, clientId, timeFilter });

        // Find client
        const client = await Client.findOne({ clientId });
        if (!client) {
            return res.status(404).json({ success: false, message: "Client not found" });
        }

        let notesMarked = 0;
        const now = new Date();
        const adminId = req.user.adminId;
        const documents = client.toObject().documents || {};

        // Check each month in the date range
        dateRange.months.forEach(monthRange => {
            const yearKey = String(monthRange.year);
            const monthKey = String(monthRange.month); // Keep as string number
            const monthData = documents[yearKey]?.[monthKey];
            if (!monthData) return;

            // Mark month-level notes
            if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                monthData.monthNotes.forEach(note => {
                    if (note && note.note && !note.isViewedByAdmin) {
                        note.isViewedByAdmin = true;
                        note.viewedBy = note.viewedBy || [];
                        note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                        notesMarked++;
                    }
                });
            }

            // Mark main categories notes
            ['sales', 'purchase', 'bank'].forEach(category => {
                const categoryData = monthData[category];
                if (!categoryData) return;

                // Category notes
                if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                    categoryData.categoryNotes.forEach(note => {
                        if (note && note.note && !note.isViewedByAdmin) {
                            note.isViewedByAdmin = true;
                            note.viewedBy = note.viewedBy || [];
                            note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                            notesMarked++;
                        }
                    });
                }

                // File notes
                if (categoryData.files && Array.isArray(categoryData.files)) {
                    categoryData.files.forEach(file => {
                        if (file.notes && Array.isArray(file.notes)) {
                            file.notes.forEach(note => {
                                if (note && note.note && !note.isViewedByAdmin) {
                                    note.isViewedByAdmin = true;
                                    note.viewedBy = note.viewedBy || [];
                                    note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                    notesMarked++;
                                }
                            });
                        }
                    });
                }
            });

            // Mark other categories notes
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCategory => {
                    if (otherCategory.document) {
                        const otherDoc = otherCategory.document;

                        // Category notes
                        if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                            otherDoc.categoryNotes.forEach(note => {
                                if (note && note.note && !note.isViewedByAdmin) {
                                    note.isViewedByAdmin = true;
                                    note.viewedBy = note.viewedBy || [];
                                    note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                    notesMarked++;
                                }
                            });
                        }

                        // File notes
                        if (otherDoc.files && Array.isArray(otherDoc.files)) {
                            otherDoc.files.forEach(file => {
                                if (file.notes && Array.isArray(file.notes)) {
                                    file.notes.forEach(note => {
                                        if (note && note.note && !note.isViewedByAdmin) {
                                            note.isViewedByAdmin = true;
                                            note.viewedBy = note.viewedBy || [];
                                            note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                            notesMarked++;
                                        }
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });

        // Save if any notes were marked
        if (notesMarked > 0) {
            client.documents = documents;
            client.markModified('documents');
            await client.save();
        }

        // Activity log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: adminId,
                clientId: clientId,
                clientName: client.name,
                action: "CLIENT_NOTES_MARKED_READ",
                details: `Admin marked ${notesMarked} notes as read for client ${client.name}`,
                dateTime: now
            });
        } catch (logError) {
            logToConsole("ERROR", "CLIENT_NOTES_MARKED_READ_ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        logToConsole("SUCCESS", "CLIENT_NOTES_MARKED_AS_READ", { clientId, notesMarked });

        res.json({
            success: true,
            message: `Marked ${notesMarked} notes as read for client ${client.name}`,
            clientId,
            notesMarked
        });

    } catch (error) {
        logToConsole("ERROR", "MARK_CLIENT_NOTES_READ_ERROR", { error: error.message });
        res.status(500).json({ success: false, message: "Error marking client's notes as read" });
    }
});

/* ===============================
   14. MARK ALL NOTES AS READ (ALL CLIENTS - FOR CURRENT TIME FILTER) - FIXED
================================ */
router.post("/dashboard/notes/mark-all-read", auth, async (req, res) => {
    try {
        const { timeFilter = 'this_month', customStart, customEnd } = req.body;
        const dateRange = getDateRange(timeFilter, customStart, customEnd);

        logToConsole("INFO", "MARK_ALL_NOTES_READ_REQUEST", { adminId: req.user.adminId, timeFilter });

        // Get all active clients
        const clients = await Client.find({ isActive: true });
        let totalNotesMarked = 0;
        const now = new Date();
        const adminId = req.user.adminId;

        for (const client of clients) {
            let clientNotesMarked = 0;
            const documents = client.toObject().documents || {};

            // Check each month in the date range
            dateRange.months.forEach(monthRange => {
                const yearKey = String(monthRange.year);
                const monthKey = String(monthRange.month); // Keep as string number
                const monthData = documents[yearKey]?.[monthKey];
                if (!monthData) return;

                // Month-level notes
                if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                    monthData.monthNotes.forEach(note => {
                        if (note && note.note && !note.isViewedByAdmin) {
                            note.isViewedByAdmin = true;
                            note.viewedBy = note.viewedBy || [];
                            note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                            clientNotesMarked++;
                        }
                    });
                }

                // Main categories notes
                ['sales', 'purchase', 'bank'].forEach(category => {
                    const categoryData = monthData[category];
                    if (!categoryData) return;

                    // Category notes
                    if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
                        categoryData.categoryNotes.forEach(note => {
                            if (note && note.note && !note.isViewedByAdmin) {
                                note.isViewedByAdmin = true;
                                note.viewedBy = note.viewedBy || [];
                                note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                clientNotesMarked++;
                            }
                        });
                    }

                    // File notes
                    if (categoryData.files && Array.isArray(categoryData.files)) {
                        categoryData.files.forEach(file => {
                            if (file.notes && Array.isArray(file.notes)) {
                                file.notes.forEach(note => {
                                    if (note && note.note && !note.isViewedByAdmin) {
                                        note.isViewedByAdmin = true;
                                        note.viewedBy = note.viewedBy || [];
                                        note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                        clientNotesMarked++;
                                    }
                                });
                            }
                        });
                    }
                });

                // Other categories notes
                if (monthData.other && Array.isArray(monthData.other)) {
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory.document) {
                            const otherDoc = otherCategory.document;

                            // Category notes
                            if (otherDoc.categoryNotes && Array.isArray(otherDoc.categoryNotes)) {
                                otherDoc.categoryNotes.forEach(note => {
                                    if (note && note.note && !note.isViewedByAdmin) {
                                        note.isViewedByAdmin = true;
                                        note.viewedBy = note.viewedBy || [];
                                        note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                        clientNotesMarked++;
                                    }
                                });
                            }

                            // File notes
                            if (otherDoc.files && Array.isArray(otherDoc.files)) {
                                otherDoc.files.forEach(file => {
                                    if (file.notes && Array.isArray(file.notes)) {
                                        file.notes.forEach(note => {
                                            if (note && note.note && !note.isViewedByAdmin) {
                                                note.isViewedByAdmin = true;
                                                note.viewedBy = note.viewedBy || [];
                                                note.viewedBy.push({ userId: adminId, userType: 'admin', viewedAt: now });
                                                clientNotesMarked++;
                                            }
                                        });
                                    }
                                });
                            }
                        }
                    });
                }
            });

            // Save if any notes were marked for this client
            if (clientNotesMarked > 0) {
                client.documents = documents;
                client.markModified('documents');
                await client.save();
                totalNotesMarked += clientNotesMarked;
            }
        }

        // Activity log
        try {
            await ActivityLog.create({
                userName: req.user.name,
                role: "ADMIN",
                adminId: adminId,
                action: "ALL_NOTES_MARKED_READ",
                details: `Admin marked all ${totalNotesMarked} unviewed notes as read for ${timeFilter}`,
                dateTime: now
            });
        } catch (logError) {
            logToConsole("ERROR", "ALL_NOTES_MARKED_READ_ACTIVITY_LOG_FAILED", { error: logError.message });
        }

        logToConsole("SUCCESS", "ALL_NOTES_MARKED_AS_READ", { totalNotesMarked });

        res.json({
            success: true,
            message: `Marked ${totalNotesMarked} notes as read across all clients`,
            totalNotesMarked
        });

    } catch (error) {
        logToConsole("ERROR", "MARK_ALL_NOTES_READ_ERROR", { error: error.message });
        res.status(500).json({ success: false, message: "Error marking all notes as read" });
    }
});



module.exports = router;
