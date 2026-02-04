const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");
const Employee = require("../models/Employee");
const Client = require("../models/Client");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// Console logging helper
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
  console.log(`[${timestamp}] EMPLOYEE ${type}: ${operation}`, data ? JSON.stringify(data, null, 2) : '');
};

/* ===============================
   HELPER: COUNT UNVIEWED NOTES FOR EMPLOYEE IN A SPECIFIC CLIENT - SIMPLE VERSION
================================ */
const countUnviewedNotesForEmployeeInClient = (client, employeeId) => {
  try {
    console.log(`\n🔍 START: Counting unviewed notes for employee ${employeeId} in client ${client.clientId}`);

    const clientObj = client.toObject ? client.toObject() : client;
    let unviewedCount = 0;

    // Debug: Log all data
    console.log('📦 Client data structure:', {
      clientId: clientObj.clientId,
      hasDocuments: !!clientObj.documents,
      documentsKeys: Object.keys(clientObj.documents || {})
    });

    const documents = clientObj.documents || {};

    if (!documents || typeof documents !== 'object') {
      console.log('❌ No documents found');
      return 0;
    }

    // Loop through all years
    Object.keys(documents).forEach(year => {
      const yearData = documents[year];
      if (!yearData || typeof yearData !== 'object') return;

      console.log(`\n  📅 Year ${year}:`);

      // Loop through all months in this year
      Object.keys(yearData).forEach(month => {
        const monthData = yearData[month];
        if (!monthData || typeof monthData !== 'object') return;

        console.log(`\n    📆 Month ${month}:`);

        // 1. Check month-level notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
          monthData.monthNotes.forEach((note, idx) => {
            if (note && note.note && !note.isViewedByEmployee) {
              unviewedCount++;
              console.log(`      📝 Month note ${idx + 1}: "${note.note.substring(0, 50)}..." - UNVIEWED!`);
            }
          });
        }

        // 2. Check sales category
        if (monthData.sales && monthData.sales.files) {
          console.log(`    🛒 Sales category: ${monthData.sales.files.length} files`);
          monthData.sales.files.forEach((file, fileIdx) => {
            if (file && file.notes && Array.isArray(file.notes)) {
              file.notes.forEach((note, noteIdx) => {
                // Check if this note is for current employee OR has no employeeId (client note)
                const isForThisEmployee = !note.employeeId || note.employeeId === employeeId;
                if (note && note.note && isForThisEmployee && !note.isViewedByEmployee) {
                  unviewedCount++;
                  console.log(`      📄 Sales file ${fileIdx + 1}, note ${noteIdx + 1}: "${note.note.substring(0, 50)}..." - UNVIEWED!`);
                  console.log(`        Details: employeeId=${note.employeeId}, isViewedByEmployee=${note.isViewedByEmployee}`);
                }
              });
            }
          });
        }

        // 3. Check purchase category
        if (monthData.purchase && monthData.purchase.files) {
          console.log(`    🛍️ Purchase category: ${monthData.purchase.files.length} files`);
          monthData.purchase.files.forEach((file, fileIdx) => {
            if (file && file.notes && Array.isArray(file.notes)) {
              file.notes.forEach((note, noteIdx) => {
                const isForThisEmployee = !note.employeeId || note.employeeId === employeeId;
                if (note && note.note && isForThisEmployee && !note.isViewedByEmployee) {
                  unviewedCount++;
                  console.log(`      📄 Purchase file ${fileIdx + 1}, note ${noteIdx + 1}: "${note.note.substring(0, 50)}..." - UNVIEWED!`);
                }
              });
            }
          });
        }

        // 4. Check bank category
        if (monthData.bank && monthData.bank.files) {
          console.log(`    🏦 Bank category: ${monthData.bank.files.length} files`);
          monthData.bank.files.forEach((file, fileIdx) => {
            if (file && file.notes && Array.isArray(file.notes)) {
              file.notes.forEach((note, noteIdx) => {
                const isForThisEmployee = !note.employeeId || note.employeeId === employeeId;
                if (note && note.note && isForThisEmployee && !note.isViewedByEmployee) {
                  unviewedCount++;
                  console.log(`      📄 Bank file ${fileIdx + 1}, note ${noteIdx + 1}: "${note.note.substring(0, 50)}..." - UNVIEWED!`);
                }
              });
            }
          });
        }

        // 5. Check category notes (sales, purchase, bank)
        ['sales', 'purchase', 'bank'].forEach(category => {
          if (monthData[category] && monthData[category].categoryNotes) {
            const catNotes = monthData[category].categoryNotes;
            console.log(`    📋 ${category} category notes: ${catNotes.length} notes`);
            catNotes.forEach((note, idx) => {
              if (note && note.note && !note.isViewedByEmployee) {
                unviewedCount++;
                console.log(`      📝 ${category} category note ${idx + 1}: "${note.note.substring(0, 50)}..." - UNVIEWED!`);
              }
            });
          }
        });
      });
    });

    console.log(`\n✅ END: Total unviewed notes for employee ${employeeId}: ${unviewedCount}`);
    return unviewedCount;

  } catch (error) {
    console.error(`❌ Error in countUnviewedNotesForEmployeeInClient:`, error);
    console.error(error.stack);
    return 0;
  }
};

/* ===============================
   HELPER: MARK ALL NOTES AS VIEWED BY EMPLOYEE FOR A CLIENT
================================ */
const markAllNotesAsViewedByEmployeeForClient = async (client, employeeId) => {
  try {
    // Convert to plain object
    const clientObj = client.toObject ? client.toObject() : client;
    let updateCount = 0;
    const now = new Date();
    const viewEntry = {
      userId: employeeId,
      userType: 'employee',
      viewedAt: now
    };

    console.log(`🔄 Marking notes as viewed for employee ${employeeId} in client ${clientObj.clientId}`);

    // Helper function to update a single note for employee
    const updateNoteForEmployee = (note) => {
      if (!note || typeof note !== 'object' || note === null) return false;

      // Check if it's a valid note object
      if (!note.note && !note.noteText) return false;

      // Check if already viewed by this employee
      const alreadyViewed = note.viewedBy?.some(
        view => view && view.userId === employeeId && view.userType === 'employee'
      );

      if (!alreadyViewed) {
        // Initialize viewedBy array if not exists
        note.viewedBy = note.viewedBy || [];
        note.viewedBy.push(viewEntry);
        note.isViewedByEmployee = true;
        return true;
      } else if (alreadyViewed && note.isViewedByEmployee !== true) {
        // Ensure consistency
        note.isViewedByEmployee = true;
        return true;
      }
      return false;
    };

    // Helper function to update notes array
    const updateNotesArrayForEmployee = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return 0;

      let count = 0;
      notesArray.forEach((note, index) => {
        if (updateNoteForEmployee(note)) {
          count++;
          console.log(`    ✅ Marked note ${index + 1} as viewed`);
        }
      });
      return count;
    };

    const documents = clientObj.documents || {};

    if (!documents || typeof documents !== 'object') {
      return { notesMarked: 0 };
    }

    // Iterate through all documents
    Object.keys(documents).forEach(year => {
      if (isNaN(parseInt(year))) return;
      const yearData = documents[year];
      if (!yearData || typeof yearData !== 'object') return;

      Object.keys(yearData).forEach(month => {
        if (isNaN(parseInt(month))) return;
        const monthData = yearData[month];
        if (!monthData || typeof monthData !== 'object') return;

        console.log(`  📅 Processing ${year}-${month}:`);

        // Month-level notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
          const updated = updateNotesArrayForEmployee(monthData.monthNotes);
          updateCount += updated;
          if (updated > 0) {
            console.log(`    📝 Updated ${updated} month notes`);
          }
        }

        // Required categories
        ['sales', 'purchase', 'bank'].forEach(category => {
          const categoryData = monthData[category];
          if (categoryData && typeof categoryData === 'object') {
            // Category notes
            if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
              const updated = updateNotesArrayForEmployee(categoryData.categoryNotes);
              updateCount += updated;
              if (updated > 0) {
                console.log(`    📂 Updated ${updated} ${category} category notes`);
              }
            }

            // File notes (ALL notes, not filtered by employeeId)
            if (categoryData.files && Array.isArray(categoryData.files)) {
              categoryData.files.forEach((file, fileIndex) => {
                if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
                  const updated = updateNotesArrayForEmployee(file.notes);
                  updateCount += updated;
                  if (updated > 0) {
                    console.log(`    📄 Updated ${updated} notes in ${category} file ${fileIndex + 1}`);
                  }
                }
              });
            }
          }
        });

        // Other categories
        if (monthData.other && Array.isArray(monthData.other)) {
          monthData.other.forEach((otherCat, catIndex) => {
            if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
              const doc = otherCat.document;
              // Category notes
              if (doc.categoryNotes && Array.isArray(doc.categoryNotes)) {
                const updated = updateNotesArrayForEmployee(doc.categoryNotes);
                updateCount += updated;
                if (updated > 0) {
                  console.log(`    📁 Updated ${updated} notes in other category "${otherCat.categoryName}"`);
                }
              }

              // File notes
              if (doc.files && Array.isArray(doc.files)) {
                doc.files.forEach((file, fileIndex) => {
                  if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
                    const updated = updateNotesArrayForEmployee(file.notes);
                    updateCount += updated;
                    if (updated > 0) {
                      console.log(`    📄 Updated ${updated} notes in other file ${fileIndex + 1}`);
                    }
                  }
                });
              }
            }
          });
        }
      });
    });

    // Update the client document
    if (updateCount > 0) {
      client.documents = clientObj.documents;
      await client.save();
    }

    console.log(`🎯 Total notes marked as viewed: ${updateCount}`);

    return {
      success: true,
      notesMarked: updateCount,
      clientId: client.clientId,
      employeeId
    };

  } catch (error) {
    console.error(`❌ Error marking notes as viewed:`, error);
    return {
      success: false,
      error: error.message,
      notesMarked: 0
    };
  }
};

/* ===============================
   HELPER: GET NOTES FOR EMPLOYEE FROM SPECIFIC CLIENT - SIMPLE VERSION
================================ */
const getNotesForEmployeeFromClient = (client, employeeId, timeFilter = 'all', limit = null) => {
  try {
    console.log(`\n🔍 START: Getting notes for employee ${employeeId} from client ${client.clientId}`);
    console.log(`   Time filter: ${timeFilter}, Limit: ${limit}`);

    const clientObj = client.toObject ? client.toObject() : client;
    const allNotes = [];

    // Debug log
    console.log('📦 Client data available:', {
      clientId: clientObj.clientId,
      name: clientObj.name,
      hasDocuments: !!clientObj.documents
    });

    const documents = clientObj.documents || {};

    if (!documents || typeof documents !== 'object') {
      console.log('❌ No documents found');
      return { notes: [], totalNotes: 0, unviewedCount: 0 };
    }

    // Calculate date filter
    const now = new Date();
    let cutoffDate = new Date(0); // Default: all time

    switch (timeFilter) {
      case 'month':
        cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last-month':
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      case '3months':
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case 'all':
      default:
        cutoffDate = new Date(0);
        break;
    }

    console.log(`   Cutoff date: ${cutoffDate.toISOString()}`);

    // Helper to add note
    const addNote = (note, metadata) => {
      if (!note || !note.note) return;

      const noteDate = new Date(note.addedAt || Date.now());
      if (noteDate < cutoffDate) return;

      const isUnviewed = !note.isViewedByEmployee;
      const source = note.employeeId === employeeId ? 'employee' :
        note.employeeId ? 'other_employee' : 'client';

      // Only add notes from this employee OR client notes
      if (source === 'employee' || source === 'client') {
        allNotes.push({
          id: `${metadata.location}_${metadata.year}_${metadata.month}_${Date.now()}_${Math.random()}`,
          note: note.note,
          addedBy: note.addedBy,
          addedAt: note.addedAt,
          isUnviewed: isUnviewed,
          isNew: isUnviewed,
          source: source,
          ...metadata
        });

        console.log(`   📝 Added note: "${note.note.substring(0, 50)}..." (${source}, ${isUnviewed ? 'UNVIEWED' : 'viewed'})`);
      }
    };

    console.log(`\n📊 Scanning documents...`);

    // Loop through documents
    Object.keys(documents).forEach(year => {
      const yearData = documents[year];
      if (!yearData || typeof yearData !== 'object') return;

      console.log(`\n  📅 Scanning year ${year}`);

      Object.keys(yearData).forEach(month => {
        const monthData = yearData[month];
        if (!monthData || typeof monthData !== 'object') return;

        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', { month: 'long' });
        console.log(`  📆 Scanning month ${month} (${monthName})`);

        // 1. Month notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
          console.log(`    📝 Found ${monthData.monthNotes.length} month notes`);
          monthData.monthNotes.forEach(note => {
            addNote(note, {
              location: 'month',
              year: parseInt(year),
              month: parseInt(month),
              monthName: monthName,
              category: 'General',
              type: 'month_note'
            });
          });
        }

        // 2. Check each category
        ['sales', 'purchase', 'bank'].forEach(category => {
          const categoryData = monthData[category];
          if (!categoryData) return;

          // Category notes
          if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
            console.log(`    📋 ${category} category notes: ${categoryData.categoryNotes.length}`);
            categoryData.categoryNotes.forEach(note => {
              addNote(note, {
                location: 'category',
                year: parseInt(year),
                month: parseInt(month),
                monthName: monthName,
                category: category.charAt(0).toUpperCase() + category.slice(1),
                type: 'delete_reason'
              });
            });
          }

          // File notes
          if (categoryData.files && Array.isArray(categoryData.files)) {
            console.log(`    📄 ${category} files: ${categoryData.files.length}`);
            categoryData.files.forEach(file => {
              if (file && file.notes && Array.isArray(file.notes)) {
                file.notes.forEach(note => {
                  addNote(note, {
                    location: 'file',
                    year: parseInt(year),
                    month: parseInt(month),
                    monthName: monthName,
                    category: category.charAt(0).toUpperCase() + category.slice(1),
                    fileName: file.fileName,
                    type: 'file_feedback'
                  });
                });
              }
            });
          }
        });
      });
    });

    // Sort by date (newest first)
    allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    const unviewedCount = allNotes.filter(note => note.isUnviewed).length;
    const totalNotes = allNotes.length;

    console.log(`\n✅ END: Found ${totalNotes} notes, ${unviewedCount} unviewed`);
    console.log(`📊 Breakdown:`);
    console.log(`  - Employee notes: ${allNotes.filter(n => n.source === 'employee').length}`);
    console.log(`  - Client notes: ${allNotes.filter(n => n.source === 'client').length}`);
    console.log(`  - Other employee notes: ${allNotes.filter(n => n.source === 'other_employee').length}`);

    // Apply limit if specified
    const limitedNotes = limit ? allNotes.slice(0, limit) : allNotes;

    return {
      notes: limitedNotes,
      totalNotes,
      unviewedCount,
      hasUnviewedNotes: unviewedCount > 0,
      clientName: client.name || client.clientId
    };

  } catch (error) {
    console.error(`❌ Error in getNotesForEmployeeFromClient:`, error);
    console.error(error.stack);
    return { notes: [], totalNotes: 0, unviewedCount: 0 };
  }
};

/* ===============================
   1. GET TOTAL UNVIEWED NOTES COUNT FOR EMPLOYEE
================================ */
router.get("/notes/unviewed-count", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const employeeName = req.user.name;

    console.log(`📊 GET /unviewed-count for employee: ${employeeId}`);

    // Get employee with assigned clients
    const employee = await Employee.findOne(
      { employeeId },
      { assignedClients: 1, name: 1 }
    ).lean();

    if (!employee) {
      console.log(`❌ Employee not found: ${employeeId}`);
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Get active assigned clients
    const activeAssignments = employee.assignedClients?.filter(
      assignment => !assignment.isRemoved
    ) || [];

    console.log(`📊 Active assignments: ${activeAssignments.length}`);

    if (activeAssignments.length === 0) {
      console.log(`📊 No assigned clients`);
      return res.json({
        success: true,
        employeeId,
        employeeName: employee.name,
        totalUnviewedNotes: 0,
        assignedClientsCount: 0,
        hasUnviewedNotes: false,
        timestamp: new Date().toISOString()
      });
    }

    // Get unique client IDs
    const clientIds = [...new Set(activeAssignments.map(assignment => assignment.clientId))];
    console.log(`📊 Unique client IDs: ${clientIds.length}`);

    let totalUnviewedNotes = 0;
    let clientsWithUnviewedNotes = [];

    // Count unviewed notes for each client
    for (const clientId of clientIds) {
      console.log(`📊 Checking client: ${clientId}`);
      const client = await Client.findOne({ clientId });
      if (client) {
        const unviewedCount = countUnviewedNotesForEmployeeInClient(client, employeeId);
        if (unviewedCount > 0) {
          totalUnviewedNotes += unviewedCount;
          clientsWithUnviewedNotes.push({
            clientId,
            clientName: client.name || client.clientId,
            unviewedCount
          });
          console.log(`📊 Client ${clientId} has ${unviewedCount} unviewed notes`);
        }
      }
    }

    // Create activity log
    await ActivityLog.create({
      userName: employee.name,
      role: "EMPLOYEE",
      employeeId: employeeId,
      action: "UNVIEWED_NOTES_CHECKED",
      details: `Employee checked unviewed notes count: ${totalUnviewedNotes} unread notes`,
      dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        employeeId,
        employeeName: employee.name,
        totalUnviewedNotes,
        assignedClientsCount: activeAssignments.length,
        clientsWithUnviewedNotesCount: clientsWithUnviewedNotes.length
      }
    });

    console.log(`✅ Total unviewed notes: ${totalUnviewedNotes}`);

    res.json({
      success: true,
      employeeId,
      employeeName: employee.name,
      totalUnviewedNotes,
      assignedClientsCount: activeAssignments.length,
      clientsWithUnviewedNotesCount: clientsWithUnviewedNotes.length,
      hasUnviewedNotes: totalUnviewedNotes > 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Error in /unviewed-count:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee unviewed notes count"
    });
  }
});

/* ===============================
   2. GET LIST OF ASSIGNED CLIENTS WITH UNVIEWED NOTES COUNT
================================ */
router.get("/notes/assigned-clients", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const limit = parseInt(req.query.limit) || 50;

    console.log(`👥 GET /assigned-clients for employee: ${employeeId}`);

    // Get employee with assigned clients
    const employee = await Employee.findOne(
      { employeeId },
      { assignedClients: 1, name: 1 }
    ).lean();

    if (!employee) {
      console.log(`❌ Employee not found: ${employeeId}`);
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Get active assigned clients
    const activeAssignments = employee.assignedClients?.filter(
      assignment => !assignment.isRemoved
    ) || [];

    console.log(`👥 Active assignments: ${activeAssignments.length}`);

    if (activeAssignments.length === 0) {
      console.log(`👥 No active assignments`);
      return res.json({
        success: true,
        employeeId,
        employeeName: employee.name,
        assignedClients: [],
        totalClients: 0,
        totalUnviewedNotes: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Get unique client IDs with their latest assignment info
    const clientMap = new Map();
    activeAssignments.forEach(assignment => {
      if (!clientMap.has(assignment.clientId) ||
        new Date(assignment.assignedAt) > new Date(clientMap.get(assignment.clientId).assignedAt)) {
        clientMap.set(assignment.clientId, assignment);
      }
    });

    const uniqueClients = Array.from(clientMap.values());
    const clientIds = uniqueClients.map(client => client.clientId);

    console.log(`👥 Unique clients to fetch: ${clientIds.length}`);

    // Get client details and unviewed notes count
    const clientsWithDetails = [];
    let totalUnviewedNotes = 0;

    for (const clientId of clientIds) {
      console.log(`👥 Fetching client: ${clientId}`);
      const client = await Client.findOne(
        { clientId },
        { clientId: 1, name: 1, email: 1, phone: 1, businessName: 1 }
      );

      if (client) {
        const unviewedCount = countUnviewedNotesForEmployeeInClient(client, employeeId);
        totalUnviewedNotes += unviewedCount;

        const assignment = clientMap.get(clientId);

        clientsWithDetails.push({
          clientId: client.clientId,
          clientName: client.name || client.clientId,
          businessName: client.businessName || "Not specified",
          email: client.email || "Not provided",
          phone: client.phone || "Not provided",
          unviewedNotesCount: unviewedCount,
          hasUnviewedNotes: unviewedCount > 0,
          lastAssigned: assignment.assignedAt,
          assignedTask: assignment.task || "Not specified",
          assignedBy: assignment.assignedBy || "Admin",
          year: assignment.year,
          month: assignment.month,
          monthName: new Date(assignment.year, assignment.month - 1).toLocaleString('default', { month: 'long' })
        });

        console.log(`👥 Client ${clientId}: ${unviewedCount} unviewed notes`);
      }
    }

    // Sort: clients with unviewed notes first, then by name
    clientsWithDetails.sort((a, b) => {
      if (a.hasUnviewedNotes !== b.hasUnviewedNotes) {
        return b.hasUnviewedNotes - a.hasUnviewedNotes;
      }
      return a.clientName.localeCompare(b.clientName);
    });

    // Apply limit
    const limitedClients = clientsWithDetails.slice(0, limit);

    console.log(`✅ Returning ${limitedClients.length} clients, total unviewed: ${totalUnviewedNotes}`);

    res.json({
      success: true,
      employeeId,
      employeeName: employee.name,
      assignedClients: limitedClients,
      totalClients: limitedClients.length,
      totalUnviewedNotes,
      hasUnviewedNotes: totalUnviewedNotes > 0,
      timestamp: new Date().toISOString(),
      summary: {
        clientsWithUnviewedNotes: limitedClients.filter(c => c.hasUnviewedNotes).length,
        clientsWithoutUnviewedNotes: limitedClients.filter(c => !c.hasUnviewedNotes).length,
        totalAssignedClients: activeAssignments.length
      }
    });

  } catch (error) {
    console.error(`❌ Error in /assigned-clients:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching assigned clients"
    });
  }
});

/* ===============================
   DEBUG: GET RAW CLIENT DATA
================================ */
router.get("/notes/debug-client/:clientId", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { clientId } = req.params;

    console.log(`🐛 DEBUG endpoint called for client: ${clientId}, employee: ${employeeId}`);

    // Get client data
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Convert to plain object for inspection
    const clientObj = client.toObject();

    // Extract just the notes structure for debugging
    const debugData = {
      clientId: clientObj.clientId,
      clientName: clientObj.name,
      employeeId: employeeId,
      documents: {}
    };

    // Build simplified structure
    const documents = clientObj.documents || {};
    Object.keys(documents).forEach(year => {
      debugData.documents[year] = {};
      const yearData = documents[year];

      Object.keys(yearData).forEach(month => {
        debugData.documents[year][month] = {
          monthNotes: yearData[month]?.monthNotes || [],
          categories: {}
        };

        ['sales', 'purchase', 'bank'].forEach(category => {
          const catData = yearData[month]?.[category];
          if (catData) {
            debugData.documents[year][month].categories[category] = {
              categoryNotes: catData.categoryNotes || [],
              files: catData.files?.map(file => ({
                fileName: file.fileName,
                notes: file.notes || []
              })) || []
            };
          }
        });
      });
    });

    // Count notes manually
    let totalNotes = 0;
    let unviewedNotes = 0;

    Object.keys(documents).forEach(year => {
      const yearData = documents[year];
      Object.keys(yearData).forEach(month => {
        const monthData = yearData[month];

        // Month notes
        if (monthData.monthNotes) {
          monthData.monthNotes.forEach(note => {
            totalNotes++;
            if (!note.isViewedByEmployee) unviewedNotes++;
          });
        }

        // Category notes
        ['sales', 'purchase', 'bank'].forEach(category => {
          const catData = monthData[category];
          if (catData && catData.categoryNotes) {
            catData.categoryNotes.forEach(note => {
              totalNotes++;
              if (!note.isViewedByEmployee) unviewedNotes++;
            });
          }

          // File notes
          if (catData && catData.files) {
            catData.files.forEach(file => {
              if (file.notes) {
                file.notes.forEach(note => {
                  // Check if note is for this employee
                  const isForThisEmployee = !note.employeeId || note.employeeId === employeeId;
                  if (isForThisEmployee) {
                    totalNotes++;
                    if (!note.isViewedByEmployee) unviewedNotes++;
                  }
                });
              }
            });
          }
        });
      });
    });

    res.json({
      success: true,
      debugData,
      summary: {
        totalNotes,
        unviewedNotes,
        employeeId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`❌ Error in debug endpoint:`, error);
    res.status(500).json({
      success: false,
      message: "Debug error",
      error: error.message
    });
  }
});

/* ===============================
   4. MARK ALL NOTES AS VIEWED BY EMPLOYEE FOR A SPECIFIC CLIENT
================================ */
router.post("/notes/mark-client-viewed/:clientId", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { clientId } = req.params;

    console.log(`✅ POST /mark-client-viewed/${clientId} for employee: ${employeeId}`);

    // Verify employee is assigned to this client
    const employee = await Employee.findOne(
      { employeeId, "assignedClients.clientId": clientId, "assignedClients.isRemoved": false },
      { name: 1 }
    );

    if (!employee) {
      console.log(`❌ Employee not assigned to client`);
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this client"
      });
    }

    // Get client
    const client = await Client.findOne({ clientId });
    if (!client) {
      console.log(`❌ Client not found`);
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    console.log(`✅ Starting to mark notes as viewed...`);

    // Mark all notes as viewed by this employee
    const result = await markAllNotesAsViewedByEmployeeForClient(client, employeeId);

    if (!result.success) {
      console.log(`❌ Failed to mark notes: ${result.error}`);
      return res.status(500).json({
        success: false,
        message: "Failed to mark notes as viewed",
        error: result.error
      });
    }

    console.log(`✅ Successfully marked ${result.notesMarked} notes`);

    // Create activity log
    await ActivityLog.create({
      userName: employee.name,
      role: "EMPLOYEE",
      employeeId: employeeId,
      clientId: clientId,
      clientName: client.name,
      action: "CLIENT_NOTES_MARKED_VIEWED",
      details: `Employee marked all notes as viewed for client: ${client.name || clientId} (${result.notesMarked} notes)`,
      dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        employeeId,
        employeeName: employee.name,
        clientId,
        clientName: client.name,
        notesMarked: result.notesMarked
      }
    });

    res.json({
      success: true,
      employeeId,
      employeeName: employee.name,
      clientId,
      clientName: client.name || clientId,
      notesMarked: result.notesMarked,
      message: result.notesMarked > 0
        ? `Marked ${result.notesMarked} notes as viewed for ${client.name || clientId}`
        : `All notes were already viewed for ${client.name || clientId}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Error in /mark-client-viewed:`, error);
    res.status(500).json({
      success: false,
      message: "Error marking client notes as viewed",
      error: error.message
    });
  }
});


/* ===============================
   3. GET NOTES FOR SPECIFIC CLIENT WITH TIME FILTER
================================ */
router.get("/notes/client-notes/:clientId", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { clientId } = req.params;
    const timeFilter = req.query.timeFilter || 'all';
    const limit = parseInt(req.query.limit) || 100;

    console.log(`📝 GET /client-notes/${clientId} for employee: ${employeeId}`);
    console.log(`   Time filter: ${timeFilter}, Limit: ${limit}`);

    // Check if employee is assigned to this client
    const employee = await Employee.findOne(
      {
        employeeId,
        "assignedClients.clientId": clientId,
        "assignedClients.isRemoved": false
      },
      { name: 1 }
    );

    if (!employee) {
      console.log(`❌ Employee ${employeeId} not assigned to client ${clientId}`);
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this client or the assignment has been removed"
      });
    }

    // Get client data
    const client = await Client.findOne({ clientId });
    if (!client) {
      console.log(`❌ Client not found: ${clientId}`);
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    console.log(`✅ Employee authorized, fetching notes...`);

    // Get notes for this client with time filter
    const notesData = getNotesForEmployeeFromClient(client, employeeId, timeFilter, limit);

    console.log(`✅ Notes data: ${notesData.totalNotes} total, ${notesData.unviewedCount} unviewed`);

    // Create activity log
    await ActivityLog.create({
      userName: employee.name,
      role: "EMPLOYEE",
      employeeId: employeeId,
      clientId: clientId,
      clientName: client.name,
      action: "CLIENT_NOTES_VIEWED",
      details: `Employee viewed notes for client: ${client.name || clientId} (${notesData.totalNotes} total, ${notesData.unviewedCount} unread)`,
      dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        employeeId,
        employeeName: employee.name,
        clientId,
        clientName: client.name,
        totalNotes: notesData.totalNotes,
        unviewedNotes: notesData.unviewedCount,
        timeFilter: timeFilter,
        limit: limit
      }
    });

    res.json({
      success: true,
      employeeId,
      employeeName: employee.name,
      clientId,
      clientName: client.name || clientId,
      businessName: client.businessName || "Not specified",
      notes: notesData.notes.map((note, index) => ({
        id: `${note.location}_${note.year}_${note.month}_${index}_${Date.now()}`,
        note: note.note || note.noteText,
        addedBy: note.addedBy,
        addedAt: note.addedAt,
        category: note.category,
        type: note.type,
        source: note.source,
        fileName: note.fileName,
        month: `${note.monthName} ${note.year}`,
        isUnviewed: note.isUnviewedByEmployee,
        isNew: note.isUnviewedByEmployee,
        viewedBy: note.viewedByEmployees,
        totalViews: note.totalViews
      })),
      summary: {
        totalNotes: notesData.totalNotes,
        unviewedNotes: notesData.unviewedCount,
        viewedNotes: notesData.totalNotes - notesData.unviewedCount,
        clientNotes: notesData.notes.filter(n => n.source === 'client').length,
        employeeNotes: notesData.notes.filter(n => n.source === 'employee').length,
        timeFilter: timeFilter
      },
      hasUnviewedNotes: notesData.hasUnviewedNotes,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Error in /client-notes:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching client notes for employee"
    });
  }
});

module.exports = router;