const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");

const Client = require("../models/Client");
const ClientMonthlyData = require("../models/ClientMonthlyData");
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
   MULTER CONFIG
================================ */
const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'xls', 'xlsx', 'csv'];
const allowedMimeTypes = [
    "application/pdf", "application/x-pdf",
    "image/jpeg", "image/jpg", "image/pjpeg", "image/heic", "image/heif",
    "image/png", "image/x-png", "image/gif", "image/webp",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/excel", "application/csv", "text/csv"
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = file.originalname.split('.').pop().toLowerCase();
        if (allowedExtensions.includes(ext) || allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file type"), false);
        }
    }
});


const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};


/* ===============================
   HELPER: GET EMPTY MONTH DATA
================================ */
const getEmptyMonthData = (year, month, monthActiveStatus = 'active') => {
    return {
        year: parseInt(year),
        month: parseInt(month),
        sales: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
        purchase: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
        bank: { files: [], categoryNotes: [], isLocked: false, wasLockedOnce: false },
        other: [],
        isLocked: false,
        wasLockedOnce: false,
        monthNotes: [],
        accountingDone: false,
        monthActiveStatus: monthActiveStatus,
        paymentStatus: false,
        paymentHistory: []
    };
};

/* ===============================
   HELPER: GET MONTH DATA FROM BOTH SOURCES
================================ */
const getMonthData = async (clientId, year, month, clientDoc = null) => {
    const numericYear = parseInt(year);
    const numericMonth = parseInt(month);

    // 1. FIRST check NEW collection (ClientMonthlyData)
    const newDoc = await ClientMonthlyData.findOne({ clientId });

    if (newDoc) {
        const foundMonth = newDoc.months.find(m => m.year === numericYear && m.month === numericMonth);
        if (foundMonth) {
            logToConsole("DEBUG", "MONTH_FOUND_IN_NEW_COLLECTION", { clientId, year, month });
            return {
                data: foundMonth,
                source: 'new',
                exists: true,
                doc: newDoc,
                monthIndex: newDoc.months.findIndex(m => m.year === numericYear && m.month === numericMonth)
            };
        }
    }

    // 2. If not found, check OLD client.documents
    let client = clientDoc;
    if (!client) {
        client = await Client.findOne({ clientId });
    }

    if (client) {
        const y = String(numericYear);
        const m = String(numericMonth);

        if (client.documents.has(y) && client.documents.get(y).has(m)) {
            const oldData = client.documents.get(y).get(m);
            // Add year/month to old data for consistency
            oldData.year = numericYear;
            oldData.month = numericMonth;
            logToConsole("DEBUG", "MONTH_FOUND_IN_OLD_COLLECTION", { clientId, year, month });
            return {
                data: oldData,
                source: 'old',
                exists: true,
                client: client,
                yearKey: y,
                monthKey: m
            };
        }
    }

    // 3. Not found - calculate active status
    let monthActiveStatus = 'active';
    if (client && client.deactivatedAt) {
        const requestedMonthDate = new Date(numericYear, numericMonth - 1, 1);
        const deactivationDate = new Date(client.deactivatedAt);
        const deactivationMonthStart = new Date(deactivationDate.getFullYear(), deactivationDate.getMonth(), 1);
        if (requestedMonthDate >= deactivationMonthStart) {
            monthActiveStatus = 'inactive';
        }
        if (client.reactivatedAt && monthActiveStatus === 'inactive') {
            const reactivationDate = new Date(client.reactivatedAt);
            const reactivationMonthStart = new Date(reactivationDate.getFullYear(), reactivationDate.getMonth(), 1);
            if (requestedMonthDate >= reactivationMonthStart) {
                monthActiveStatus = 'active';
            }
        }
    }

    logToConsole("DEBUG", "MONTH_NOT_FOUND_CREATING_NEW", { clientId, year, month });
    return {
        data: getEmptyMonthData(year, month, monthActiveStatus),
        source: null,
        exists: false,
        client: client,
        newDoc: newDoc
    };
};

/* ===============================
   HELPER: SAVE MONTH DATA - FIXED
================================ */
const saveMonthData = async (clientId, year, month, monthData, existingSource, context) => {
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
            // Remove year/month ONLY for OLD storage (old doesn't have these fields)
            const { year: yField, month: mField, ...cleanData } = monthData;
            context.client.documents.get(y).set(m, cleanData);
            await context.client.save();
            logToConsole("INFO", "SAVED_TO_OLD_COLLECTION", { clientId, year, month });
            return { savedTo: 'old' };
        }
    } else {
        // Save to NEW collection - KEEP year and month
        let doc = await ClientMonthlyData.findOne({ clientId: clientId });

        if (!doc) {
            doc = new ClientMonthlyData({
                clientId: clientId,
                clientName: context.client?.name || '',
                clientEmail: context.client?.email || '',
                months: []
            });
        }

        // Check if month already exists
        const existingIndex = doc.months.findIndex(m => m.year === numericYear && m.month === numericMonth);

        // ✅ DO NOT remove year and month - keep them in data
        if (existingIndex !== -1) {
            // Update existing month
            doc.months[existingIndex] = monthData;
        } else {
            // Add new month
            doc.months.push(monthData);
        }

        // Sort months
        doc.months.sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
        });

        if (context.client) {
            doc.clientName = context.client.name;
            doc.clientEmail = context.client.email;
        }

        await doc.save();
        logToConsole("INFO", "SAVED_TO_NEW_COLLECTION", { clientId, year, month });
        return { savedTo: 'new' };
    }
};

/* ===============================
   HELPER: GET ASSIGNED EMPLOYEES
================================ */
const getAssignedEmployeesForMonth = async (clientId, year, month) => {
    try {
        const client = await Client.findOne({ clientId });
        if (!client || !client.employeeAssignments) return [];
        const assignments = client.employeeAssignments.filter(
            a => a.year === parseInt(year) && a.month === parseInt(month) && !a.isRemoved
        );
        const employeeIds = [...new Set(assignments.map(a => a.employeeId))];
        if (employeeIds.length === 0) return [];
        const Employee = require("../models/Employee");
        const employees = await Employee.find({ employeeId: { $in: employeeIds } }, { employeeId: 1, name: 1, email: 1 });
        return employees;
    } catch (error) {
        console.error("Error getting assigned employees:", error);
        return [];
    }
};

/* ===============================
   HELPER: SEND EMAIL NOTIFICATIONS (FULL TEMPLATES)
================================ */
const sendNotificationEmails = async ({ client, employeeName, actionType, details, year, month, fileName, categoryType, categoryName, note }) => {
    try {
        const sendEmail = require("../utils/sendEmail");
        const assignedEmployees = await getAssignedEmployeesForMonth(client.clientId, year, month);
        const emailsSent = { employees: [], admin: false };
        const emailData = {
            clientName: client.name, clientId: client.clientId, clientEmail: client.email,
            employeeName: employeeName || 'Client', year, month, actionType, details,
            fileName: fileName || 'Multiple files', categoryType, categoryName: categoryName || categoryType,
            note: note || 'No note provided', timestamp: new Date().toLocaleString("en-IN")
        };

        for (const employee of assignedEmployees) {
            if (employee.email) {
                const employeeHtml = `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}.container{max-width:600px;margin:0 auto;padding:20px;}.header{background-color:#ff9800;color:white;padding:15px;text-align:center;border-radius:5px 5px 0 0;}.content{background-color:#f9f9f9;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 5px 5px;}.info-box{background-color:#fff3e0;padding:15px;margin:15px 0;border-left:4px solid #ff9800;}.details{background-color:#fff;padding:15px;border:1px solid #ddd;border-radius:3px;margin:10px 0;}.note-box{background-color:#f1f8e9;padding:15px;border-left:4px solid #8bc34a;margin:15px 0;}.footer{text-align:center;margin-top:20px;color:#666;font-size:12px;}</style></head><body><div class="container"><div class="header"><h2>📋 ${actionType}</h2></div><div class="content"><div class="info-box"><p><strong>Hello ${employee.name},</strong></p><p>Your assigned client has performed an action that requires your attention.</p></div><div class="details"><h3>🔍 Details</h3><p><strong>Client:</strong> ${client.name} (${client.clientId})</p><p><strong>Period:</strong> ${month}/${year}</p><p><strong>Action:</strong> ${details}</p><p><strong>File:</strong> ${emailData.fileName}</p><p><strong>Category:</strong> ${emailData.categoryName}</p><p><strong>Performed by:</strong> ${emailData.employeeName}</p><p><strong>Time:</strong> ${emailData.timestamp}</p></div>${note ? `<div class="note-box"><h4>📝 Note:</h4><p>"${note}"</p></div>` : ''}<p><strong>Action Required:</strong> Please log in to review.</p><div class="footer"><p>Credence Enterprise Accounting Services</p></div></div></div></body></html>`;
                await sendEmail(employee.email, `📝 ${actionType} - ${client.name} (${month}/${year})`, employeeHtml);
                emailsSent.employees.push(employee.email);
            }
        }

        const adminEmail = process.env.EMAIL_USER;
        if (adminEmail) {
            const adminHtml = `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}.container{max-width:600px;margin:0 auto;padding:20px;}.header{background-color:#2196f3;color:white;padding:15px;text-align:center;border-radius:5px 5px 0 0;}.content{background-color:#f9f9f9;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 5px 5px;}.alert{background-color:#fff3cd;border:1px solid #ffeaa7;padding:10px;border-radius:3px;margin:10px 0;}.details{background-color:#e3f2fd;padding:15px;border-radius:3px;margin:10px 0;}.employee-list{background-color:#f5f5f5;padding:10px;border-radius:3px;margin:10px 0;}.footer{text-align:center;margin-top:20px;color:#666;font-size:12px;}</style></head><body><div class="container"><div class="header"><h2>🔔 ${actionType} Notification</h2></div><div class="content"><div class="alert"><strong>Notification:</strong> Client has performed an action.</div><div class="details"><h3>Client Information</h3><p><strong>Client:</strong> ${client.name} (${client.clientId})</p><p><strong>Period:</strong> ${month}/${year}</p><p><strong>Action:</strong> ${details}</p><p><strong>File:</strong> ${emailData.fileName}</p><p><strong>Category:</strong> ${emailData.categoryName}</p><p><strong>Time:</strong> ${emailData.timestamp}</p></div>${assignedEmployees.length > 0 ? `<div class="employee-list"><h4>📋 Assigned Employees Notified:</h4><ul>${assignedEmployees.map(emp => `<li>${emp.name} (${emp.email})</li>`).join('')}</ul></div>` : '<p><strong>⚠️ No employees assigned.</strong></p>'}${note ? `<div class="note-box"><h4>📝 Client Note:</h4><p>"${note}"</p></div>` : ''}<div class="footer"><p>Credence Enterprise Accounting Services</p></div></div></div></body></html>`;
            await sendEmail(adminEmail, `🔔 ${actionType} - Client ${client.name} (${month}/${year})`, adminHtml);
            emailsSent.admin = true;
        }
        return emailsSent;
    } catch (emailError) {
        console.error("Email sending failed:", emailError);
        return { employees: [], admin: false, error: emailError.message };
    }
};

/* ===============================
   UPLOAD / UPDATE FILES
================================ */
router.post("/upload", auth, upload.array("files"), async (req, res) => {
    try {
        const { year, month, type, categoryName, note, deleteNote, replacedFile } = req.body;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "❌ No files selected." });
        }

        const MAX_TOTAL_SIZE = 10 * 1024 * 1024;
        const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
        if (totalSize > MAX_TOTAL_SIZE) {
            return res.status(400).json({ message: `❌ Total file size exceeds limit.` });
        }

        const MAX_FILES = 20;
        if (req.files.length > MAX_FILES) {
            return res.status(400).json({ message: `❌ Too many files. Max ${MAX_FILES}.` });
        }

        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "❌ Client not found." });
        }

        const { data: monthData, source: dataSource, exists, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `❌ Cannot upload. Month ${month}/${year} was inactive.` });
        }

        if (monthData.isLocked) {
            let allowed = false;
            if (type === "other") {
                const o = monthData.other?.find(x => x.categoryName === categoryName);
                allowed = o && !o.document?.isLocked;
            } else {
                allowed = monthData[type] && !monthData[type].isLocked;
            }
            if (!allowed) {
                return res.status(403).json({ message: "❌ Cannot upload. Category is locked." });
            }
        }

        const category = type === "other" ? monthData.other?.find(x => x.categoryName === categoryName)?.document : monthData[type];
        const isUpdate = category && category.files && category.files.length > 0;

        if (monthData.wasLockedOnce && isUpdate && !note) {
            return res.status(400).json({ message: "❌ Note required when updating locked month." });
        }

        // Handle file replacement
        if (replacedFile) {
            let oldFile = null;
            if (type === "other") {
                const otherIndex = monthData.other?.findIndex(x => x.categoryName === categoryName);
                if (otherIndex >= 0 && monthData.other[otherIndex].document) {
                    const fileIndex = monthData.other[otherIndex].document.files.findIndex(f => f.fileName === replacedFile);
                    if (fileIndex >= 0) {
                        oldFile = monthData.other[otherIndex].document.files[fileIndex];
                        monthData.other[otherIndex].document.files.splice(fileIndex, 1);
                        await DeletedFile.create({
                            clientId: client.clientId, fileName: oldFile.fileName, fileUrl: oldFile.url,
                            fileSize: oldFile.fileSize, fileType: oldFile.fileType, year: parseInt(year),
                            month: parseInt(month), categoryType: type, categoryName: categoryName,
                            uploadedBy: oldFile.uploadedBy, uploadedAt: oldFile.uploadedAt,
                            deletedBy: client.clientId, deleteNote: deleteNote || "Replaced",
                            wasReplaced: true, replacedByFile: req.files[0]?.originalname
                        });
                    }
                }
            } else {
                const fileIndex = monthData[type]?.files?.findIndex(f => f.fileName === replacedFile);
                if (fileIndex >= 0) {
                    oldFile = monthData[type].files[fileIndex];
                    monthData[type].files.splice(fileIndex, 1);
                    await DeletedFile.create({
                        clientId: client.clientId, fileName: oldFile.fileName, fileUrl: oldFile.url,
                        fileSize: oldFile.fileSize, fileType: oldFile.fileType, year: parseInt(year),
                        month: parseInt(month), categoryType: type, uploadedBy: oldFile.uploadedBy,
                        uploadedAt: oldFile.uploadedAt, deletedBy: client.clientId,
                        deleteNote: deleteNote || "Replaced", wasReplaced: true,
                        replacedByFile: req.files[0]?.originalname
                    });
                }
            }
        }

        // Upload files to S3
        const uploadedFiles = [];
        for (const file of req.files) {
            const fileExt = file.originalname.split(".").pop();
            const key = `clients/${client.clientId}/${year}/${month}/${uuidv4()}.${fileExt}`;
            await s3.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype
            }));
            uploadedFiles.push({
                url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
                uploadedAt: new Date(), uploadedBy: client.clientId, fileName: file.originalname,
                fileSize: file.size, fileType: file.mimetype, notes: []
            });
        }

        // Add files to category
        if (type === "other") {
            let otherCategory = monthData.other?.find(x => x.categoryName === categoryName);
            if (otherCategory) {
                otherCategory.document.files.push(...uploadedFiles);
            } else {
                monthData.other = monthData.other || [];
                monthData.other.push({
                    categoryName,
                    document: { files: uploadedFiles, categoryNotes: [], isLocked: false, wasLockedOnce: false }
                });
            }
        } else {
            if (!monthData[type]) {
                monthData[type] = { files: uploadedFiles, categoryNotes: [], isLocked: false, wasLockedOnce: false };
            } else {
                monthData[type].files.push(...uploadedFiles);
            }
        }

        if (monthData.wasLockedOnce && isUpdate && note) {
            const targetCategory = type === "other" ? monthData.other.find(x => x.categoryName === categoryName)?.document : monthData[type];
            if (targetCategory) {
                targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                targetCategory.categoryNotes.push({ note, addedBy: client.clientId, addedAt: new Date() });
            }
        }

        await saveMonthData(client.clientId, year, month, monthData, dataSource, { client: existingClient, yearKey, monthKey, newDoc });

        if (monthData.wasLockedOnce && isUpdate && note) {
            try {
                await sendNotificationEmails({
                    client, employeeName: client.name, actionType: "CLIENT ADDED NOTE",
                    details: `Client added note while uploading to ${type}${categoryName ? ` (${categoryName})` : ''}`,
                    year, month, fileName: uploadedFiles.map(f => f.fileName).join(', '),
                    categoryType: type, categoryName: categoryName, note
                });
            } catch (emailError) { console.error("Email error:", emailError); }
        }

        await ActivityLog.create({
            userName: client.name, role: "CLIENT", clientId: client.clientId, clientName: client.name,
            action: replacedFile ? "CLIENT_FILE_UPDATED" : "CLIENT_FILE_UPLOADED",
            details: `${uploadedFiles.length} file(s) uploaded`, dateTime: new Date(),
            metadata: { year, month, type, categoryName, filesCount: uploadedFiles.length, totalSize }
        });

        res.json({ message: `✅ ${req.files.length} file(s) uploaded!`, filesCount: req.files.length, totalSize, monthData });
    } catch (err) {
        logToConsole("ERROR", "UPLOAD_FAILED", { error: err.message });
        if (err.message?.includes("Invalid file type")) {
            return res.status(400).json({ message: "❌ Invalid file type." });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: "❌ File exceeds 10MB limit." });
        }
        res.status(500).json({ message: "❌ Upload failed." });
    }
});

/* ===============================
   GET MONTH DATA
================================ */
router.get("/month-data", auth, async (req, res) => {
    try {
        const { year, month } = req.query;
        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const { data: monthData } = await getMonthData(client.clientId, year, month, client);

        // Get employee names for notes
        const Employee = require("../models/Employee");
        const employeeMap = new Map();
        const employeeIds = new Set();

        const collectEmployeeIds = (notesArray) => {
            if (!notesArray || !Array.isArray(notesArray)) return;
            notesArray.forEach(note => { if (note.employeeId) employeeIds.add(note.employeeId); });
        };

        ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
                collectEmployeeIds(monthData[category].categoryNotes);
                monthData[category].files?.forEach(file => collectEmployeeIds(file.notes));
            }
        });
        if (monthData.other) {
            monthData.other.forEach(otherCategory => {
                if (otherCategory.document) {
                    collectEmployeeIds(otherCategory.document.categoryNotes);
                    otherCategory.document.files?.forEach(file => collectEmployeeIds(file.notes));
                }
            });
        }

        if (employeeIds.size > 0) {
            const employees = await Employee.find({ employeeId: { $in: Array.from(employeeIds) } }, { employeeId: 1, name: 1 });
            employees.forEach(emp => employeeMap.set(emp.employeeId, emp.name));
        }

        const populateEmployeeNames = (notesArray) => {
            if (!notesArray) return;
            notesArray.forEach(note => {
                note.employeeName = note.employeeId && employeeMap.has(note.employeeId) ? employeeMap.get(note.employeeId) : note.addedBy || 'Unknown';
            });
        };

        ['sales', 'purchase', 'bank'].forEach(category => {
            if (monthData[category]) {
                populateEmployeeNames(monthData[category].categoryNotes);
                monthData[category].files?.forEach(file => populateEmployeeNames(file.notes));
            }
        });
        if (monthData.other) {
            monthData.other.forEach(otherCategory => {
                if (otherCategory.document) {
                    populateEmployeeNames(otherCategory.document.categoryNotes);
                    otherCategory.document.files?.forEach(file => populateEmployeeNames(file.notes));
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
   DELETE SINGLE FILE
================================ */
router.delete("/delete-file", auth, async (req, res) => {
    try {
        const { year, month, type, fileName, categoryName, deleteNote } = req.body;
        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const { data: monthData, source: dataSource, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `Cannot delete. Month ${month}/${year} was inactive.` });
        }

        const category = type === "other" ? monthData.other?.find(x => x.categoryName === categoryName)?.document : monthData[type];
        if (category?.isLocked) {
            return res.status(403).json({ message: "Category is locked" });
        }

        let deletedFileData = null;

        if (type === "other") {
            const otherIndex = monthData.other?.findIndex(x => x.categoryName === categoryName);
            if (otherIndex >= 0 && monthData.other[otherIndex].document) {
                const fileIndex = monthData.other[otherIndex].document.files.findIndex(f => f.fileName === fileName);
                if (fileIndex >= 0) {
                    deletedFileData = monthData.other[otherIndex].document.files[fileIndex];
                    monthData.other[otherIndex].document.files.splice(fileIndex, 1);
                }
            }
        } else {
            if (monthData[type]?.files) {
                const fileIndex = monthData[type].files.findIndex(f => f.fileName === fileName);
                if (fileIndex >= 0) {
                    deletedFileData = monthData[type].files[fileIndex];
                    monthData[type].files.splice(fileIndex, 1);
                }
            }
        }

        if (!deletedFileData) {
            return res.status(404).json({ message: "File not found" });
        }

        await DeletedFile.create({
            clientId: client.clientId, fileName: deletedFileData.fileName, fileUrl: deletedFileData.url,
            fileSize: deletedFileData.fileSize, fileType: deletedFileData.fileType, year: parseInt(year),
            month: parseInt(month), categoryType: type, categoryName: categoryName,
            uploadedBy: deletedFileData.uploadedBy, uploadedAt: deletedFileData.uploadedAt,
            deletedBy: client.clientId, deleteNote: deleteNote || "No reason provided"
        });

        if (category) {
            category.categoryNotes = category.categoryNotes || [];
            category.categoryNotes.push({
                note: `File deleted: ${fileName}. Reason: ${deleteNote || "No reason provided"}`,
                addedBy: client.clientId, addedAt: new Date()
            });
        }

        await saveMonthData(client.clientId, year, month, monthData, dataSource, { client: existingClient, yearKey, monthKey, newDoc });

        try {
            await sendNotificationEmails({
                client, employeeName: client.name, actionType: "FILE DELETED",
                details: `Deleted file "${fileName}" from ${type}${categoryName ? ` (${categoryName})` : ''}`,
                year, month, fileName, categoryType: type, categoryName: categoryName,
                note: `File deleted: ${fileName}. Reason: ${deleteNote || "No reason provided"}`
            });
        } catch (emailError) { console.error("Email error:", emailError); }

        await ActivityLog.create({
            userName: client.name, role: "CLIENT", clientId: client.clientId, clientName: client.name,
            action: "CLIENT_FILE_DELETED", details: `Deleted file: ${fileName}`, dateTime: new Date(),
            metadata: { year, month, type, categoryName, fileName, deleteNote }
        });

        res.json({ message: "File deleted successfully", monthData });
    } catch (err) {
        logToConsole("ERROR", "DELETE_FAILED", { error: err.message });
        res.status(500).json({ message: "Failed to delete file" });
    }
});


/* ===============================
   DELETE MULTIPLE FILES (BULK DELETE) - FIXED
================================ */
router.post("/delete-multiple-files", auth, async (req, res) => {
    try {
        const { year, month, files, deleteNote } = req.body;

        // Validate input
        if (!year || !month || !files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ message: "❌ Invalid request. Please provide year, month, and files array." });
        }

        if (!deleteNote || !deleteNote.trim()) {
            return res.status(400).json({ message: "❌ Please provide a reason for deletion." });
        }

        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "❌ Client not found." });
        }

        // Get month data
        const { data: monthData, source: dataSource, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        // Check if month is inactive
        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `❌ Cannot delete. Month ${month}/${year} was inactive.` });
        }

        const deletedFilesInfo = [];
        const errors = [];

        // Process each file
        for (const fileInfo of files) {
            const { type, fileName, categoryName } = fileInfo;

            // Find the category
            let category = null;
            let categoryPath = null;

            if (type === "other") {
                const otherIndex = monthData.other?.findIndex(x => x.categoryName === categoryName);
                if (otherIndex !== -1 && otherIndex >= 0) {
                    category = monthData.other[otherIndex].document;
                    categoryPath = { type: "other", index: otherIndex };
                }
            } else {
                if (monthData[type]) {
                    category = monthData[type];
                    categoryPath = { type: type, index: null };
                }
            }

            // Check if category exists
            if (!category) {
                errors.push(`Category not found for file: ${fileName}`);
                continue;
            }

            // Check if category is locked
            if (category.isLocked) {
                errors.push(`Cannot delete "${fileName}" - Category is locked`);
                continue;
            }

            // Find and remove the file
            let deletedFileData = null;
            let fileIndex = -1;

            if (type === "other" && categoryPath && categoryPath.index !== undefined) {
                fileIndex = monthData.other[categoryPath.index].document.files.findIndex(f => f.fileName === fileName);
                if (fileIndex >= 0) {
                    deletedFileData = monthData.other[categoryPath.index].document.files[fileIndex];
                    monthData.other[categoryPath.index].document.files.splice(fileIndex, 1);
                }
            } else {
                if (monthData[type]?.files) {
                    fileIndex = monthData[type].files.findIndex(f => f.fileName === fileName);
                    if (fileIndex >= 0) {
                        deletedFileData = monthData[type].files[fileIndex];
                        monthData[type].files.splice(fileIndex, 1);
                    }
                }
            }

            if (!deletedFileData) {
                errors.push(`File not found: ${fileName}`);
                continue;
            }

            // Store deleted file info with correct field names
            deletedFilesInfo.push({
                fileName: deletedFileData.fileName,
                url: deletedFileData.url,
                fileSize: deletedFileData.fileSize,
                fileType: deletedFileData.fileType,
                uploadedBy: deletedFileData.uploadedBy,
                uploadedAt: deletedFileData.uploadedAt,
                type: type,
                categoryName: categoryName
            });
        }

        // If no files were deleted successfully
        if (deletedFilesInfo.length === 0) {
            return res.status(404).json({
                message: "❌ No files were deleted",
                errors: errors
            });
        }

        // Create bulk delete note with all filenames
        const fileNamesList = deletedFilesInfo.map(f => f.fileName).join(", ");
        const bulkDeleteNote = `Bulk delete (${deletedFilesInfo.length} files): [${fileNamesList}]. Reason: ${deleteNote.trim()}`;

        // Create DeletedFile records for each deleted file
        for (const deletedFile of deletedFilesInfo) {
            await DeletedFile.create({
                clientId: client.clientId,
                fileName: deletedFile.fileName,
                fileUrl: deletedFile.url,
                fileSize: deletedFile.fileSize,
                fileType: deletedFile.fileType,
                year: parseInt(year),
                month: parseInt(month),
                categoryType: deletedFile.type,
                categoryName: deletedFile.categoryName || null,
                uploadedBy: deletedFile.uploadedBy,
                uploadedAt: deletedFile.uploadedAt,
                deletedBy: client.clientId,
                deleteNote: bulkDeleteNote,
                wasReplaced: false
            });
        }

        // Add note to category about bulk delete
        // Group files by category to add notes
        const filesByCategory = {};
        for (const deletedFile of deletedFilesInfo) {
            const categoryKey = deletedFile.type === "other" ? `other-${deletedFile.categoryName}` : deletedFile.type;
            if (!filesByCategory[categoryKey]) {
                filesByCategory[categoryKey] = {
                    type: deletedFile.type,
                    categoryName: deletedFile.categoryName,
                    files: []
                };
            }
            filesByCategory[categoryKey].files.push(deletedFile.fileName);
        }

        // Add note to each affected category
        for (const categoryKey in filesByCategory) {
            const catInfo = filesByCategory[categoryKey];
            let targetCategory = null;

            if (catInfo.type === "other") {
                const otherCategory = monthData.other?.find(x => x.categoryName === catInfo.categoryName);
                if (otherCategory) {
                    targetCategory = otherCategory.document;
                }
            } else {
                targetCategory = monthData[catInfo.type];
            }

            if (targetCategory) {
                targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                targetCategory.categoryNotes.push({
                    note: `Bulk delete (${catInfo.files.length} files): [${catInfo.files.join(", ")}]. Reason: ${deleteNote.trim()}`,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }
        }

        // Save month data
        await saveMonthData(client.clientId, year, month, monthData, dataSource, {
            client: existingClient,
            yearKey,
            monthKey,
            newDoc
        });

        // Send email notification
        try {
            await sendNotificationEmails({
                client,
                employeeName: client.name,
                actionType: "BULK FILES DELETED",
                details: `Deleted ${deletedFilesInfo.length} file(s)`,
                year,
                month,
                fileName: fileNamesList,
                categoryType: "multiple",
                categoryName: "various categories",
                note: bulkDeleteNote
            });
        } catch (emailError) {
            console.error("Email error:", emailError);
        }

        // Log activity
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            clientName: client.name,
            action: "CLIENT_BULK_FILES_DELETED",
            details: `Bulk deleted ${deletedFilesInfo.length} file(s)`,
            dateTime: new Date(),
            metadata: {
                year,
                month,
                filesCount: deletedFilesInfo.length,
                fileNames: fileNamesList,
                deleteNote: deleteNote.trim(),
                errors: errors.length > 0 ? errors : null
            }
        });

        logToConsole("INFO", "BULK_DELETE_SUCCESS", {
            clientId: client.clientId,
            year,
            month,
            filesDeleted: deletedFilesInfo.length,
            errors: errors.length
        });

        res.json({
            success: true,
            message: `✅ Successfully deleted ${deletedFilesInfo.length} file(s)`,
            deletedCount: deletedFilesInfo.length,
            errors: errors.length > 0 ? errors : null,
            monthData
        });

    } catch (err) {
        logToConsole("ERROR", "BULK_DELETE_FAILED", { error: err.message, stack: err.stack });
        res.status(500).json({ message: "❌ Failed to delete files. Please try again." });
    }
});
/* ===============================
   SAVE & LOCK MONTH
================================ */
router.post("/save-lock", auth, async (req, res) => {
    try {
        const { year, month } = req.body;
        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const { data: monthData, source: dataSource, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `Cannot lock. Month ${month}/${year} was inactive.` });
        }

        let shouldSendEmail = false;
        if (!monthData.wasLockedOnce) {
            shouldSendEmail = true;
            const sendEmail = require("../utils/sendEmail");
            const html = `<div><h2>New Documents Uploaded</h2><p><strong>Client:</strong> ${client.name}</p><p><strong>Period:</strong> ${month}/${year}</p><p><strong>Action Required:</strong> Please assign an employee.</p></div>`;
            try {
                await sendEmail(process.env.EMAIL_USER, `Client ${client.name} uploaded documents for ${month}/${year}`, html);
            } catch (emailError) { console.error("Email error:", emailError); }
        }

        monthData.isLocked = true;
        monthData.wasLockedOnce = true;
        monthData.lockedAt = new Date();
        monthData.lockedBy = client.clientId;

        ["sales", "purchase", "bank"].forEach(k => {
            if (monthData[k]) {
                monthData[k].isLocked = true;
                monthData[k].wasLockedOnce = true;
            }
        });
        monthData.other?.forEach(o => {
            if (o.document) {
                o.document.isLocked = true;
                o.document.wasLockedOnce = true;
            }
        });

        await saveMonthData(client.clientId, year, month, monthData, dataSource, { client: existingClient, yearKey, monthKey, newDoc });

        await ActivityLog.create({
            userName: client.name, role: "CLIENT", clientId: client.clientId, clientName: client.name,
            action: "CLIENT_MONTH_LOCKED", details: `Locked month ${year}-${month}`, dateTime: new Date(),
            metadata: { year, month }
        });

        res.json({ message: `Month locked${shouldSendEmail ? " - Admin notified" : ""}`, monthData });
    } catch (err) {
        logToConsole("ERROR", "LOCK_FAILED", { error: err.message });
        res.status(500).json({ message: "Failed to lock month" });
    }
});

/* ===============================
   UPLOAD & LOCK CATEGORY
================================ */
router.post("/upload-and-lock", auth, upload.array("files"), async (req, res) => {
    try {
        const { year, month, type, categoryName, note } = req.body;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "❌ No files selected." });
        }

        const MAX_TOTAL_SIZE = 10 * 1024 * 1024;
        const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
        if (totalSize > MAX_TOTAL_SIZE) {
            return res.status(400).json({ message: `❌ Total file size exceeds limit.` });
        }

        const MAX_FILES = 20;
        if (req.files.length > MAX_FILES) {
            return res.status(400).json({ message: `❌ Too many files. Max ${MAX_FILES}.` });
        }

        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "❌ Client not found." });
        }

        const { data: monthData, source: dataSource, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `❌ Cannot upload. Month ${month}/${year} was inactive.` });
        }

        if (type === "other") {
            const o = monthData.other?.find(x => x.categoryName === categoryName);
            if (o?.document?.isLocked) {
                return res.status(403).json({ message: "❌ Category already locked" });
            }
        } else {
            if (monthData[type]?.isLocked) {
                return res.status(403).json({ message: "❌ Category already locked" });
            }
        }

        const uploadedFiles = [];
        for (const file of req.files) {
            const fileExt = file.originalname.split(".").pop();
            const key = `clients/${client.clientId}/${year}/${month}/${uuidv4()}.${fileExt}`;
            await s3.send(new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype
            }));
            uploadedFiles.push({
                url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
                uploadedAt: new Date(), uploadedBy: client.clientId, fileName: file.originalname,
                fileSize: file.size, fileType: file.mimetype, notes: []
            });
        }

        let targetCategory;
        if (type === "other") {
            let otherCategory = monthData.other?.find(x => x.categoryName === categoryName);
            if (otherCategory) {
                otherCategory.document.files.push(...uploadedFiles);
                targetCategory = otherCategory.document;
            } else {
                const newCategory = {
                    categoryName,
                    document: { files: uploadedFiles, categoryNotes: [], isLocked: false, wasLockedOnce: false }
                };
                monthData.other = monthData.other || [];
                monthData.other.push(newCategory);
                targetCategory = newCategory.document;
            }
        } else {
            if (!monthData[type]) {
                monthData[type] = { files: uploadedFiles, categoryNotes: [], isLocked: false, wasLockedOnce: false };
            } else {
                monthData[type].files.push(...uploadedFiles);
            }
            targetCategory = monthData[type];
        }

        if (note) {
            targetCategory.categoryNotes = targetCategory.categoryNotes || [];
            targetCategory.categoryNotes.push({ note, addedBy: client.clientId, addedAt: new Date() });
        }

        targetCategory.isLocked = true;
        targetCategory.wasLockedOnce = true;
        targetCategory.lockedAt = new Date();
        targetCategory.lockedBy = client.clientId;

        await saveMonthData(client.clientId, year, month, monthData, dataSource, { client: existingClient, yearKey, monthKey, newDoc });

        if (note) {
            try {
                await sendNotificationEmails({
                    client, employeeName: client.name, actionType: "UPLOADED & LOCKED WITH NOTE",
                    details: `Uploaded files and locked ${type}${categoryName ? ` (${categoryName})` : ''}`,
                    year, month, fileName: uploadedFiles.map(f => f.fileName).join(', '),
                    categoryType: type, categoryName: categoryName, note
                });
            } catch (emailError) { console.error("Email error:", emailError); }
        }

        try {
            await sendNotificationEmails({
                client, employeeName: client.name, actionType: "CATEGORY LOCKED",
                details: `Locked ${type}${categoryName ? ` (${categoryName})` : ''} category`,
                year, month, fileName: uploadedFiles.map(f => f.fileName).join(', '),
                categoryType: type, categoryName: categoryName, note: note || "Category locked"
            });
        } catch (emailError) { console.error("Email error:", emailError); }

        await ActivityLog.create({
            userName: client.name, role: "CLIENT", clientId: client.clientId, clientName: client.name,
            action: "CLIENT_FILE_UPLOADED_AND_LOCKED",
            details: `Uploaded ${uploadedFiles.length} file(s) and locked ${type}${categoryName ? ` (${categoryName})` : ''}`,
            dateTime: new Date(),
            metadata: { year, month, type, categoryName, filesCount: uploadedFiles.length, totalSize, noteProvided: !!note }
        });

        res.json({ message: `✅ ${req.files.length} file(s) uploaded and locked!`, filesCount: req.files.length, totalSize, monthData });
    } catch (err) {
        logToConsole("ERROR", "UPLOAD_LOCK_FAILED", { error: err.message });
        if (err.message?.includes("Invalid file type")) {
            return res.status(400).json({ message: "❌ Invalid file type." });
        }
        res.status(500).json({ message: "❌ Upload and lock failed." });
    }
});


/* ===============================
   NEW: LOCK CATEGORY ONLY (No Upload)
   ADD THIS NEW ROUTE - DOES NOT AFFECT EXISTING CODE
================================ */
router.post("/lock-category", auth, async (req, res) => {
    try {
        const { year, month, type, categoryName, note } = req.body;

        // Validate required fields
        if (!year || !month || !type) {
            return res.status(400).json({ message: "❌ Year, month, and type are required" });
        }

        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "❌ Client not found" });
        }

        // Get month data using existing helper function
        const { data: monthData, source: dataSource, client: existingClient, yearKey, monthKey, newDoc } =
            await getMonthData(client.clientId, year, month, client);

        // Check if month is inactive
        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({ message: `❌ Cannot lock. Month ${month}/${year} was inactive.` });
        }

        let targetCategory = null;
        let categoryDisplayName = "";

        // Find and lock the appropriate category
        if (type === "other") {
            // Handle "other" category
            if (!categoryName) {
                return res.status(400).json({ message: "❌ Category name required for other categories" });
            }

            const otherCategory = monthData.other?.find(x => x.categoryName === categoryName);
            if (!otherCategory) {
                return res.status(404).json({ message: "❌ Category not found" });
            }

            if (otherCategory.document.isLocked) {
                return res.status(403).json({ message: "❌ Category already locked" });
            }

            targetCategory = otherCategory.document;
            categoryDisplayName = categoryName;

            // Lock the category
            targetCategory.isLocked = true;
            targetCategory.wasLockedOnce = true;
            targetCategory.lockedAt = new Date();
            targetCategory.lockedBy = client.clientId;

            // Add note if provided
            if (note && note.trim()) {
                targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                targetCategory.categoryNotes.push({
                    note: note.trim(),
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }
        } else {
            // Handle main categories: sales, purchase, bank
            if (!monthData[type]) {
                return res.status(404).json({ message: `❌ Category ${type} not found` });
            }

            if (monthData[type].isLocked) {
                return res.status(403).json({ message: "❌ Category already locked" });
            }

            targetCategory = monthData[type];
            categoryDisplayName = type === 'sales' ? 'Sales' : type === 'purchase' ? 'Purchase' : 'Bank';

            // Lock the category
            targetCategory.isLocked = true;
            targetCategory.wasLockedOnce = true;
            targetCategory.lockedAt = new Date();
            targetCategory.lockedBy = client.clientId;

            // Add note if provided
            if (note && note.trim()) {
                targetCategory.categoryNotes = targetCategory.categoryNotes || [];
                targetCategory.categoryNotes.push({
                    note: note.trim(),
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }
        }

        // Save using existing helper function
        await saveMonthData(client.clientId, year, month, monthData, dataSource, {
            client: existingClient,
            yearKey,
            monthKey,
            newDoc
        });

        // Send email notification using existing helper
        try {
            await sendNotificationEmails({
                client,
                employeeName: client.name,
                actionType: "CATEGORY LOCKED",
                details: `Locked ${categoryDisplayName} category ${type === 'other' ? `(${categoryName})` : ''} without uploading new files`,
                year,
                month,
                fileName: "No new files uploaded",
                categoryType: type,
                categoryName: categoryName,
                note: note || "Category locked by client"
            });
        } catch (emailError) {
            console.error("Email notification error:", emailError);
            // Don't fail the request if email fails
        }

        // Log activity using existing model
        await ActivityLog.create({
            userName: client.name,
            role: "CLIENT",
            clientId: client.clientId,
            clientName: client.name,
            action: "CLIENT_CATEGORY_LOCKED",
            details: `Locked ${categoryDisplayName} category ${type === 'other' ? `(${categoryName})` : ''}`,
            dateTime: new Date(),
            metadata: {
                year,
                month,
                type,
                categoryName: categoryName || null,
                noteProvided: !!(note && note.trim()),
                lockedVia: "lock-category-only-route"
            }
        });

        logToConsole("INFO", "CATEGORY_LOCKED_SUCCESS", {
            clientId: client.clientId,
            year,
            month,
            type,
            categoryName,
            noteProvided: !!(note && note.trim())
        });

        res.json({
            success: true,
            message: `✅ ${categoryDisplayName} category locked successfully!`,
            monthData
        });

    } catch (err) {
        logToConsole("ERROR", "LOCK_CATEGORY_FAILED", { error: err.message, stack: err.stack });

        // Handle specific errors
        if (err.message?.includes("not found")) {
            return res.status(404).json({ message: "❌ Category or data not found" });
        }

        res.status(500).json({
            success: false,
            message: "❌ Failed to lock category. Please try again."
        });
    }
});

/* ===============================
   GET DELETED FILES
================================ */
router.get("/deleted-files", auth, async (req, res) => {
    try {
        const { year, month } = req.query;
        const clientId = req.user.clientId;
        const query = { clientId };
        if (year) query.year = parseInt(year);
        if (month) query.month = parseInt(month);
        const deletedFiles = await DeletedFile.find(query).sort({ deletedAt: -1 }).limit(50);
        res.json(deletedFiles);
    } catch (err) {
        console.error("GET_DELETED_FILES_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch deleted files" });
    }
});

/* ===============================
   GET EMPLOYEE ASSIGNMENT INFO
================================ */
router.get("/employee-assignment", auth, async (req, res) => {
    try {
        const { year, month } = req.query;
        const client = await Client.findOne({ clientId: req.user.clientId });
        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }
        const assignments = client.employeeAssignments?.filter(
            a => String(a.year) === String(year) && String(a.month) === String(month) && !a.isRemoved
        );
        if (!assignments || assignments.length === 0) {
            return res.json([]);
        }
        const employeeIds = assignments.map(a => a.employeeId);
        const Employee = require("../models/Employee");
        const employees = await Employee.find({ employeeId: { $in: employeeIds } }, { employeeId: 1, name: 1, phone: 1 });
        const employeeMap = new Map();
        employees.forEach(emp => { employeeMap.set(emp.employeeId, { name: emp.name, phone: emp.phone || "N/A" }); });
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
    res.json({ message: "SUCCESS: clientUpload.js working!", timestamp: new Date().toISOString() });
});

module.exports = router;