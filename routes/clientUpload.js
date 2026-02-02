const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");

const Client = require("../models/Client");
const DeletedFile = require("../models/DeletedFile");
const ActivityLog = require("../models/ActivityLog");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

/* ===============================
   AWS S3 CONFIG
================================ */
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

/* ===============================
   MULTER (MEMORY) - ALLOW MULTIPLE FILES
================================ */
const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    "Invalid file type. Only PDF, Images (jpg, jpeg, png, webp, gif) and Excel files are allowed."
                ),
                false
            );
        }
    }
});

/* ===============================
   CONSOLE LOGGING UTILITY
================================ */
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   HELPER: GET MONTH DATA
================================ */
const getMonthData = (client, year, month) => {
    const y = String(year);
    const m = String(month);

    if (!client.documents.has(y)) {
        client.documents.set(y, new Map());
    }

    if (!client.documents.get(y).has(m)) {
        client.documents.get(y).set(m, {
            sales: {
                files: [],
                categoryNotes: [],
                isLocked: false,
                wasLockedOnce: false
            },
            purchase: {
                files: [],
                categoryNotes: [],
                isLocked: false,
                wasLockedOnce: false
            },
            bank: {
                files: [],
                categoryNotes: [],
                isLocked: false,
                wasLockedOnce: false
            },
            other: [],
            isLocked: false,
            wasLockedOnce: false,
            monthNotes: []
        });
    }

    return client.documents.get(y).get(m);
};

/* ===============================
   UPLOAD / UPDATE FILES (MULTIPLE)
================================ */
router.post("/upload", auth, upload.array("files"),
    async (req, res) => {
        try {
            const {
                year,
                month,
                type,
                categoryName,
                note,
                deleteNote,
                replacedFile
            } = req.body;

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: "No files uploaded" });
            }

            const client = await Client.findOne({
                clientId: req.user.clientId
            });

            if (!client) {
                return res.status(404).json({ message: "Client not found" });
            }

            const monthData = getMonthData(client, year, month);

            // MONTH LOCK CHECK
            if (monthData.isLocked) {
                let allowed = false;

                if (type === "other") {
                    const o = monthData.other?.find(
                        (x) => x.categoryName === categoryName
                    );
                    allowed = o && !o.document?.isLocked;
                } else {
                    allowed = monthData[type] && !monthData[type].isLocked;
                }

                if (!allowed) {
                    return res.status(403).json({
                        message: "Month or category is locked"
                    });
                }
            }

            // CHECK IF NOTE IS REQUIRED
            const category = type === "other"
                ? monthData.other?.find(x => x.categoryName === categoryName)?.document
                : monthData[type];

            const isUpdate = category && category.files && category.files.length > 0;

            if (monthData.wasLockedOnce && isUpdate && !note) {
                return res.status(400).json({
                    message: "Note is required when updating files after unlock"
                });
            }

            // LOG: FILE UPLOAD REQUEST
            logToConsole("INFO", "CLIENT_FILE_UPLOAD_REQUEST", {
                clientId: client.clientId,
                clientName: client.name,
                year,
                month,
                type,
                categoryName: categoryName || "N/A",
                filesCount: req.files.length
            });

            // Handle file replacement - track deleted file
            if (replacedFile) {
                logToConsole("INFO", "CLIENT_FILE_UPDATE_REPLACEMENT", {
                    clientId: client.clientId,
                    oldFileName: replacedFile,
                    newFilesCount: req.files.length
                });

                let oldFile = null;

                if (type === "other") {
                    const otherIndex = monthData.other?.findIndex(x => x.categoryName === categoryName);
                    if (otherIndex >= 0 && monthData.other[otherIndex].document) {
                        const fileIndex = monthData.other[otherIndex].document.files.findIndex(f => f.fileName === replacedFile);
                        if (fileIndex >= 0) {
                            oldFile = monthData.other[otherIndex].document.files[fileIndex];
                            monthData.other[otherIndex].document.files.splice(fileIndex, 1);

                            // Track deleted file
                            await DeletedFile.create({
                                clientId: client.clientId,
                                fileName: oldFile.fileName,
                                fileUrl: oldFile.url,
                                fileSize: oldFile.fileSize,
                                fileType: oldFile.fileType,
                                year: parseInt(year),
                                month: parseInt(month),
                                categoryType: type,
                                categoryName: categoryName,
                                uploadedBy: oldFile.uploadedBy,
                                uploadedAt: oldFile.uploadedAt,
                                deletedBy: client.clientId,
                                deleteNote: deleteNote || "Replaced with new file",
                                wasReplaced: true,
                                replacedByFile: req.files[0]?.originalname || "New file"
                            });
                        }
                    }
                } else {
                    const fileIndex = monthData[type]?.files?.findIndex(f => f.fileName === replacedFile);
                    if (fileIndex >= 0) {
                        oldFile = monthData[type].files[fileIndex];
                        monthData[type].files.splice(fileIndex, 1);

                        // Track deleted file
                        await DeletedFile.create({
                            clientId: client.clientId,
                            fileName: oldFile.fileName,
                            fileUrl: oldFile.url,
                            fileSize: oldFile.fileSize,
                            fileType: oldFile.fileType,
                            year: parseInt(year),
                            month: parseInt(month),
                            categoryType: type,
                            uploadedBy: oldFile.uploadedBy,
                            uploadedAt: oldFile.uploadedAt,
                            deletedBy: client.clientId,
                            deleteNote: deleteNote || "Replaced with new file",
                            wasReplaced: true,
                            replacedByFile: req.files[0]?.originalname || "New file"
                        });
                    }
                }
            }

            // UPLOAD ALL FILES TO S3
            const uploadedFiles = [];

            for (const file of req.files) {
                const fileExt = file.originalname.split(".").pop();
                const key = `clients/${client.clientId}/${year}/${month}/${uuidv4()}.${fileExt}`;

                await s3.send(
                    new PutObjectCommand({
                        Bucket: process.env.AWS_BUCKET,
                        Key: key,
                        Body: file.buffer,
                        ContentType: file.mimetype
                    })
                );

                uploadedFiles.push({
                    url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
                    uploadedAt: new Date(),
                    uploadedBy: client.clientId,
                    fileName: file.originalname,
                    fileSize: file.size,
                    fileType: file.mimetype,
                    notes: []
                });
            }

            // ADD FILES TO CATEGORY
            if (type === "other") {
                let otherCategory = monthData.other?.find(
                    (x) => x.categoryName === categoryName
                );

                if (otherCategory) {
                    otherCategory.document.files.push(...uploadedFiles);
                } else {
                    monthData.other = monthData.other || [];
                    monthData.other.push({
                        categoryName,
                        document: {
                            files: uploadedFiles,
                            categoryNotes: [],
                            isLocked: false,
                            wasLockedOnce: false
                        }
                    });
                }
            } else {
                if (!monthData[type]) {
                    monthData[type] = {
                        files: uploadedFiles,
                        categoryNotes: [],
                        isLocked: false,
                        wasLockedOnce: false
                    };
                } else {
                    monthData[type].files.push(...uploadedFiles);
                }
            }

            // ADD NOTE IF REQUIRED
            if (monthData.wasLockedOnce && isUpdate && note) {
                const targetCategory = type === "other"
                    ? monthData.other.find(x => x.categoryName === categoryName)?.document
                    : monthData[type];

                if (targetCategory) {
                    targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                    targetCategory.categoryNotes.push({
                        note,
                        addedBy: client.clientId,
                        addedAt: new Date()
                    });
                }

                monthData.monthNotes = monthData.monthNotes || [];
                monthData.monthNotes.push({
                    note,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }

            await client.save();

            // LOG SUCCESS
            logToConsole("SUCCESS", "CLIENT_FILE_UPLOAD_COMPLETE", {
                clientId: client.clientId,
                uploadedFilesCount: uploadedFiles.length
            });

            // ===== ACTIVITY LOG: FILE UPLOAD =====
            try {
                await ActivityLog.create({
                    userName: client.name,
                    role: "CLIENT",
                    clientId: client.clientId,
                    clientName: client.name,
                    // ADDED: adminId if available (for admin-initiated uploads)
                    adminId: req.user.role === "ADMIN" ? req.user.adminId : null,
                    adminName: req.user.role === "ADMIN" ? req.user.name : null,
                    action: replacedFile ? "CLIENT_FILE_UPDATED" : "CLIENT_FILE_UPLOADED",
                    details: replacedFile
                        ? `File updated: ${replacedFile} → ${uploadedFiles.map(f => f.fileName).join(', ')} in ${type}${categoryName ? ` (${categoryName})` : ''} for ${year}-${month}`
                        : `${req.user.role === "ADMIN" ? "Admin uploaded" : "Client uploaded"} ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.fileName).join(', ')} in ${type}${categoryName ? ` (${categoryName})` : ''} for ${year}-${month}`,
                    dateTime: new Date(),
                    metadata: {
                        year,
                        month,
                        type,
                        categoryName: categoryName || "N/A",
                        filesCount: uploadedFiles.length,
                        fileNames: uploadedFiles.map(f => f.fileName),
                        wasReplacement: !!replacedFile,
                        replacedFile: replacedFile || null,
                        noteProvided: !!note,
                        performedBy: req.user.role === "ADMIN" ? "ADMIN" : "CLIENT"
                    }
                });
            } catch (logError) {
                logToConsole("ERROR", "ACTIVITY_LOG_FAILED_FILE_UPLOAD", {
                    error: logError.message
                });
            }

            res.json({
                message: `${req.files.length} file(s) uploaded successfully`,
                filesCount: req.files.length,
                monthData: monthData
            });
        } catch (err) {
            logToConsole("ERROR", "CLIENT_FILE_UPLOAD_FAILED", {
                clientId: req.user?.clientId,
                error: err.message
            });

            if (err.message?.includes("Invalid file type")) {
                return res.status(400).json({ message: err.message });
            }

            res.status(500).json({ message: "Upload failed" });
        }
    }
);

/* ===============================
   GET MONTH DATA
================================ */
router.get("/month-data", auth, async (req, res) => {
    try {
        const { year, month } = req.query;

        console.log("MONTH-DATA REQUEST:", {
            clientId: req.user?.clientId,
            year,
            month
        });

        const client = await Client.findOne({
            clientId: req.user.clientId
        });

        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const monthData = getMonthData(client, year, month);

        // Get employee names for notes
        const Employee = require("../models/Employee");
        const employeeMap = new Map();
        const employeeIds = new Set();

        // Helper to collect employeeIds
        const collectEmployeeIds = (notesArray) => {
            if (!notesArray || !Array.isArray(notesArray)) return;
            notesArray.forEach(note => {
                if (note.employeeId) employeeIds.add(note.employeeId);
            });
        };

        // Process main categories
        ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
                const categoryData = monthData[category];
                collectEmployeeIds(categoryData.categoryNotes);
                if (categoryData.files && Array.isArray(categoryData.files)) {
                    categoryData.files.forEach(file => {
                        collectEmployeeIds(file.notes);
                    });
                }
            }
        });

        // Process other categories
        if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
                if (otherCategory.document) {
                    collectEmployeeIds(otherCategory.document.categoryNotes);
                    if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                        otherCategory.document.files.forEach(file => {
                            collectEmployeeIds(file.notes);
                        });
                    }
                }
            });
        }

        // Fetch employee names
        if (employeeIds.size > 0) {
            const employees = await Employee.find(
                { employeeId: { $in: Array.from(employeeIds) } },
                { employeeId: 1, name: 1 }
            );

            employees.forEach(emp => {
                employeeMap.set(emp.employeeId, emp.name);
            });
        }

        // Helper to populate employee names
        const populateEmployeeNames = (notesArray) => {
            if (!notesArray || !Array.isArray(notesArray)) return;
            notesArray.forEach(note => {
                if (note.employeeId && employeeMap.has(note.employeeId)) {
                    note.employeeName = employeeMap.get(note.employeeId);
                } else {
                    note.employeeName = note.addedBy || 'Unknown';
                }
            });
        };

        // Populate employee names in all notes
        ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
                const categoryData = monthData[category];
                populateEmployeeNames(categoryData.categoryNotes);
                if (categoryData.files && Array.isArray(categoryData.files)) {
                    categoryData.files.forEach(file => {
                        populateEmployeeNames(file.notes);
                    });
                }
            }
        });

        if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
                if (otherCategory.document) {
                    populateEmployeeNames(otherCategory.document.categoryNotes);
                    if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                        otherCategory.document.files.forEach(file => {
                            populateEmployeeNames(file.notes);
                        });
                    }
                }
            });
        }

        res.json(monthData);
    } catch (err) {
        console.error("GET_MONTH_DATA_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch month data" });
    }
});

/* ===============================
   GET DELETED FILES FOR CLIENT
================================ */
router.get("/deleted-files", auth, async (req, res) => {
    try {
        const { year, month } = req.query;
        const clientId = req.user.clientId;

        const query = { clientId };
        if (year) query.year = parseInt(year);
        if (month) query.month = parseInt(month);

        const deletedFiles = await DeletedFile.find(query)
            .sort({ deletedAt: -1 })
            .limit(50);

        res.json(deletedFiles);
    } catch (err) {
        console.error("GET_DELETED_FILES_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch deleted files" });
    }
});

/* ===============================
   DELETE SINGLE FILE
================================ */
router.delete("/delete-file", auth, async (req, res) => {
    try {
        const {
            year,
            month,
            type,
            fileName,
            categoryName,
            deleteNote
        } = req.body;

        const client = await Client.findOne({
            clientId: req.user.clientId
        });

        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const monthData = getMonthData(client, year, month);

        // Check if category is locked
        const category = type === "other"
            ? monthData.other?.find(x => x.categoryName === categoryName)?.document
            : monthData[type];

        if (category?.isLocked) {
            return res.status(403).json({ message: "Category is locked" });
        }

        // LOG DELETE REQUEST
        logToConsole("INFO", "CLIENT_FILE_DELETE_REQUEST", {
            clientId: client.clientId,
            fileName,
            deleteNote: deleteNote || "No reason provided"
        });

        let deletedFileData = null;

        // Find and remove file
        if (type === "other") {
            const otherIndex = monthData.other?.findIndex(x => x.categoryName === categoryName);
            if (otherIndex >= 0 && monthData.other[otherIndex].document) {
                const fileIndex = monthData.other[otherIndex].document.files.findIndex(file => file.fileName === fileName);
                if (fileIndex >= 0) {
                    deletedFileData = monthData.other[otherIndex].document.files[fileIndex];
                    monthData.other[otherIndex].document.files.splice(fileIndex, 1);
                }
            }
        } else {
            if (monthData[type]?.files) {
                const fileIndex = monthData[type].files.findIndex(file => file.fileName === fileName);
                if (fileIndex >= 0) {
                    deletedFileData = monthData[type].files[fileIndex];
                    monthData[type].files.splice(fileIndex, 1);
                }
            }
        }

        if (!deletedFileData) {
            return res.status(404).json({ message: "File not found" });
        }

        // Track deleted file in audit trail
        await DeletedFile.create({
            clientId: client.clientId,
            fileName: deletedFileData.fileName,
            fileUrl: deletedFileData.url,
            fileSize: deletedFileData.fileSize,
            fileType: deletedFileData.fileType,
            year: parseInt(year),
            month: parseInt(month),
            categoryType: type,
            categoryName: categoryName,
            uploadedBy: deletedFileData.uploadedBy,
            uploadedAt: deletedFileData.uploadedAt,
            deletedBy: client.clientId,
            deleteNote: deleteNote || "No reason provided",
            wasReplaced: false
        });

        // Add deletion note to category notes
        if (category) {
            category.categoryNotes = category.categoryNotes || [];
            category.categoryNotes.push({
                note: `File deleted: ${fileName}. Reason: ${deleteNote || "No reason provided"}`,
                addedBy: client.clientId,
                addedAt: new Date()
            });
        }

        // Add to month notes
        monthData.monthNotes = monthData.monthNotes || [];
        monthData.monthNotes.push({
            note: `File deleted from ${type}${categoryName ? ` (${categoryName})` : ''}: ${fileName}`,
            addedBy: client.clientId,
            addedAt: new Date()
        });

        await client.save();

        // LOG SUCCESS
        logToConsole("SUCCESS", "CLIENT_FILE_DELETE_COMPLETE", {
            clientId: client.clientId,
            fileName
        });

        // ===== ACTIVITY LOG: FILE DELETE =====
        try {
            await ActivityLog.create({
                userName: client.name,
                role: "CLIENT",
                clientId: client.clientId,
                clientName: client.name,
                // ADDED: adminId if available
                adminId: req.user.role === "ADMIN" ? req.user.adminId : null,
                adminName: req.user.role === "ADMIN" ? req.user.name : null,
                action: "CLIENT_FILE_DELETED",
                details: `${req.user.role === "ADMIN" ? "Admin deleted" : "Client deleted"} file: ${fileName} from ${type}${categoryName ? ` (${categoryName})` : ''} for ${year}-${month}. Reason: ${deleteNote || "No reason provided"}`,
                dateTime: new Date(),
                metadata: {
                    year,
                    month,
                    type,
                    categoryName: categoryName || "N/A",
                    fileName,
                    deleteNote: deleteNote || "No reason provided",
                    performedBy: req.user.role === "ADMIN" ? "ADMIN" : "CLIENT"
                }
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED_FILE_DELETE", {
                error: logError.message
            });
        }

        res.json({
            message: "File deleted successfully",
            monthData: monthData
        });
    } catch (err) {
        logToConsole("ERROR", "CLIENT_FILE_DELETE_FAILED", {
            clientId: req.user?.clientId,
            error: err.message
        });

        res.status(500).json({ message: "Failed to delete file" });
    }
});

/* ===============================
   SAVE & LOCK MONTH
================================ */
router.post("/save-lock", auth, async (req, res) => {
    try {
        const { year, month } = req.body;

        const client = await Client.findOne({
            clientId: req.user.clientId
        });

        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const monthData = getMonthData(client, year, month);

        // LOG LOCK REQUEST
        logToConsole("INFO", "CLIENT_MONTH_LOCK_REQUEST", {
            clientId: client.clientId,
            year,
            month
        });

        // LOCK MONTH
        monthData.isLocked = true;
        monthData.wasLockedOnce = true;
        monthData.lockedAt = new Date();
        monthData.lockedBy = client.clientId;

        // LOCK ALL CATEGORIES
        ["sales", "purchase", "bank"].forEach((k) => {
            if (monthData[k]) {
                monthData[k].isLocked = true;
                monthData[k].wasLockedOnce = true;
            }
        });

        monthData.other?.forEach((o) => {
            if (o.document) {
                o.document.isLocked = true;
                o.document.wasLockedOnce = true;
            }
        });

        await client.save();

        // LOG SUCCESS
        logToConsole("SUCCESS", "CLIENT_MONTH_LOCK_COMPLETE", {
            clientId: client.clientId,
            year,
            month
        });

        // ===== ACTIVITY LOG: MONTH LOCK =====
        try {
            await ActivityLog.create({
                userName: client.name,
                role: "CLIENT",
                clientId: client.clientId,
                clientName: client.name,
                // ADDED: adminId if available (admin-initiated lock)
                adminId: req.user.role === "ADMIN" ? req.user.adminId : null,
                adminName: req.user.role === "ADMIN" ? req.user.name : null,
                action: "CLIENT_MONTH_LOCKED",
                details: `${req.user.role === "ADMIN" ? "Admin locked" : "Client locked"} month ${year}-${month}. All categories have been locked.`,
                dateTime: new Date(),
                metadata: {
                    year,
                    month,
                    lockedAt: new Date(),
                    performedBy: req.user.role === "ADMIN" ? "ADMIN" : "CLIENT"
                }
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED_MONTH_LOCK", {
                error: logError.message
            });
        }

        res.json({
            message: "Month saved and locked",
            monthData: monthData
        });
    } catch (err) {
        logToConsole("ERROR", "CLIENT_MONTH_LOCK_FAILED", {
            clientId: req.user?.clientId,
            error: err.message
        });

        res.status(500).json({ message: "Failed to lock month" });
    }
});

/* ===============================
   GET EMPLOYEE ASSIGNMENT INFO
================================ */
router.get("/employee-assignment", auth, async (req, res) => {
    try {
        const { year, month } = req.query;

        const client = await Client.findOne({
            clientId: req.user.clientId
        });

        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        // Get ALL assignments for this month
        const assignments = client.employeeAssignments?.filter(
            assignment =>
                String(assignment.year) === String(year) &&
                String(assignment.month) === String(month) &&
                !assignment.isRemoved
        );

        if (!assignments || assignments.length === 0) {
            return res.json([]);
        }

        // Get ALL employee IDs from assignments
        const employeeIds = assignments.map(a => a.employeeId);

        // Fetch employee details including phone numbers
        const Employee = require("../models/Employee");
        const employees = await Employee.find(
            { employeeId: { $in: employeeIds } },
            { employeeId: 1, name: 1, phone: 1 }
        );

        // Create employee map for quick lookup
        const employeeMap = new Map();
        employees.forEach(emp => {
            employeeMap.set(emp.employeeId, {
                name: emp.name,
                phone: emp.phone || "N/A"
            });
        });

        // Enrich assignments with employee details
        const enrichedAssignments = assignments.map(assignment => {
            const empInfo = employeeMap.get(assignment.employeeId);
            return {
                employeeId: assignment.employeeId,
                employeeName: empInfo?.name || "Unknown",
                employeePhone: empInfo?.phone || "N/A",
                task: assignment.task,
                accountingDone: assignment.accountingDone,
                accountingDoneAt: assignment.accountingDoneAt,
                accountingDoneBy: assignment.accountingDoneBy,
                assignedAt: assignment.assignedAt,
                assignedBy: assignment.assignedBy,
                adminName: assignment.adminName
            };
        });

        res.json(enrichedAssignments);

    } catch (err) {
        console.error("GET_EMPLOYEE_ASSIGNMENT_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch employee assignments" });
    }
});

/* ===============================
   SIMPLE TEST ROUTE
================================ */
router.get("/test-simple", (req, res) => {
    console.log("✓ Simple test route called from clientUpload.js");
    res.json({
        message: "SUCCESS: clientUpload.js route file is working!",
        timestamp: new Date().toISOString(),
        status: "active"
    });
});

/* ===============================
   UPLOAD & LOCK CATEGORY
================================ */
router.post("/upload-and-lock", auth, upload.array("files"),
    async (req, res) => {
        try {
            const {
                year,
                month,
                type,
                categoryName,
                note
            } = req.body;

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: "No files uploaded" });
            }

            const client = await Client.findOne({
                clientId: req.user.clientId
            });

            if (!client) {
                return res.status(404).json({ message: "Client not found" });
            }

            const monthData = getMonthData(client, year, month);

            // Check if category is already locked
            if (type === "other") {
                const o = monthData.other?.find(
                    (x) => x.categoryName === categoryName
                );
                if (o?.document?.isLocked) {
                    return res.status(403).json({
                        message: "Category is already locked"
                    });
                }
            } else {
                if (monthData[type]?.isLocked) {
                    return res.status(403).json({
                        message: "Category is already locked"
                    });
                }
            }

            // LOG REQUEST
            logToConsole("INFO", "CLIENT_UPLOAD_AND_LOCK_REQUEST", {
                clientId: client.clientId,
                filesCount: req.files.length
            });

            // UPLOAD FILES TO S3
            const uploadedFiles = [];

            for (const file of req.files) {
                const fileExt = file.originalname.split(".").pop();
                const key = `clients/${client.clientId}/${year}/${month}/${uuidv4()}.${fileExt}`;

                await s3.send(
                    new PutObjectCommand({
                        Bucket: process.env.AWS_BUCKET,
                        Key: key,
                        Body: file.buffer,
                        ContentType: file.mimetype
                    })
                );

                uploadedFiles.push({
                    url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
                    uploadedAt: new Date(),
                    uploadedBy: client.clientId,
                    fileName: file.originalname,
                    fileSize: file.size,
                    fileType: file.mimetype,
                    notes: []
                });
            }

            // ADD FILES TO CATEGORY
            let targetCategory;

            if (type === "other") {
                let otherCategory = monthData.other?.find(
                    (x) => x.categoryName === categoryName
                );

                if (otherCategory) {
                    otherCategory.document.files.push(...uploadedFiles);
                    targetCategory = otherCategory.document;
                } else {
                    const newCategory = {
                        categoryName,
                        document: {
                            files: uploadedFiles,
                            categoryNotes: [],
                            isLocked: false,
                            wasLockedOnce: false
                        }
                    };
                    monthData.other = monthData.other || [];
                    monthData.other.push(newCategory);
                    targetCategory = newCategory.document;
                }
            } else {
                if (!monthData[type]) {
                    monthData[type] = {
                        files: uploadedFiles,
                        categoryNotes: [],
                        isLocked: false,
                        wasLockedOnce: false
                    };
                } else {
                    monthData[type].files.push(...uploadedFiles);
                }
                targetCategory = monthData[type];
            }

            // ADD NOTE IF PROVIDED
            if (note) {
                targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                targetCategory.categoryNotes.push({
                    note,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });

                monthData.monthNotes = monthData.monthNotes || [];
                monthData.monthNotes.push({
                    note,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }

            // LOCK THE CATEGORY
            targetCategory.isLocked = true;
            targetCategory.wasLockedOnce = true;
            targetCategory.lockedAt = new Date();
            targetCategory.lockedBy = client.clientId;

            await client.save();

            // LOG SUCCESS
            logToConsole("SUCCESS", "CLIENT_UPLOAD_AND_LOCK_COMPLETE", {
                clientId: client.clientId,
                uploadedFilesCount: uploadedFiles.length
            });

            // ===== ACTIVITY LOG: UPLOAD AND LOCK =====
            try {
                await ActivityLog.create({
                    userName: client.name,
                    role: "CLIENT",
                    clientId: client.clientId,
                    clientName: client.name,
                    // ADDED: adminId if available
                    adminId: req.user.role === "ADMIN" ? req.user.adminId : null,
                    adminName: req.user.role === "ADMIN" ? req.user.name : null,
                    action: "CLIENT_FILE_UPLOADED_AND_LOCKED",
                    details: `${req.user.role === "ADMIN" ? "Admin uploaded" : "Client uploaded"} ${uploadedFiles.length} file(s) and locked ${type}${categoryName ? ` (${categoryName})` : ''} for ${year}-${month}`,
                    dateTime: new Date(),
                    metadata: {
                        year,
                        month,
                        type,
                        categoryName: categoryName || "N/A",
                        filesCount: uploadedFiles.length,
                        noteProvided: !!note,
                        performedBy: req.user.role === "ADMIN" ? "ADMIN" : "CLIENT"
                    }
                });
            } catch (logError) {
                logToConsole("ERROR", "ACTIVITY_LOG_FAILED_UPLOAD_LOCK", {
                    error: logError.message
                });
            }

            res.json({
                message: `${req.files.length} file(s) uploaded and category locked successfully!`,
                filesCount: req.files.length,
                monthData: monthData
            });
        } catch (err) {
            logToConsole("ERROR", "CLIENT_UPLOAD_AND_LOCK_FAILED", {
                clientId: req.user?.clientId,
                error: err.message
            });

            res.status(500).json({ message: "Upload and lock failed" });
        }
    }
);

module.exports = router;