const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Client = require("../models/Client");
const ClientMonthlyData = require("../models/ClientMonthlyData");

// Console logging utility
const logToConsole = (type, operation, data) => {
    const timestamp = new Date().toLocaleString("en-IN");
    const colors = {
        INFO: '\x1b[36m',
        SUCCESS: '\x1b[32m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        DEBUG: '\x1b[35m',
        RESET: '\x1b[0m'
    };
    const color = colors[type] || colors.RESET;
    console.log(`${color}[${timestamp}] ${type}: ${operation}${colors.RESET}`, data);
    return { timestamp, type, operation, data };
};

// Helper function to generate unique ID for notes
const generateNoteId = () => {
    return new mongoose.Types.ObjectId().toString();
};

// Helper to process month data (works for both OLD and NEW structure)
const processMonthData = (monthData, year, month, clientId, clientName, notes, addNoteFn) => {
    if (!monthData || typeof monthData !== 'object') return;

    // 1. Month-level notes
    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
        monthData.monthNotes.forEach(note => {
            addNoteFn(note, {
                contextType: 'month',
                year,
                month,
                noteLevel: 'month'
            }, clientId, clientName, notes);
        });
    }

    // 2. Process main categories: sales, purchase, bank
    ['sales', 'purchase', 'bank'].forEach(categoryType => {
        if (monthData[categoryType] && typeof monthData[categoryType] === 'object') {
            const category = monthData[categoryType];

            // Category-level notes
            if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
                category.categoryNotes.forEach(note => {
                    addNoteFn(note, {
                        contextType: 'category',
                        year,
                        month,
                        categoryType,
                        noteLevel: 'category'
                    }, clientId, clientName, notes);
                });
            }

            // File-level notes
            if (category.files && Array.isArray(category.files)) {
                category.files.forEach(file => {
                    if (file && file.notes && Array.isArray(file.notes)) {
                        file.notes.forEach(note => {
                            addNoteFn(note, {
                                contextType: 'file',
                                year,
                                month,
                                categoryType,
                                fileName: file.fileName,
                                fileUrl: file.url,
                                noteLevel: 'file'
                            }, clientId, clientName, notes);
                        });
                    }
                });
            }
        }
    });

    // 3. Process other categories
    if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCategory => {
            if (otherCategory && otherCategory.document && typeof otherCategory.document === 'object') {
                const categoryType = 'other';
                const categoryName = otherCategory.categoryName;

                // Other category-level notes
                if (otherCategory.document.categoryNotes && Array.isArray(otherCategory.document.categoryNotes)) {
                    otherCategory.document.categoryNotes.forEach(note => {
                        addNoteFn(note, {
                            contextType: 'category',
                            year,
                            month,
                            categoryType,
                            categoryName,
                            noteLevel: 'category'
                        }, clientId, clientName, notes);
                    });
                }

                // Other category file-level notes
                if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                    otherCategory.document.files.forEach(file => {
                        if (file && file.notes && Array.isArray(file.notes)) {
                            file.notes.forEach(note => {
                                addNoteFn(note, {
                                    contextType: 'file',
                                    year,
                                    month,
                                    categoryType,
                                    categoryName,
                                    fileName: file.fileName,
                                    fileUrl: file.url,
                                    noteLevel: 'file'
                                }, clientId, clientName, notes);
                            });
                        }
                    });
                }
            }
        });
    }
};

// UPDATED: Helper function to extract all notes from client with metadata - CHECKS BOTH COLLECTIONS
const extractNotesFromClient = async (client) => {
    const notes = [];
    const clientId = client.clientId;
    const clientName = client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client';

    // Helper to add note with context
    const addNote = (noteObj, context, clientId, clientName, notesArray) => {
        if (!noteObj || !noteObj.note) return;

        const noteId = noteObj._id || generateNoteId();
        const isViewedByAdmin = noteObj.isViewedByAdmin || false;

        notesArray.push({
            noteId,
            note: noteObj.note,
            addedBy: noteObj.addedBy || 'Unknown',
            addedAt: noteObj.addedAt || new Date(),
            employeeId: noteObj.employeeId,
            employeeName: noteObj.employeeName,

            isViewedByAdmin,
            isViewedByClient: noteObj.isViewedByClient || false,
            isViewedByEmployee: noteObj.isViewedByEmployee || false,
            viewedBy: noteObj.viewedBy || [],

            clientId,
            clientName,
            contextType: context.contextType,
            year: context.year,
            month: context.month,
            categoryType: context.categoryType,
            categoryName: context.categoryName,
            fileName: context.fileName,
            fileUrl: context.fileUrl,
            noteLevel: context.noteLevel
        });
    };

    // ===== 1. FIRST: Check NEW ClientMonthlyData collection =====
    try {
        const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });
        if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
            for (const monthData of newDoc.months) {
                processMonthData(monthData, monthData.year, monthData.month, clientId, clientName, notes, addNote);
            }
            console.log(`✅ Admin - Extracted notes from NEW collection for client ${clientId}: ${notes.length}`);
        }
    } catch (error) {
        console.error('❌ Error extracting notes from NEW collection:', error);
        logToConsole("ERROR", "EXTRACT_NOTES_NEW_COLLECTION_ERROR", {
            clientId: client.clientId,
            error: error.message
        });
    }

    // ===== 2. SECOND: Check OLD client.documents =====
    if (!client.documents) {
        console.log(`📄 No old documents for client ${clientId}`);
        return notes;
    }

    try {
        let documentsObj = {};

        if (client.documents instanceof Map) {
            for (const [yearKey, yearMap] of client.documents.entries()) {
                if (yearMap instanceof Map) {
                    const monthObj = {};
                    for (const [monthKey, monthData] of yearMap.entries()) {
                        monthObj[monthKey] = monthData;
                    }
                    documentsObj[yearKey] = monthObj;
                } else {
                    documentsObj[yearKey] = yearMap;
                }
            }
        } else if (typeof client.documents === 'object') {
            documentsObj = client.documents;
        } else {
            console.log(`❌ Client ${clientId} has invalid documents type:`, typeof client.documents);
            return notes;
        }

        for (const yearKey in documentsObj) {
            const year = parseInt(yearKey);
            const yearData = documentsObj[yearKey];
            if (!yearData || typeof yearData !== 'object') continue;

            for (const monthKey in yearData) {
                const month = parseInt(monthKey);
                const monthData = yearData[monthKey];
                if (!monthData || typeof monthData !== 'object') continue;

                processMonthData(monthData, year, month, clientId, clientName, notes, addNote);
            }
        }

        console.log(`✅ Admin - Extracted notes from OLD collection for client ${clientId}: Total now ${notes.length}`);

    } catch (error) {
        console.error('❌ Error extracting notes from OLD documents:', error);
        logToConsole("ERROR", "EXTRACT_NOTES_OLD_DOCUMENTS_ERROR", {
            clientId: client.clientId,
            error: error.message
        });
    }

    return notes;
};

// UPDATED: Helper to mark notes in BOTH collections
const markNotesInBothCollections = async (clientId, adminId, notesToMarkArray) => {
    let markedCount = 0;

    // Helper to mark notes in a month data object
    const markNotesInMonthData = (monthData, year, month, notesToMarkArray, adminId) => {
        if (!monthData || typeof monthData !== 'object') return 0;
        let count = 0;

        const markNote = (note, noteIndex, noteArray, context) => {
            const matchingNote = notesToMarkArray.find(unreadNote =>
                unreadNote.note === note.note &&
                unreadNote.addedBy === note.addedBy &&
                new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                year === unreadNote.year &&
                month === unreadNote.month &&
                unreadNote.noteLevel === context.noteLevel &&
                (context.categoryType ? unreadNote.categoryType === context.categoryType : true) &&
                (context.categoryName ? unreadNote.categoryName === context.categoryName : true) &&
                (context.fileName ? unreadNote.fileName === context.fileName : true)
            );

            if (matchingNote && !note.isViewedByAdmin) {
                noteArray[noteIndex].isViewedByAdmin = true;
                if (!noteArray[noteIndex].viewedBy) {
                    noteArray[noteIndex].viewedBy = [];
                }
                const alreadyViewed = noteArray[noteIndex].viewedBy.some(
                    v => v.userId === adminId && v.userType === 'admin'
                );
                if (!alreadyViewed) {
                    noteArray[noteIndex].viewedBy.push({
                        userId: adminId,
                        userType: 'admin',
                        viewedAt: new Date()
                    });
                }
                count++;
            }
        };

        // Month-level notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
            monthData.monthNotes.forEach((note, index) => {
                markNote(note, index, monthData.monthNotes, { noteLevel: 'month' });
            });
        }

        // Main categories
        ['sales', 'purchase', 'bank'].forEach(categoryType => {
            if (monthData[categoryType] && typeof monthData[categoryType] === 'object') {
                const category = monthData[categoryType];

                if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
                    category.categoryNotes.forEach((note, index) => {
                        markNote(note, index, category.categoryNotes, { noteLevel: 'category', categoryType });
                    });
                }

                if (category.files && Array.isArray(category.files)) {
                    category.files.forEach(file => {
                        if (file && file.notes && Array.isArray(file.notes)) {
                            file.notes.forEach((note, index) => {
                                markNote(note, index, file.notes, { noteLevel: 'file', categoryType, fileName: file.fileName });
                            });
                        }
                    });
                }
            }
        });

        // Other categories
        if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCategory => {
                if (otherCategory && otherCategory.document && typeof otherCategory.document === 'object') {
                    const categoryName = otherCategory.categoryName;

                    if (otherCategory.document.categoryNotes && Array.isArray(otherCategory.document.categoryNotes)) {
                        otherCategory.document.categoryNotes.forEach((note, index) => {
                            markNote(note, index, otherCategory.document.categoryNotes, { noteLevel: 'category', categoryType: 'other', categoryName });
                        });
                    }

                    if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                        otherCategory.document.files.forEach(file => {
                            if (file && file.notes && Array.isArray(file.notes)) {
                                file.notes.forEach((note, index) => {
                                    markNote(note, index, file.notes, { noteLevel: 'file', categoryType: 'other', categoryName, fileName: file.fileName });
                                });
                            }
                        });
                    }
                }
            });
        }

        return count;
    };

    // ===== 1. Mark in NEW collection =====
    try {
        const newDoc = await ClientMonthlyData.findOne({ clientId });
        if (newDoc && newDoc.months) {
            let newDocModified = false;
            for (let i = 0; i < newDoc.months.length; i++) {
                const monthData = newDoc.months[i];
                const count = markNotesInMonthData(monthData, monthData.year, monthData.month, notesToMarkArray, adminId);
                if (count > 0) {
                    markedCount += count;
                    newDocModified = true;
                }
            }
            if (newDocModified) {
                await newDoc.save();
                console.log(`✅ Updated notes in NEW collection for client ${clientId}`);
            }
        }
    } catch (error) {
        console.error('Error marking notes in NEW collection:', error);
    }

    // ===== 2. Mark in OLD collection =====
    try {
        const client = await Client.findOne({ clientId });
        if (client && client.documents) {
            let clientModified = false;
            let documentsObj = {};

            if (client.documents instanceof Map) {
                for (const [yearKey, yearMap] of client.documents.entries()) {
                    if (yearMap instanceof Map) {
                        const monthObj = {};
                        for (const [monthKey, monthData] of yearMap.entries()) {
                            monthObj[monthKey] = monthData;
                        }
                        documentsObj[yearKey] = monthObj;
                    } else {
                        documentsObj[yearKey] = yearMap;
                    }
                }
            } else if (typeof client.documents === 'object') {
                documentsObj = client.documents;
            }

            for (const yearKey in documentsObj) {
                const year = parseInt(yearKey);
                const yearData = documentsObj[yearKey];
                if (!yearData || typeof yearData !== 'object') continue;

                for (const monthKey in yearData) {
                    const month = parseInt(monthKey);
                    const monthData = yearData[monthKey];
                    if (monthData && typeof monthData === 'object') {
                        const count = markNotesInMonthData(monthData, year, month, notesToMarkArray, adminId);
                        if (count > 0) {
                            markedCount += count;
                            clientModified = true;
                        }
                    }
                }
            }

            if (clientModified) {
                client.markModified('documents');
                await client.save();
                console.log(`✅ Updated notes in OLD collection for client ${clientId}`);
            }
        }
    } catch (error) {
        console.error('Error marking notes in OLD collection:', error);
    }

    return markedCount;
};

/* ===============================
   GET UNREAD NOTES COUNT FOR ADMIN - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/unread-count", async (req, res) => {
    try {
        logToConsole("INFO", "GET_UNREAD_NOTES_COUNT_REQUEST_OPTIMIZED", {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // ===== STEP 1: Get all active clients in ONE query =====
        const allClients = await Client.find({ isActive: true }).select("clientId name email phone firstName lastName createdAt").lean();

        if (allClients.length === 0) {
            return res.json({
                success: true,
                totalUnread: 0,
                clientsWithUnread: [],
                totalClients: 0,
                timestamp: new Date().toISOString()
            });
        }

        const clientIds = allClients.map(c => c.clientId);

        // ===== STEP 2: Batch load ALL month data from NEW collection =====
        const ClientMonthlyData = require("../models/ClientMonthlyData");
        const allMonthlyData = await ClientMonthlyData.find({
            clientId: { $in: clientIds }
        }).lean();

        // Build month data map for O(1) lookup
        const monthDataMap = new Map(); // key: "clientId-year-month"
        for (const record of allMonthlyData) {
            if (record.months && Array.isArray(record.months)) {
                for (const month of record.months) {
                    const key = `${record.clientId}-${month.year}-${month.month}`;
                    monthDataMap.set(key, month);
                }
            }
        }

        // ===== STEP 3: Build OLD documents map =====
        const oldDocMap = new Map();
        const clientsWithDocs = await Client.find(
            { clientId: { $in: clientIds } },
            { clientId: 1, documents: 1 }
        ).lean();

        for (const client of clientsWithDocs) {
            if (client.documents && typeof client.documents === 'object') {
                for (const [yearKey, yearData] of Object.entries(client.documents)) {
                    if (yearData && typeof yearData === 'object') {
                        for (const [monthKey, monthData] of Object.entries(yearData)) {
                            const key = `${client.clientId}-${yearKey}-${monthKey}`;
                            if (!monthDataMap.has(key)) {
                                oldDocMap.set(key, monthData);
                            }
                        }
                    }
                }
            }
        }

        // Merge old into main map
        for (const [key, value] of oldDocMap) {
            if (!monthDataMap.has(key)) {
                monthDataMap.set(key, value);
            }
        }

        // ===== STEP 4: Helper to count unread notes from month data =====
        const countUnreadNotesInMonthData = (monthData) => {
            let count = 0;
            if (!monthData || typeof monthData !== 'object') return count;

            // Month notes
            if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                monthData.monthNotes.forEach(note => {
                    if (note && !note.isViewedByAdmin) count++;
                });
            }

            // Category notes in main categories
            ['sales', 'purchase', 'bank'].forEach(cat => {
                const catData = monthData[cat];
                if (catData && catData.categoryNotes && Array.isArray(catData.categoryNotes)) {
                    catData.categoryNotes.forEach(note => {
                        if (note && !note.isViewedByAdmin) count++;
                    });
                }
            });

            // Other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCat => {
                    if (otherCat && otherCat.document && otherCat.document.categoryNotes) {
                        otherCat.document.categoryNotes.forEach(note => {
                            if (note && !note.isViewedByAdmin) count++;
                        });
                    }
                });
            }

            return count;
        };

        // ===== STEP 5: Process all clients in memory =====
        let totalUnread = 0;
        let clientsWithUnread = [];

        for (const client of allClients) {
            let clientUnread = 0;

            // Find all month data for this client in the map
            for (const [key, monthData] of monthDataMap.entries()) {
                if (key.startsWith(`${client.clientId}-`)) {
                    clientUnread += countUnreadNotesInMonthData(monthData);
                }
            }

            if (clientUnread > 0) {
                totalUnread += clientUnread;
                clientsWithUnread.push({
                    clientId: client.clientId,
                    clientName: client.name || `${client.firstName} ${client.lastName}`,
                    unreadCount: clientUnread,
                    email: client.email,
                    totalNotes: 0 // We don't calculate total notes in this optimized version
                });
            }
        }

        logToConsole("SUCCESS", "UNREAD_NOTES_COUNT_CALCULATED_OPTIMIZED", {
            totalClients: allClients.length,
            clientsWithUnread: clientsWithUnread.length,
            totalUnreadNotes: totalUnread
        });

        res.json({
            success: true,
            totalUnread,
            clientsWithUnread,
            totalClients: allClients.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "UNREAD_NOTES_COUNT_ERROR", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: "Error fetching unread notes count",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   GET ALL CLIENTS WITH NOTES SUMMARY - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/clients-summary", async (req, res) => {
    try {
        logToConsole("INFO", "GET_CLIENTS_NOTES_SUMMARY_REQUEST_OPTIMIZED", {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // ===== STEP 1: Get all active clients =====
        const allClients = await Client.find({ isActive: true }).select("clientId name email phone firstName lastName createdAt").lean();

        if (allClients.length === 0) {
            return res.json({
                success: true,
                clients: [],
                totals: { totalClients: 0, totalUnread: 0, totalNotes: 0 },
                timestamp: new Date().toISOString()
            });
        }

        const clientIds = allClients.map(c => c.clientId);

        // ===== STEP 2: Batch load ALL month data from NEW collection =====
        const ClientMonthlyData = require("../models/ClientMonthlyData");
        const allMonthlyData = await ClientMonthlyData.find({
            clientId: { $in: clientIds }
        }).lean();

        const monthDataMap = new Map();
        for (const record of allMonthlyData) {
            if (record.months && Array.isArray(record.months)) {
                for (const month of record.months) {
                    const key = `${record.clientId}-${month.year}-${month.month}`;
                    monthDataMap.set(key, month);
                }
            }
        }

        // ===== STEP 3: Build OLD documents map =====
        const clientsWithDocs = await Client.find(
            { clientId: { $in: clientIds } },
            { clientId: 1, documents: 1 }
        ).lean();

        for (const client of clientsWithDocs) {
            if (client.documents && typeof client.documents === 'object') {
                for (const [yearKey, yearData] of Object.entries(client.documents)) {
                    if (yearData && typeof yearData === 'object') {
                        for (const [monthKey, monthData] of Object.entries(yearData)) {
                            const key = `${client.clientId}-${yearKey}-${monthKey}`;
                            if (!monthDataMap.has(key)) {
                                monthDataMap.set(key, monthData);
                            }
                        }
                    }
                }
            }
        }

        // ===== STEP 4: Helper to extract notes info from month data =====
        const extractNotesInfoFromMonthData = (monthData, year, month, clientId, clientName) => {
            const notes = [];

            const addNote = (noteObj, context) => {
                if (!noteObj || !noteObj.note) return;

                notes.push({
                    noteId: noteObj._id,
                    note: noteObj.note,
                    addedBy: noteObj.addedBy || 'Unknown',
                    addedAt: noteObj.addedAt || new Date(),
                    isViewedByAdmin: noteObj.isViewedByAdmin || false,
                    year: year,
                    month: month,
                    contextType: context.contextType,
                    categoryType: context.categoryType,
                    categoryName: context.categoryName,
                    fileName: context.fileName,
                    noteLevel: context.noteLevel
                });
            };

            // Month notes
            if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                monthData.monthNotes.forEach(note => {
                    addNote(note, { contextType: 'month', noteLevel: 'month' });
                });
            }

            // Main categories
            ['sales', 'purchase', 'bank'].forEach(categoryType => {
                const category = monthData[categoryType];
                if (category && category.categoryNotes) {
                    category.categoryNotes.forEach(note => {
                        addNote(note, { contextType: 'category', categoryType, noteLevel: 'category' });
                    });
                }
                if (category && category.files) {
                    category.files.forEach(file => {
                        if (file && file.notes) {
                            file.notes.forEach(note => {
                                addNote(note, { contextType: 'file', categoryType, fileName: file.fileName, noteLevel: 'file' });
                            });
                        }
                    });
                }
            });

            // Other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCat => {
                    if (otherCat && otherCat.document) {
                        const categoryName = otherCat.categoryName;
                        if (otherCat.document.categoryNotes) {
                            otherCat.document.categoryNotes.forEach(note => {
                                addNote(note, { contextType: 'category', categoryType: 'other', categoryName, noteLevel: 'category' });
                            });
                        }
                        if (otherCat.document.files) {
                            otherCat.document.files.forEach(file => {
                                if (file && file.notes) {
                                    file.notes.forEach(note => {
                                        addNote(note, { contextType: 'file', categoryType: 'other', categoryName, fileName: file.fileName, noteLevel: 'file' });
                                    });
                                }
                            });
                        }
                    }
                });
            }

            return notes;
        };

        // ===== STEP 5: Process all clients in memory =====
        const clientsSummary = [];

        for (const client of allClients) {
            const allNotes = [];
            const unreadByMonth = {};

            // Collect all month data for this client
            for (const [key, monthData] of monthDataMap.entries()) {
                if (key.startsWith(`${client.clientId}-`)) {
                    const [_, year, month] = key.split('-');
                    const notes = extractNotesInfoFromMonthData(monthData, parseInt(year), parseInt(month), client.clientId, client.name);

                    for (const note of notes) {
                        allNotes.push(note);

                        if (!note.isViewedByAdmin) {
                            const monthKey = `${note.year}-${note.month}`;
                            if (!unreadByMonth[monthKey]) {
                                unreadByMonth[monthKey] = {
                                    year: note.year,
                                    month: note.month,
                                    count: 0,
                                    categories: new Set()
                                };
                            }
                            unreadByMonth[monthKey].count++;
                            if (note.categoryType) {
                                unreadByMonth[monthKey].categories.add(note.categoryType);
                            }
                        }
                    }
                }
            }

            const unreadNotes = allNotes.filter(n => !n.isViewedByAdmin);
            const readNotes = allNotes.filter(n => n.isViewedByAdmin);

            clientsSummary.push({
                clientId: client.clientId,
                clientName: client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client',
                email: client.email,
                phone: client.phone,
                createdAt: client.createdAt,
                totalNotes: allNotes.length,
                unreadCount: unreadNotes.length,
                readCount: readNotes.length,
                unreadByMonth: Object.values(unreadByMonth).map(monthData => ({
                    ...monthData,
                    categories: Array.from(monthData.categories)
                })),
                latestUnreadNote: unreadNotes.length > 0 ? unreadNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0] : null,
                latestNote: allNotes.length > 0 ? allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0] : null
            });
        }

        clientsSummary.sort((a, b) => b.unreadCount - a.unreadCount);

        logToConsole("SUCCESS", "CLIENTS_NOTES_SUMMARY_FETCHED_OPTIMIZED", {
            totalClients: clientsSummary.length,
            totalUnreadNotes: clientsSummary.reduce((sum, client) => sum + client.unreadCount, 0),
            clientsWithUnread: clientsSummary.filter(c => c.unreadCount > 0).length
        });

        res.json({
            success: true,
            clients: clientsSummary,
            totals: {
                totalClients: clientsSummary.length,
                totalUnread: clientsSummary.reduce((sum, client) => sum + client.unreadCount, 0),
                totalNotes: clientsSummary.reduce((sum, client) => sum + client.totalNotes, 0)
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "CLIENTS_NOTES_SUMMARY_ERROR", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: "Error fetching clients notes summary",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   GET ALL NOTES FOR SPECIFIC CLIENT WITH FILTERS - OPTIMIZED
================================ */
router.get("/client/:clientId/notes", async (req, res) => {
    try {
        const { clientId } = req.params;
        const { year, month, startDate, endDate } = req.query;

        logToConsole("INFO", "GET_CLIENT_NOTES_REQUEST_OPTIMIZED", {
            clientId,
            filters: req.query,
            ip: req.ip
        });

        // ===== STEP 1: Get client =====
        const client = await Client.findOne({ clientId }).lean();

        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // ===== STEP 2: Batch load month data for this client =====
        const ClientMonthlyData = require("../models/ClientMonthlyData");
        const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId }).lean();

        // ===== STEP 3: Build notes from both collections =====
        const allNotes = [];

        const addNote = (noteObj, context, year, month) => {
            if (!noteObj || !noteObj.note) return;

            allNotes.push({
                noteId: noteObj._id,
                note: noteObj.note,
                addedBy: noteObj.addedBy || 'Unknown',
                addedAt: noteObj.addedAt || new Date(),
                employeeId: noteObj.employeeId,
                employeeName: noteObj.employeeName,
                isViewedByAdmin: noteObj.isViewedByAdmin || false,
                isViewedByClient: noteObj.isViewedByClient || false,
                isViewedByEmployee: noteObj.isViewedByEmployee || false,
                viewedBy: noteObj.viewedBy || [],
                clientId: client.clientId,
                clientName: client.name || `${client.firstName} ${client.lastName}`,
                contextType: context.contextType,
                year: year,
                month: month,
                categoryType: context.categoryType,
                categoryName: context.categoryName,
                fileName: context.fileName,
                fileUrl: context.fileUrl,
                noteLevel: context.noteLevel
            });
        };

        const processMonthData = (monthData, year, month) => {
            if (!monthData || typeof monthData !== 'object') return;

            // Month notes
            if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                monthData.monthNotes.forEach(note => {
                    addNote(note, { contextType: 'month', noteLevel: 'month' }, year, month);
                });
            }

            // Main categories
            ['sales', 'purchase', 'bank'].forEach(categoryType => {
                const category = monthData[categoryType];
                if (category && category.categoryNotes) {
                    category.categoryNotes.forEach(note => {
                        addNote(note, { contextType: 'category', categoryType, noteLevel: 'category' }, year, month);
                    });
                }
                if (category && category.files) {
                    category.files.forEach(file => {
                        if (file && file.notes) {
                            file.notes.forEach(note => {
                                addNote(note, { contextType: 'file', categoryType, fileName: file.fileName, fileUrl: file.url, noteLevel: 'file' }, year, month);
                            });
                        }
                    });
                }
            });

            // Other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCat => {
                    if (otherCat && otherCat.document) {
                        const categoryName = otherCat.categoryName;
                        if (otherCat.document.categoryNotes) {
                            otherCat.document.categoryNotes.forEach(note => {
                                addNote(note, { contextType: 'category', categoryType: 'other', categoryName, noteLevel: 'category' }, year, month);
                            });
                        }
                        if (otherCat.document.files) {
                            otherCat.document.files.forEach(file => {
                                if (file && file.notes) {
                                    file.notes.forEach(note => {
                                        addNote(note, { contextType: 'file', categoryType: 'other', categoryName, fileName: file.fileName, fileUrl: file.url, noteLevel: 'file' }, year, month);
                                    });
                                }
                            });
                        }
                    }
                });
            }
        };

        // Process NEW collection
        if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
            for (const monthData of newDoc.months) {
                processMonthData(monthData, monthData.year, monthData.month);
            }
        }

        // Process OLD documents
        if (client.documents && typeof client.documents === 'object') {
            for (const [yearKey, yearData] of Object.entries(client.documents)) {
                if (yearData && typeof yearData === 'object') {
                    for (const [monthKey, monthData] of Object.entries(yearData)) {
                        if (monthData && typeof monthData === 'object') {
                            processMonthData(monthData, parseInt(yearKey), parseInt(monthKey));
                        }
                    }
                }
            }
        }

        // ===== STEP 4: Apply filters =====
        let filteredNotes = [...allNotes];

        if (year) {
            const yearNum = parseInt(year);
            filteredNotes = filteredNotes.filter(note => note.year === yearNum);
        }

        if (month) {
            const monthNum = parseInt(month);
            filteredNotes = filteredNotes.filter(note => note.month === monthNum);
        }

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            filteredNotes = filteredNotes.filter(note => {
                if (!note.addedAt) return false;
                const noteDate = new Date(note.addedAt);
                return noteDate >= start && noteDate <= end;
            });
        }

        filteredNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

        // ===== STEP 5: Group by month =====
        const notesByMonth = {};
        filteredNotes.forEach(note => {
            if (!note.year || !note.month) return;

            const monthKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
            if (!notesByMonth[monthKey]) {
                notesByMonth[monthKey] = {
                    year: note.year,
                    month: note.month,
                    monthName: new Date(note.year, note.month - 1).toLocaleString('default', { month: 'long' }),
                    notes: [],
                    unreadCount: 0,
                    readCount: 0
                };
            }
            notesByMonth[monthKey].notes.push(note);
            if (note.isViewedByAdmin) {
                notesByMonth[monthKey].readCount++;
            } else {
                notesByMonth[monthKey].unreadCount++;
            }
        });

        const monthsArray = Object.values(notesByMonth).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        logToConsole("SUCCESS", "CLIENT_NOTES_FETCHED_OPTIMIZED", {
            clientId,
            clientName: client.name,
            totalNotes: filteredNotes.length,
            unreadNotes: filteredNotes.filter(n => !n.isViewedByAdmin).length,
            monthsCount: monthsArray.length
        });

        res.json({
            success: true,
            client: {
                clientId: client.clientId,
                name: client.name || `${client.firstName} ${client.lastName}`,
                email: client.email,
                phone: client.phone
            },
            notes: {
                all: filteredNotes,
                byMonth: monthsArray,
                statistics: {
                    total: filteredNotes.length,
                    unread: filteredNotes.filter(n => !n.isViewedByAdmin).length,
                    read: filteredNotes.filter(n => n.isViewedByAdmin).length
                }
            },
            filters: req.query,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "CLIENT_NOTES_ERROR", {
            error: error.message,
            stack: error.stack,
            clientId: req.params.clientId
        });

        res.status(500).json({
            success: false,
            message: "Error fetching client notes",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   MARK NOTES AS VIEWED BY ADMIN (UPDATED - WORKS FOR BOTH)
================================ */
router.post("/mark-as-viewed", async (req, res) => {
    try {
        const { clientId, noteIds, filter, adminId = "admin-system" } = req.body;

        logToConsole("INFO", "MARK_NOTES_AS_VIEWED_REQUEST", {
            clientId,
            noteIdsCount: noteIds?.length || 0,
            filter,
            adminId,
            ip: req.ip
        });

        if (!clientId) {
            return res.status(400).json({
                success: false,
                message: "Client ID is required"
            });
        }

        const client = await Client.findOne({ clientId });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        const notesBeforeUpdate = await extractNotesFromClient(client);

        let notesToMark = notesBeforeUpdate;

        if (filter) {
            const { year, month, startDate, endDate, noteLevel, categoryType } = filter;

            if (year) {
                const yearNum = parseInt(year);
                notesToMark = notesToMark.filter(note => note.year === yearNum);
            }

            if (month) {
                const monthNum = parseInt(month);
                notesToMark = notesToMark.filter(note => note.month === monthNum);
            }

            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);

                notesToMark = notesToMark.filter(note => {
                    const noteDate = new Date(note.addedAt);
                    return noteDate >= start && noteDate <= end;
                });
            }

            if (noteLevel) {
                notesToMark = notesToMark.filter(note => note.noteLevel === noteLevel);
            }

            if (categoryType) {
                notesToMark = notesToMark.filter(note => note.categoryType === categoryType);
            }
        }

        if (noteIds && noteIds.length > 0) {
            notesToMark = notesToMark.filter(note => noteIds.includes(note.noteId));
        }

        const unreadNotesToMark = notesToMark.filter(note => !note.isViewedByAdmin);

        if (unreadNotesToMark.length === 0) {
            return res.json({
                success: true,
                message: "No unread notes to mark as viewed",
                markedCount: 0
            });
        }

        const markedCount = await markNotesInBothCollections(clientId, adminId, unreadNotesToMark);

        const notesAfterUpdate = await extractNotesFromClient(client);
        const updatedUnread = notesAfterUpdate.filter(n => !n.isViewedByAdmin).length;
        const unreadBefore = notesBeforeUpdate.filter(n => !n.isViewedByAdmin).length;

        logToConsole("SUCCESS", "NOTES_MARKED_AS_VIEWED", {
            clientId,
            clientName: client.name,
            unreadBefore,
            unreadAfter: updatedUnread,
            markedCount,
            adminId
        });

        res.json({
            success: true,
            message: `Marked ${markedCount} notes as viewed`,
            markedCount,
            remainingUnread: updatedUnread,
            client: {
                clientId: client.clientId,
                name: client.name,
                totalNotes: notesAfterUpdate.length,
                unreadNotes: updatedUnread
            },
            verification: {
                unreadBefore,
                unreadAfter: updatedUnread,
                expectedMarked: unreadBefore - updatedUnread
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "MARK_NOTES_AS_VIEWED_ERROR", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: "Error marking notes as viewed",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   GET MONTHLY UNREAD NOTES STATISTICS - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/monthly-stats", async (req, res) => {
    try {
        logToConsole("INFO", "GET_MONTHLY_NOTES_STATS_REQUEST_OPTIMIZED", {
            ip: req.ip
        });

        // ===== STEP 1: Get all active clients =====
        const allClients = await Client.find({ isActive: true }).select("clientId").lean();

        if (allClients.length === 0) {
            return res.json({
                success: true,
                monthlyStats: [],
                summary: { totalMonths: 0, totalUnread: 0, totalNotes: 0, averageUnreadPerMonth: "0.00" },
                timestamp: new Date().toISOString()
            });
        }

        const clientIds = allClients.map(c => c.clientId);

        // ===== STEP 2: Batch load ALL month data =====
        const ClientMonthlyData = require("../models/ClientMonthlyData");
        const allMonthlyData = await ClientMonthlyData.find({
            clientId: { $in: clientIds }
        }).lean();

        const monthDataMap = new Map();
        for (const record of allMonthlyData) {
            if (record.months && Array.isArray(record.months)) {
                for (const month of record.months) {
                    const key = `${record.clientId}-${month.year}-${month.month}`;
                    monthDataMap.set(key, month);
                }
            }
        }

        // ===== STEP 3: Build OLD documents map =====
        const clientsWithDocs = await Client.find(
            { clientId: { $in: clientIds } },
            { clientId: 1, documents: 1 }
        ).lean();

        for (const client of clientsWithDocs) {
            if (client.documents && typeof client.documents === 'object') {
                for (const [yearKey, yearData] of Object.entries(client.documents)) {
                    if (yearData && typeof yearData === 'object') {
                        for (const [monthKey, monthData] of Object.entries(yearData)) {
                            const key = `${client.clientId}-${yearKey}-${monthKey}`;
                            if (!monthDataMap.has(key)) {
                                monthDataMap.set(key, monthData);
                            }
                        }
                    }
                }
            }
        }

        // ===== STEP 4: Generate last 6 months =====
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        const monthlyStats = {};
        for (let i = 0; i < 6; i++) {
            let month = currentMonth - i;
            let year = currentYear;

            if (month < 1) {
                month += 12;
                year -= 1;
            }

            const key = `${year}-${String(month).padStart(2, '0')}`;
            monthlyStats[key] = {
                year,
                month,
                monthName: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
                totalNotes: 0,
                unreadNotes: 0,
                clientsWithUnread: 0
            };
        }

        // ===== STEP 5: Helper to count notes in month data =====
        const countNotesInMonthData = (monthData) => {
            let total = 0;
            let unread = 0;

            if (!monthData || typeof monthData !== 'object') return { total, unread };

            const processNotes = (notesArray) => {
                if (!notesArray || !Array.isArray(notesArray)) return;
                notesArray.forEach(note => {
                    if (note && note.note) {
                        total++;
                        if (!note.isViewedByAdmin) unread++;
                    }
                });
            };

            // Month notes
            processNotes(monthData.monthNotes);

            // Main categories
            ['sales', 'purchase', 'bank'].forEach(cat => {
                const catData = monthData[cat];
                if (catData && catData.categoryNotes) processNotes(catData.categoryNotes);
                if (catData && catData.files) {
                    catData.files.forEach(file => {
                        if (file && file.notes) processNotes(file.notes);
                    });
                }
            });

            // Other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCat => {
                    if (otherCat && otherCat.document) {
                        if (otherCat.document.categoryNotes) processNotes(otherCat.document.categoryNotes);
                        if (otherCat.document.files) {
                            otherCat.document.files.forEach(file => {
                                if (file && file.notes) processNotes(file.notes);
                            });
                        }
                    }
                });
            }

            return { total, unread };
        };

        // ===== STEP 6: Process all data =====
        const clientUnreadByMonth = new Map(); // key: "clientId-monthKey"

        for (const [key, monthData] of monthDataMap.entries()) {
            const [clientId, year, month] = key.split('-');
            const monthKey = `${year}-${String(month).padStart(2, '0')}`;

            if (monthlyStats[monthKey]) {
                const { total, unread } = countNotesInMonthData(monthData);
                monthlyStats[monthKey].totalNotes += total;
                monthlyStats[monthKey].unreadNotes += unread;

                if (unread > 0) {
                    const clientKey = `${clientId}-${monthKey}`;
                    if (!clientUnreadByMonth.has(clientKey)) {
                        clientUnreadByMonth.set(clientKey, true);
                        monthlyStats[monthKey].clientsWithUnread++;
                    }
                }
            }
        }

        const statsArray = Object.values(monthlyStats).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        logToConsole("SUCCESS", "MONTHLY_STATS_FETCHED_OPTIMIZED", {
            monthsCount: statsArray.length,
            totalUnread: statsArray.reduce((sum, month) => sum + month.unreadNotes, 0)
        });

        res.json({
            success: true,
            monthlyStats: statsArray,
            summary: {
                totalMonths: statsArray.length,
                totalUnread: statsArray.reduce((sum, month) => sum + month.unreadNotes, 0),
                totalNotes: statsArray.reduce((sum, month) => sum + month.totalNotes, 0),
                averageUnreadPerMonth: statsArray.length > 0
                    ? (statsArray.reduce((sum, month) => sum + month.unreadNotes, 0) / statsArray.length).toFixed(2)
                    : "0.00"
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "MONTHLY_STATS_ERROR", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: "Error fetching monthly statistics",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/* ===============================
   GET NOTES STATISTICS FOR DASHBOARD - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/dashboard-stats", async (req, res) => {
    try {
        logToConsole("INFO", "GET_DASHBOARD_NOTES_STATS_REQUEST_OPTIMIZED", {
            ip: req.ip
        });

        // ===== STEP 1: Get all active clients =====
        const allClients = await Client.find({ isActive: true }).select("clientId name firstName lastName").lean();

        if (allClients.length === 0) {
            return res.json({
                success: true,
                stats: {
                    totalNotes: 0,
                    totalUnread: 0,
                    totalRead: 0,
                    clientsWithUnread: 0,
                    totalClients: 0,
                    noteSources: { client: 0, employee: 0, admin: 0 },
                    unreadPercentage: "0.00"
                },
                recentNotes: [],
                timestamp: new Date().toISOString()
            });
        }

        const clientIds = allClients.map(c => c.clientId);

        // ===== STEP 2: Batch load ALL month data =====
        const ClientMonthlyData = require("../models/ClientMonthlyData");
        const allMonthlyData = await ClientMonthlyData.find({
            clientId: { $in: clientIds }
        }).lean();

        const monthDataMap = new Map();
        for (const record of allMonthlyData) {
            if (record.months && Array.isArray(record.months)) {
                for (const month of record.months) {
                    const key = `${record.clientId}-${month.year}-${month.month}`;
                    monthDataMap.set(key, month);
                }
            }
        }

        // ===== STEP 3: Build OLD documents map =====
        const clientsWithDocs = await Client.find(
            { clientId: { $in: clientIds } },
            { clientId: 1, documents: 1 }
        ).lean();

        for (const client of clientsWithDocs) {
            if (client.documents && typeof client.documents === 'object') {
                for (const [yearKey, yearData] of Object.entries(client.documents)) {
                    if (yearData && typeof yearData === 'object') {
                        for (const [monthKey, monthData] of Object.entries(yearData)) {
                            const key = `${client.clientId}-${yearKey}-${monthKey}`;
                            if (!monthDataMap.has(key)) {
                                monthDataMap.set(key, monthData);
                            }
                        }
                    }
                }
            }
        }

        // ===== STEP 4: Helper to extract notes from month data =====
        const extractNotesFromMonthData = (monthData, year, month, clientId, clientName) => {
            const notes = [];

            const addNote = (noteObj, context) => {
                if (!noteObj || !noteObj.note) return;

                notes.push({
                    note: noteObj.note,
                    addedBy: noteObj.addedBy || 'Unknown',
                    addedAt: noteObj.addedAt || new Date(),
                    isViewedByAdmin: noteObj.isViewedByAdmin || false,
                    employeeId: noteObj.employeeId,
                    year: year,
                    month: month,
                    clientId: clientId,
                    clientName: clientName,
                    contextType: context.contextType,
                    categoryType: context.categoryType,
                    noteLevel: context.noteLevel
                });
            };

            // Month notes
            if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                monthData.monthNotes.forEach(note => {
                    addNote(note, { contextType: 'month', noteLevel: 'month' });
                });
            }

            // Main categories
            ['sales', 'purchase', 'bank'].forEach(categoryType => {
                const category = monthData[categoryType];
                if (category && category.categoryNotes) {
                    category.categoryNotes.forEach(note => {
                        addNote(note, { contextType: 'category', categoryType, noteLevel: 'category' });
                    });
                }
                if (category && category.files) {
                    category.files.forEach(file => {
                        if (file && file.notes) {
                            file.notes.forEach(note => {
                                addNote(note, { contextType: 'file', categoryType, fileName: file.fileName, noteLevel: 'file' });
                            });
                        }
                    });
                }
            });

            // Other categories
            if (monthData.other && Array.isArray(monthData.other)) {
                monthData.other.forEach(otherCat => {
                    if (otherCat && otherCat.document) {
                        const categoryName = otherCat.categoryName;
                        if (otherCat.document.categoryNotes) {
                            otherCat.document.categoryNotes.forEach(note => {
                                addNote(note, { contextType: 'category', categoryType: 'other', categoryName, noteLevel: 'category' });
                            });
                        }
                        if (otherCat.document.files) {
                            otherCat.document.files.forEach(file => {
                                if (file && file.notes) {
                                    file.notes.forEach(note => {
                                        addNote(note, { contextType: 'file', categoryType: 'other', categoryName, fileName: file.fileName, noteLevel: 'file' });
                                    });
                                }
                            });
                        }
                    }
                });
            }

            return notes;
        };

        // ===== STEP 5: Process all data =====
        let totalNotes = 0;
        let totalUnread = 0;
        let totalRead = 0;
        const clientsWithUnreadSet = new Set();
        const recentNotes = [];
        const noteSources = { client: 0, employee: 0, admin: 0 };

        const clientMap = new Map();
        for (const client of allClients) {
            clientMap.set(client.clientId, client);
        }

        for (const [key, monthData] of monthDataMap.entries()) {
            const [clientId, year, month] = key.split('-');
            const client = clientMap.get(clientId);
            if (!client) continue;

            const notes = extractNotesFromMonthData(monthData, parseInt(year), parseInt(month), clientId, client.name || `${client.firstName} ${client.lastName}`);

            for (const note of notes) {
                totalNotes++;
                if (note.isViewedByAdmin) {
                    totalRead++;
                } else {
                    totalUnread++;
                    clientsWithUnreadSet.add(clientId);
                }

                // Count note sources
                if (note.employeeId) {
                    noteSources.employee++;
                } else if (note.addedBy && note.addedBy.toLowerCase().includes('admin')) {
                    noteSources.admin++;
                } else {
                    noteSources.client++;
                }

                // Add to recent notes
                recentNotes.push({
                    ...note,
                    clientName: client.name || `${client.firstName} ${client.lastName}`
                });
            }
        }

        recentNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
        const topRecentNotes = recentNotes.slice(0, 10);

        logToConsole("SUCCESS", "DASHBOARD_STATS_FETCHED_OPTIMIZED", {
            totalNotes,
            totalUnread,
            totalRead,
            clientsWithUnread: clientsWithUnreadSet.size,
            totalClients: allClients.length
        });

        res.json({
            success: true,
            stats: {
                totalNotes,
                totalUnread,
                totalRead,
                clientsWithUnread: clientsWithUnreadSet.size,
                totalClients: allClients.length,
                noteSources,
                unreadPercentage: totalNotes > 0 ? ((totalUnread / totalNotes) * 100).toFixed(2) : "0.00"
            },
            recentNotes: topRecentNotes,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logToConsole("ERROR", "DASHBOARD_STATS_ERROR", {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: "Error fetching dashboard statistics",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;