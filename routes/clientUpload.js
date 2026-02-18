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
   HELPER: GET MONTH DATA - WITH ACTIVE STATUS CALCULATION
================================ */
const getMonthData = (client, year, month) => {
    const y = String(year);
    const m = String(month);

    if (!client.documents.has(y)) {
        client.documents.set(y, new Map());
    }

    if (!client.documents.get(y).has(m)) {
        // ✅ CALCULATE MONTH ACTIVE STATUS BASED ON DEACTIVATION/REACTIVATION DATES
        let monthActiveStatus = 'active';

        // Create date for first day of requested month
        const requestedMonthDate = new Date(parseInt(year), parseInt(month) - 1, 1);

        // Check if client was ever deactivated
        if (client.deactivatedAt) {
            const deactivationDate = new Date(client.deactivatedAt);
            // Create date for first day of deactivation month
            const deactivationMonthStart = new Date(
                deactivationDate.getFullYear(),
                deactivationDate.getMonth(), // getMonth() returns 0-11
                1
            );

            // If requested month is ON or AFTER deactivation month
            if (requestedMonthDate >= deactivationMonthStart) {
                monthActiveStatus = 'inactive';
            }
        }

        // Check if client was reactivated (this overrides deactivation)
        if (client.reactivatedAt && monthActiveStatus === 'inactive') {
            const reactivationDate = new Date(client.reactivatedAt);
            // Create date for first day of reactivation month
            const reactivationMonthStart = new Date(
                reactivationDate.getFullYear(),
                reactivationDate.getMonth(), // getMonth() returns 0-11
                1
            );

            // If requested month is ON or AFTER reactivation month
            if (requestedMonthDate >= reactivationMonthStart) {
                monthActiveStatus = 'active';
            }
        }

        // Create new month data with calculated active status
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
            monthNotes: [],
            accountingDone: false,
            // ✅ CORRECT ACTIVE STATUS BASED ON DATES
            monthActiveStatus: monthActiveStatus,
            lockedAt: null,
            lockedBy: null
        });
    }

    return client.documents.get(y).get(m);
};

/* ===============================
   HELPER: GET ASSIGNED EMPLOYEES FOR MONTH
================================ */
const getAssignedEmployeesForMonth = async (clientId, year, month) => {
    try {
        const client = await Client.findOne({ clientId });
        if (!client || !client.employeeAssignments) return [];

        const assignments = client.employeeAssignments.filter(
            a => a.year === parseInt(year) &&
                a.month === parseInt(month) &&
                !a.isRemoved
        );

        // Get unique employee IDs
        const employeeIds = [...new Set(assignments.map(a => a.employeeId))];

        if (employeeIds.length === 0) return [];

        // Fetch employee details
        const Employee = require("../models/Employee");
        const employees = await Employee.find(
            { employeeId: { $in: employeeIds } },
            { employeeId: 1, name: 1, email: 1 }
        );

        return employees;
    } catch (error) {
        console.error("Error getting assigned employees:", error);
        return [];
    }
};

/* ===============================
   HELPER: SEND EMAIL NOTIFICATIONS
================================ */
const sendNotificationEmails = async ({
    client,
    employeeName,
    actionType,
    details,
    year,
    month,
    fileName,
    categoryType,
    categoryName,
    note
}) => {
    try {
        // Import email utility
        const sendEmail = require("../utils/sendEmail");

        // 1. Get assigned employees for this month
        const assignedEmployees = await getAssignedEmployeesForMonth(
            client.clientId,
            year,
            month
        );

        const emailsSent = {
            employees: [],
            admin: false
        };

        // Common email data
        const emailData = {
            clientName: client.name,
            clientId: client.clientId,
            clientEmail: client.email,
            employeeName: employeeName || 'Client',
            year,
            month,
            actionType,
            details,
            fileName: fileName || 'Multiple files',
            categoryType,
            categoryName: categoryName || categoryType,
            note: note || 'No note provided',
            timestamp: new Date().toLocaleString("en-IN")
        };

        // 2. Send email to each assigned employee
        for (const employee of assignedEmployees) {
            if (employee.email) {
                const employeeSubject = `📝 ${actionType} - ${client.name} (${month}/${year})`;

                const employeeHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #ff9800; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
              .info-box { background-color: #fff3e0; padding: 15px; margin: 15px 0; border-left: 4px solid #ff9800; }
              .details { background-color: #fff; padding: 15px; border: 1px solid #ddd; border-radius: 3px; margin: 10px 0; }
              .note-box { background-color: #f1f8e9; padding: 15px; border-left: 4px solid #8bc34a; margin: 15px 0; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>📋 ${actionType}</h2>
              </div>
              <div class="content">
                <div class="info-box">
                  <p><strong>Hello ${employee.name},</strong></p>
                  <p>Your assigned client has performed an action that requires your attention.</p>
                </div>
                
                <div class="details">
                  <h3>🔍 Details</h3>
                  <p><strong>Client:</strong> ${client.name} (${client.clientId})</p>
                  <p><strong>Client Email:</strong> ${client.email || 'Not provided'}</p>
                  <p><strong>Period:</strong> ${month}/${year}</p>
                  <p><strong>Action:</strong> ${details}</p>
                  <p><strong>File:</strong> ${emailData.fileName}</p>
                  <p><strong>Category:</strong> ${emailData.categoryName}</p>
                  <p><strong>Performed by:</strong> ${emailData.employeeName}</p>
                  <p><strong>Time:</strong> ${emailData.timestamp}</p>
                </div>
                
                ${note ? `
                <div class="note-box">
                  <h4>📝 Note from Client:</h4>
                  <p>"${note}"</p>
                </div>
                ` : ''}
                
                <p><strong>Action Required:</strong> Please log in to review the changes and take necessary action if required.</p>
                
                <div class="footer">
                  <p>This is an automated notification from Accounting Portal.</p>
                  <p>Client ID: ${client.clientId} | Employee ID: ${employee.employeeId}</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;

                await sendEmail(employee.email, employeeSubject, employeeHtml);
                emailsSent.employees.push(employee.email);
            }
        }

        // 3. Send email to admin
        const adminEmail = process.env.EMAIL_USER;
        if (adminEmail) {
            const adminSubject = `🔔 ${actionType} - Client ${client.name} (${month}/${year})`;

            const adminHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #2196f3; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
            .alert { background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 3px; margin: 10px 0; }
            .details { background-color: #e3f2fd; padding: 15px; border-radius: 3px; margin: 10px 0; }
            .note-box { background-color: #fff; border-left: 4px solid #2196f3; padding: 15px; margin: 15px 0; }
            .employee-list { background-color: #f5f5f5; padding: 10px; border-radius: 3px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🔔 ${actionType} Notification</h2>
            </div>
            <div class="content">
              <div class="alert">
                <strong>Notification:</strong> Client has performed an action on their documents.
              </div>
              
              <div class="details">
                <h3>Client Information</h3>
                <p><strong>Client:</strong> ${client.name} (${client.clientId})</p>
                <p><strong>Client Email:</strong> ${client.email || 'Not provided'}</p>
                <p><strong>Business:</strong> ${client.businessName || 'N/A'}</p>
                <p><strong>Period:</strong> ${month}/${year}</p>
                <p><strong>Action:</strong> ${details}</p>
                <p><strong>File:</strong> ${emailData.fileName}</p>
                <p><strong>Category:</strong> ${emailData.categoryName}</p>
                <p><strong>Performed by:</strong> ${emailData.employeeName}</p>
                <p><strong>Time:</strong> ${emailData.timestamp}</p>
              </div>
              
              ${assignedEmployees.length > 0 ? `
              <div class="employee-list">
                <h4>📋 Assigned Employees Notified:</h4>
                <ul>
                  ${assignedEmployees.map(emp => `<li>${emp.name} (${emp.email})</li>`).join('')}
                </ul>
              </div>
              ` : '<p><strong>⚠️ No employees assigned for this month.</strong></p>'}
              
              ${note ? `
              <div class="note-box">
                <h4>📝 Client Note:</h4>
                <p>"${note}"</p>
              </div>
              ` : ''}
              
              <div class="footer">
                <p>This is an automated notification from Accounting Portal System.</p>
                <p>Total employees notified: ${assignedEmployees.length}</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

            await sendEmail(adminEmail, adminSubject, adminHtml);
            emailsSent.admin = true;
        }

        return emailsSent;

    } catch (emailError) {
        console.error("Email sending failed:", emailError);
        return { employees: [], admin: false, error: emailError.message };
    }
};




/* ===============================
   UPLOAD / UPDATE FILES (MULTIPLE) - UPDATED WITH ACTIVE MONTH CHECK
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

            // ✅ NEW: CHECK IF MONTH IS ACTIVE FOR THIS CLIENT
            if (monthData.monthActiveStatus === 'inactive') {
                return res.status(403).json({
                    message: `Cannot upload files for ${month}/${year} - Client was inactive during this period`
                });
            }

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
            }

            await client.save();

            // LOG SUCCESS
            logToConsole("SUCCESS", "CLIENT_FILE_UPLOAD_COMPLETE", {
                clientId: client.clientId,
                uploadedFilesCount: uploadedFiles.length
            });

            // ============================================
            // SEND EMAIL NOTIFICATIONS FOR NOTE ADDITION
            // ============================================
            if (monthData.wasLockedOnce && isUpdate && note) {
                try {
                    const emailsSent = await sendNotificationEmails({
                        client,
                        employeeName: client.name,
                        actionType: "CLIENT ADDED NOTE",
                        details: `Client added note while uploading/updating files in ${type}${categoryName ? ` (${categoryName})` : ''}`,
                        year,
                        month,
                        fileName: uploadedFiles.map(f => f.fileName).join(', '),
                        categoryType: type,
                        categoryName: categoryName,
                        note
                    });

                    logToConsole("INFO", "NOTIFICATION_EMAILS_SENT", {
                        clientId: client.clientId,
                        employeesNotified: emailsSent.employees.length,
                        adminNotified: emailsSent.admin,
                        action: "UPLOAD_WITH_NOTE"
                    });
                } catch (emailError) {
                    logToConsole("ERROR", "NOTIFICATION_EMAILS_FAILED", {
                        error: emailError.message,
                        clientId: client.clientId
                    });
                }
            }

            // ===== ACTIVITY LOG: FILE UPLOAD =====
            try {
                await ActivityLog.create({
                    userName: client.name,
                    role: "CLIENT",
                    clientId: client.clientId,
                    clientName: client.name,
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
   GET MONTH DATA - UPDATED TO INCLUDE ACTIVE STATUS
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
   DELETE SINGLE FILE - UPDATED WITH ACTIVE MONTH CHECK
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

        // ✅ NEW: CHECK IF MONTH IS ACTIVE FOR THIS CLIENT
        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({
                message: `Cannot delete files for ${month}/${year} - Client was inactive during this period`
            });
        }

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

        await client.save();

        // LOG SUCCESS
        logToConsole("SUCCESS", "CLIENT_FILE_DELETE_COMPLETE", {
            clientId: client.clientId,
            fileName
        });

        // ============================================
        // SEND EMAIL NOTIFICATIONS FOR FILE DELETE
        // ============================================
        try {
            const emailsSent = await sendNotificationEmails({
                client,
                employeeName: client.name,
                actionType: "FILE DELETED",
                details: `Client deleted file "${fileName}" from ${type}${categoryName ? ` (${categoryName})` : ''}`,
                year,
                month,
                fileName,
                categoryType: type,
                categoryName: categoryName,
                note: `File deleted: ${fileName}. Reason: ${deleteNote || "No reason provided"}`
            });

            logToConsole("INFO", "NOTIFICATION_EMAILS_SENT", {
                clientId: client.clientId,
                employeesNotified: emailsSent.employees.length,
                adminNotified: emailsSent.admin,
                action: "FILE_DELETE"
            });
        } catch (emailError) {
            logToConsole("ERROR", "NOTIFICATION_EMAILS_FAILED", {
                error: emailError.message,
                clientId: client.clientId
            });
        }

        // ===== ACTIVITY LOG: FILE DELETE =====
        try {
            await ActivityLog.create({
                userName: client.name,
                role: "CLIENT",
                clientId: client.clientId,
                clientName: client.name,
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
   SAVE & LOCK MONTH - UPDATED WITH ACTIVE MONTH CHECK
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

        // ✅ NEW: CHECK IF MONTH IS ACTIVE FOR THIS CLIENT
        if (monthData.monthActiveStatus === 'inactive') {
            return res.status(403).json({
                message: `Cannot lock month ${month}/${year} - Client was inactive during this period`
            });
        }

        // LOG LOCK REQUEST
        logToConsole("INFO", "CLIENT_MONTH_LOCK_REQUEST", {
            clientId: client.clientId,
            year,
            month,
            isFirstLock: !monthData.wasLockedOnce
        });

        // CHECK IF FIRST TIME LOCK - Send email notification
        let shouldSendEmail = false;
        if (!monthData.wasLockedOnce) {
            shouldSendEmail = true;

            // IMPORT EMAIL UTILITY
            const sendEmail = require("../utils/sendEmail");

            // EMAIL CONTENT FOR ADMIN
            const subject = `Client ${client.name} has uploaded documents for ${month}/${year}`;
            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>New Documents Uploaded</h2>
                    <p><strong>Client:</strong> ${client.name} (${client.clientId})</p>
                    <p><strong>Client Email:</strong> ${client.email || "N/A"}</p>
                    <p><strong>Client Phone:</strong> ${client.phone || "N/A"}</p>
                    <p><strong>Period:</strong> ${month}/${year}</p>
                    <p><strong>Business Name:</strong> ${client.businessName || "N/A"}</p>
                    <p><strong>VAT Period:</strong> ${client.vatPeriod || "N/A"}</p>
                    <hr>
                    <p><strong>Action Required:</strong> Please assign an employee to this client for processing.</p>
                    <p>Login to the admin portal to assign an employee.</p>
                    <br>
                    <p>This is an automated notification.</p>
                </div>
            `;

            try {
                // Send email to admin
                await sendEmail(
                    process.env.EMAIL_USER, // Admin email
                    subject,
                    html
                );

                logToConsole("INFO", "ADMIN_NOTIFICATION_EMAIL_SENT", {
                    clientId: client.clientId,
                    adminEmail: process.env.EMAIL_USER,
                    year,
                    month
                });
            } catch (emailError) {
                logToConsole("ERROR", "ADMIN_NOTIFICATION_EMAIL_FAILED", {
                    clientId: client.clientId,
                    error: emailError.message
                });
                // Don't fail the lock operation if email fails
            }
        }

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
            month,
            emailSent: shouldSendEmail
        });

        // ===== ACTIVITY LOG: MONTH LOCK =====
        try {
            await ActivityLog.create({
                userName: client.name,
                role: "CLIENT",
                clientId: client.clientId,
                clientName: client.name,
                adminId: req.user.role === "ADMIN" ? req.user.adminId : null,
                adminName: req.user.role === "ADMIN" ? req.user.name : null,
                action: "CLIENT_MONTH_LOCKED",
                details: `${req.user.role === "ADMIN" ? "Admin locked" : "Client locked"} month ${year}-${month}.${shouldSendEmail ? " (First time lock - Admin notified)" : ""}`,
                dateTime: new Date(),
                metadata: {
                    year,
                    month,
                    lockedAt: new Date(),
                    performedBy: req.user.role === "ADMIN" ? "ADMIN" : "CLIENT",
                    firstTimeLock: shouldSendEmail,
                    adminEmailSent: shouldSendEmail
                }
            });
        } catch (logError) {
            logToConsole("ERROR", "ACTIVITY_LOG_FAILED_MONTH_LOCK", {
                error: logError.message
            });
        }

        res.json({
            message: `Month saved and locked${shouldSendEmail ? " - Admin has been notified" : ""}`,
            monthData: monthData,
            firstTimeLock: shouldSendEmail
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
   UPLOAD & LOCK CATEGORY - UPDATED WITH ACTIVE MONTH CHECK
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

            // ✅ NEW: CHECK IF MONTH IS ACTIVE FOR THIS CLIENT
            if (monthData.monthActiveStatus === 'inactive') {
                return res.status(403).json({
                    message: `Cannot upload files for ${month}/${year} - Client was inactive during this period`
                });
            }

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

            // ============================================
            // SEND EMAIL NOTIFICATIONS FOR UPLOAD AND LOCK
            // ============================================
            if (note) {
                try {
                    const emailsSent = await sendNotificationEmails({
                        client,
                        employeeName: client.name,
                        actionType: "UPLOADED & LOCKED WITH NOTE",
                        details: `Client uploaded files and locked ${type}${categoryName ? ` (${categoryName})` : ''}`,
                        year,
                        month,
                        fileName: uploadedFiles.map(f => f.fileName).join(', '),
                        categoryType: type,
                        categoryName: categoryName,
                        note
                    });

                    logToConsole("INFO", "NOTIFICATION_EMAILS_SENT", {
                        clientId: client.clientId,
                        employeesNotified: emailsSent.employees.length,
                        adminNotified: emailsSent.admin,
                        action: "UPLOAD_AND_LOCK_WITH_NOTE"
                    });
                } catch (emailError) {
                    logToConsole("ERROR", "NOTIFICATION_EMAILS_FAILED", {
                        error: emailError.message,
                        clientId: client.clientId
                    });
                }
            }

            // ALSO SEND NOTIFICATION FOR LOCK ACTION (even without note)
            try {
                const emailsSent = await sendNotificationEmails({
                    client,
                    employeeName: client.name,
                    actionType: "CATEGORY LOCKED",
                    details: `Client locked ${type}${categoryName ? ` (${categoryName})` : ''} category`,
                    year,
                    month,
                    fileName: uploadedFiles.map(f => f.fileName).join(', '),
                    categoryType: type,
                    categoryName: categoryName,
                    note: note || "Category locked by client"
                });

                logToConsole("INFO", "LOCK_NOTIFICATION_EMAILS_SENT", {
                    clientId: client.clientId,
                    employeesNotified: emailsSent.employees.length,
                    adminNotified: emailsSent.admin,
                    action: "CATEGORY_LOCK"
                });
            } catch (emailError) {
                logToConsole("ERROR", "LOCK_NOTIFICATION_EMAILS_FAILED", {
                    error: emailError.message,
                    clientId: client.clientId
                });
            }

            // ===== ACTIVITY LOG: UPLOAD AND LOCK =====
            try {
                await ActivityLog.create({
                    userName: client.name,
                    role: "CLIENT",
                    clientId: client.clientId,
                    clientName: client.name,
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