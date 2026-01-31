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
            adminId: req.user.id,
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
        console.error("Dashboard overview error:", error);
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
        console.error("Active clients error:", error);
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
        console.error("Active employees error:", error);
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

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: unassignedClients.length,
            clients: unassignedClients
        });

    } catch (error) {
        console.error("Unassigned clients error:", error);
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

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: idleEmployees.length,
            employees: idleEmployees
        });

    } catch (error) {
        console.error("Idle employees error:", error);
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

        res.json({
            success: true,
            timeFilter: dateRange.timeFilter,
            currentMonth,
            count: formattedClients.length,
            clients: formattedClients
        });

    } catch (error) {
        console.error("Incomplete tasks error:", error);
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
        console.error("Recent notes error:", error);
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
        console.error("Client notes error:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching client notes"
        });
    }
});

module.exports = router;