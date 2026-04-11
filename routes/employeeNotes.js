const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Client = require("../models/Client");
const ClientMonthlyData = require("../models/ClientMonthlyData");
const Employee = require("../models/Employee");

// Console logging utility (same as admin)
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Europe/Helsinki"  // Finland timezone
  });
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

/* ===============================
   FIXED: EXTRACT NOTES FOR EMPLOYEE - SHOWS ALL NOTES FROM ALL EMPLOYEES
================================ */
const extractNotesForEmployee = async (client, employeeId) => {
  const notes = [];
  const clientId = client.clientId;
  const clientName = client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client';

  // Helper to add note with context
  const addNote = (noteObj, context) => {
    if (!noteObj || !noteObj.note) return;

    // EMPLOYEE RULE: 
    // 1. Client notes (no employeeId) - ALWAYS show
    // 2. Employee notes (has employeeId) - ALWAYS show (all employees can see each other's notes)
    const isClientNote = !noteObj.employeeId;

    // ✅ FIXED: Show ALL notes - both client notes AND all employee notes
    // No filtering by employeeId anymore - all employees see all notes

    // Check if this employee has viewed the note
    let isViewedByEmployee = false;

    // First check the viewedBy array
    if (noteObj.viewedBy && Array.isArray(noteObj.viewedBy)) {
      const employeeView = noteObj.viewedBy.find(
        viewer => viewer.userId === employeeId && viewer.userType === 'employee'
      );
      isViewedByEmployee = !!employeeView;
    }

    // If not found in viewedBy, check direct boolean field
    if (!isViewedByEmployee && noteObj.isViewedByEmployee !== undefined) {
      isViewedByEmployee = noteObj.isViewedByEmployee;
    }

    const noteId = noteObj._id || generateNoteId();

    notes.push({
      noteId,
      note: noteObj.note,
      addedBy: noteObj.addedBy || 'Unknown',
      addedAt: noteObj.addedAt || new Date(),
      employeeId: noteObj.employeeId,
      employeeName: noteObj.employeeName,

      isViewedByAdmin: noteObj.isViewedByAdmin || false,
      isViewedByClient: noteObj.isViewedByClient || false,
      isViewedByEmployee: isViewedByEmployee,
      viewedBy: noteObj.viewedBy || [],

      noteSource: isClientNote ? 'client' : 'employee',

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

  // Helper to process month data (works for both OLD and NEW structure)
  const processMonthData = (monthData, year, month) => {
    if (!monthData || typeof monthData !== 'object') return;

    // 1. Month-level notes (only client can add these)
    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
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

        // Category-level notes (only client can add these)
        if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
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

        // File-level notes (employees can add these)
        // ✅ FIXED: Show ALL file notes, not just current employee's notes
        if (category.files && Array.isArray(category.files)) {
          category.files.forEach(file => {
            if (file && file.notes && Array.isArray(file.notes)) {
              file.notes.forEach(note => {
                // ✅ REMOVED the employeeId filter - show ALL employee notes
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
          // ✅ FIXED: Show ALL file notes
          if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
            otherCategory.document.files.forEach(file => {
              if (file && file.notes && Array.isArray(file.notes)) {
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
    }
  };

  // ===== 1. FIRST: Check NEW ClientMonthlyData collection =====
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });
    if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
      for (const monthData of newDoc.months) {
        processMonthData(monthData, monthData.year, monthData.month);
      }
      console.log(`✅ Employee ${employeeId} - Extracted notes from NEW collection for client ${clientId}: ${notes.length}`);
    }
  } catch (error) {
    console.error('❌ Error extracting notes from NEW collection:', error);
    logToConsole("ERROR", "EXTRACT_NOTES_NEW_COLLECTION_ERROR", {
      clientId: client.clientId,
      employeeId,
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

    // Handle both Map and object formats
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

    // Iterate through all years and months in OLD documents
    for (const yearKey in documentsObj) {
      const year = parseInt(yearKey);
      const yearData = documentsObj[yearKey];
      if (!yearData || typeof yearData !== 'object') continue;

      for (const monthKey in yearData) {
        const month = parseInt(monthKey);
        const monthData = yearData[monthKey];
        if (!monthData || typeof monthData !== 'object') continue;

        processMonthData(monthData, year, month);
      }
    }

    console.log(`✅ Employee ${employeeId} - Extracted notes from OLD collection for client ${clientId}: Total now ${notes.length}`);

  } catch (error) {
    console.error('❌ Error extracting notes from OLD documents:', error);
    logToConsole("ERROR", "EXTRACT_NOTES_OLD_DOCUMENTS_ERROR", {
      clientId: client.clientId,
      employeeId,
      error: error.message
    });
  }

  return notes;
};


/* ===============================
   OPTIMIZED: EXTRACT NOTES FOR EMPLOYEE - USES PRE-LOADED MONTH DATA
   Same output format as original, but uses batch-loaded data
================================ */
const extractNotesForEmployeeOptimized = async (client, employeeId, preloadedMonthDataMap = null) => {
  const notes = [];
  const clientId = client.clientId;
  const clientName = client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client';

  const addNote = (noteObj, context) => {
    if (!noteObj || !noteObj.note) return;

    let isViewedByEmployee = false;

    if (noteObj.viewedBy && Array.isArray(noteObj.viewedBy)) {
      const employeeView = noteObj.viewedBy.find(
        viewer => viewer.userId === employeeId && viewer.userType === 'employee'
      );
      isViewedByEmployee = !!employeeView;
    }

    if (!isViewedByEmployee && noteObj.isViewedByEmployee !== undefined) {
      isViewedByEmployee = noteObj.isViewedByEmployee;
    }

    const noteId = noteObj._id || generateNoteId();

    notes.push({
      noteId,
      note: noteObj.note,
      addedBy: noteObj.addedBy || 'Unknown',
      addedAt: noteObj.addedAt || new Date(),
      employeeId: noteObj.employeeId,
      employeeName: noteObj.employeeName,
      isViewedByAdmin: noteObj.isViewedByAdmin || false,
      isViewedByClient: noteObj.isViewedByClient || false,
      isViewedByEmployee: isViewedByEmployee,
      viewedBy: noteObj.viewedBy || [],
      noteSource: !noteObj.employeeId ? 'client' : 'employee',
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

  const processMonthData = (monthData, year, month) => {
    if (!monthData || typeof monthData !== 'object') return;

    // Month-level notes
    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      monthData.monthNotes.forEach(note => {
        addNote(note, { contextType: 'month', year, month, noteLevel: 'month' });
      });
    }

    // Main categories
    ['sales', 'purchase', 'bank'].forEach(categoryType => {
      if (monthData[categoryType] && typeof monthData[categoryType] === 'object') {
        const category = monthData[categoryType];

        if (category.categoryNotes && Array.isArray(category.categoryNotes)) {
          category.categoryNotes.forEach(note => {
            addNote(note, { contextType: 'category', year, month, categoryType, noteLevel: 'category' });
          });
        }

        if (category.files && Array.isArray(category.files)) {
          category.files.forEach(file => {
            if (file && file.notes && Array.isArray(file.notes)) {
              file.notes.forEach(note => {
                addNote(note, { contextType: 'file', year, month, categoryType, fileName: file.fileName, fileUrl: file.url, noteLevel: 'file' });
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
          const categoryType = 'other';
          const categoryName = otherCategory.categoryName;

          if (otherCategory.document.categoryNotes && Array.isArray(otherCategory.document.categoryNotes)) {
            otherCategory.document.categoryNotes.forEach(note => {
              addNote(note, { contextType: 'category', year, month, categoryType, categoryName, noteLevel: 'category' });
            });
          }

          if (otherCategory.document.files && Array.isArray(otherCategory.document.files)) {
            otherCategory.document.files.forEach(file => {
              if (file && file.notes && Array.isArray(file.notes)) {
                file.notes.forEach(note => {
                  addNote(note, { contextType: 'file', year, month, categoryType, categoryName, fileName: file.fileName, fileUrl: file.url, noteLevel: 'file' });
                });
              }
            });
          }
        }
      });
    }
  };

  // ===== 1. Process NEW collection using pre-loaded data =====
  if (preloadedMonthDataMap) {
    for (const [key, monthData] of preloadedMonthDataMap.entries()) {
      const [docClientId, year, month] = key.split('-');
      if (docClientId === clientId) {
        processMonthData(monthData, parseInt(year), parseInt(month));
      }
    }
  } else {
    // Fallback to direct query if no preloaded data
    try {
      const newDoc = await ClientMonthlyData.findOne({ clientId: client.clientId });
      if (newDoc && newDoc.months && Array.isArray(newDoc.months)) {
        for (const monthData of newDoc.months) {
          processMonthData(monthData, monthData.year, monthData.month);
        }
      }
    } catch (error) {
      console.error('Error extracting notes from NEW collection:', error);
    }
  }

  // ===== 2. Process OLD client.documents =====
  if (client.documents) {
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
      }

      for (const yearKey in documentsObj) {
        const year = parseInt(yearKey);
        const yearData = documentsObj[yearKey];
        if (!yearData || typeof yearData !== 'object') continue;

        for (const monthKey in yearData) {
          const month = parseInt(monthKey);
          const monthData = yearData[monthKey];
          if (!monthData || typeof monthData !== 'object') continue;

          processMonthData(monthData, year, month);
        }
      }
    } catch (error) {
      console.error('Error extracting notes from OLD documents:', error);
    }
  }

  return notes;
};


/* ===============================
   UPDATED: MARK NOTES AS VIEWED - WORKS FOR BOTH COLLECTIONS
================================ */
const markNotesInBothCollections = async (clientId, employeeId, notesToMarkArray, assignedMonthKeys) => {
  let markedCount = 0;

  // Helper to mark notes in a month data object
  const markNotesInMonthData = (monthData, year, month, notesToMarkArray, employeeId) => {
    if (!monthData || typeof monthData !== 'object') return 0;
    let count = 0;

    // Helper function to mark a single note
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

      if (matchingNote && !note.isViewedByEmployee) {
        noteArray[noteIndex].isViewedByEmployee = true;
        if (!noteArray[noteIndex].viewedBy) {
          noteArray[noteIndex].viewedBy = [];
        }
        const alreadyViewed = noteArray[noteIndex].viewedBy.some(
          v => v.userId === employeeId && v.userType === 'employee'
        );
        if (!alreadyViewed) {
          noteArray[noteIndex].viewedBy.push({
            userId: employeeId,
            userType: 'employee',
            viewedAt: new Date()
          });
        }
        count++;
      }
    };

    // Mark month-level notes
    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      monthData.monthNotes.forEach((note, index) => {
        markNote(note, index, monthData.monthNotes, { noteLevel: 'month' });
      });
    }

    // Mark category notes in main categories
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

    // Mark other categories
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
        const monthKey = `${monthData.year}-${monthData.month}`;
        if (assignedMonthKeys.has(monthKey)) {
          const count = markNotesInMonthData(monthData, monthData.year, monthData.month, notesToMarkArray, employeeId);
          if (count > 0) {
            markedCount += count;
            newDocModified = true;
          }
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
      const documents = client.documents;
      let documentsObj = {};

      if (documents instanceof Map) {
        for (const [yearKey, yearMap] of documents.entries()) {
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
      } else if (typeof documents === 'object') {
        documentsObj = documents;
      }

      for (const yearKey in documentsObj) {
        const year = parseInt(yearKey);
        const yearData = documentsObj[yearKey];
        if (!yearData || typeof yearData !== 'object') continue;

        for (const monthKey in yearData) {
          const month = parseInt(monthKey);
          const monthKeyStr = `${year}-${month}`;
          if (assignedMonthKeys.has(monthKeyStr)) {
            const monthData = yearData[monthKey];
            if (monthData && typeof monthData === 'object') {
              const count = markNotesInMonthData(monthData, year, month, notesToMarkArray, employeeId);
              if (count > 0) {
                markedCount += count;
                clientModified = true;
              }
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

// Middleware to get employee from token
const getEmployeeFromToken = async (req) => {
  try {
    const token = req.cookies?.employeeToken;
    if (!token) return null;

    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const employee = await Employee.findOne({
      employeeId: decoded.employeeId,
      isActive: true
    });

    return employee;
  } catch (error) {
    return null;
  }
};

/* ===============================
   GET UNREAD NOTES COUNT FOR EMPLOYEE - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/unread-count", async (req, res) => {
  try {
    logToConsole("INFO", "EMPLOYEE_GET_UNREAD_NOTES_COUNT", { ip: req.ip });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({ success: false, message: "Employee authentication failed" });
    }

    // ===== READ ASSIGNMENTS FROM BOTH SOURCES =====
    const oldAssignments = (employee.assignedClients || []).filter(a => !a.isRemoved);

    let newAssignments = [];
    try {
      const EmployeeAssignment = require("../models/EmployeeAssignment");
      const newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });
      if (newDoc && newDoc.assignedClients) {
        newAssignments = newDoc.assignedClients.filter(a => !a.isRemoved);
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_READING_NEW_ASSIGNMENTS_FOR_UNREAD", { error: err.message });
    }

    const allAssignments = [...oldAssignments, ...newAssignments];

    if (allAssignments.length === 0) {
      return res.json({ success: true, totalUnread: 0, assignedClients: [] });
    }

    // Group assignments by client
    const clientAssignmentsMap = new Map(); // clientId -> Set of monthKeys
    allAssignments.forEach(assignment => {
      if (!assignment.isRemoved && assignment.clientId) {
        if (!clientAssignmentsMap.has(assignment.clientId)) {
          clientAssignmentsMap.set(assignment.clientId, new Set());
        }
        const monthKey = `${assignment.year}-${assignment.month}`;
        clientAssignmentsMap.get(assignment.clientId).add(monthKey);
      }
    });

    const clientIds = Array.from(clientAssignmentsMap.keys());

    // ===== OPTIMIZATION: BATCH LOAD ALL CLIENTS IN ONE QUERY =====
    const allClients = await Client.find({
      clientId: { $in: clientIds },
      isActive: true
    }).select("clientId name email documents firstName lastName").lean();

    // ===== OPTIMIZATION: BATCH LOAD ALL MONTH DATA IN ONE QUERY =====
    const ClientMonthlyData = require("../models/ClientMonthlyData");
    const allMonthlyData = await ClientMonthlyData.find({
      clientId: { $in: clientIds }
    }).lean();

    // Build month data map for quick lookup
    const monthDataMap = new Map(); // key: "clientId-year-month"
    for (const record of allMonthlyData) {
      if (record.months && Array.isArray(record.months)) {
        for (const month of record.months) {
          const key = `${record.clientId}-${month.year}-${month.month}`;
          monthDataMap.set(key, month);
        }
      }
    }

    // ===== OPTIMIZATION: Process all clients in memory =====
    let totalUnread = 0;

    for (const client of allClients) {
      const assignedMonths = clientAssignmentsMap.get(client.clientId);
      if (!assignedMonths) continue;

      // Get notes for this client using optimized helper
      const notes = await extractNotesForEmployeeOptimized(client, employee.employeeId, monthDataMap);

      const unreadNotes = notes.filter(note => {
        const noteKey = `${note.year}-${note.month}`;
        return !note.isViewedByEmployee && assignedMonths.has(noteKey);
      });

      totalUnread += unreadNotes.length;
    }

    logToConsole("SUCCESS", "EMPLOYEE_UNREAD_COUNT_CALCULATED_OPTIMIZED", {
      employeeId: employee.employeeId,
      totalAssignedClients: clientIds.length,
      totalUnreadNotes: totalUnread
    });

    res.json({
      success: true,
      totalUnread,
      employee: { employeeId: employee.employeeId, name: employee.name },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_UNREAD_NOTES_COUNT_ERROR", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: "Error fetching unread notes count",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   GET ASSIGNED CLIENTS - OPTIMIZED (BATCH QUERIES)
================================ */
router.get("/assigned-clients", async (req, res) => {
  try {
    logToConsole("INFO", "EMPLOYEE_GET_ASSIGNED_CLIENTS_OPTIMIZED", { ip: req.ip });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({ success: false, message: "Employee authentication failed" });
    }

    // ===== READ FROM BOTH SOURCES =====
    const oldAssignments = (employee.assignedClients || []).filter(a => !a.isRemoved);

    let newAssignments = [];
    try {
      const EmployeeAssignment = require("../models/EmployeeAssignment");
      const newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });
      if (newDoc && newDoc.assignedClients) {
        newAssignments = newDoc.assignedClients.filter(a => !a.isRemoved);
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_READING_NEW_ASSIGNMENTS", { error: err.message });
    }

    const allAssignments = [...oldAssignments, ...newAssignments];

    if (allAssignments.length === 0) {
      return res.json({
        success: true,
        clients: [],
        totals: { totalClients: 0, totalUnread: 0 }
      });
    }

    // Group by client and collect assigned months
    const clientMap = new Map();
    allAssignments.forEach(assignment => {
      if (!clientMap.has(assignment.clientId)) {
        clientMap.set(assignment.clientId, {
          clientId: assignment.clientId,
          clientName: assignment.clientName,
          assignedMonths: new Set(),
          latestAssignment: null
        });
      }
      const clientData = clientMap.get(assignment.clientId);
      const monthKey = `${assignment.year}-${String(assignment.month).padStart(2, '0')}`;
      clientData.assignedMonths.add(monthKey);
      if (!clientData.latestAssignment || new Date(assignment.assignedAt) > new Date(clientData.latestAssignment.assignedAt)) {
        clientData.latestAssignment = {
          year: assignment.year,
          month: assignment.month,
          assignedAt: assignment.assignedAt,
          task: assignment.task
        };
      }
    });

    const clientIds = Array.from(clientMap.keys());

    // ===== OPTIMIZATION: BATCH LOAD ALL CLIENTS IN ONE QUERY =====
    const clientsFromDB = await Client.find({
      clientId: { $in: clientIds },
      isActive: true
    }).select("clientId name email phone firstName lastName documents").lean();

    // ===== OPTIMIZATION: BATCH LOAD ALL MONTH DATA IN ONE QUERY =====
    const ClientMonthlyData = require("../models/ClientMonthlyData");
    const allMonthlyData = await ClientMonthlyData.find({
      clientId: { $in: clientIds }
    }).lean();

    // Build month data map
    const monthDataMap = new Map();
    for (const record of allMonthlyData) {
      if (record.months && Array.isArray(record.months)) {
        for (const month of record.months) {
          const key = `${record.clientId}-${month.year}-${month.month}`;
          monthDataMap.set(key, month);
        }
      }
    }

    // ===== OPTIMIZATION: Process all clients in memory =====
    const clientsSummary = [];

    for (const client of clientsFromDB) {
      const clientData = clientMap.get(client.clientId);

      // Use optimized extract function with pre-loaded month data
      const notes = await extractNotesForEmployeeOptimized(client, employee.employeeId, monthDataMap);

      const unreadNotesFromAssigned = notes.filter(note => {
        const noteKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
        const isAssigned = clientData.assignedMonths.has(noteKey);
        return !note.isViewedByEmployee && isAssigned;
      });

      const assignedMonthsArray = Array.from(clientData.assignedMonths)
        .map(key => {
          const [year, month] = key.split('-');
          return {
            year: parseInt(year),
            month: parseInt(month),
            monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long', timeZone: "Europe/Helsinki" })
          };
        })
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        });

      let latestUnreadNote = null;
      if (unreadNotesFromAssigned.length > 0) {
        latestUnreadNote = unreadNotesFromAssigned.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0];
      }

      clientsSummary.push({
        clientId: client.clientId,
        clientName: client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client',
        email: client.email,
        phone: client.phone,
        totalNotes: notes.length,
        unreadCount: unreadNotesFromAssigned.length,
        assignedMonths: assignedMonthsArray,
        latestAssignment: clientData.latestAssignment,
        latestUnreadNote: latestUnreadNote
      });
    }

    clientsSummary.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      if (a.latestAssignment && b.latestAssignment) {
        return new Date(b.latestAssignment.assignedAt) - new Date(a.latestAssignment.assignedAt);
      }
      return 0;
    });

    const totalUnread = clientsSummary.reduce((sum, client) => sum + client.unreadCount, 0);

    res.json({
      success: true,
      clients: clientsSummary,
      totals: { totalClients: clientsSummary.length, totalUnread },
      employee: { employeeId: employee.employeeId, name: employee.name },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_ASSIGNED_CLIENTS_ERROR", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: "Error fetching assigned clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   GET NOTES FOR SPECIFIC ASSIGNED CLIENT - READS FROM BOTH
================================ */
router.get("/client/:clientId/notes", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month } = req.query;

    logToConsole("INFO", "EMPLOYEE_GET_CLIENT_NOTES", { clientId, year, month, ip: req.ip });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({ success: false, message: "Employee authentication failed" });
    }

    // ===== READ ASSIGNMENTS FROM BOTH SOURCES =====
    let allClientAssignments = [];

    // From OLD
    const oldAssignments = (employee.assignedClients || []).filter(a => a.clientId === clientId && !a.isRemoved);
    allClientAssignments.push(...oldAssignments);

    // From NEW
    try {
      const EmployeeAssignment = require("../models/EmployeeAssignment");
      const newDoc = await EmployeeAssignment.findOne({ employeeId: employee.employeeId });
      if (newDoc && newDoc.assignedClients) {
        const newAssignments = newDoc.assignedClients.filter(a => a.clientId === clientId && !a.isRemoved);
        allClientAssignments.push(...newAssignments);
      }
    } catch (err) {
      logToConsole("WARN", "ERROR_READING_NEW_ASSIGNMENTS_FOR_CLIENT", { error: err.message });
    }

    if (allClientAssignments.length === 0) {
      return res.status(403).json({ success: false, message: "You are not assigned to this client" });
    }

    const assignedMonthKeys = new Set();
    allClientAssignments.forEach(a => {
      const key = `${a.year}-${a.month}`;
      assignedMonthKeys.add(key);
    });

    if (year && month) {
      const requestedKey = `${parseInt(year)}-${parseInt(month)}`;
      if (!assignedMonthKeys.has(requestedKey)) {
        return res.status(403).json({ success: false, message: "You are not assigned to this client for the requested month" });
      }
    }

    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    let notes = await extractNotesForEmployee(client, employee.employeeId);
    notes = notes.filter(note => {
      const noteKey = `${note.year}-${note.month}`;
      return assignedMonthKeys.has(noteKey);
    });

    if (year) {
      const yearNum = parseInt(year);
      notes = notes.filter(note => note.year === yearNum);
    }
    if (month) {
      const monthNum = parseInt(month);
      notes = notes.filter(note => note.month === monthNum);
    }

    notes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    const notesByMonth = {};
    notes.forEach(note => {
      if (!note.year || !note.month) return;
      const monthKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
      if (!notesByMonth[monthKey]) {
        notesByMonth[monthKey] = {
          year: note.year,
          month: note.month,
          monthName: new Date(note.year, note.month - 1).toLocaleString('default', { month: 'long', timeZone: "Europe/Helsinki" }),
          notes: [],
          unreadCount: 0,
          readCount: 0
        };
      }
      notesByMonth[monthKey].notes.push(note);
      if (note.isViewedByEmployee) {
        notesByMonth[monthKey].readCount++;
      } else {
        notesByMonth[monthKey].unreadCount++;
      }
    });

    const monthsArray = Object.values(notesByMonth).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    const assignedMonths = Array.from(assignedMonthKeys)
      .map(key => {
        const [year, month] = key.split('-');
        return {
          year: parseInt(year),
          month: parseInt(month),
          monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long', timeZone: "Europe/Helsinki" })
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

    const latestAssignedMonth = assignedMonths.length > 0 ? assignedMonths[0] : null;

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
          unread: notes.filter(n => !n.isViewedByEmployee).length,
          read: notes.filter(n => n.isViewedByEmployee).length,
          clientNotes: notes.filter(n => n.noteSource === 'client').length,
          employeeNotes: notes.filter(n => n.noteSource === 'employee').length
        }
      },
      filters: {
        assignedMonths,
        latestAssignedMonth,
        currentFilter: { year: year || (latestAssignedMonth ? latestAssignedMonth.year : null), month: month || (latestAssignedMonth ? latestAssignedMonth.month : null) }
      },
      employee: { employeeId: employee.employeeId, name: employee.name },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_CLIENT_NOTES_ERROR", { error: error.message, stack: error.stack, clientId: req.params.clientId });
    res.status(500).json({
      success: false,
      message: "Error fetching client notes",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ===============================
   MARK NOTES AS VIEWED BY EMPLOYEE (UPDATED - WORKS FOR BOTH)
================================ */
router.post("/mark-as-viewed", async (req, res) => {
  try {
    const { clientId, noteIds, filter, markAll = false } = req.body;

    logToConsole("INFO", "EMPLOYEE_MARK_NOTES_AS_VIEWED", { clientId, noteIdsCount: noteIds?.length || 0, markAll, filter, ip: req.ip });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({ success: false, message: "Employee authentication failed" });
    }

    if (!clientId) {
      return res.status(400).json({ success: false, message: "Client ID is required" });
    }

    const clientAssignments = employee.assignedClients.filter(a => a.clientId === clientId && !a.isRemoved);
    if (clientAssignments.length === 0) {
      return res.status(403).json({ success: false, message: "You are not assigned to this client" });
    }

    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const notesBeforeUpdate = await extractNotesForEmployee(client, employee.employeeId);

    const assignedMonthKeys = new Set();
    clientAssignments.forEach(a => {
      const key = `${a.year}-${a.month}`;
      assignedMonthKeys.add(key);
    });

    let notesToMark = notesBeforeUpdate.filter(note => {
      const noteKey = `${note.year}-${note.month}`;
      return assignedMonthKeys.has(noteKey);
    });

    if (filter) {
      const { year, month } = filter;
      if (year) {
        const yearNum = parseInt(year);
        notesToMark = notesToMark.filter(note => note.year === yearNum);
      }
      if (month) {
        const monthNum = parseInt(month);
        notesToMark = notesToMark.filter(note => note.month === monthNum);
      }
    }

    if (noteIds && noteIds.length > 0) {
      notesToMark = notesToMark.filter(note => noteIds.includes(note.noteId));
    }

    const unreadNotesToMark = notesToMark.filter(note => !note.isViewedByEmployee);

    if (unreadNotesToMark.length === 0) {
      return res.json({ success: true, message: "No unread notes to mark as viewed", markedCount: 0 });
    }

    const markedCount = await markNotesInBothCollections(clientId, employee.employeeId, unreadNotesToMark, assignedMonthKeys);

    // Get updated unread count
    const updatedClient = await Client.findOne({ clientId });
    const notesAfterUpdate = await extractNotesForEmployee(updatedClient, employee.employeeId);
    const updatedUnread = notesAfterUpdate.filter(n => !n.isViewedByEmployee && assignedMonthKeys.has(`${n.year}-${n.month}`)).length;

    logToConsole("SUCCESS", "EMPLOYEE_NOTES_MARKED_AS_VIEWED", {
      employeeId: employee.employeeId,
      clientId,
      markedCount,
      remainingUnread: updatedUnread
    });

    res.json({
      success: true,
      message: `Marked ${markedCount} notes as viewed`,
      markedCount,
      remainingUnread: updatedUnread,
      client: { clientId: client.clientId, name: client.name },
      employee: { employeeId: employee.employeeId, name: employee.name },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_MARK_NOTES_AS_VIEWED_ERROR", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: "Error marking notes as viewed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;