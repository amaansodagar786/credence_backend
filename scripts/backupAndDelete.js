// scripts/backupAndDelete.js
// Backup & Delete Script for Credence Accounting Portal
// Run: node scripts/backupAndDelete.js
// Dry run: node scripts/backupAndDelete.js --dry-run

require("dotenv").config({ path: "../.env" });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

// ===============================
// CONFIGURATION
// ===============================
const DRY_RUN = process.argv.includes("--dry-run");
const CURRENT_YEAR = new Date().getFullYear();
const TARGET_YEAR = CURRENT_YEAR - 2; // Last to last year

// Generate timestamp for versioning (format: 2026-04-13T10-30-00)
const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
const VERSION_FOLDER = timestamp;  // Just the timestamp

// Backup paths with versioning INSIDE year folder
const BACKUP_ROOT = path.join(__dirname, "..", "backups");
const YEAR_PATH = path.join(BACKUP_ROOT, String(TARGET_YEAR));  // backups/2024/
const VERSION_PATH = path.join(YEAR_PATH, VERSION_FOLDER);      // backups/2024/2026-04-13T10-30-00/
const JSON_PATH = path.join(VERSION_PATH, "json");
const EXCEL_PATH = path.join(VERSION_PATH, "excel");
const LOGS_PATH = path.join(VERSION_PATH, "logs");

// Month names
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Statistics
const stats = {
    targetYear: TARGET_YEAR,
    currentYear: CURRENT_YEAR,
    versionFolder: VERSION_FOLDER,
    dryRun: DRY_RUN,
    startTime: new Date(),
    records: {
        clients: 0,
        clientMonthlyData: 0,
        employees: 0,
        employeeAssignments: 0,
        employeeViewedFiles: 0,
        employeeAuditedFiles: 0,
        activityLogs: 0
    },
    deleted: {
        clients: 0,
        clientMonthlyData: 0,
        employees: 0,
        employeeAssignments: 0,
        employeeViewedFiles: 0,
        employeeAuditedFiles: 0,
        activityLogs: 0
    }
};

// ===============================
// LOGGING
// ===============================
const logFile = path.join(LOGS_PATH, `backup_${TARGET_YEAR}_${timestamp}.log`);

function log(message, type = "INFO") {
    const timestampNow = new Date().toLocaleString("en-IN", { timeZone: "Europe/Helsinki" });
    const logLine = `[${timestampNow}] [${type}] ${message}`;
    console.log(logLine);

    // Write to log file if not dry run
    if (!DRY_RUN) {
        if (!fs.existsSync(LOGS_PATH)) {
            fs.mkdirSync(LOGS_PATH, { recursive: true });
        }
        fs.appendFileSync(logFile, logLine + "\n");
    }
}

// ===============================
// CREATE FOLDERS (with versioning)
// ===============================
function createFolders() {
    log(`Creating backup folders for version: ${VERSION_FOLDER}`);
    log(`Full path: ${VERSION_PATH}`);

    const folders = [BACKUP_ROOT, YEAR_PATH, VERSION_PATH, JSON_PATH, EXCEL_PATH, LOGS_PATH];
    for (const folder of folders) {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
            log(`Created folder: ${folder}`);
        }
    }
}

async function checkIfDataExists() {
    log(`Checking if ${TARGET_YEAR} data exists in database...`);

    try {
        // Quick check for any 2024 data
        const clientMonthlyCount = await ClientMonthlyData.countDocuments({ "months.year": TARGET_YEAR });
        const activityLogCount = await ActivityLog.countDocuments({
            dateTime: {
                $gte: new Date(TARGET_YEAR, 0, 1),
                $lte: new Date(TARGET_YEAR, 11, 31, 23, 59, 59)
            }
        });

        const hasData = clientMonthlyCount > 0 || activityLogCount > 0;

        if (!hasData) {
            log(`⚠️ No ${TARGET_YEAR} data found in database!`, "WARN");
        } else {
            log(`Found ${clientMonthlyCount} months in ClientMonthlyData and ${activityLogCount} activity logs for ${TARGET_YEAR}`);
        }

        return hasData;
    } catch (error) {
        log(`Error checking data existence: ${error.message}`, "ERROR");
        return false;
    }
}

// ===============================
// CONNECT TO MONGODB
// ===============================
async function connectDB() {
    log("Connecting to MongoDB...");

    // const mongoURI = "mongodb://admin:Admin%402025@93.127.167.226:27017/credence?authSource=admin&authMechanism=SCRAM-SHA-256";
    const mongoURI =  "mongodb://admin:Admin%402025@89.116.236.84:27017/credence?authSource=admin&authMechanism=SCRAM-SHA-256";

    await mongoose.connect(mongoURI);
    log("MongoDB connected successfully");
}

// ===============================
// DISCONNECT FROM MONGODB
// ===============================
async function disconnectDB() {
    log("Disconnecting from MongoDB...");
    await mongoose.disconnect();
    log("MongoDB disconnected");
}

// ===============================
// SCHEMA MODELS
// ===============================
const Client = mongoose.model("Client", require("../models/Client").schema);
const ClientMonthlyData = mongoose.model("ClientMonthlyData", require("../models/ClientMonthlyData").schema);
const Employee = mongoose.model("Employee", require("../models/Employee").schema);
const EmployeeAssignment = mongoose.model("EmployeeAssignment", require("../models/EmployeeAssignment").schema);
const EmployeeViewedFile = mongoose.model("EmployeeViewedFile", require("../models/EmployeeViewedFile").schema);
const EmployeeAuditedFile = mongoose.model("EmployeeAuditedFile", require("../models/EmployeeAuditedFile").schema);
const ActivityLog = mongoose.model("ActivityLog", require("../models/ActivityLog").schema);

// ===============================
// 1. BACKUP CLIENT OLD DATA (from Client.documents Map)
// ===============================
async function backupClientOldData() {
    log(`Backing up Client old data for year ${TARGET_YEAR}...`);

    const clients = await Client.find({}).lean();
    const targetData = [];

    for (const client of clients) {
        const clientYearData = {
            clientId: client.clientId,
            name: client.name,
            email: client.email,
            year: TARGET_YEAR,
            months: []
        };

        if (client.documents && typeof client.documents === "object") {
            const yearKey = String(TARGET_YEAR);
            if (client.documents[yearKey]) {
                const yearData = client.documents[yearKey];
                for (const [monthKey, monthData] of Object.entries(yearData)) {
                    clientYearData.months.push({
                        month: parseInt(monthKey),
                        data: monthData
                    });
                    stats.records.clients++;
                }
            }
        }

        if (clientYearData.months.length > 0) {
            targetData.push(clientYearData);
        }
    }

    // Save to JSON
    const jsonPath = path.join(JSON_PATH, `clients_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} clients with ${stats.records.clients} months to JSON`);

    return targetData;
}

// ===============================
// 2. BACKUP CLIENT MONTHLY DATA (new collection)
// ===============================
async function backupClientMonthlyData() {
    log(`Backing up ClientMonthlyData for year ${TARGET_YEAR}...`);

    const allData = await ClientMonthlyData.find({
        "months.year": TARGET_YEAR
    }).lean();

    const targetData = [];
    for (const doc of allData) {
        const filteredMonths = doc.months.filter(m => m.year === TARGET_YEAR);
        if (filteredMonths.length > 0) {
            targetData.push({
                clientId: doc.clientId,
                clientName: doc.clientName,
                clientEmail: doc.clientEmail,
                months: filteredMonths
            });
            stats.records.clientMonthlyData += filteredMonths.length;
        }
    }

    // Save to JSON
    const jsonPath = path.join(JSON_PATH, `client_monthly_data_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} documents with ${stats.records.clientMonthlyData} months to JSON`);

    return targetData;
}

// ===============================
// 3. BACKUP EMPLOYEE OLD DATA
// ===============================
async function backupEmployeeOldData() {
    log(`Backing up Employee old data for year ${TARGET_YEAR}...`);

    const employees = await Employee.find({}).lean();
    const targetData = [];

    for (const emp of employees) {
        const empData = {
            employeeId: emp.employeeId,
            name: emp.name,
            email: emp.email,
            year: TARGET_YEAR,
            assignedClients: [],
            viewedFiles: [],
            auditedFiles: []
        };

        if (emp.assignedClients && Array.isArray(emp.assignedClients)) {
            empData.assignedClients = emp.assignedClients.filter(a => a.year === TARGET_YEAR);
            stats.records.employees += empData.assignedClients.length;
        }

        if (emp.viewedFiles && Array.isArray(emp.viewedFiles)) {
            empData.viewedFiles = emp.viewedFiles.filter(v => v.year === TARGET_YEAR);
        }

        if (emp.auditedFiles && Array.isArray(emp.auditedFiles)) {
            empData.auditedFiles = emp.auditedFiles.filter(a => a.year === TARGET_YEAR);
        }

        if (empData.assignedClients.length > 0 || empData.viewedFiles.length > 0 || empData.auditedFiles.length > 0) {
            targetData.push(empData);
        }
    }

    const jsonPath = path.join(JSON_PATH, `employees_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} employees with ${stats.records.employees} assignments to JSON`);

    return targetData;
}

// ===============================
// 4. BACKUP EMPLOYEE ASSIGNMENT (new collection)
// ===============================
async function backupEmployeeAssignment() {
    log(`Backing up EmployeeAssignment for year ${TARGET_YEAR}...`);

    const allData = await EmployeeAssignment.find({
        "assignedClients.year": TARGET_YEAR
    }).lean();

    const targetData = [];
    for (const doc of allData) {
        const filteredAssignments = doc.assignedClients.filter(a => a.year === TARGET_YEAR);
        if (filteredAssignments.length > 0) {
            targetData.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                employeeEmail: doc.employeeEmail,
                assignedClients: filteredAssignments
            });
            stats.records.employeeAssignments += filteredAssignments.length;
        }
    }

    const jsonPath = path.join(JSON_PATH, `employee_assignments_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} documents with ${stats.records.employeeAssignments} assignments to JSON`);

    return targetData;
}

// ===============================
// 5. BACKUP EMPLOYEE VIEWED FILE (new collection)
// ===============================
async function backupEmployeeViewedFile() {
    log(`Backing up EmployeeViewedFile for year ${TARGET_YEAR}...`);

    const allData = await EmployeeViewedFile.find({
        "viewedFiles.year": TARGET_YEAR
    }).lean();

    const targetData = [];
    for (const doc of allData) {
        const filteredFiles = doc.viewedFiles.filter(f => f.year === TARGET_YEAR);
        if (filteredFiles.length > 0) {
            targetData.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                employeeEmail: doc.employeeEmail,
                viewedFiles: filteredFiles
            });
            stats.records.employeeViewedFiles += filteredFiles.length;
        }
    }

    const jsonPath = path.join(JSON_PATH, `employee_viewed_files_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} documents with ${stats.records.employeeViewedFiles} viewed files to JSON`);

    return targetData;
}

// ===============================
// 6. BACKUP EMPLOYEE AUDITED FILE (new collection)
// ===============================
async function backupEmployeeAuditedFile() {
    log(`Backing up EmployeeAuditedFile for year ${TARGET_YEAR}...`);

    const allData = await EmployeeAuditedFile.find({
        "auditedFiles.year": TARGET_YEAR
    }).lean();

    const targetData = [];
    for (const doc of allData) {
        const filteredFiles = doc.auditedFiles.filter(f => f.year === TARGET_YEAR);
        if (filteredFiles.length > 0) {
            targetData.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                employeeEmail: doc.employeeEmail,
                auditedFiles: filteredFiles
            });
            stats.records.employeeAuditedFiles += filteredFiles.length;
        }
    }

    const jsonPath = path.join(JSON_PATH, `employee_audited_files_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(targetData, null, 2));
    log(`Saved ${targetData.length} documents with ${stats.records.employeeAuditedFiles} audited files to JSON`);

    return targetData;
}

// ===============================
// 7. BACKUP ACTIVITY LOGS (by date range)
// ===============================
async function backupActivityLogs() {
    log(`Backing up ActivityLogs for year ${TARGET_YEAR}...`);

    const startDate = new Date(TARGET_YEAR, 0, 1);
    const endDate = new Date(TARGET_YEAR, 11, 31, 23, 59, 59);

    const logs = await ActivityLog.find({
        dateTime: { $gte: startDate, $lte: endDate }
    }).lean();

    stats.records.activityLogs = logs.length;

    const jsonPath = path.join(JSON_PATH, `activity_logs_${TARGET_YEAR}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(logs, null, 2));
    log(`Saved ${logs.length} activity logs to JSON`);

    return logs;
}

// ===============================
// CREATE EXCEL FILES (SEPARATE TABS - HIERARCHICAL FOR CLIENT DATA)
// ===============================
async function createExcelFiles(clientOldData, clientMonthlyData, employeeOldData, employeeAssignment, employeeViewed, employeeAudited, activityLogs) {
    log(`Creating Excel files for each month of ${TARGET_YEAR}...`);

    const clientNameCache = new Map();
    async function getClientName(clientId) {
        if (clientNameCache.has(clientId)) return clientNameCache.get(clientId);
        const client = await Client.findOne({ clientId }).lean();
        const name = client ? client.name : clientId;
        clientNameCache.set(clientId, name);
        return name;
    }

    const monthlyData = {};
    for (let i = 1; i <= 12; i++) {
        monthlyData[i] = {
            clientOldRows: [],
            clientMonthlyRows: [],
            employeeOldRows: [],
            employeeAssignmentRows: [],
            employeeViewedRows: [],
            employeeAuditedRows: [],
            activityRows: []
        };
    }

    // ============================================================
    // 1. CLIENT OLD DATA (from Client.documents) - HIERARCHICAL
    // ============================================================
    for (const client of clientOldData) {
        for (const month of client.months) {
            const monthData = month.data;
            const monthNum = month.month;

            const addCategoryRows = (categoryName, categoryData, categoryType, rowsArray) => {
                if (!categoryData || !categoryData.files || categoryData.files.length === 0) return;

                const fileCount = categoryData.files.length;
                const isLocked = categoryData.isLocked ? "Yes" : "No";
                const paymentStatus = monthData.paymentStatus ? "Paid" : "Not Paid";
                const accountingDone = monthData.accountingDone ? "Yes" : "No";

                let categoryNotesText = "";
                if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                    const notesList = [];
                    categoryData.categoryNotes.forEach(note => {
                        const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                        const author = note.addedBy || note.employeeId || "Unknown";
                        notesList.push(`[${date}] ${author}: ${note.note}`);
                    });
                    categoryNotesText = notesList.join("; ");
                }

                rowsArray.push({
                    isMainRow: true,
                    clientId: client.clientId,
                    clientName: client.name,
                    clientEmail: client.email,
                    month: monthNum,
                    category: `${categoryType.toUpperCase()} (${fileCount} file${fileCount > 1 ? 's' : ''})`,
                    fileName: "",
                    fileUrl: "",
                    uploadedAt: "",
                    fileNotes: "",
                    isLocked: isLocked,
                    paymentStatus: paymentStatus,
                    accountingDone: accountingDone,
                    categoryNotes: categoryNotesText || "-"
                });

                for (const file of categoryData.files) {
                    let fileNotesText = "";
                    if (file.notes && file.notes.length > 0) {
                        const notesList = [];
                        file.notes.forEach(note => {
                            const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                            const author = note.addedBy || note.employeeId || "Unknown";
                            notesList.push(`[${date}] ${author}: ${note.note}`);
                        });
                        fileNotesText = notesList.join("; ");
                    }

                    rowsArray.push({
                        isMainRow: false,
                        clientId: "",
                        clientName: "",
                        clientEmail: "",
                        month: "",
                        category: `→ ${categoryType}`,
                        fileName: file.fileName,
                        fileUrl: file.url,
                        uploadedAt: file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : "Unknown",
                        fileNotes: fileNotesText || "-",
                        isLocked: "",
                        paymentStatus: "",
                        accountingDone: "",
                        categoryNotes: ""
                    });
                }
            };

            addCategoryRows("Sales", monthData.sales, "Sales", monthlyData[monthNum].clientOldRows);
            addCategoryRows("Purchase", monthData.purchase, "Purchase", monthlyData[monthNum].clientOldRows);
            addCategoryRows("Bank", monthData.bank, "Bank", monthlyData[monthNum].clientOldRows);

            if (monthData.other && monthData.other.length > 0) {
                for (const otherCat of monthData.other) {
                    if (otherCat.document && otherCat.document.files && otherCat.document.files.length > 0) {
                        const fileCount = otherCat.document.files.length;
                        const isLocked = otherCat.document.isLocked ? "Yes" : "No";
                        const paymentStatus = monthData.paymentStatus ? "Paid" : "Not Paid";
                        const accountingDone = monthData.accountingDone ? "Yes" : "No";

                        let categoryNotesText = "";
                        if (otherCat.document.categoryNotes && otherCat.document.categoryNotes.length > 0) {
                            const notesList = [];
                            otherCat.document.categoryNotes.forEach(note => {
                                const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                                const author = note.addedBy || note.employeeId || "Unknown";
                                notesList.push(`[${date}] ${author}: ${note.note}`);
                            });
                            categoryNotesText = notesList.join("; ");
                        }

                        monthlyData[monthNum].clientOldRows.push({
                            isMainRow: true,
                            clientId: client.clientId,
                            clientName: client.name,
                            clientEmail: client.email,
                            month: monthNum,
                            category: `OTHER - ${otherCat.categoryName} (${fileCount} file${fileCount > 1 ? 's' : ''})`,
                            fileName: "",
                            fileUrl: "",
                            uploadedAt: "",
                            fileNotes: "",
                            isLocked: isLocked,
                            paymentStatus: paymentStatus,
                            accountingDone: accountingDone,
                            categoryNotes: categoryNotesText || "-"
                        });

                        for (const file of otherCat.document.files) {
                            let fileNotesText = "";
                            if (file.notes && file.notes.length > 0) {
                                const notesList = [];
                                file.notes.forEach(note => {
                                    const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                                    const author = note.addedBy || note.employeeId || "Unknown";
                                    notesList.push(`[${date}] ${author}: ${note.note}`);
                                });
                                fileNotesText = notesList.join("; ");
                            }

                            monthlyData[monthNum].clientOldRows.push({
                                isMainRow: false,
                                clientId: "",
                                clientName: "",
                                clientEmail: "",
                                month: "",
                                category: `→ ${otherCat.categoryName}`,
                                fileName: file.fileName,
                                fileUrl: file.url,
                                uploadedAt: file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : "Unknown",
                                fileNotes: fileNotesText || "-",
                                isLocked: "",
                                paymentStatus: "",
                                accountingDone: "",
                                categoryNotes: ""
                            });
                        }
                    }
                }
            }
        }
    }

    // ============================================================
    // 2. CLIENT MONTHLY DATA NEW - HIERARCHICAL
    // ============================================================
    for (const doc of clientMonthlyData) {
        for (const month of doc.months) {
            const monthNum = month.month;

            const addCategoryRowsNew = (categoryName, categoryData, categoryType, rowsArray) => {
                if (!categoryData || !categoryData.files || categoryData.files.length === 0) return;

                const fileCount = categoryData.files.length;
                const isLocked = categoryData.isLocked ? "Yes" : "No";
                const paymentStatus = month.paymentStatus ? "Paid" : "Not Paid";
                const accountingDone = month.accountingDone ? "Yes" : "No";

                let categoryNotesText = "";
                if (categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
                    const notesList = [];
                    categoryData.categoryNotes.forEach(note => {
                        const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                        const author = note.addedBy || note.employeeId || "Unknown";
                        notesList.push(`[${date}] ${author}: ${note.note}`);
                    });
                    categoryNotesText = notesList.join("; ");
                }

                rowsArray.push({
                    isMainRow: true,
                    clientId: doc.clientId,
                    clientName: doc.clientName,
                    clientEmail: doc.clientEmail,
                    month: monthNum,
                    category: `${categoryType.toUpperCase()} (${fileCount} file${fileCount > 1 ? 's' : ''})`,
                    fileName: "",
                    fileUrl: "",
                    uploadedAt: "",
                    fileNotes: "",
                    isLocked: isLocked,
                    paymentStatus: paymentStatus,
                    accountingDone: accountingDone,
                    categoryNotes: categoryNotesText || "-"
                });

                for (const file of categoryData.files) {
                    let fileNotesText = "";
                    if (file.notes && file.notes.length > 0) {
                        const notesList = [];
                        file.notes.forEach(note => {
                            const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                            const author = note.addedBy || note.employeeId || "Unknown";
                            notesList.push(`[${date}] ${author}: ${note.note}`);
                        });
                        fileNotesText = notesList.join("; ");
                    }

                    rowsArray.push({
                        isMainRow: false,
                        clientId: "",
                        clientName: "",
                        clientEmail: "",
                        month: "",
                        category: `→ ${categoryType}`,
                        fileName: file.fileName,
                        fileUrl: file.url,
                        uploadedAt: file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : "Unknown",
                        fileNotes: fileNotesText || "-",
                        isLocked: "",
                        paymentStatus: "",
                        accountingDone: "",
                        categoryNotes: ""
                    });
                }
            };

            addCategoryRowsNew("Sales", month.sales, "Sales", monthlyData[monthNum].clientMonthlyRows);
            addCategoryRowsNew("Purchase", month.purchase, "Purchase", monthlyData[monthNum].clientMonthlyRows);
            addCategoryRowsNew("Bank", month.bank, "Bank", monthlyData[monthNum].clientMonthlyRows);

            if (month.other && month.other.length > 0) {
                for (const otherCat of month.other) {
                    if (otherCat.document && otherCat.document.files && otherCat.document.files.length > 0) {
                        const fileCount = otherCat.document.files.length;
                        const isLocked = otherCat.document.isLocked ? "Yes" : "No";
                        const paymentStatus = month.paymentStatus ? "Paid" : "Not Paid";
                        const accountingDone = month.accountingDone ? "Yes" : "No";

                        let categoryNotesText = "";
                        if (otherCat.document.categoryNotes && otherCat.document.categoryNotes.length > 0) {
                            const notesList = [];
                            otherCat.document.categoryNotes.forEach(note => {
                                const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                                const author = note.addedBy || note.employeeId || "Unknown";
                                notesList.push(`[${date}] ${author}: ${note.note}`);
                            });
                            categoryNotesText = notesList.join("; ");
                        }

                        monthlyData[monthNum].clientMonthlyRows.push({
                            isMainRow: true,
                            clientId: doc.clientId,
                            clientName: doc.clientName,
                            clientEmail: doc.clientEmail,
                            month: monthNum,
                            category: `OTHER - ${otherCat.categoryName} (${fileCount} file${fileCount > 1 ? 's' : ''})`,
                            fileName: "",
                            fileUrl: "",
                            uploadedAt: "",
                            fileNotes: "",
                            isLocked: isLocked,
                            paymentStatus: paymentStatus,
                            accountingDone: accountingDone,
                            categoryNotes: categoryNotesText || "-"
                        });

                        for (const file of otherCat.document.files) {
                            let fileNotesText = "";
                            if (file.notes && file.notes.length > 0) {
                                const notesList = [];
                                file.notes.forEach(note => {
                                    const date = note.addedAt ? new Date(note.addedAt).toLocaleDateString() : "Unknown";
                                    const author = note.addedBy || note.employeeId || "Unknown";
                                    notesList.push(`[${date}] ${author}: ${note.note}`);
                                });
                                fileNotesText = notesList.join("; ");
                            }

                            monthlyData[monthNum].clientMonthlyRows.push({
                                isMainRow: false,
                                clientId: "",
                                clientName: "",
                                clientEmail: "",
                                month: "",
                                category: `→ ${otherCat.categoryName}`,
                                fileName: file.fileName,
                                fileUrl: file.url,
                                uploadedAt: file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : "Unknown",
                                fileNotes: fileNotesText || "-",
                                isLocked: "",
                                paymentStatus: "",
                                accountingDone: "",
                                categoryNotes: ""
                            });
                        }
                    }
                }
            }
        }
    }

    // ============================================================
    // 3. EMPLOYEE OLD DATA (Flat)
    // ============================================================
    for (const emp of employeeOldData) {
        for (const assignment of emp.assignedClients) {
            const clientName = await getClientName(assignment.clientId);
            monthlyData[assignment.month].employeeOldRows.push({
                employeeId: emp.employeeId,
                employeeName: emp.name,
                clientId: assignment.clientId,
                clientName: clientName,
                month: assignment.month,
                task: assignment.task,
                accountingDone: assignment.accountingDone ? "Yes" : "No",
                assignedAt: assignment.assignedAt ? new Date(assignment.assignedAt).toLocaleDateString() : "N/A",
                assignedBy: assignment.assignedBy || "N/A"
            });
        }
    }

    // ============================================================
    // 4. EMPLOYEE ASSIGNMENT NEW (Flat)
    // ============================================================
    for (const doc of employeeAssignment) {
        for (const assignment of doc.assignedClients) {
            const clientName = await getClientName(assignment.clientId);
            monthlyData[assignment.month].employeeAssignmentRows.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                clientId: assignment.clientId,
                clientName: clientName,
                month: assignment.month,
                task: assignment.task,
                accountingDone: assignment.accountingDone ? "Yes" : "No",
                assignedAt: assignment.assignedAt ? new Date(assignment.assignedAt).toLocaleDateString() : "N/A",
                assignedBy: assignment.assignedBy || "N/A"
            });
        }
    }

    // ============================================================
    // 5. EMPLOYEE VIEWED FILES NEW (Flat)
    // ============================================================
    for (const doc of employeeViewed) {
        for (const file of doc.viewedFiles) {
            const clientName = await getClientName(file.clientId);
            monthlyData[file.month].employeeViewedRows.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                clientId: file.clientId,
                clientName: clientName,
                month: file.month,
                categoryType: file.categoryType,
                fileName: file.fileName,
                fileUrl: file.fileUrl || "",
                viewedAt: file.viewedAt ? new Date(file.viewedAt).toLocaleDateString() : "N/A"
            });
        }
    }

    // ============================================================
    // 6. EMPLOYEE AUDITED FILES NEW (Flat)
    // ============================================================
    for (const doc of employeeAudited) {
        for (const file of doc.auditedFiles) {
            const clientName = await getClientName(file.clientId);
            monthlyData[file.month].employeeAuditedRows.push({
                employeeId: doc.employeeId,
                employeeName: doc.employeeName,
                clientId: file.clientId,
                clientName: clientName,
                month: file.month,
                categoryType: file.categoryType,
                fileName: file.fileName,
                fileUrl: file.fileUrl || "",
                auditedAt: file.auditedAt ? new Date(file.auditedAt).toLocaleDateString() : "N/A"
            });
        }
    }

    // ============================================================
    // 7. ACTIVITY LOGS (Flat)
    // ============================================================
    for (const log of activityLogs) {
        const logDate = new Date(log.dateTime);
        const month = logDate.getMonth() + 1;
        monthlyData[month].activityRows.push({
            userName: log.userName,
            role: log.role,
            action: log.action,
            details: log.details,
            dateTime: log.dateTime ? new Date(log.dateTime).toLocaleString() : "N/A"
        });
    }

    // ============================================================
    // CREATE EXCEL FILES
    // ============================================================
    for (let month = 1; month <= 12; month++) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Credence Backup System";
        workbook.created = new Date();

        // TAB 1: CLIENT OLD DATA
        const sheet1 = workbook.addWorksheet("Client_OldData");
        sheet1.columns = [
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Client Email", key: "clientEmail", width: 30 },
            { header: "Month", key: "month", width: 10 },
            { header: "Category", key: "category", width: 35 },
            { header: "File Name", key: "fileName", width: 40 },
            { header: "File URL", key: "fileUrl", width: 60 },
            { header: "Uploaded At", key: "uploadedAt", width: 15 },
            { header: "File Notes", key: "fileNotes", width: 50 },
            { header: "Lock Status", key: "isLocked", width: 12 },
            { header: "Payment Status", key: "paymentStatus", width: 12 },
            { header: "Accounting Done", key: "accountingDone", width: 15 },
            { header: "Category Notes", key: "categoryNotes", width: 60 }
        ];

        for (const row of monthlyData[month].clientOldRows) {
            const addedRow = sheet1.addRow(row);
            if (row.isMainRow) {
                addedRow.eachCell(cell => {
                    cell.font = { bold: true };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE0E0E0' }
                    };
                });
            } else {
                if (addedRow.getCell(5)) addedRow.getCell(5).alignment = { indent: 2 };
            }
        }

        // TAB 2: CLIENT MONTHLY DATA NEW
        const sheet2 = workbook.addWorksheet("ClientMonthlyData_New");
        sheet2.columns = [
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Client Email", key: "clientEmail", width: 30 },
            { header: "Month", key: "month", width: 10 },
            { header: "Category", key: "category", width: 35 },
            { header: "File Name", key: "fileName", width: 40 },
            { header: "File URL", key: "fileUrl", width: 60 },
            { header: "Uploaded At", key: "uploadedAt", width: 15 },
            { header: "File Notes", key: "fileNotes", width: 50 },
            { header: "Lock Status", key: "isLocked", width: 12 },
            { header: "Payment Status", key: "paymentStatus", width: 12 },
            { header: "Accounting Done", key: "accountingDone", width: 15 },
            { header: "Category Notes", key: "categoryNotes", width: 60 }
        ];

        for (const row of monthlyData[month].clientMonthlyRows) {
            const addedRow = sheet2.addRow(row);
            if (row.isMainRow) {
                addedRow.eachCell(cell => {
                    cell.font = { bold: true };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE0E0E0' }
                    };
                });
            } else {
                if (addedRow.getCell(5)) addedRow.getCell(5).alignment = { indent: 2 };
            }
        }

        // TAB 3: EMPLOYEE OLD DATA
        const sheet3 = workbook.addWorksheet("Employee_OldData");
        sheet3.columns = [
            { header: "Employee ID", key: "employeeId", width: 20 },
            { header: "Employee Name", key: "employeeName", width: 25 },
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Month", key: "month", width: 10 },
            { header: "Task", key: "task", width: 30 },
            { header: "Accounting Done", key: "accountingDone", width: 15 },
            { header: "Assigned At", key: "assignedAt", width: 15 },
            { header: "Assigned By", key: "assignedBy", width: 20 }
        ];
        monthlyData[month].employeeOldRows.forEach(row => sheet3.addRow(row));

        // TAB 4: EMPLOYEE ASSIGNMENT NEW
        const sheet4 = workbook.addWorksheet("EmployeeAssignment_New");
        sheet4.columns = [
            { header: "Employee ID", key: "employeeId", width: 20 },
            { header: "Employee Name", key: "employeeName", width: 25 },
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Month", key: "month", width: 10 },
            { header: "Task", key: "task", width: 30 },
            { header: "Accounting Done", key: "accountingDone", width: 15 },
            { header: "Assigned At", key: "assignedAt", width: 15 },
            { header: "Assigned By", key: "assignedBy", width: 20 }
        ];
        monthlyData[month].employeeAssignmentRows.forEach(row => sheet4.addRow(row));

        // TAB 5: EMPLOYEE VIEWED FILE NEW
        const sheet5 = workbook.addWorksheet("EmployeeViewedFile_New");
        sheet5.columns = [
            { header: "Employee ID", key: "employeeId", width: 20 },
            { header: "Employee Name", key: "employeeName", width: 25 },
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Month", key: "month", width: 10 },
            { header: "Category Type", key: "categoryType", width: 15 },
            { header: "File Name", key: "fileName", width: 40 },
            { header: "File URL", key: "fileUrl", width: 60 },
            { header: "Viewed At", key: "viewedAt", width: 15 }
        ];
        monthlyData[month].employeeViewedRows.forEach(row => sheet5.addRow(row));

        // TAB 6: EMPLOYEE AUDITED FILE NEW
        const sheet6 = workbook.addWorksheet("EmployeeAuditedFile_New");
        sheet6.columns = [
            { header: "Employee ID", key: "employeeId", width: 20 },
            { header: "Employee Name", key: "employeeName", width: 25 },
            { header: "Client ID", key: "clientId", width: 20 },
            { header: "Client Name", key: "clientName", width: 25 },
            { header: "Month", key: "month", width: 10 },
            { header: "Category Type", key: "categoryType", width: 15 },
            { header: "File Name", key: "fileName", width: 40 },
            { header: "File URL", key: "fileUrl", width: 60 },
            { header: "Audited At", key: "auditedAt", width: 15 }
        ];
        monthlyData[month].employeeAuditedRows.forEach(row => sheet6.addRow(row));

        // TAB 7: ACTIVITY LOGS
        const sheet7 = workbook.addWorksheet("ActivityLog");
        sheet7.columns = [
            { header: "User Name", key: "userName", width: 25 },
            { header: "Role", key: "role", width: 15 },
            { header: "Action", key: "action", width: 35 },
            { header: "Details", key: "details", width: 60 },
            { header: "Date Time", key: "dateTime", width: 25 }
        ];
        monthlyData[month].activityRows.forEach(row => sheet7.addRow(row));

        const excelPath = path.join(EXCEL_PATH, `${MONTH_NAMES[month - 1]}_${TARGET_YEAR}.xlsx`);
        await workbook.xlsx.writeFile(excelPath);
        log(`Created Excel file: ${MONTH_NAMES[month - 1]}_${TARGET_YEAR}.xlsx`);
    }
}

// ===============================
// DELETE DATA FROM DATABASE
// ===============================
async function deleteDataFromDB() {
    if (DRY_RUN) {
        log("DRY RUN MODE: Skipping actual deletion", "WARN");
        return;
    }

    log(`DELETING ${TARGET_YEAR} data from database...`, "WARN");

    // 1. Delete from Client.documents
    log("Deleting from Client.documents...");
    const clients = await Client.find({});
    let deletedClientsCount = 0;
    for (const client of clients) {
        let modified = false;
        if (client.documents && client.documents.has(String(TARGET_YEAR))) {
            client.documents.delete(String(TARGET_YEAR));
            modified = true;
            deletedClientsCount++;
        }
        if (modified) {
            await client.save();
        }
    }
    stats.deleted.clients = deletedClientsCount;
    log(`Deleted ${deletedClientsCount} client year entries`);

    // 2. Delete from ClientMonthlyData
    log("Deleting from ClientMonthlyData...");
    const monthlyDocs = await ClientMonthlyData.find({ "months.year": TARGET_YEAR });
    let deletedMonthsCount = 0;
    for (const doc of monthlyDocs) {
        const originalLength = doc.months.length;
        doc.months = doc.months.filter(m => m.year !== TARGET_YEAR);
        if (doc.months.length !== originalLength) {
            deletedMonthsCount += (originalLength - doc.months.length);
            await doc.save();
        }
    }
    stats.deleted.clientMonthlyData = deletedMonthsCount;
    log(`Deleted ${deletedMonthsCount} months from ClientMonthlyData`);

    // 3. Delete from Employee
    log("Deleting from Employee...");
    const employees = await Employee.find({});
    let deletedAssignmentsCount = 0;
    for (const emp of employees) {
        let modified = false;

        if (emp.assignedClients && emp.assignedClients.length > 0) {
            const originalLength = emp.assignedClients.length;
            emp.assignedClients = emp.assignedClients.filter(a => a.year !== TARGET_YEAR);
            if (emp.assignedClients.length !== originalLength) {
                deletedAssignmentsCount += (originalLength - emp.assignedClients.length);
                modified = true;
            }
        }

        if (emp.viewedFiles && emp.viewedFiles.length > 0) {
            emp.viewedFiles = emp.viewedFiles.filter(v => v.year !== TARGET_YEAR);
            modified = true;
        }

        if (emp.auditedFiles && emp.auditedFiles.length > 0) {
            emp.auditedFiles = emp.auditedFiles.filter(a => a.year !== TARGET_YEAR);
            modified = true;
        }

        if (modified) {
            await emp.save();
        }
    }
    stats.deleted.employees = deletedAssignmentsCount;
    log(`Deleted ${deletedAssignmentsCount} assignments from Employee`);

    // 4. Delete from EmployeeAssignment
    log("Deleting from EmployeeAssignment...");
    const assignDocs = await EmployeeAssignment.find({ "assignedClients.year": TARGET_YEAR });
    let deletedAssignDocsCount = 0;
    for (const doc of assignDocs) {
        const originalLength = doc.assignedClients.length;
        doc.assignedClients = doc.assignedClients.filter(a => a.year !== TARGET_YEAR);
        if (doc.assignedClients.length !== originalLength) {
            deletedAssignDocsCount += (originalLength - doc.assignedClients.length);
            await doc.save();
        }
    }
    stats.deleted.employeeAssignments = deletedAssignDocsCount;
    log(`Deleted ${deletedAssignDocsCount} from EmployeeAssignment`);

    // 5. Delete from EmployeeViewedFile
    log("Deleting from EmployeeViewedFile...");
    const viewedDocs = await EmployeeViewedFile.find({ "viewedFiles.year": TARGET_YEAR });
    let deletedViewedCount = 0;
    for (const doc of viewedDocs) {
        const originalLength = doc.viewedFiles.length;
        doc.viewedFiles = doc.viewedFiles.filter(f => f.year !== TARGET_YEAR);
        if (doc.viewedFiles.length !== originalLength) {
            deletedViewedCount += (originalLength - doc.viewedFiles.length);
            await doc.save();
        }
    }
    stats.deleted.employeeViewedFiles = deletedViewedCount;
    log(`Deleted ${deletedViewedCount} from EmployeeViewedFile`);

    // 6. Delete from EmployeeAuditedFile
    log("Deleting from EmployeeAuditedFile...");
    const auditedDocs = await EmployeeAuditedFile.find({ "auditedFiles.year": TARGET_YEAR });
    let deletedAuditedCount = 0;
    for (const doc of auditedDocs) {
        const originalLength = doc.auditedFiles.length;
        doc.auditedFiles = doc.auditedFiles.filter(f => f.year !== TARGET_YEAR);
        if (doc.auditedFiles.length !== originalLength) {
            deletedAuditedCount += (originalLength - doc.auditedFiles.length);
            await doc.save();
        }
    }
    stats.deleted.employeeAuditedFiles = deletedAuditedCount;
    log(`Deleted ${deletedAuditedCount} from EmployeeAuditedFile`);

    // 7. Delete from ActivityLog
    log("Deleting from ActivityLog...");
    const startDate = new Date(TARGET_YEAR, 0, 1);
    const endDate = new Date(TARGET_YEAR, 11, 31, 23, 59, 59);
    const deleteResult = await ActivityLog.deleteMany({
        dateTime: { $gte: startDate, $lte: endDate }
    });
    stats.deleted.activityLogs = deleteResult.deletedCount;
    log(`Deleted ${deleteResult.deletedCount} activity logs`);

    log("Deletion completed!", "SUCCESS");
}

// ===============================
// CREATE BACKUP INFO FILE
// ===============================
function createBackupInfoFile() {
    const info = {
        backupDate: new Date(),
        targetYear: TARGET_YEAR,
        currentYear: CURRENT_YEAR,
        versionFolder: VERSION_FOLDER,
        dryRun: DRY_RUN,
        status: "success",
        recordsBackedUp: stats.records,
        recordsDeleted: stats.deleted,
        filesCreated: {
            json: 7,
            excel: 12
        },
        backupLocation: {
            root: VERSION_PATH,
            json: JSON_PATH,
            excel: EXCEL_PATH,
            logs: LOGS_PATH
        }
    };

    const infoPath = path.join(VERSION_PATH, "backup_info.json");
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
    log(`Created backup info file: ${infoPath}`);
}

// ===============================
// MAIN FUNCTION (CORRECTED)
// ===============================
async function main() {
    console.log("\n" + "=".repeat(60));
    log(`BACKUP & DELETE SCRIPT STARTED`, "SUCCESS");
    log(`Current Year: ${CURRENT_YEAR}`);
    log(`Target Year: ${TARGET_YEAR} (Last to last year)`);
    log(`Version Folder: ${VERSION_FOLDER}`);
    log(`Dry Run Mode: ${DRY_RUN ? "YES (No actual deletion)" : "NO (Will delete data)"}`);
    console.log("=".repeat(60) + "\n");

    if (DRY_RUN) {
        log("⚠️  DRY RUN MODE - No changes will be made to database", "WARN");
    }

    try {
        // FIRST: Connect to database
        await connectDB();

        // SECOND: Check if data exists
        const hasData = await checkIfDataExists();
        if (!hasData) {
            log(`No ${TARGET_YEAR} data found. Exiting script.`, "WARN");
            return;
        }

        // THIRD: Create folders
        createFolders();

        // FOURTH: Backup all data
        log("\n📦 STEP 1: Backing up data...");
        const clientOld = await backupClientOldData();
        const clientMonthly = await backupClientMonthlyData();
        const employeeOld = await backupEmployeeOldData();
        const employeeAssignment = await backupEmployeeAssignment();
        const employeeViewed = await backupEmployeeViewedFile();
        const employeeAudited = await backupEmployeeAuditedFile();
        const activityLogs = await backupActivityLogs();

        // FIFTH: Create Excel files
        log("\n📊 STEP 2: Creating Excel files...");
        await createExcelFiles(clientOld, clientMonthly, employeeOld, employeeAssignment, employeeViewed, employeeAudited, activityLogs);

        // SIXTH: Delete data from database
        log("\n🗑️  STEP 3: Deleting data from database...");
        await deleteDataFromDB();

        // SEVENTH: Create backup info file
        log("\n📝 STEP 4: Creating backup info file...");
        createBackupInfoFile();

        // Final summary
        console.log("\n" + "=".repeat(60));
        log(`BACKUP & DELETE COMPLETED!`, "SUCCESS");
        log(`Target Year: ${TARGET_YEAR}`);
        log(`Version: ${VERSION_FOLDER}`);
        log(`Records Backed Up: ${Object.values(stats.records).reduce((a, b) => a + b, 0)}`);
        if (!DRY_RUN) {
            log(`Records Deleted: ${Object.values(stats.deleted).reduce((a, b) => a + b, 0)}`);
        }
        log(`Backup Location: ${VERSION_PATH}`);
        console.log("=".repeat(60) + "\n");

    } catch (error) {
        log(`ERROR: ${error.message}`, "ERROR");
        console.error(error.stack);
    } finally {
        await disconnectDB();
    }
}

// Run the script
main();