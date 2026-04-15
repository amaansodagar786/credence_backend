const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const auth = require("../middleware/authMiddleware");
const Admin = require("../models/Admin");
const AgreementPdf = require("../models/AgreementPdf");
const ActivityLog = require("../models/ActivityLog");
const Client = require("../models/Client");

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
   MULTER CONFIG - PDF ONLY
================================ */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype === 'application/x-pdf') {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed"), false);
        }
    }
});

/* ===============================
   CONSOLE LOGGING
================================ */
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    console.log(`[${timestamp}] ${type}: ${operation}`, data);
};

/* ===============================
   UPLOAD NEW PDF - EACH GETS NEW UNIQUE ID!
================================ */
router.post("/upload", auth, upload.single("pdf"), async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Only admins can upload" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "❌ No PDF file selected" });
        }

        const { description } = req.body;
        const file = req.file;

        // Get admin details
        const admin = await Admin.findOne({ adminId: req.user.adminId });
        if (!admin) {
            return res.status(404).json({ message: "❌ Admin not found" });
        }

        // Find current active PDF
        const currentActive = await AgreementPdf.findOne({ isActive: true });

        // Calculate new version number
        let newVersion = 1;
        if (currentActive) {
            newVersion = currentActive.version + 1;

            // Mark current as inactive
            currentActive.isActive = false;
            await currentActive.save();
        }

        // ALWAYS CREATE NEW UNIQUE ID for each upload
        const pdfId = uuidv4();

        // Create S3 key
        const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const s3Key = `admin/pdfs/agreements/${pdfId}-v${newVersion}-${sanitizedFileName}`;

        // Upload to S3
        await s3.send(
            new PutObjectCommand({
                Bucket: process.env.AWS_BUCKET,
                Key: s3Key,
                Body: file.buffer,
                ContentType: file.mimetype
            })
        );

        const fileUrl = `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

        // Create NEW document with BRAND NEW ID
        const newPdf = new AgreementPdf({
            pdfId,
            fileName: file.originalname,
            fileUrl,
            fileSize: file.size,
            s3Key,
            version: newVersion,
            uploadedBy: admin.adminId,
            uploadedByName: admin.name,
            uploadedAt: new Date(),
            description: description || "",
            isActive: true
        });

        await newPdf.save();

        // ============================================
        // SET requiresConsentUpdate: true ON ALL ACTIVE CLIENTS
        // So their dashboard shows the consent popup
        // ============================================
        try {
            const updateResult = await Client.updateMany(
                { isActive: true },
                { $set: { requiresConsentUpdate: true } }
            );

            logToConsole("SUCCESS", "CONSENT_UPDATE_FLAG_SET", {
                clientsUpdated: updateResult.modifiedCount,
                pdfVersion: newVersion
            });
        } catch (flagErr) {
            logToConsole("ERROR", "CONSENT_UPDATE_FLAG_FAILED", {
                error: flagErr.message,
                pdfVersion: newVersion
            });
            // Don't fail the upload if this fails
        }

        // Log success
        logToConsole("SUCCESS", "ADMIN_PDF_UPLOADED", {
            pdfId,
            version: newVersion,
            fileName: file.originalname,
            previousVersion: currentActive ? currentActive.version : null
        });

        // Activity Log
        await ActivityLog.create({
            userName: admin.name,
            role: "ADMIN",
            adminId: admin.adminId,
            adminName: admin.name,
            action: currentActive ? "ADMIN_PDF_UPDATED" : "ADMIN_PDF_UPLOADED",
            details: currentActive
                ? `Admin updated PDF: Version ${currentActive.version} → ${newVersion}`
                : `Admin uploaded first PDF: Version 1`,
            dateTime: new Date(),
            metadata: {
                pdfId,
                oldVersion: currentActive ? currentActive.version : null,
                newVersion,
                fileName: file.originalname
            }
        });

        res.status(201).json({
            message: currentActive ? "✅ PDF updated successfully" : "✅ PDF uploaded successfully",
            pdf: {
                pdfId: newPdf.pdfId,
                fileName: newPdf.fileName,
                fileUrl: newPdf.fileUrl,
                fileSize: newPdf.fileSize,
                version: newPdf.version,
                uploadedAt: newPdf.uploadedAt,
                uploadedByName: newPdf.uploadedByName,
                description: newPdf.description
            }
        });

    } catch (err) {
        logToConsole("ERROR", "ADMIN_PDF_UPLOAD_FAILED", { error: err.message });

        if (err.message === "Only PDF files are allowed") {
            return res.status(400).json({ message: "❌ Only PDF files are allowed" });
        }

        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: "❌ File size exceeds 20MB limit" });
        }

        res.status(500).json({ message: "❌ Failed to upload PDF" });
    }
});

/* ===============================
   GET CURRENT ACTIVE PDF
================================ */
router.get("/current", auth, async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Access denied" });
        }

        const currentPdf = await AgreementPdf.findOne({ isActive: true });

        res.json({
            success: true,
            pdf: currentPdf ? {
                pdfId: currentPdf.pdfId,
                fileName: currentPdf.fileName,
                fileUrl: currentPdf.fileUrl,
                fileSize: currentPdf.fileSize,
                version: currentPdf.version,
                uploadedAt: currentPdf.uploadedAt,
                uploadedByName: currentPdf.uploadedByName,
                description: currentPdf.description
            } : null
        });

    } catch (err) {
        logToConsole("ERROR", "GET_CURRENT_PDF_FAILED", { error: err.message });
        res.status(500).json({ message: "❌ Failed to fetch current PDF" });
    }
});

/* ===============================
   GET ALL VERSIONS HISTORY
================================ */
router.get("/history", auth, async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Access denied" });
        }

        // Get all PDFs sorted by uploadedAt (newest first)
        const allPdfs = await AgreementPdf.find()
            .sort({ uploadedAt: -1 })
            .lean();

        // Group by pdfId (but since each has unique ID, each group will have one PDF)
        // This is just for consistency in response structure
        const history = allPdfs.map(pdf => ({
            pdfId: pdf.pdfId,
            versions: [{
                version: pdf.version,
                fileName: pdf.fileName,
                fileUrl: pdf.fileUrl,
                fileSize: pdf.fileSize,
                uploadedAt: pdf.uploadedAt,
                uploadedByName: pdf.uploadedByName,
                description: pdf.description,
                isActive: pdf.isActive
            }]
        }));

        res.json({
            success: true,
            history
        });

    } catch (err) {
        logToConsole("ERROR", "GET_HISTORY_FAILED", { error: err.message });
        res.status(500).json({ message: "❌ Failed to fetch history" });
    }
});

/* ===============================
   DOWNLOAD PDF (FORCES DOWNLOAD)
================================ */
// router.get("/download/:pdfId", auth, async (req, res) => {
//     try {
//         if (req.user.role !== "ADMIN") {
//             return res.status(403).json({ message: "❌ Access denied" });
//         }

//         const { pdfId } = req.params;

//         // Find the PDF by its unique ID
//         const pdf = await AgreementPdf.findOne({ pdfId });

//         if (!pdf) {
//             return res.status(404).json({ message: "❌ PDF not found" });
//         }

//         // Return the S3 URL - frontend will handle download
//         res.json({
//             success: true,
//             fileUrl: pdf.fileUrl,
//             fileName: pdf.fileName,
//             version: pdf.version
//         });

//     } catch (err) {
//         logToConsole("ERROR", "DOWNLOAD_FAILED", { error: err.message });
//         res.status(500).json({ message: "❌ Failed to get download URL" });
//     }
// });


router.get("/download/:pdfId", auth, async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Access denied" });
        }

        const { pdfId } = req.params;

        const pdf = await AgreementPdf.findOne({ pdfId });

        if (!pdf) {
            return res.status(404).json({ message: "❌ PDF not found" });
        }

        // 🔥 FETCH FILE FROM S3 (SERVER SIDE)
        const fileResponse = await fetch(pdf.fileUrl);

        if (!fileResponse.ok) {
            throw new Error("Failed to fetch file from S3");
        }

        const buffer = await fileResponse.arrayBuffer();

        // 🔥 FORCE DOWNLOAD
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdf.fileName || "Agreement.pdf"}"`
        });

        res.send(Buffer.from(buffer));

    } catch (err) {
        logToConsole("ERROR", "DOWNLOAD_FAILED", { error: err.message });
        res.status(500).json({ message: "❌ Failed to download file" });
    }
});



router.get("/public/download-current", async (req, res) => {
    try {
        // Log download attempt
        logToConsole("INFO", "PUBLIC_DOWNLOAD_ATTEMPT", {
            timestamp: new Date().toISOString(),
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection.remoteAddress
        });

        // Check if PDF exists in database
        const pdf = await AgreementPdf.findOne({ isActive: true });

        if (!pdf) {
            logToConsole("ERROR", "PUBLIC_DOWNLOAD_NO_PDF", {
                error: "No active PDF found in database",
                timestamp: new Date().toISOString()
            });
            
            return res.status(404).json({ 
                success: false,
                error: "NO_PDF_FOUND",
                message: "No active agreement PDF is available for download" 
            });
        }

        // Log PDF details found
        logToConsole("INFO", "PUBLIC_DOWNLOAD_PDF_FOUND", {
            pdfId: pdf.pdfId,
            version: pdf.version,
            fileName: pdf.fileName,
            fileSize: pdf.fileSize,
            s3Key: pdf.s3Key
        });

        // Attempt to fetch from S3 with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        let fileResponse;
        try {
            fileResponse = await fetch(pdf.fileUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            
            if (fetchError.name === 'AbortError') {
                logToConsole("ERROR", "PUBLIC_DOWNLOAD_TIMEOUT", {
                    error: "S3 fetch timeout after 30 seconds",
                    pdfId: pdf.pdfId,
                    fileUrl: pdf.fileUrl
                });
                
                return res.status(504).json({
                    success: false,
                    error: "DOWNLOAD_TIMEOUT",
                    message: "Download timed out. Please try again later."
                });
            }
            
            logToConsole("ERROR", "PUBLIC_DOWNLOAD_FETCH_FAILED", {
                error: fetchError.message,
                pdfId: pdf.pdfId,
                fileUrl: pdf.fileUrl
            });
            
            throw fetchError;
        }

        // Check if response is OK
        if (!fileResponse.ok) {
            logToConsole("ERROR", "PUBLIC_DOWNLOAD_S3_ERROR", {
                status: fileResponse.status,
                statusText: fileResponse.statusText,
                pdfId: pdf.pdfId,
                s3Key: pdf.s3Key
            });
            
            return res.status(500).json({
                success: false,
                error: "S3_FETCH_FAILED",
                message: `Failed to fetch file from storage (Status: ${fileResponse.status})`
            });
        }

        // Check content type
        const contentType = fileResponse.headers.get('content-type');
        if (!contentType || !contentType.includes('pdf')) {
            logToConsole("WARNING", "PUBLIC_DOWNLOAD_INVALID_CONTENT_TYPE", {
                contentType: contentType,
                pdfId: pdf.pdfId,
                expected: "application/pdf"
            });
            
            // Still try to send it, but log the warning
        }

        // Get file buffer
        let buffer;
        try {
            buffer = await fileResponse.arrayBuffer();
        } catch (bufferError) {
            logToConsole("ERROR", "PUBLIC_DOWNLOAD_BUFFER_ERROR", {
                error: bufferError.message,
                pdfId: pdf.pdfId
            });
            
            return res.status(500).json({
                success: false,
                error: "BUFFER_CREATION_FAILED",
                message: "Failed to process the file. Please try again."
            });
        }

        // Log success
        logToConsole("SUCCESS", "PUBLIC_DOWNLOAD_SUCCESS", {
            pdfId: pdf.pdfId,
            version: pdf.version,
            fileSize: buffer.byteLength,
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection.remoteAddress
        });

        // Send file with proper headers
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Agreement_v${pdf.version}.pdf"`,
            "Content-Length": buffer.byteLength,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        });

        res.send(Buffer.from(buffer));

    } catch (err) {
        // Comprehensive error logging
        logToConsole("ERROR", "PUBLIC_DOWNLOAD_UNEXPECTED_ERROR", {
            error: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString(),
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection.remoteAddress
        });

        // Send appropriate error response based on error type
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
            return res.status(503).json({
                success: false,
                error: "NETWORK_ERROR",
                message: "Unable to connect to storage service. Please try again later."
            });
        }

        res.status(500).json({
            success: false,
            error: "DOWNLOAD_FAILED",
            message: "An unexpected error occurred while downloading the file. Please try again."
        });
    }
});

/* ===============================
   GET PDF BY VERSION (if needed)
================================ */
router.get("/version/:version", auth, async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Access denied" });
        }

        const { version } = req.params;

        const pdf = await AgreementPdf.findOne({ version: parseInt(version) });

        if (!pdf) {
            return res.status(404).json({ message: "❌ PDF version not found" });
        }

        res.json({
            success: true,
            pdf: {
                pdfId: pdf.pdfId,
                fileName: pdf.fileName,
                fileUrl: pdf.fileUrl,
                fileSize: pdf.fileSize,
                version: pdf.version,
                uploadedAt: pdf.uploadedAt,
                uploadedByName: pdf.uploadedByName,
                description: pdf.description,
                isActive: pdf.isActive
            }
        });

    } catch (err) {
        logToConsole("ERROR", "GET_PDF_BY_VERSION_FAILED", { error: err.message });
        res.status(500).json({ message: "❌ Failed to fetch PDF" });
    }
});

/* ===============================
   GET ALL PDFS (simple list)
================================ */
router.get("/all", auth, async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "❌ Access denied" });
        }

        const allPdfs = await AgreementPdf.find()
            .sort({ uploadedAt: -1 })
            .lean();

        res.json({
            success: true,
            count: allPdfs.length,
            pdfs: allPdfs.map(pdf => ({
                pdfId: pdf.pdfId,
                fileName: pdf.fileName,
                fileUrl: pdf.fileUrl,
                fileSize: pdf.fileSize,
                version: pdf.version,
                uploadedAt: pdf.uploadedAt,
                uploadedByName: pdf.uploadedByName,
                description: pdf.description,
                isActive: pdf.isActive
            }))
        });

    } catch (err) {
        logToConsole("ERROR", "GET_ALL_PDFS_FAILED", { error: err.message });
        res.status(500).json({ message: "❌ Failed to fetch PDFs" });
    }
});


/* ===============================
   PUBLIC - GET ACTIVE PDF (NO AUTH)
================================ */
router.get("/public/current", async (req, res) => {
    try {
        const pdf = await AgreementPdf.findOne({ isActive: true }).lean();

        if (!pdf) {
            return res.status(404).json({
                success: false,
                message: "No active agreement PDF found"
            });
        }

        res.json({
            success: true,
            pdf: {
                fileName: pdf.fileName,
                fileUrl: pdf.fileUrl,
                fileSize: pdf.fileSize,
                version: pdf.version,
                uploadedAt: pdf.uploadedAt
            }
        });

    } catch (err) {
        logToConsole("ERROR", "PUBLIC_GET_ACTIVE_PDF_FAILED", { error: err.message });
        res.status(500).json({
            success: false,
            message: "Failed to fetch agreement PDF"
        });
    }
});

/* ===============================
   TEST ROUTE
================================ */
router.get("/test", (req, res) => {
    res.json({
        message: "✅ Admin PDF routes working!",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;