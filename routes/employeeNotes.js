const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Client = require("../models/Client");
const Employee = require("../models/Employee");

// Console logging utility (same as admin)
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


const extractNotesForEmployee = (client, employeeId) => {
  const notes = [];
  const clientId = client.clientId;
  const clientName = client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client';

  // Helper function to debug note structure
  const debugNoteStructure = (noteObj, context) => {
    console.log(`🔍 DEBUG NOTE STRUCTURE for ${employeeId}:`, {
      notePreview: noteObj.note?.substring(0, 30) + '...',
      employeeId: noteObj.employeeId,
      clientNote: !noteObj.employeeId,
      isOwnNote: noteObj.employeeId === employeeId,
      viewedBy: noteObj.viewedBy,
      isViewedByEmployee: noteObj.isViewedByEmployee,
      hasIsViewedByEmployeeField: noteObj.hasOwnProperty('isViewedByEmployee'),
      context: context.contextType,
      month: `${context.year}-${context.month}`
    });
  };

  // Helper to add note with context
  const addNote = (noteObj, context) => {
    if (!noteObj || !noteObj.note) return;

    // EMPLOYEE RULE: Only show notes from client OR notes added by this employee
    const isClientNote = !noteObj.employeeId;
    const isOwnNote = noteObj.employeeId === employeeId;

    if (!isClientNote && !isOwnNote) {
      // Skip notes from other employees
      return;
    }

    // ✅ FIX: Check if this employee has viewed the note
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

      // ✅ FIXED: View tracking
      isViewedByAdmin: noteObj.isViewedByAdmin || false,
      isViewedByClient: noteObj.isViewedByClient || false,
      isViewedByEmployee: isViewedByEmployee, // ✅ Now correctly calculated
      viewedBy: noteObj.viewedBy || [],

      // Note source: client or employee
      noteSource: isClientNote ? 'client' : 'employee',

      // Context
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

    // Debug log for unread notes
    if (!isViewedByEmployee) {
      console.log(`🚨 EMPLOYEE ${employeeId} - UNREAD NOTE FOUND:`, {
        client: clientName,
        month: `${context.year}-${context.month}`,
        level: context.noteLevel,
        source: isClientNote ? 'client' : 'employee',
        addedBy: noteObj.addedBy,
        notePreview: noteObj.note.substring(0, 50) + '...'
      });
    }
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
            if (category.files && Array.isArray(category.files)) {
              category.files.forEach(file => {
                if (file && file.notes && Array.isArray(file.notes)) {
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
      }
    }

    console.log(`✅ Employee ${employeeId} - Notes extracted for client ${clientId}: ${notes.length}`);
    console.log(`   - Client notes: ${notes.filter(n => n.noteSource === 'client').length}`);
    console.log(`   - Own notes: ${notes.filter(n => n.noteSource === 'employee').length}`);
    console.log(`   - Unread notes: ${notes.filter(n => !n.isViewedByEmployee).length}`);

  } catch (error) {
    console.error('❌ Error extracting notes from client:', error);
    logToConsole("ERROR", "EXTRACT_NOTES_ERROR", {
      clientId: client.clientId,
      employeeId,
      error: error.message
    });
  }

  return notes;
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
   GET UNREAD NOTES COUNT FOR EMPLOYEE
================================ */
router.get("/unread-count", async (req, res) => {
  try {
    logToConsole("INFO", "EMPLOYEE_GET_UNREAD_NOTES_COUNT", {
      ip: req.ip
    });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({
        success: false,
        message: "Employee authentication failed"
      });
    }

    // Get all assigned clients
    const assignedClients = employee.assignedClients || [];
    if (assignedClients.length === 0) {
      return res.json({
        success: true,
        totalUnread: 0,
        assignedClients: []
      });
    }

    // Group assignments by client
    const clientAssignments = {};
    assignedClients.forEach(assignment => {
      if (!assignment.isRemoved && assignment.clientId) {
        if (!clientAssignments[assignment.clientId]) {
          clientAssignments[assignment.clientId] = new Set();
        }
        // Store assigned months as "year-month" keys
        const key = `${assignment.year}-${assignment.month}`;
        clientAssignments[assignment.clientId].add(key);
      }
    });

    const clientIds = Object.keys(clientAssignments);
    const allClients = await Client.find({
      clientId: { $in: clientIds },
      isActive: true
    }).select("clientId name email documents");

    let totalUnread = 0;

    for (const client of allClients) {
      const assignedMonths = clientAssignments[client.clientId];
      const notes = extractNotesForEmployee(client, employee.employeeId);

      // Only count notes from assigned months
      const unreadNotes = notes.filter(note => {
        const noteKey = `${note.year}-${note.month}`;
        return !note.isViewedByEmployee && assignedMonths.has(noteKey);
      });

      totalUnread += unreadNotes.length;
    }

    logToConsole("SUCCESS", "EMPLOYEE_UNREAD_COUNT_CALCULATED", {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      totalAssignedClients: clientIds.length,
      totalUnreadNotes: totalUnread
    });

    res.json({
      success: true,
      totalUnread,
      employee: {
        employeeId: employee.employeeId,
        name: employee.name
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_UNREAD_NOTES_COUNT_ERROR", {
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


router.get("/assigned-clients", async (req, res) => {
  try {
    logToConsole("INFO", "EMPLOYEE_GET_ASSIGNED_CLIENTS", {
      ip: req.ip
    });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({
        success: false,
        message: "Employee authentication failed"
      });
    }

    console.log(`\n👨‍💼 ===== START: Processing employee ${employee.employeeId} (${employee.name}) =====\n`);

    // Get all assigned clients (not removed)
    const assignedClients = employee.assignedClients.filter(a => !a.isRemoved);

    if (assignedClients.length === 0) {
      console.log(`ℹ️ No assigned clients for employee ${employee.employeeId}`);
      return res.json({
        success: true,
        clients: [],
        totals: {
          totalClients: 0,
          totalUnread: 0
        }
      });
    }

    console.log(`📋 Total assigned clients (not removed): ${assignedClients.length}`);

    // Group by client and collect assigned months
    const clientMap = new Map();
    assignedClients.forEach(assignment => {
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

      // Track latest assignment
      if (!clientData.latestAssignment ||
        new Date(assignment.assignedAt) > new Date(clientData.latestAssignment.assignedAt)) {
        clientData.latestAssignment = {
          year: assignment.year,
          month: assignment.month,
          assignedAt: assignment.assignedAt,
          task: assignment.task
        };
      }
    });

    console.log(`📊 Unique clients assigned: ${clientMap.size}`);

    // Get client details from Client collection
    const clientIds = Array.from(clientMap.keys());
    const clientsFromDB = await Client.find({
      clientId: { $in: clientIds },
      isActive: true
    }).select("clientId name email phone firstName lastName documents");

    console.log(`✅ Found ${clientsFromDB.length} active clients in database`);

    const clientsSummary = [];

    for (const client of clientsFromDB) {
      const clientData = clientMap.get(client.clientId);
      const notes = extractNotesForEmployee(client, employee.employeeId);

      // ================= DETAILED DEBUG LOGS =================
      console.log(`\n🔍 ===== PROCESSING CLIENT: ${client.clientId} (${client.name}) =====`);
      console.log(`📅 Assigned months:`, Array.from(clientData.assignedMonths));
      console.log(`📝 Total notes extracted: ${notes.length}`);

      // Count notes by source and view status
      const clientNotes = notes.filter(n => n.noteSource === 'client');
      const employeeNotes = notes.filter(n => n.noteSource === 'employee');
      const unreadNotes = notes.filter(n => !n.isViewedByEmployee);
      const readNotes = notes.filter(n => n.isViewedByEmployee);

      console.log(`   - Client notes: ${clientNotes.length}`);
      console.log(`   - Employee notes: ${employeeNotes.length}`);
      console.log(`   - Read notes: ${readNotes.length}`);
      console.log(`   - Unread notes: ${unreadNotes.length}`);

      // Show detailed breakdown of unread notes
      if (unreadNotes.length > 0) {
        console.log(`   🚨 UNREAD NOTES DETAILS:`);
        unreadNotes.forEach((note, index) => {
          const noteKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
          const isAssigned = clientData.assignedMonths.has(noteKey);

          console.log(`     ${index + 1}. ${noteKey} - ${note.noteLevel} - ${note.noteSource.toUpperCase()}`);
          console.log(`        Note: ${note.note.substring(0, 50)}...`);
          console.log(`        Added by: ${note.addedBy}`);
          console.log(`        Added at: ${note.addedAt}`);
          console.log(`        Assigned month? ${isAssigned ? '✅' : '❌'}`);
          console.log(`        View status: Employee ${note.isViewedByEmployee ? '✅ READ' : '🚨 UNREAD'}`);
        });
      }

      // Count unread notes only from assigned months
      const unreadNotesFromAssigned = notes.filter(note => {
        const noteKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
        const isAssigned = clientData.assignedMonths.has(noteKey);
        const isUnread = !note.isViewedByEmployee;

        return isUnread && isAssigned;
      });

      console.log(`🎯 FINAL UNREAD COUNT (assigned months only): ${unreadNotesFromAssigned.length}`);

      // Debug: Show which assigned months have unread notes
      clientData.assignedMonths.forEach(monthKey => {
        const monthUnread = notes.filter(note => {
          const noteMonthKey = `${note.year}-${String(note.month).padStart(2, '0')}`;
          return noteMonthKey === monthKey && !note.isViewedByEmployee;
        });

        if (monthUnread.length > 0) {
          console.log(`   📍 ${monthKey}: ${monthUnread.length} unread notes`);
        }
      });

      const assignedMonthsArray = Array.from(clientData.assignedMonths)
        .map(key => {
          const [year, month] = key.split('-');
          return {
            year: parseInt(year),
            month: parseInt(month),
            monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
          };
        })
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        });

      // Find the latest unread note
      let latestUnreadNote = null;
      if (unreadNotesFromAssigned.length > 0) {
        latestUnreadNote = unreadNotesFromAssigned.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0];
        console.log(`📌 Latest unread note:`, {
          month: `${latestUnreadNote.year}-${latestUnreadNote.month}`,
          addedAt: latestUnreadNote.addedAt,
          addedBy: latestUnreadNote.addedBy,
          noteSource: latestUnreadNote.noteSource,
          notePreview: latestUnreadNote.note.substring(0, 50) + '...'
        });
      }

      clientsSummary.push({
        clientId: client.clientId,
        clientName: client.name || `${client.firstName} ${client.lastName}` || 'Unknown Client',
        email: client.email,
        phone: client.phone,

        // Notes statistics
        totalNotes: notes.length,
        unreadCount: unreadNotesFromAssigned.length,

        // Assignment info
        assignedMonths: assignedMonthsArray,
        latestAssignment: clientData.latestAssignment,

        // Latest unread note
        latestUnreadNote: latestUnreadNote
      });

      console.log(`✅ Client ${client.clientId} processing complete\n`);
    }

    // Sort: 1) Has unread notes, 2) Recent assignments
    clientsSummary.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      if (a.latestAssignment && b.latestAssignment) {
        return new Date(b.latestAssignment.assignedAt) - new Date(a.latestAssignment.assignedAt);
      }
      return 0;
    });

    // Final debug summary
    const totalUnread = clientsSummary.reduce((sum, client) => sum + client.unreadCount, 0);
    const clientsWithUnread = clientsSummary.filter(c => c.unreadCount > 0).length;

    console.log(`\n📊 ===== FINAL SUMMARY for Employee ${employee.employeeId} =====`);
    console.log(`   Total clients: ${clientsSummary.length}`);
    console.log(`   Total unread notes: ${totalUnread}`);
    console.log(`   Clients with unread: ${clientsWithUnread}`);

    if (clientsWithUnread > 0) {
      console.log(`   🚨 CLIENTS WITH UNREAD NOTES:`);
      clientsSummary.forEach(client => {
        if (client.unreadCount > 0) {
          console.log(`   - ${client.clientName} (${client.clientId}): ${client.unreadCount} unread`);
        }
      });
    } else {
      console.log(`   ✅ No clients with unread notes found`);
    }

    console.log(`\n👨‍💼 ===== END: Processing employee ${employee.employeeId} =====\n`);

    logToConsole("SUCCESS", "EMPLOYEE_ASSIGNED_CLIENTS_FETCHED", {
      employeeId: employee.employeeId,
      totalClients: clientsSummary.length,
      totalUnreadNotes: totalUnread,
      clientsWithUnread: clientsWithUnread
    });

    res.json({
      success: true,
      clients: clientsSummary,
      totals: {
        totalClients: clientsSummary.length,
        totalUnread: totalUnread
      },
      employee: {
        employeeId: employee.employeeId,
        name: employee.name
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`\n❌ ERROR in /assigned-clients route:`, error);
    logToConsole("ERROR", "EMPLOYEE_ASSIGNED_CLIENTS_ERROR", {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: "Error fetching assigned clients",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
/* ===============================
   GET NOTES FOR SPECIFIC ASSIGNED CLIENT
================================ */
router.get("/client/:clientId/notes", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { year, month } = req.query;

    logToConsole("INFO", "EMPLOYEE_GET_CLIENT_NOTES", {
      clientId,
      year,
      month,
      employeeId: req.employeeId,
      ip: req.ip
    });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({
        success: false,
        message: "Employee authentication failed"
      });
    }

    // Check if employee is assigned to this client
    const assignment = employee.assignedClients.find(
      a => a.clientId === clientId && !a.isRemoved
    );

    if (!assignment) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this client"
      });
    }

    // Get all assignments for this client to know assigned months
    const clientAssignments = employee.assignedClients.filter(
      a => a.clientId === clientId && !a.isRemoved
    );

    // Create set of assigned month keys
    const assignedMonthKeys = new Set();
    clientAssignments.forEach(a => {
      const key = `${a.year}-${a.month}`;
      assignedMonthKeys.add(key);
    });

    // If year/month provided, validate it's an assigned month
    if (year && month) {
      const requestedKey = `${parseInt(year)}-${parseInt(month)}`;
      if (!assignedMonthKeys.has(requestedKey)) {
        return res.status(403).json({
          success: false,
          message: "You are not assigned to this client for the requested month"
        });
      }
    }

    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Extract all notes for this client
    let notes = extractNotesForEmployee(client, employee.employeeId);

    // Filter by assigned months
    notes = notes.filter(note => {
      const noteKey = `${note.year}-${note.month}`;
      return assignedMonthKeys.has(noteKey);
    });

    // Apply year/month filter if provided
    if (year) {
      const yearNum = parseInt(year);
      notes = notes.filter(note => note.year === yearNum);
    }

    if (month) {
      const monthNum = parseInt(month);
      notes = notes.filter(note => note.month === monthNum);
    }

    // Sort by date (newest first)
    notes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    // Group notes by month
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
      if (note.isViewedByEmployee) {
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

    // Get assigned months for filter dropdown
    const assignedMonths = Array.from(assignedMonthKeys)
      .map(key => {
        const [year, month] = key.split('-');
        return {
          year: parseInt(year),
          month: parseInt(month),
          monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

    // Find latest assigned month
    const latestAssignedMonth = assignedMonths.length > 0 ? assignedMonths[0] : null;

    logToConsole("SUCCESS", "EMPLOYEE_CLIENT_NOTES_FETCHED", {
      employeeId: employee.employeeId,
      clientId,
      clientName: client.name,
      totalNotes: notes.length,
      unreadNotes: notes.filter(n => !n.isViewedByEmployee).length,
      assignedMonthsCount: assignedMonths.length,
      latestMonth: latestAssignedMonth ? `${latestAssignedMonth.year}-${latestAssignedMonth.month}` : 'None'
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
          unread: notes.filter(n => !n.isViewedByEmployee).length,
          read: notes.filter(n => n.isViewedByEmployee).length,
          clientNotes: notes.filter(n => n.noteSource === 'client').length,
          ownNotes: notes.filter(n => n.noteSource === 'employee').length
        }
      },
      filters: {
        assignedMonths,
        latestAssignedMonth,
        currentFilter: {
          year: year || (latestAssignedMonth ? latestAssignedMonth.year : null),
          month: month || (latestAssignedMonth ? latestAssignedMonth.month : null)
        }
      },
      employee: {
        employeeId: employee.employeeId,
        name: employee.name
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_CLIENT_NOTES_ERROR", {
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
   MARK NOTES AS VIEWED BY EMPLOYEE
================================ */
router.post("/mark-as-viewed", async (req, res) => {
  try {
    const { clientId, noteIds, filter, markAll = false } = req.body;

    logToConsole("INFO", "EMPLOYEE_MARK_NOTES_AS_VIEWED", {
      clientId,
      noteIdsCount: noteIds?.length || 0,
      markAll,
      filter,
      ip: req.ip
    });

    const employee = await getEmployeeFromToken(req);
    if (!employee) {
      return res.status(401).json({
        success: false,
        message: "Employee authentication failed"
      });
    }

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    // Check if employee is assigned to this client
    const clientAssignments = employee.assignedClients.filter(
      a => a.clientId === clientId && !a.isRemoved
    );

    if (clientAssignments.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this client"
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
    const notesBeforeUpdate = extractNotesForEmployee(client, employee.employeeId);

    // Filter notes by assigned months
    const assignedMonthKeys = new Set();
    clientAssignments.forEach(a => {
      const key = `${a.year}-${a.month}`;
      assignedMonthKeys.add(key);
    });

    let notesToMark = notesBeforeUpdate.filter(note => {
      const noteKey = `${note.year}-${note.month}`;
      return assignedMonthKeys.has(noteKey);
    });

    // Apply filter if provided
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

    // If specific note IDs are provided, only mark those
    if (noteIds && noteIds.length > 0) {
      notesToMark = notesToMark.filter(note => noteIds.includes(note.noteId));
    }

    // Filter only unread notes (by employee)
    const unreadNotesToMark = notesToMark.filter(note => !note.isViewedByEmployee);

    if (unreadNotesToMark.length === 0) {
      return res.json({
        success: true,
        message: "No unread notes to mark as viewed",
        markedCount: 0
      });
    }

    console.log("🔍 EMPLOYEE DEBUG: Notes to mark as viewed:", {
      employeeId: employee.employeeId,
      totalNotesBeforeUpdate: notesBeforeUpdate.length,
      unreadNotesBeforeUpdate: notesBeforeUpdate.filter(n => !n.isViewedByEmployee).length,
      unreadNotesToMarkCount: unreadNotesToMark.length
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

            // Check if employee is assigned to this month
            const monthKeyCheck = `${parseInt(yearKey)}-${parseInt(monthKey)}`;
            if (!assignedMonthKeys.has(monthKeyCheck)) {
              continue; // Skip months not assigned to employee
            }

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

                if (matchingNote && !note.isViewedByEmployee) {
                  monthData.monthNotes[index].isViewedByEmployee = true;

                  if (!monthData.monthNotes[index].viewedBy) {
                    monthData.monthNotes[index].viewedBy = [];
                  }

                  const alreadyViewed = monthData.monthNotes[index].viewedBy.some(
                    v => v.userId === employee.employeeId && v.userType === 'employee'
                  );

                  if (!alreadyViewed) {
                    monthData.monthNotes[index].viewedBy.push({
                      userId: employee.employeeId,
                      userType: 'employee',
                      viewedAt: new Date()
                    });
                  }

                  markedCount++;
                  console.log(`✅ Employee marked month-level note as read`);
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

                    if (matchingNote && !note.isViewedByEmployee) {
                      category.categoryNotes[index].isViewedByEmployee = true;

                      if (!category.categoryNotes[index].viewedBy) {
                        category.categoryNotes[index].viewedBy = [];
                      }

                      const alreadyViewed = category.categoryNotes[index].viewedBy.some(
                        v => v.userId === employee.employeeId && v.userType === 'employee'
                      );

                      if (!alreadyViewed) {
                        category.categoryNotes[index].viewedBy.push({
                          userId: employee.employeeId,
                          userType: 'employee',
                          viewedAt: new Date()
                        });
                      }

                      markedCount++;
                      console.log(`✅ Employee marked ${categoryType} category note as read`);
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

                        if (matchingNote && !note.isViewedByEmployee) {
                          file.notes[index].isViewedByEmployee = true;

                          if (!file.notes[index].viewedBy) {
                            file.notes[index].viewedBy = [];
                          }

                          const alreadyViewed = file.notes[index].viewedBy.some(
                            v => v.userId === employee.employeeId && v.userType === 'employee'
                          );

                          if (!alreadyViewed) {
                            file.notes[index].viewedBy.push({
                              userId: employee.employeeId,
                              userType: 'employee',
                              viewedAt: new Date()
                            });
                          }

                          markedCount++;
                          console.log(`✅ Employee marked ${categoryType} file note as read`);
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

                      if (matchingNote && !note.isViewedByEmployee) {
                        otherCategory.document.categoryNotes[index].isViewedByEmployee = true;

                        if (!otherCategory.document.categoryNotes[index].viewedBy) {
                          otherCategory.document.categoryNotes[index].viewedBy = [];
                        }

                        const alreadyViewed = otherCategory.document.categoryNotes[index].viewedBy.some(
                          v => v.userId === employee.employeeId && v.userType === 'employee'
                        );

                        if (!alreadyViewed) {
                          otherCategory.document.categoryNotes[index].viewedBy.push({
                            userId: employee.employeeId,
                            userType: 'employee',
                            viewedAt: new Date()
                          });
                        }

                        markedCount++;
                        console.log(`✅ Employee marked other category (${categoryName}) note as read`);
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

                          if (matchingNote && !note.isViewedByEmployee) {
                            file.notes[index].isViewedByEmployee = true;

                            if (!file.notes[index].viewedBy) {
                              file.notes[index].viewedBy = [];
                            }

                            const alreadyViewed = file.notes[index].viewedBy.some(
                              v => v.userId === employee.employeeId && v.userType === 'employee'
                            );

                            if (!alreadyViewed) {
                              file.notes[index].viewedBy.push({
                                userId: employee.employeeId,
                                userType: 'employee',
                                viewedAt: new Date()
                              });
                            }

                            markedCount++;
                            console.log(`✅ Employee marked other category (${categoryName}) file note as read`);
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
        console.error("Employee error marking notes in documents:", error);
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
    const notesAfterUpdate = extractNotesForEmployee(updatedClient, employee.employeeId);
    const updatedUnread = notesAfterUpdate.filter(n =>
      !n.isViewedByEmployee && assignedMonthKeys.has(`${n.year}-${n.month}`)
    ).length;

    logToConsole("SUCCESS", "EMPLOYEE_NOTES_MARKED_AS_VIEWED", {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      clientId,
      markedCount,
      remainingUnread: updatedUnread
    });

    res.json({
      success: true,
      message: `Marked ${markedCount} notes as viewed`,
      markedCount,
      remainingUnread: updatedUnread,
      client: {
        clientId: updatedClient.clientId,
        name: updatedClient.name
      },
      employee: {
        employeeId: employee.employeeId,
        name: employee.name
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_MARK_NOTES_AS_VIEWED_ERROR", {
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

module.exports = router;