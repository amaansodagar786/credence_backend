const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Client = require("../models/Client");

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

// Helper function to extract all notes from client with metadata - DEBUG VERSION
const extractNotesFromClient = (client) => {
    const notes = [];
    const clientId = client.clientId;
    const clientName = client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client';

    // Helper to add note with context
    const addNote = (noteObj, context) => {
        if (!noteObj || !noteObj.note) return;

        const noteId = noteObj._id || generateNoteId();
        const isViewedByAdmin = noteObj.isViewedByAdmin || false;

        // DEBUG: Log notes being extracted
        if (!isViewedByAdmin) {
            console.log(`🔍 Extracting unread note:`, {
                noteId,
                note: noteObj.note.substring(0, 50) + '...',
                addedBy: noteObj.addedBy,
                isViewedByAdmin,
                context
            });
        }

        notes.push({
            noteId,
            note: noteObj.note,
            addedBy: noteObj.addedBy || 'Unknown',
            addedAt: noteObj.addedAt || new Date(),
            employeeId: noteObj.employeeId,
            employeeName: noteObj.employeeName,

            // View tracking
            isViewedByAdmin,
            isViewedByClient: noteObj.isViewedByClient || false,
            isViewedByEmployee: noteObj.isViewedByEmployee || false,
            viewedBy: noteObj.viewedBy || [],

            // Context
            clientId,
            clientName,
            contextType: context.contextType, // 'month', 'category', 'file'
            year: context.year,
            month: context.month,
            categoryType: context.categoryType, // 'sales', 'purchase', 'bank', 'other'
            categoryName: context.categoryName, // for 'other' categories
            fileName: context.fileName,
            fileUrl: context.fileUrl,
            noteLevel: context.noteLevel // 'month', 'category', 'file'
        });
    };

    // Check if client has documents
    if (!client.documents) {
        console.log(`📄 No documents for client ${clientId}`);
        return notes;
    }

    try {
        // Process documents structure
        let documentsObj = {};

        // Handle both Map and object formats
        if (client.documents instanceof Map) {
            console.log(`🗺️ Client ${clientId} has Map documents structure`);
            // Convert Map to object for easier traversal
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
            console.log(`📁 Client ${clientId} has object documents structure`);
            documentsObj = client.documents;
        } else {
            console.log(`❌ Client ${clientId} has invalid documents type:`, typeof client.documents);
            return notes;
        }

        // Iterate through all years and months
        for (const yearKey in documentsObj) {
            const year = parseInt(yearKey);
            const yearData = documentsObj[yearKey];

            if (!yearData || typeof yearData !== 'object') continue;

            for (const monthKey in yearData) {
                const month = parseInt(monthKey);
                const monthData = yearData[monthKey];

                if (!monthData || typeof monthData !== 'object') continue;

                // 1. Month-level notes
                if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                    console.log(`📝 Found ${monthData.monthNotes.length} month-level notes for ${year}-${month}`);
                    monthData.monthNotes.forEach(note => {
                        addNote(note, {
                            contextType: 'month',
                            year,
                            month,
                            noteLevel: 'month'
                        });
                    });
                }

                // 2. Process main categories: sales, purchase, bank
                ['sales', 'purchase', 'bank'].forEach(categoryType => {
                    if (monthData[categoryType] && typeof monthData[categoryType] === 'object') {
                        const category = monthData[categoryType];

                        // Category-level notes
                        if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
                            console.log(`📝 Found ${category.categoryNotes.length} ${categoryType} category-level notes for ${year}-${month}`);
                            category.categoryNotes.forEach(note => {
                                addNote(note, {
                                    contextType: 'category',
                                    year,
                                    month,
                                    categoryType,
                                    noteLevel: 'category'
                                });
                            });
                        }

                        // File-level notes
                        if (category.files && Array.isArray(category.files)) {
                            let fileNotesCount = 0;
                            category.files.forEach(file => {
                                if (file && file.notes && Array.isArray(file.notes)) {
                                    fileNotesCount += file.notes.length;
                                    file.notes.forEach(note => {
                                        addNote(note, {
                                            contextType: 'file',
                                            year,
                                            month,
                                            categoryType,
                                            fileName: file.fileName,
                                            fileUrl: file.url,
                                            noteLevel: 'file'
                                        });
                                    });
                                }
                            });
                            if (fileNotesCount > 0) {
                                console.log(`📝 Found ${fileNotesCount} ${categoryType} file-level notes for ${year}-${month}`);
                            }
                        }
                    }
                });

                // 3. Process other categories
                if (monthData.other && Array.isArray(monthData.other)) {
                    let otherNotesCount = 0;
                    monthData.other.forEach(otherCategory => {
                        if (otherCategory && otherCategory.document && typeof otherCategory.document === 'object') {
                            const categoryType = 'other';
                            const categoryName = otherCategory.categoryName;

                            // Other category-level notes
                            if (otherCategory.document.categoryNotes && Array.isArray(otherCategory.document.categoryNotes)) {
                                otherNotesCount += otherCategory.document.categoryNotes.length;
                                otherCategory.document.categoryNotes.forEach(note => {
                                    addNote(note, {
                                        contextType: 'category',
                                        year,
                                        month,
                                        categoryType,
                                        categoryName,
                                        noteLevel: 'category'
                                    });
                                });
                            }

                            // Other category file-level notes
                            if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                                otherCategory.document.files.forEach(file => {
                                    if (file && file.notes && Array.isArray(file.notes)) {
                                        otherNotesCount += file.notes.length;
                                        file.notes.forEach(note => {
                                            addNote(note, {
                                                contextType: 'file',
                                                year,
                                                month,
                                                categoryType,
                                                categoryName,
                                                fileName: file.fileName,
                                                fileUrl: file.url,
                                                noteLevel: 'file'
                                            });
                                        });
                                    }
                                });
                            }
                        }
                    });
                    if (otherNotesCount > 0) {
                        console.log(`📝 Found ${otherNotesCount} other category notes for ${year}-${month}`);
                    }
                }
            }
        }

        console.log(`✅ Total notes extracted for client ${clientId}: ${notes.length}`);
        console.log(`   - Unread notes: ${notes.filter(n => !n.isViewedByAdmin).length}`);
        console.log(`   - Read notes: ${notes.filter(n => n.isViewedByAdmin).length}`);

    } catch (error) {
        console.error('❌ Error extracting notes from client:', error);
        logToConsole("ERROR", "EXTRACT_NOTES_ERROR", {
            clientId: client.clientId,
            error: error.message
        });
    }

    return notes;
};

/* ===============================
   GET UNREAD NOTES COUNT FOR ADMIN
================================ */
router.get("/unread-count", async (req, res) => {
    try {
        logToConsole("INFO", "GET_UNREAD_NOTES_COUNT_REQUEST", {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const allClients = await Client.find({
            isActive: true
        }).select("clientId name email documents");

        let totalUnread = 0;
        let clientsWithUnread = [];

        for (const client of allClients) {
            const notes = extractNotesFromClient(client);
            const clientUnread = notes.filter(note => !note.isViewedByAdmin).length;

            if (clientUnread > 0) {
                totalUnread += clientUnread;
                clientsWithUnread.push({
                    clientId: client.clientId,
                    clientName: client.name || `${client.firstName} ${client.lastName}`,
                    unreadCount: clientUnread,
                    email: client.email,
                    totalNotes: notes.length
                });
            }
        }

        logToConsole("SUCCESS", "UNREAD_NOTES_COUNT_CALCULATED", {
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
   GET ALL CLIENTS WITH NOTES SUMMARY
================================ */
router.get("/clients-summary", async (req, res) => {
    try {
        logToConsole("INFO", "GET_CLIENTS_NOTES_SUMMARY_REQUEST", {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        const allClients = await Client.find({
            isActive: true
        }).select("clientId name email phone firstName lastName createdAt documents");

        const clientsSummary = [];

        for (const client of allClients) {
            const notes = extractNotesFromClient(client);

            const unreadNotes = notes.filter(note => !note.isViewedByAdmin);
            const readNotes = notes.filter(note => note.isViewedByAdmin);

            // Group unread notes by month for quick overview
            const unreadByMonth = {};
            unreadNotes.forEach(note => {
                const key = `${note.year}-${note.month}`;
                if (!unreadByMonth[key]) {
                    unreadByMonth[key] = {
                        year: note.year,
                        month: note.month,
                        count: 0,
                        categories: new Set()
                    };
                }
                unreadByMonth[key].count++;
                if (note.categoryType) {
                    unreadByMonth[key].categories.add(note.categoryType);
                }
            });

            clientsSummary.push({
                clientId: client.clientId,
                clientName: client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client',
                email: client.email,
                phone: client.phone,
                createdAt: client.createdAt,

                // Notes statistics
                totalNotes: notes.length,
                unreadCount: unreadNotes.length,
                readCount: readNotes.length,

                // Unread notes distribution
                unreadByMonth: Object.values(unreadByMonth).map(monthData => ({
                    ...monthData,
                    categories: Array.from(monthData.categories)
                })),

                // Latest unread note
                latestUnreadNote: unreadNotes.length > 0
                    ? unreadNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0]
                    : null,

                // Latest note (any)
                latestNote: notes.length > 0
                    ? notes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0]
                    : null
            });
        }

        // Sort clients by unread count (descending)
        clientsSummary.sort((a, b) => b.unreadCount - a.unreadCount);

        logToConsole("SUCCESS", "CLIENTS_NOTES_SUMMARY_FETCHED", {
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
   GET ALL NOTES FOR SPECIFIC CLIENT WITH FILTERS - UPDATED
================================ */
router.get("/client/:clientId/notes", async (req, res) => {
    try {
        const { clientId } = req.params;
        const {
            year,
            month,
            startDate,
            endDate
            // REMOVED: noteLevel, categoryType, isViewed filters
        } = req.query;

        logToConsole("INFO", "GET_CLIENT_NOTES_REQUEST", {
            clientId,
            filters: req.query,
            ip: req.ip
        });

        const client = await Client.findOne({ clientId });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Extract all notes from client
        let notes = extractNotesFromClient(client);

        // Apply filters - SIMPLIFIED VERSION
        if (year) {
            const yearNum = parseInt(year);
            notes = notes.filter(note => note.year === yearNum);
        }

        if (month) {
            const monthNum = parseInt(month);
            notes = notes.filter(note => note.month === monthNum);
        }

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // End of day

            notes = notes.filter(note => {
                const noteDate = new Date(note.addedAt);
                return noteDate >= start && noteDate <= end;
            });
        }

        // Sort by date (newest first)
        notes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

        // Group notes by month for easier display
        const notesByMonth = {};
        notes.forEach(note => {
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

        // Convert to array and sort by date (newest first)
        const monthsArray = Object.values(notesByMonth).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        logToConsole("SUCCESS", "CLIENT_NOTES_FETCHED", {
            clientId,
            clientName: client.name,
            totalNotes: notes.length,
            unreadNotes: notes.filter(n => !n.isViewedByAdmin).length,
            filteredNotes: notes.length,
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
                all: notes,
                byMonth: monthsArray,
                statistics: {
                    total: notes.length,
                    unread: notes.filter(n => !n.isViewedByAdmin).length,
                    read: notes.filter(n => n.isViewedByAdmin).length
                    // REMOVED: byLevel statistics
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
   MARK NOTES AS VIEWED BY ADMIN - FIXED VERSION
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

        // Get notes BEFORE update
        const notesBeforeUpdate = extractNotesFromClient(client);

        // Apply filter if provided to get notes that should be marked
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

        // If specific note IDs are provided, only mark those
        if (noteIds && noteIds.length > 0) {
            notesToMark = notesToMark.filter(note => noteIds.includes(note.noteId));
        }

        // Filter only unread notes from the filtered set
        const unreadNotesToMark = notesToMark.filter(note => !note.isViewedByAdmin);

        if (unreadNotesToMark.length === 0) {
            return res.json({
                success: true,
                message: "No unread notes to mark as viewed",
                markedCount: 0
            });
        }

        console.log("🔍 DEBUG: Notes to mark as viewed:", {
            totalNotesBeforeUpdate: notesBeforeUpdate.length,
            unreadNotesBeforeUpdate: notesBeforeUpdate.filter(n => !n.isViewedByAdmin).length,
            notesToMarkCount: notesToMark.length,
            unreadNotesToMarkCount: unreadNotesToMark.length,
            unreadNotesToMark: unreadNotesToMark.map(n => ({
                noteId: n.noteId,
                note: n.note.substring(0, 30) + '...',
                addedBy: n.addedBy,
                isViewedByAdmin: n.isViewedByAdmin
            }))
        });

        // Convert client to plain object for manipulation
        const clientObj = client.toObject();
        let markedCount = 0;

        // Helper function to mark notes in the documents structure
        const markNotesInDocuments = (documents, notesToMarkArray) => {
            if (!documents || typeof documents !== 'object') return false;

            try {
                // Convert Map to object if needed
                let docsObj = documents;
                if (documents instanceof Map) {
                    docsObj = {};
                    for (const [key, value] of documents.entries()) {
                        if (value instanceof Map) {
                            const innerObj = {};
                            for (const [innerKey, innerValue] of value.entries()) {
                                innerObj[innerKey] = innerValue;
                            }
                            docsObj[key] = innerObj;
                        } else {
                            docsObj[key] = value;
                        }
                    }
                }

                // Iterate through all years
                for (const yearKey in docsObj) {
                    const yearData = docsObj[yearKey];
                    if (!yearData || typeof yearData !== 'object') continue;

                    // Iterate through all months
                    for (const monthKey in yearData) {
                        const monthData = yearData[monthKey];
                        if (!monthData || typeof monthData !== 'object') continue;

                        // 1. Mark month-level notes
                        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
                            monthData.monthNotes.forEach((note, index) => {
                                const matchingNote = notesToMarkArray.find(unreadNote =>
                                    unreadNote.note === note.note &&
                                    unreadNote.addedBy === note.addedBy &&
                                    new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                                    parseInt(yearKey) === unreadNote.year &&
                                    parseInt(monthKey) === unreadNote.month &&
                                    unreadNote.noteLevel === 'month'
                                );

                                if (matchingNote && !note.isViewedByAdmin) {
                                    monthData.monthNotes[index].isViewedByAdmin = true;

                                    if (!monthData.monthNotes[index].viewedBy) {
                                        monthData.monthNotes[index].viewedBy = [];
                                    }

                                    const alreadyViewed = monthData.monthNotes[index].viewedBy.some(
                                        v => v.userId === adminId && v.userType === 'admin'
                                    );

                                    if (!alreadyViewed) {
                                        monthData.monthNotes[index].viewedBy.push({
                                            userId: adminId,
                                            userType: 'admin',
                                            viewedAt: new Date()
                                        });
                                    }

                                    markedCount++;
                                    console.log(`✅ Marked month-level note: ${note.note.substring(0, 30)}...`);
                                }
                            });
                        }

                        // 2. Process main categories
                        ['sales', 'purchase', 'bank'].forEach(categoryType => {
                            if (monthData[categoryType] && typeof monthData[categoryType] === 'object') {
                                const category = monthData[categoryType];

                                // Mark category-level notes
                                if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
                                    category.categoryNotes.forEach((note, index) => {
                                        const matchingNote = notesToMarkArray.find(unreadNote =>
                                            unreadNote.note === note.note &&
                                            unreadNote.addedBy === note.addedBy &&
                                            new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                                            parseInt(yearKey) === unreadNote.year &&
                                            parseInt(monthKey) === unreadNote.month &&
                                            unreadNote.noteLevel === 'category' &&
                                            unreadNote.categoryType === categoryType
                                        );

                                        if (matchingNote && !note.isViewedByAdmin) {
                                            category.categoryNotes[index].isViewedByAdmin = true;

                                            if (!category.categoryNotes[index].viewedBy) {
                                                category.categoryNotes[index].viewedBy = [];
                                            }

                                            const alreadyViewed = category.categoryNotes[index].viewedBy.some(
                                                v => v.userId === adminId && v.userType === 'admin'
                                            );

                                            if (!alreadyViewed) {
                                                category.categoryNotes[index].viewedBy.push({
                                                    userId: adminId,
                                                    userType: 'admin',
                                                    viewedAt: new Date()
                                                });
                                            }

                                            markedCount++;
                                            console.log(`✅ Marked ${categoryType} category-level note: ${note.note.substring(0, 30)}...`);
                                        }
                                    });
                                }

                                // Mark file-level notes
                                if (category.files && Array.isArray(category.files)) {
                                    category.files.forEach(file => {
                                        if (file && file.notes && Array.isArray(file.notes)) {
                                            file.notes.forEach((note, index) => {
                                                const matchingNote = notesToMarkArray.find(unreadNote =>
                                                    unreadNote.note === note.note &&
                                                    unreadNote.addedBy === note.addedBy &&
                                                    new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                                                    parseInt(yearKey) === unreadNote.year &&
                                                    parseInt(monthKey) === unreadNote.month &&
                                                    unreadNote.noteLevel === 'file' &&
                                                    unreadNote.categoryType === categoryType &&
                                                    unreadNote.fileName === file.fileName
                                                );

                                                if (matchingNote && !note.isViewedByAdmin) {
                                                    file.notes[index].isViewedByAdmin = true;

                                                    if (!file.notes[index].viewedBy) {
                                                        file.notes[index].viewedBy = [];
                                                    }

                                                    const alreadyViewed = file.notes[index].viewedBy.some(
                                                        v => v.userId === adminId && v.userType === 'admin'
                                                    );

                                                    if (!alreadyViewed) {
                                                        file.notes[index].viewedBy.push({
                                                            userId: adminId,
                                                            userType: 'admin',
                                                            viewedAt: new Date()
                                                        });
                                                    }

                                                    markedCount++;
                                                    console.log(`✅ Marked ${categoryType} file-level note: ${note.note.substring(0, 30)}...`);
                                                }
                                            });
                                        }
                                    });
                                }
                            }
                        });

                        // 3. Process other categories
                        if (monthData.other && Array.isArray(monthData.other)) {
                            monthData.other.forEach((otherCategory, otherIndex) => {
                                if (otherCategory && otherCategory.document && typeof otherCategory.document === 'object') {
                                    const categoryName = otherCategory.categoryName;

                                    // Mark other category-level notes
                                    if (otherCategory.document.categoryNotes && Array.isArray(otherCategory.document.categoryNotes)) {
                                        otherCategory.document.categoryNotes.forEach((note, index) => {
                                            const matchingNote = notesToMarkArray.find(unreadNote =>
                                                unreadNote.note === note.note &&
                                                unreadNote.addedBy === note.addedBy &&
                                                new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                                                parseInt(yearKey) === unreadNote.year &&
                                                parseInt(monthKey) === unreadNote.month &&
                                                unreadNote.noteLevel === 'category' &&
                                                unreadNote.categoryType === 'other' &&
                                                unreadNote.categoryName === categoryName
                                            );

                                            if (matchingNote && !note.isViewedByAdmin) {
                                                otherCategory.document.categoryNotes[index].isViewedByAdmin = true;

                                                if (!otherCategory.document.categoryNotes[index].viewedBy) {
                                                    otherCategory.document.categoryNotes[index].viewedBy = [];
                                                }

                                                const alreadyViewed = otherCategory.document.categoryNotes[index].viewedBy.some(
                                                    v => v.userId === adminId && v.userType === 'admin'
                                                );

                                                if (!alreadyViewed) {
                                                    otherCategory.document.categoryNotes[index].viewedBy.push({
                                                        userId: adminId,
                                                        userType: 'admin',
                                                        viewedAt: new Date()
                                                    });
                                                }

                                                markedCount++;
                                                console.log(`✅ Marked other category (${categoryName}) note: ${note.note.substring(0, 30)}...`);
                                            }
                                        });
                                    }

                                    // Mark other category file-level notes
                                    if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
                                        otherCategory.document.files.forEach(file => {
                                            if (file && file.notes && Array.isArray(file.notes)) {
                                                file.notes.forEach((note, index) => {
                                                    const matchingNote = notesToMarkArray.find(unreadNote =>
                                                        unreadNote.note === note.note &&
                                                        unreadNote.addedBy === note.addedBy &&
                                                        new Date(unreadNote.addedAt).getTime() === new Date(note.addedAt).getTime() &&
                                                        parseInt(yearKey) === unreadNote.year &&
                                                        parseInt(monthKey) === unreadNote.month &&
                                                        unreadNote.noteLevel === 'file' &&
                                                        unreadNote.categoryType === 'other' &&
                                                        unreadNote.categoryName === categoryName &&
                                                        unreadNote.fileName === file.fileName
                                                    );

                                                    if (matchingNote && !note.isViewedByAdmin) {
                                                        file.notes[index].isViewedByAdmin = true;

                                                        if (!file.notes[index].viewedBy) {
                                                            file.notes[index].viewedBy = [];
                                                        }

                                                        const alreadyViewed = file.notes[index].viewedBy.some(
                                                            v => v.userId === adminId && v.userType === 'admin'
                                                        );

                                                        if (!alreadyViewed) {
                                                            file.notes[index].viewedBy.push({
                                                                userId: adminId,
                                                                userType: 'admin',
                                                                viewedAt: new Date()
                                                            });
                                                        }

                                                        markedCount++;
                                                        console.log(`✅ Marked other category (${categoryName}) file note: ${note.note.substring(0, 30)}...`);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                }
                            });
                        }
                    }
                }

                return true;
            } catch (error) {
                console.error("Error marking notes in documents:", error);
                return false;
            }
        };

        // Mark the notes in the documents
        const markingSuccessful = markNotesInDocuments(clientObj.documents, unreadNotesToMark);

        if (!markingSuccessful) {
            return res.status(500).json({
                success: false,
                message: "Failed to mark notes as viewed"
            });
        }

        console.log("🔍 DEBUG: After marking -", {
            markedCount,
            clientObjDocuments: JSON.stringify(clientObj.documents, null, 2).substring(0, 500) + '...'
        });

        // Save the updated client
        const updatedClient = await Client.findOneAndUpdate(
            { clientId },
            { $set: { documents: clientObj.documents } },
            { new: true }
        );

        if (!updatedClient) {
            return res.status(500).json({
                success: false,
                message: "Failed to save updated client"
            });
        }

        // Get updated unread count
        const notesAfterUpdate = extractNotesFromClient(updatedClient);
        const updatedUnread = notesAfterUpdate.filter(n => !n.isViewedByAdmin).length;
        const unreadBefore = notesBeforeUpdate.filter(n => !n.isViewedByAdmin).length;

        // Verify marked count makes sense
        const expectedMarked = unreadBefore - updatedUnread;

        console.log("🔍 DEBUG: Final verification -", {
            unreadNotesBeforeUpdate: unreadBefore,
            unreadNotesAfterUpdate: updatedUnread,
            expectedMarkedCount: expectedMarked,
            actualMarkedCount: markedCount
        });

        logToConsole("SUCCESS", "NOTES_MARKED_AS_VIEWED", {
            clientId,
            clientName: client.name,
            unreadBefore,
            unreadAfter: updatedUnread,
            markedCount,
            expectedMarked,
            adminId
        });

        res.json({
            success: true,
            message: `Marked ${markedCount} notes as viewed`,
            markedCount,
            remainingUnread: updatedUnread,
            client: {
                clientId: updatedClient.clientId,
                name: updatedClient.name,
                totalNotes: notesAfterUpdate.length,
                unreadNotes: updatedUnread
            },
            verification: {
                unreadBefore,
                unreadAfter: updatedUnread,
                expectedMarked
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
   GET MONTHLY UNREAD NOTES STATISTICS
================================ */
router.get("/monthly-stats", async (req, res) => {
    try {
        logToConsole("INFO", "GET_MONTHLY_NOTES_STATS_REQUEST", {
            ip: req.ip
        });

        const allClients = await Client.find({ isActive: true });

        const monthlyStats = {};
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // Initialize last 6 months
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

        // Process each client
        for (const client of allClients) {
            const notes = extractNotesFromClient(client);

            notes.forEach(note => {
                if (!note.year || !note.month) return;

                const key = `${note.year}-${String(note.month).padStart(2, '0')}`;

                if (monthlyStats[key]) {
                    monthlyStats[key].totalNotes++;

                    if (!note.isViewedByAdmin) {
                        monthlyStats[key].unreadNotes++;
                    }
                }
            });
        }

        // Count clients with unread notes for each month
        for (const client of allClients) {
            const notes = extractNotesFromClient(client);
            const unreadByMonth = {};

            notes.filter(note => !note.isViewedByAdmin).forEach(note => {
                if (!note.year || !note.month) return;

                const key = `${note.year}-${String(note.month).padStart(2, '0')}`;
                unreadByMonth[key] = true;
            });

            Object.keys(unreadByMonth).forEach(key => {
                if (monthlyStats[key]) {
                    monthlyStats[key].clientsWithUnread++;
                }
            });
        }

        // Convert to array and sort by date (newest first)
        const statsArray = Object.values(monthlyStats).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });

        logToConsole("SUCCESS", "MONTHLY_STATS_FETCHED", {
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
   GET NOTES STATISTICS FOR DASHBOARD
================================ */
router.get("/dashboard-stats", async (req, res) => {
    try {
        logToConsole("INFO", "GET_DASHBOARD_NOTES_STATS_REQUEST", {
            ip: req.ip
        });

        const allClients = await Client.find({ isActive: true });

        let totalNotes = 0;
        let totalUnread = 0;
        let totalRead = 0;
        let clientsWithUnread = 0;
        const recentNotes = [];
        const noteSources = {
            client: 0,
            employee: 0,
            admin: 0
        };

        for (const client of allClients) {
            const notes = extractNotesFromClient(client);
            totalNotes += notes.length;

            const clientUnread = notes.filter(note => !note.isViewedByAdmin).length;
            totalUnread += clientUnread;
            totalRead += notes.length - clientUnread;

            if (clientUnread > 0) {
                clientsWithUnread++;
            }

            // Add recent notes (last 10)
            notes.forEach(note => {
                recentNotes.push({
                    ...note,
                    clientName: client.name || `${client.firstName} ${client.lastName}`
                });
            });

            // Count note sources
            notes.forEach(note => {
                if (note.employeeId) {
                    noteSources.employee++;
                } else if (note.addedBy && note.addedBy.includes('admin')) {
                    noteSources.admin++;
                } else {
                    noteSources.client++;
                }
            });
        }

        // Sort recent notes by date (newest first) and take top 10
        recentNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
        const topRecentNotes = recentNotes.slice(0, 10);

        logToConsole("SUCCESS", "DASHBOARD_STATS_FETCHED", {
            totalNotes,
            totalUnread,
            totalRead,
            clientsWithUnread,
            totalClients: allClients.length
        });

        res.json({
            success: true,
            stats: {
                totalNotes,
                totalUnread,
                totalRead,
                clientsWithUnread,
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