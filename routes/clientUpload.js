/**
 * ===============================
 * CLIENT FILE UPLOAD & UPDATE
 * AWS S3 + LOCK RULES
 * ===============================
 *
 * ✔ First upload allowed if month/file unlocked
 * ✔ Update allowed only if unlocked (month or file)
 * ✔ Notes REQUIRED on update (file + month)
 * ✔ Save & Lock locks month + all files
 * ✔ Uses AWS S3 (URL stored in DB)
 *
 * BACKEND ONLY
 */

const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");

const Client = require("../models/Client");
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
   MULTER (MEMORY)
================================ */
const upload = multer({ storage: multer.memoryStorage() });

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
        client.documents.get(y).set(m, {});
    }

    return client.documents.get(y).get(m);
};

/* ===============================
   GET MONTH DATA (NEW ENDPOINT)
================================ */
router.get("/month-data", auth, async (req, res) => {
    try {
        const { year, month } = req.query;

        const client = await Client.findOne({
            clientId: req.user.clientId
        });

        if (!client) {
            return res.status(404).json({ message: "Client not found" });
        }

        const monthData = getMonthData(client, year, month);

        res.json(monthData);
    } catch (err) {
        console.error("GET_MONTH_DATA_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch month data" });
    }
});

/* ===============================
   UPLOAD / UPDATE FILE
================================ */
router.post(
    "/upload",
    auth,
    upload.single("file"),
    async (req, res) => {
        try {
            const {
                year,
                month,
                type, // sales | purchase | bank | other
                categoryName,
                note // REQUIRED on update after unlock
            } = req.body;

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
                        message: "Month or file is locked"
                    });
                }
            }

            // CHECK IF NOTE IS REQUIRED
            // Note is required IF month wasLockedOnce AND this is an update
            const isUpdate = type === "other"
                ? monthData.other?.some(x => x.categoryName === categoryName && x.document?.url)
                : monthData[type]?.url;

            // NOTE LOGIC: Required if (wasLockedOnce AND isUpdate)
            if (monthData.wasLockedOnce && isUpdate && !note) {
                return res.status(400).json({
                    message: "Note is required when updating files after unlock"
                });
            }

            /* ===============================
               S3 UPLOAD
            ================================ */
            const fileExt = req.file.originalname.split(".").pop();
            const key = `clients/${client.clientId}/${year}/${month}/${uuidv4()}.${fileExt}`;

            await s3.send(
                new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET,
                    Key: key,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                })
            );

            const fileData = {
                url: `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
                uploadedAt: new Date(),
                uploadedBy: client.clientId,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                fileType: req.file.mimetype,
                isLocked: false,
                notes: []
            };

            // Add note only if required (after unlock)
            if (monthData.wasLockedOnce && isUpdate && note) {
                fileData.notes.push({
                    note,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });

                // Add to month notes
                monthData.monthNotes = monthData.monthNotes || [];
                monthData.monthNotes.push({
                    note,
                    addedBy: client.clientId,
                    addedAt: new Date()
                });
            }

            if (type === "other") {
                const idx = monthData.other?.findIndex(
                    (x) => x.categoryName === categoryName
                );

                if (idx >= 0 && monthData.other) {
                    monthData.other[idx].document = fileData;
                } else {
                    monthData.other = monthData.other || [];
                    monthData.other.push({
                        categoryName,
                        document: fileData
                    });
                }
            } else {
                monthData[type] = fileData;
            }

            await client.save();

            res.json({
                message: isUpdate ? "File updated" : "File uploaded",
                url: fileData.url,
                monthData: monthData // Return updated data
            });
        } catch (err) {
            console.error("CLIENT_UPLOAD_ERROR:", err.message);
            res.status(500).json({ message: "Upload failed" });
        }
    }
);

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

        // LOCK MONTH
        monthData.isLocked = true;
        monthData.wasLockedOnce = true; // MARK AS WAS LOCKED ONCE
        monthData.lockedAt = new Date();
        monthData.lockedBy = client.clientId;

        // LOCK ALL FILES
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

        res.json({
            message: "Month saved and locked",
            monthData: monthData
        });
    } catch (err) {
        console.error("SAVE_LOCK_ERROR:", err.message);
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

        // Find employee assignment for this specific month
        const assignment = client.employeeAssignments?.find(
            assignment =>
                String(assignment.year) === String(year) &&
                String(assignment.month) === String(month)
        );

        res.json(assignment || null);
    } catch (err) {
        console.error("GET_EMPLOYEE_ASSIGNMENT_ERROR:", err.message);
        res.status(500).json({ message: "Failed to fetch employee assignment" });
    }
});

module.exports = router;