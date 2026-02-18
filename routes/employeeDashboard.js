const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");

const Client = require("../models/Client");
const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// Console logging
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Europe/Helsinki"
  });
  console.log(`[${timestamp}] ${type}: ${operation}`, data ? JSON.stringify(data, null, 2) : '');
};

/* ===============================
   HELPER: GET MONTH RANGE BASED ON FILTER
================================ */
const getMonthRange = (timeFilter, customStart = null, customEnd = null) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let months = [];

  switch (timeFilter) {
    case 'this_month':
      months = [{ year: currentYear, month: currentMonth }];
      break;

    case 'last_month':
      let lastYear = currentYear;
      let lastMonth = currentMonth - 1;
      if (lastMonth === 0) {
        lastMonth = 12;
        lastYear = currentYear - 1;
      }
      months = [{ year: lastYear, month: lastMonth }];
      break;

    case 'last_3_months':
      for (let i = 0; i < 3; i++) {
        let year = currentYear;
        let month = currentMonth - i;
        if (month <= 0) {
          month += 12;
          year -= 1;
        }
        months.push({ year, month });
      }
      break;

    case 'custom':
      if (customStart && customEnd) {
        const start = new Date(customStart);
        const end = new Date(customEnd);

        const current = new Date(start.getFullYear(), start.getMonth(), 1);
        const last = new Date(end.getFullYear(), end.getMonth(), 1);

        while (current <= last) {
          months.push({
            year: current.getFullYear(),
            month: current.getMonth() + 1
          });
          current.setMonth(current.getMonth() + 1);
        }
      } else {
        months = [{ year: currentYear, month: currentMonth }];
      }
      break;

    default:
      months = [{ year: currentYear, month: currentMonth }];
  }

  months.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return months;
};

/* ===============================
   HELPER: GET TASKS ASSIGNED TO EMPLOYEE
================================ */
const getEmployeeTasksForMonth = (employeeId, employeeAssignments = [], year, month) => {
  const allTasks = [
    { id: 'bookkeeping', name: 'Bookkeeping', required: true },
    { id: 'vat_computation', name: 'VAT Filing Computation', required: true },
    { id: 'vat_filing', name: 'VAT Filing', required: true },
    { id: 'financial_statements', name: 'Financial Statement Generation', required: true }
  ];

  // Get assignments for this employee and month
  const monthAssignments = employeeAssignments.filter(assignment =>
    assignment.year === year &&
    assignment.month === month &&
    assignment.employeeId === employeeId &&
    assignment.isRemoved === false
  );

  return allTasks.map(task => {
    const assignment = monthAssignments.find(a => a.task === task.name);

    if (assignment) {
      return {
        taskId: task.id,
        taskName: task.name,
        status: 'assigned',
        accountingDone: assignment.accountingDone || false,
        accountingDoneAt: assignment.accountingDoneAt,
        accountingDoneBy: assignment.accountingDoneBy,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
        adminName: assignment.adminName
      };
    }

    return {
      taskId: task.id,
      taskName: task.name,
      status: 'not_assigned',
      accountingDone: false
    };
  });
};

/* ===============================
   HELPER: GET NOTES FOR EMPLOYEE WITH VIEW STATUS
================================ */
const getEmployeeNotesForMonth = (monthData, employeeId, clientId = null) => {
  const allNotes = [];

  if (!monthData) {
    return { total: 0, notes: [], unviewedCount: 0 };
  }

  // 1. Client notes (month notes + delete reasons) - CHECK VIEW STATUS
  // Month notes → CLIENT
  if (monthData.monthNotes && monthData.monthNotes.length > 0) {
    monthData.monthNotes.forEach(note => {
      const isUnviewedByEmployee = !note.isViewedByEmployee;

      allNotes.push({
        type: 'month_note',
        category: 'General',
        note: note.note,
        addedBy: note.addedBy || 'Client',
        addedAt: note.addedAt,
        source: 'client',
        isUnviewedByEmployee,
        viewedBy: note.viewedBy || [],
        isViewedByEmployee: note.isViewedByEmployee || false
      });
    });
  }

  // Category notes (delete reasons) → CLIENT
  ['sales', 'purchase', 'bank'].forEach(category => {
    const categoryData = monthData[category];
    if (categoryData && categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
      categoryData.categoryNotes.forEach(note => {
        const isUnviewedByEmployee = !note.isViewedByEmployee;

        allNotes.push({
          type: 'delete_reason',
          category: category.charAt(0).toUpperCase() + category.slice(1),
          note: note.note,
          addedBy: note.addedBy || 'Client',
          addedAt: note.addedAt,
          source: 'client',
          isUnviewedByEmployee,
          viewedBy: note.viewedBy || [],
          isViewedByEmployee: note.isViewedByEmployee || false
        });
      });
    }
  });

  // 2. File notes → ONLY THIS EMPLOYEE'S NOTES (automatically viewed by them)
  ['sales', 'purchase', 'bank'].forEach(category => {
    const categoryData = monthData[category];
    if (categoryData && categoryData.files) {
      categoryData.files.forEach(file => {
        if (file.notes && file.notes.length > 0) {
          file.notes.forEach(note => {
            // Only include if note is added by this employee
            if (note.employeeId === employeeId) {
              // Employee's own notes are automatically "viewed"
              allNotes.push({
                type: 'file_feedback',
                category: category.charAt(0).toUpperCase() + category.slice(1),
                fileName: file.fileName,
                note: note.note,
                addedBy: note.addedBy || 'You',
                addedAt: note.addedAt,
                source: 'employee',
                isUnviewedByEmployee: false, // Own notes are always viewed
                viewedBy: note.viewedBy || [],
                isViewedByEmployee: true
              });
            }
          });
        }
      });
    }
  });

  // 3. Other categories
  if (monthData.other && Array.isArray(monthData.other)) {
    monthData.other.forEach(otherCat => {
      if (otherCat.document) {
        // Category notes → CLIENT
        if (otherCat.document.categoryNotes && otherCat.document.categoryNotes.length > 0) {
          otherCat.document.categoryNotes.forEach(note => {
            const isUnviewedByEmployee = !note.isViewedByEmployee;

            allNotes.push({
              type: 'delete_reason',
              category: otherCat.categoryName,
              note: note.note,
              addedBy: note.addedBy || 'Client',
              addedAt: note.addedAt,
              source: 'client',
              isUnviewedByEmployee,
              viewedBy: note.viewedBy || [],
              isViewedByEmployee: note.isViewedByEmployee || false
            });
          });
        }

        // File notes → ONLY THIS EMPLOYEE'S NOTES
        if (otherCat.document.files) {
          otherCat.document.files.forEach(file => {
            if (file.notes && file.notes.length > 0) {
              file.notes.forEach(note => {
                if (note.employeeId === employeeId) {
                  // Employee's own notes
                  allNotes.push({
                    type: 'file_feedback',
                    category: otherCat.categoryName,
                    fileName: file.fileName,
                    note: note.note,
                    addedBy: note.addedBy || 'You',
                    addedAt: note.addedAt,
                    source: 'employee',
                    isUnviewedByEmployee: false,
                    viewedBy: note.viewedBy || [],
                    isViewedByEmployee: true
                  });
                }
              });
            }
          });
        }
      }
    });
  }

  // Sort by date (newest first)
  allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  const unviewedCount = allNotes.filter(note => note.isUnviewedByEmployee).length;

  return {
    total: allNotes.length,
    notes: allNotes,
    unviewedCount: unviewedCount
  };
};

/* ===============================
   HELPER: COUNT ALL UNVIEWED CLIENT NOTES FOR EMPLOYEE
================================ */
const countUnviewedClientNotesForEmployee = async (employeeId) => {
  try {
    // Get all clients assigned to this employee
    const clients = await Client.find({
      "employeeAssignments.employeeId": employeeId,
      "employeeAssignments.isRemoved": false
    }).lean();

    let totalUnviewed = 0;

    // Iterate through all clients' documents
    for (const client of clients) {
      const documents = client.documents || {};

      // Check each year and month
      for (const year in documents) {
        if (isNaN(Number(year))) continue;

        const yearData = documents[year];
        if (!yearData || typeof yearData !== 'object') continue;

        for (const month in yearData) {
          if (isNaN(Number(month))) continue;

          const monthData = yearData[month];
          if (!monthData || typeof monthData !== 'object') continue;

          // Check month notes
          if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
            monthData.monthNotes.forEach(note => {
              if (note && typeof note === 'object' && !note.isViewedByEmployee) {
                totalUnviewed++;
              }
            });
          }

          // Check category notes in required categories
          ['sales', 'purchase', 'bank'].forEach(category => {
            const categoryData = monthData[category];
            if (categoryData && categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
              categoryData.categoryNotes.forEach(note => {
                if (note && typeof note === 'object' && !note.isViewedByEmployee) {
                  totalUnviewed++;
                }
              });
            }
          });

          // Check other categories
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCat => {
              if (otherCat && otherCat.document && otherCat.document.categoryNotes &&
                Array.isArray(otherCat.document.categoryNotes)) {
                otherCat.document.categoryNotes.forEach(note => {
                  if (note && typeof note === 'object' && !note.isViewedByEmployee) {
                    totalUnviewed++;
                  }
                });
              }
            });
          }
        }
      }
    }

    return totalUnviewed;

  } catch (error) {
    logToConsole("ERROR", "COUNT_UNVIEWED_NOTES_FOR_EMPLOYEE_FAILED", {
      error: error.message,
      employeeId
    });
    return 0;
  }
};

/* ===============================
   HELPER: MARK ALL CLIENT NOTES AS VIEWED BY EMPLOYEE (FIXED)
================================ */
const markAllClientNotesAsViewedForEmployee = async (employeeId) => {
  try {
    logToConsole("INFO", "MARK_ALL_NOTES_VIEWED_BY_EMPLOYEE_START", {
      employeeId,
      timestamp: new Date().toISOString()
    });

    // Get all clients assigned to this employee
    const clients = await Client.find({
      "employeeAssignments.employeeId": employeeId,
      "employeeAssignments.isRemoved": false
    });

    let updateCount = 0;
    const now = new Date();
    const viewEntry = {
      userId: employeeId,
      userType: 'employee',
      viewedAt: now
    };

    // Helper function to update a single note
    const updateNote = (note) => {
      if (!note || typeof note !== 'object' || note === null) return false;
      if (!note.note && !note.noteText) return false;

      // Check if already viewed by this employee
      const alreadyViewed = note.viewedBy?.some(
        view => view && view.userId === employeeId && view.userType === 'employee'
      );

      if (!alreadyViewed) {
        note.viewedBy = note.viewedBy || [];
        note.viewedBy.push(viewEntry);
        note.isViewedByEmployee = true;
        return true;
      }
      return false;
    };

    // Process each client
    for (const client of clients) {
      let clientUpdated = false;

      // Convert to plain object to modify
      const clientObj = client.toObject ? client.toObject() : client;
      const documents = clientObj.documents || {};

      // Iterate through documents
      for (const year in documents) {
        if (isNaN(Number(year))) continue;

        const yearData = documents[year];
        if (!yearData || typeof yearData !== 'object') continue;

        for (const month in yearData) {
          if (isNaN(Number(month))) continue;

          const monthData = yearData[month];
          if (!monthData || typeof monthData !== 'object') continue;

          // Update month notes
          if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
            monthData.monthNotes.forEach(note => {
              if (updateNote(note)) {
                updateCount++;
                clientUpdated = true;
              }
            });
          }

          // Update category notes in required categories
          ['sales', 'purchase', 'bank'].forEach(category => {
            const categoryData = monthData[category];
            if (categoryData && categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
              categoryData.categoryNotes.forEach(note => {
                if (updateNote(note)) {
                  updateCount++;
                  clientUpdated = true;
                }
              });
            }
          });

          // Update other categories
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCat => {
              if (otherCat && otherCat.document && otherCat.document.categoryNotes &&
                Array.isArray(otherCat.document.categoryNotes)) {
                otherCat.document.categoryNotes.forEach(note => {
                  if (updateNote(note)) {
                    updateCount++;
                    clientUpdated = true;
                  }
                });
              }
            });
          }
        }
      }

      // Save client if updated - IMPORTANT FIX HERE!
      if (clientUpdated) {
        // Update the actual Mongoose document with the modified object
        Object.assign(client, clientObj);
        client.markModified('documents');
        await client.save();
        logToConsole("DEBUG", "CLIENT_SAVED", {
          clientId: client.clientId,
          notesUpdated: updateCount
        });
      }
    }

    logToConsole("SUCCESS", "MARK_ALL_NOTES_VIEWED_BY_EMPLOYEE_COMPLETE", {
      employeeId,
      notesMarked: updateCount,
      clientsProcessed: clients.length
    });

    return {
      success: true,
      notesMarked: updateCount,
      clientsProcessed: clients.length
    };

  } catch (error) {
    logToConsole("ERROR", "MARK_ALL_NOTES_VIEWED_BY_EMPLOYEE_FAILED", {
      error: error.message,
      stack: error.stack,
      employeeId
    });
    return {
      success: false,
      error: error.message,
      notesMarked: 0
    };
  }
};



/* ===============================
   HELPER: GET ALL NOTES FOR EMPLOYEE ALERT
================================ */
const getAllNotesForEmployeeAlert = async (employeeId, limit = 5) => {
  try {
    // Get all clients assigned to this employee
    const clients = await Client.find({
      "employeeAssignments.employeeId": employeeId,
      "employeeAssignments.isRemoved": false
    }).lean();

    const allNotes = [];

    // Process each client
    for (const client of clients) {
      const documents = client.documents || {};

      // Iterate through documents
      for (const year in documents) {
        if (isNaN(Number(year))) continue;

        const yearData = documents[year];
        if (!yearData || typeof yearData !== 'object') continue;

        for (const month in yearData) {
          if (isNaN(Number(month))) continue;

          const monthData = yearData[month];
          if (!monthData || typeof monthData !== 'object') continue;

          const monthName = new Date(year, month - 1).toLocaleString('default', {
            month: 'long',
            timeZone: "Europe/Helsinki"
          });

          // Month notes → CLIENT
          if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
            monthData.monthNotes.forEach(note => {
              const isUnviewedByEmployee = !note.isViewedByEmployee;

              allNotes.push({
                type: 'month_note',
                category: 'General',
                note: note.note,
                fullNote: note.note,
                addedBy: note.addedBy || 'Client',
                addedAt: note.addedAt,
                source: 'client',
                clientId: client.clientId,
                clientName: client.name,
                clientEmail: client.email,
                year: parseInt(year),
                month: parseInt(month),
                monthName: monthName,
                isUnviewedByEmployee,
                isNew: isUnviewedByEmployee,
                viewedBy: note.viewedBy || [],
                isViewedByEmployee: note.isViewedByEmployee || false
              });
            });
          }

          // Category notes in required categories → CLIENT
          ['sales', 'purchase', 'bank'].forEach(category => {
            const categoryData = monthData[category];
            if (categoryData && categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
              categoryData.categoryNotes.forEach(note => {
                const isUnviewedByEmployee = !note.isViewedByEmployee;

                allNotes.push({
                  type: 'delete_reason',
                  category: category.charAt(0).toUpperCase() + category.slice(1),
                  note: note.note,
                  fullNote: note.note,
                  addedBy: note.addedBy || 'Client',
                  addedAt: note.addedAt,
                  source: 'client',
                  clientId: client.clientId,
                  clientName: client.name,
                  clientEmail: client.email,
                  year: parseInt(year),
                  month: parseInt(month),
                  monthName: monthName,
                  isUnviewedByEmployee,
                  isNew: isUnviewedByEmployee,
                  viewedBy: note.viewedBy || [],
                  isViewedByEmployee: note.isViewedByEmployee || false
                });
              });
            }
          });

          // File notes → ONLY THIS EMPLOYEE'S NOTES
          ['sales', 'purchase', 'bank'].forEach(category => {
            const categoryData = monthData[category];
            if (categoryData && categoryData.files) {
              categoryData.files.forEach(file => {
                if (file.notes && Array.isArray(file.notes)) {
                  file.notes.forEach(note => {
                    // Only include if note is added by this employee
                    if (note.employeeId === employeeId) {
                      allNotes.push({
                        type: 'file_feedback',
                        category: category.charAt(0).toUpperCase() + category.slice(1),
                        fileName: file.fileName,
                        note: note.note,
                        fullNote: note.note,
                        addedBy: note.addedBy || 'You',
                        addedAt: note.addedAt,
                        source: 'employee',
                        clientId: client.clientId,
                        clientName: client.name,
                        clientEmail: client.email,
                        year: parseInt(year),
                        month: parseInt(month),
                        monthName: monthName,
                        isUnviewedByEmployee: false, // Own notes are always viewed
                        isNew: false,
                        viewedBy: note.viewedBy || [],
                        isViewedByEmployee: true
                      });
                    }
                  });
                }
              });
            }
          });

          // Other categories
          if (monthData.other && Array.isArray(monthData.other)) {
            monthData.other.forEach(otherCat => {
              if (otherCat && otherCat.document) {
                // Category notes → CLIENT
                if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
                  otherCat.document.categoryNotes.forEach(note => {
                    const isUnviewedByEmployee = !note.isViewedByEmployee;

                    allNotes.push({
                      type: 'delete_reason',
                      category: otherCat.categoryName,
                      note: note.note,
                      fullNote: note.note,
                      addedBy: note.addedBy || 'Client',
                      addedAt: note.addedAt,
                      source: 'client',
                      clientId: client.clientId,
                      clientName: client.name,
                      clientEmail: client.email,
                      year: parseInt(year),
                      month: parseInt(month),
                      monthName: monthName,
                      isUnviewedByEmployee,
                      isNew: isUnviewedByEmployee,
                      viewedBy: note.viewedBy || [],
                      isViewedByEmployee: note.isViewedByEmployee || false
                    });
                  });
                }

                // File notes → ONLY THIS EMPLOYEE'S NOTES
                if (otherCat.document.files) {
                  otherCat.document.files.forEach(file => {
                    if (file.notes && Array.isArray(file.notes)) {
                      file.notes.forEach(note => {
                        if (note.employeeId === employeeId) {
                          allNotes.push({
                            type: 'file_feedback',
                            category: otherCat.categoryName,
                            fileName: file.fileName,
                            note: note.note,
                            fullNote: note.note,
                            addedBy: note.addedBy || 'You',
                            addedAt: note.addedAt,
                            source: 'employee',
                            clientId: client.clientId,
                            clientName: client.name,
                            clientEmail: client.email,
                            year: parseInt(year),
                            month: parseInt(month),
                            monthName: monthName,
                            isUnviewedByEmployee: false,
                            isNew: false,
                            viewedBy: note.viewedBy || [],
                            isViewedByEmployee: true
                          });
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
    }

    // Sort by date (newest first)
    allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    const unviewedCount = allNotes.filter(note => note.isUnviewedByEmployee).length;
    const totalNotes = allNotes.length;

    // Get preview notes
    const previewNotes = allNotes.slice(0, limit);

    return {
      notes: allNotes,
      preview: previewNotes,
      unviewedCount,
      totalNotes,
      hasUnviewedNotes: unviewedCount > 0
    };

  } catch (error) {
    logToConsole("ERROR", "GET_ALL_NOTES_FOR_EMPLOYEE_ALERT_FAILED", {
      error: error.message,
      employeeId
    });
    return { notes: [], preview: [], unviewedCount: 0, totalNotes: 0, hasUnviewedNotes: false };
  }
};

/* ===============================
   NEW 1: GET UNVIEWED NOTES COUNT FOR EMPLOYEE
================================ */
router.get("/notes/unviewed-count", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;

    logToConsole("INFO", "EMPLOYEE_UNVIEWED_NOTES_COUNT_REQUEST", {
      employeeId
    });

    const unviewedCount = await countUnviewedClientNotesForEmployee(employeeId);

    logToConsole("SUCCESS", "EMPLOYEE_UNVIEWED_NOTES_COUNT_FETCHED", {
      employeeId,
      unviewedCount
    });

    res.json({
      success: true,
      employeeId,
      unviewedCount,
      hasUnviewedNotes: unviewedCount > 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_UNVIEWED_NOTES_COUNT_FAILED", {
      error: error.message,
      employeeId: req.user?.employeeId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching unviewed notes count"
    });
  }
});

/* ===============================
   NEW 2: MARK ALL CLIENT NOTES AS VIEWED BY EMPLOYEE
================================ */
router.post("/notes/mark-all-viewed", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;

    logToConsole("INFO", "EMPLOYEE_MARK_ALL_NOTES_VIEWED_REQUEST", {
      employeeId,
      timestamp: new Date().toISOString(),
      user: req.user.name
    });

    const result = await markAllClientNotesAsViewedForEmployee(employeeId);

    if (!result.success) {
      logToConsole("ERROR", "EMPLOYEE_MARK_ALL_NOTES_FAILED", {
        employeeId,
        error: result.error
      });

      return res.status(500).json({
        success: false,
        message: "Failed to mark notes as viewed",
        error: result.error
      });
    }

    // Get employee info for activity log
    const employee = await Employee.findOne({ employeeId }).lean();

    // Create activity log - REMOVED dateTime line
    await ActivityLog.create({
      userName: employee?.name || "Employee",
      role: "EMPLOYEE",
      employeeId: employeeId,
      employeeName: employee?.name || "Employee",
      action: "EMPLOYEE_NOTES_VIEWED",
      details: `Employee "${employee?.name || "Employee"}" marked ${result.notesMarked} client notes as viewed`,
      metadata: {
        employeeId,
        employeeName: employee?.name || "Employee",
        notesMarked: result.notesMarked,
        clientsProcessed: result.clientsProcessed,
        actionType: "mark_all_viewed",
        timestamp: new Date().toISOString()
      }
    });

    logToConsole("SUCCESS", "EMPLOYEE_ALL_NOTES_MARKED_AS_VIEWED", {
      employeeId,
      notesMarked: result.notesMarked,
      clientsProcessed: result.clientsProcessed
    });

    res.json({
      success: true,
      employeeId,
      notesMarked: result.notesMarked,
      clientsProcessed: result.clientsProcessed,
      message: result.notesMarked > 0
        ? `Marked ${result.notesMarked} client notes as viewed`
        : `All notes were already viewed`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_MARK_ALL_NOTES_VIEWED_FAILED", {
      error: error.message,
      stack: error.stack,
      employeeId: req.user?.employeeId
    });

    res.status(500).json({
      success: false,
      message: "Error marking notes as viewed",
      error: error.message
    });
  }
});

/* ===============================
   NEW 3: GET ALL NOTES FOR EMPLOYEE ALERT CARD
================================ */
router.get("/notes/alert-preview", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const limit = parseInt(req.query.limit) || 5;

    logToConsole("INFO", "EMPLOYEE_NOTES_ALERT_PREVIEW_REQUEST", {
      employeeId,
      limit
    });

    const result = await getAllNotesForEmployeeAlert(employeeId, limit);

    logToConsole("SUCCESS", "EMPLOYEE_NOTES_ALERT_PREVIEW_FETCHED", {
      employeeId,
      totalNotes: result.totalNotes,
      unviewedCount: result.unviewedCount,
      previewCount: result.preview.length
    });

    res.json({
      success: true,
      employeeId,
      summary: {
        totalNotes: result.totalNotes,
        unviewedNotes: result.unviewedCount,
        viewedNotes: result.totalNotes - result.unviewedCount,
        clientNotes: result.notes.filter(n => n.source === 'client').length,
        employeeNotes: result.notes.filter(n => n.source === 'employee').length
      },
      preview: result.preview.map(note => ({
        id: `${note.source}_${note.clientId}_${note.year}_${note.month}_${Date.now()}_${Math.random()}`,
        note: note.note.length > 100 ? note.note.substring(0, 100) + '...' : note.note,
        fullNote: note.note,
        addedBy: note.addedBy,
        addedAt: note.addedAt,
        category: note.category,
        type: note.type,
        source: note.source,
        clientId: note.clientId,
        clientName: note.clientName,
        clientEmail: note.clientEmail,
        fileName: note.fileName,
        month: `${note.monthName} ${note.year}`,
        isUnviewed: note.isUnviewedByEmployee,
        isNew: note.isNew,
        isUnviewedByEmployee: note.isUnviewedByEmployee
      })),
      hasUnviewedNotes: result.hasUnviewedNotes,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_NOTES_ALERT_PREVIEW_FAILED", {
      error: error.message,
      employeeId: req.user?.employeeId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching notes preview"
    });
  }
});

/* ===============================
   NEW 4: GET ALL NOTES FOR EMPLOYEE MODAL
================================ */
router.get("/notes/all-notes", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const limit = parseInt(req.query.limit) || 50;

    logToConsole("INFO", "EMPLOYEE_ALL_NOTES_REQUEST", {
      employeeId,
      limit
    });

    const result = await getAllNotesForEmployeeAlert(employeeId, limit);

    // Get employee info for activity log
    const employee = await Employee.findOne({ employeeId }).lean();

    // Create activity log - REMOVED dateTime line
    await ActivityLog.create({
      userName: employee?.name || "Employee",
      role: "EMPLOYEE",
      employeeId: employeeId,
      employeeName: employee?.name || "Employee",
      action: "EMPLOYEE_ALL_NOTES_VIEWED",
      details: `Employee "${employee?.name || "Employee"}" viewed all notes (${result.totalNotes} total, ${result.unviewedCount} unviewed)`,
      metadata: {
        employeeId,
        employeeName: employee?.name || "Employee",
        totalNotes: result.totalNotes,
        unviewedNotes: result.unviewedCount,
        viewedNotes: result.totalNotes - result.unviewedCount,
        timestamp: new Date().toISOString()
      }
    });

    logToConsole("SUCCESS", "EMPLOYEE_ALL_NOTES_FETCHED", {
      employeeId,
      totalNotes: result.totalNotes,
      unviewedCount: result.unviewedCount
    });

    res.json({
      success: true,
      employeeId,
      employeeName: employee?.name || "Employee",
      totalNotes: result.totalNotes,
      unviewedNotes: result.unviewedCount,
      notes: result.notes.map(note => ({
        id: `${note.source}_${note.clientId}_${note.year}_${note.month}_${Date.now()}_${Math.random()}`,
        note: note.note,
        fullNote: note.note,
        addedBy: note.addedBy,
        addedAt: note.addedAt,
        category: note.category,
        type: note.type,
        source: note.source,
        clientId: note.clientId,
        clientName: note.clientName,
        clientEmail: note.clientEmail,
        fileName: note.fileName,
        year: note.year,
        month: note.month,
        monthName: note.monthName,
        isUnviewed: note.isUnviewedByEmployee,
        isNew: note.isNew,
        isUnviewedByEmployee: note.isUnviewedByEmployee,
        viewedBy: note.viewedBy,
        isViewedByEmployee: note.isViewedByEmployee
      })),
      hasUnviewedNotes: result.hasUnviewedNotes,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_ALL_NOTES_FAILED", {
      error: error.message,
      employeeId: req.user?.employeeId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching all notes"
    });
  }
});

/* ===============================
   1. GET EMPLOYEE DASHBOARD OVERVIEW (UPDATED WITH NOTES)
================================ */
router.get("/dashboard/overview", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { timeFilter = 'this_month', customStart, customEnd } = req.query;

    logToConsole("INFO", "EMPLOYEE_DASHBOARD_REQUEST", {
      employeeId,
      timeFilter,
      customStart,
      customEnd
    });

    // Get employee data
    const employee = await Employee.findOne(
      { employeeId },
      {
        employeeId: 1,
        name: 1,
        email: 1,
        phone: 1,
        isActive: 1,
        createdAt: 1
      }
    ).lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Get all clients where this employee is assigned
    const clients = await Client.find(
      {
        "employeeAssignments.employeeId": employeeId,
        "employeeAssignments.isRemoved": false
      },
      {
        clientId: 1,
        name: 1,
        email: 1,
        phone: 1,
        businessName: 1,
        documents: 1,
        employeeAssignments: 1
      }
    ).lean();

    // Get unviewed notes count for alert card
    const unviewedNotesCount = await countUnviewedClientNotesForEmployee(employeeId);

    // Get notes preview for alert card
    const notesPreview = await getAllNotesForEmployeeAlert(employeeId, 3);

    // Get month range based on filter
    const months = getMonthRange(timeFilter, customStart, customEnd);

    const monthData = [];
    const allTasksSummary = {
      totalAssigned: 0,
      totalCompleted: 0,
      pendingTasks: 0
    };
    const allNotesSummary = {
      totalNotes: 0,
      clientNotes: 0,
      employeeNotes: 0,
      unviewedNotes: unviewedNotesCount  // ADDED
    };

    // Process each month
    for (const month of months) {
      const monthTasks = [];
      const monthNotes = [];
      const clientsForMonth = [];

      // Process each client for this month
      for (const client of clients) {
        const yearKey = String(month.year);
        const monthKey = String(month.month);
        const monthDocuments = client.documents?.[yearKey]?.[monthKey];

        // Get tasks assigned to this employee for this client & month
        const clientTasks = getEmployeeTasksForMonth(
          employeeId,
          client.employeeAssignments || [],
          month.year,
          month.month
        );

        // Filter only assigned tasks
        const assignedTasks = clientTasks.filter(task => task.status === 'assigned');

        if (assignedTasks.length > 0) {
          // Get notes for this month WITH VIEW STATUS
          const notes = getEmployeeNotesForMonth(monthDocuments, employeeId, client.clientId);
          const clientNotes = notes.notes.filter(note => note.source === 'client');
          const employeeNotes = notes.notes.filter(note => note.source === 'employee');
          const unviewedNotes = notes.notes.filter(note => note.isUnviewedByEmployee);

          // Add client info with tasks
          clientsForMonth.push({
            clientId: client.clientId,
            clientName: client.name,
            clientEmail: client.email,
            clientPhone: client.phone,
            businessName: client.businessName,
            tasks: assignedTasks,
            notes: {
              clientNotes: clientNotes.length,
              employeeNotes: employeeNotes.length,
              unviewedNotes: unviewedNotes.length
            }
          });

          // Add to month tasks
          monthTasks.push(...assignedTasks.map(task => ({
            ...task,
            clientName: client.name,
            clientId: client.clientId
          })));

          // Add to month notes
          monthNotes.push(...notes.notes.map(note => ({
            ...note,
            clientName: client.name,
            clientId: client.clientId,
            isUnviewed: note.isUnviewedByEmployee  // ADDED
          })));

          // Update summaries
          allTasksSummary.totalAssigned += assignedTasks.length;
          allTasksSummary.totalCompleted += assignedTasks.filter(t => t.accountingDone).length;
          allTasksSummary.pendingTasks += assignedTasks.filter(t => !t.accountingDone).length;

          allNotesSummary.totalNotes += notes.total;
          allNotesSummary.clientNotes += clientNotes.length;
          allNotesSummary.employeeNotes += employeeNotes.length;
        }
      }

      // Only add month if there are assigned tasks
      if (clientsForMonth.length > 0) {
        const pendingTasks = monthTasks.filter(task => !task.accountingDone);
        const completedTasks = monthTasks.filter(task => task.accountingDone);

        monthData.push({
          year: month.year,
          month: month.month,
          monthName: new Date(month.year, month.month - 1).toLocaleString('default', {
            month: 'long',
            timeZone: "Europe/Helsinki"
          }),

          clients: clientsForMonth,

          // Task Summary
          tasks: {
            list: monthTasks.slice(0, 5),
            summary: {
              totalTasks: monthTasks.length,
              assignedTasks: monthTasks.length,
              completedTasks: completedTasks.length,
              pendingTasks: pendingTasks.length,
              completionRate: monthTasks.length > 0 ? Math.round((completedTasks.length / monthTasks.length) * 100) : 0
            }
          },

          // Notes Summary WITH VIEW STATUS
          notes: {
            list: monthNotes.slice(0, 5),
            summary: {
              totalNotes: monthNotes.length,
              clientNotes: monthNotes.filter(n => n.source === 'client').length,
              employeeNotes: monthNotes.filter(n => n.source === 'employee').length,
              unviewedNotes: monthNotes.filter(n => n.isUnviewed).length,  // ADDED
              unviewedPercentage: monthNotes.length > 0 ? Math.round((monthNotes.filter(n => n.isUnviewed).length / monthNotes.length) * 100) : 0
            }
          },

          // Month Status
          monthStatus: {
            hasPendingTasks: pendingTasks.length > 0,
            allTasksCompleted: pendingTasks.length === 0 && monthTasks.length > 0,
            noAssignments: monthTasks.length === 0,
            hasUnviewedNotes: monthNotes.filter(n => n.isUnviewed).length > 0  // ADDED
          }
        });
      }
    }

    // Employee info
    const employeeInfo = {
      employeeId: employee.employeeId,
      name: employee.name,
      email: employee.email,
      phone: employee.phone || "Not provided",
      isActive: employee.isActive ? 'Active' : 'Inactive',
      statusColor: employee.isActive ? '#7cd64b' : '#ff4b4b',
      activeSince: new Date(employee.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: "Europe/Helsinki"
      })
    };

    // ===== ACTIVITY LOG: EMPLOYEE DASHBOARD VIEWED =====
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        employeeName: employee.name,
        action: "EMPLOYEE_DASHBOARD_VIEWED",
        details: `Employee "${employee.name}" viewed dashboard with filter: ${timeFilter}. Summary: ${allTasksSummary.totalAssigned} tasks assigned, ${allTasksSummary.pendingTasks} pending, ${unviewedNotesCount} unviewed notes`,
        metadata: {
          timeFilter,
          customStart: customStart || null,
          customEnd: customEnd || null,
          totalAssignedTasks: allTasksSummary.totalAssigned,
          totalCompletedTasks: allTasksSummary.totalCompleted,
          pendingTasks: allTasksSummary.pendingTasks,
          totalClients: clients.length,
          unviewedNotesCount: unviewedNotesCount
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED_EMPLOYEE_DASHBOARD", {
        employeeId: employee.employeeId,
        action: "EMPLOYEE_DASHBOARD_VIEWED"
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED_EMPLOYEE_DASHBOARD", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    logToConsole("SUCCESS", "EMPLOYEE_DASHBOARD_FETCHED", {
      employeeId: employee.employeeId,
      timeFilter,
      totalClients: clients.length,
      totalTasks: allTasksSummary.totalAssigned,
      unviewedNotes: unviewedNotesCount
    });

    res.json({
      success: true,
      employee: employeeInfo,
      timeFilter,
      months: months.map(m => ({
        year: m.year,
        month: m.month,
        display: `${new Date(m.year, m.month - 1).toLocaleString('default', {
          month: 'long',
          timeZone: "Europe/Helsinki"
        })} ${m.year}`
      })),
      data: monthData,
      summaries: {
        totalClients: clients.length,
        tasks: allTasksSummary,
        notes: allNotesSummary
      },
      // NEW: Alert information with notes preview
      alertInfo: {
        hasUnviewedNotes: unviewedNotesCount > 0,
        unviewedNotesCount,
        totalNotes: notesPreview.totalNotes,
        previewNotes: notesPreview.preview,
        lastChecked: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Employee dashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee dashboard data"
    });
  }
});

/* ===============================
   2. GET SPECIFIC MONTH DETAILS FOR EMPLOYEE (UPDATED)
================================ */
router.get("/dashboard/month-details", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        message: "Year and month are required"
      });
    }

    logToConsole("INFO", "EMPLOYEE_MONTH_DETAILS_REQUEST", {
      employeeId,
      year,
      month
    });

    // Get employee data
    const employee = await Employee.findOne(
      { employeeId },
      {
        employeeId: 1,
        name: 1,
        email: 1
      }
    ).lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Get all clients where this employee is assigned for this month
    const clients = await Client.find(
      {
        "employeeAssignments.employeeId": employeeId,
        "employeeAssignments.year": parseInt(year),
        "employeeAssignments.month": parseInt(month),
        "employeeAssignments.isRemoved": false
      },
      {
        clientId: 1,
        name: 1,
        email: 1,
        phone: 1,
        businessName: 1,
        businessNature: 1,
        vatPeriod: 1,
        documents: 1,
        employeeAssignments: 1
      }
    ).lean();

    const detailedClients = [];
    const allTasks = [];
    const allNotes = [];

    for (const client of clients) {
      const yearKey = String(year);
      const monthKey = String(month);
      const monthDocuments = client.documents?.[yearKey]?.[monthKey];

      // Get tasks for this client
      const clientTasks = getEmployeeTasksForMonth(
        employeeId,
        client.employeeAssignments || [],
        parseInt(year),
        parseInt(month)
      );

      const assignedTasks = clientTasks.filter(task => task.status === 'assigned');
      const pendingTasks = assignedTasks.filter(task => !task.accountingDone);
      const completedTasks = assignedTasks.filter(task => task.accountingDone);

      // Get notes for this client WITH VIEW STATUS
      const notes = getEmployeeNotesForMonth(monthDocuments, employeeId, client.clientId);
      const unviewedNotes = notes.notes.filter(note => note.isUnviewedByEmployee);

      if (assignedTasks.length > 0) {
        detailedClients.push({
          clientId: client.clientId,
          clientName: client.name,
          clientEmail: client.email,
          clientPhone: client.phone || "Not provided",
          businessName: client.businessName || "Not specified",
          businessNature: client.businessNature || "Not specified",
          vatPeriod: client.vatPeriod || "Monthly",
          tasks: assignedTasks,
          pendingTasks: pendingTasks.length,
          completedTasks: completedTasks.length,
          notes: notes.notes,
          unviewedNotes: unviewedNotes.length  // ADDED
        });

        allTasks.push(...assignedTasks.map(task => ({
          ...task,
          clientName: client.name,
          clientId: client.clientId
        })));

        allNotes.push(...notes.notes.map(note => ({
          ...note,
          clientName: client.name,
          clientId: client.clientId,
          isUnviewed: note.isUnviewedByEmployee  // ADDED
        })));
      }
    }

    // ===== ACTIVITY LOG: EMPLOYEE MONTH DETAILS VIEWED =====
    try {
      const unviewedNotesCount = allNotes.filter(n => n.isUnviewed).length;

      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        employeeName: employee.name,
        action: "EMPLOYEE_MONTH_DETAILS_VIEWED",
        details: `Employee "${employee.name}" viewed details for ${month}/${year}. Found ${detailedClients.length} clients, ${allTasks.length} tasks, ${allNotes.length} notes (${unviewedNotesCount} unviewed)`,
        metadata: {
          year: parseInt(year),
          month: parseInt(month),
          totalClients: detailedClients.length,
          totalTasks: allTasks.length,
          pendingTasks: allTasks.filter(t => !t.accountingDone).length,
          completedTasks: allTasks.filter(t => t.accountingDone).length,
          totalNotes: allNotes.length,
          clientNotes: allNotes.filter(n => n.source === 'client').length,
          employeeNotes: allNotes.filter(n => n.source === 'employee').length,
          unviewedNotes: unviewedNotesCount
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED_MONTH_DETAILS", {
        employeeId: employee.employeeId,
        year,
        month
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED_MONTH_DETAILS", {
        error: logError.message,
        employeeId: employee.employeeId
      });
    }

    logToConsole("SUCCESS", "EMPLOYEE_MONTH_DETAILS_FETCHED", {
      employeeId: employee.employeeId,
      year,
      month,
      clientsCount: detailedClients.length,
      tasksCount: allTasks.length,
      notesCount: allNotes.length,
      unviewedNotes: allNotes.filter(n => n.isUnviewed).length
    });

    res.json({
      success: true,
      employee: {
        employeeId: employee.employeeId,
        name: employee.name,
        email: employee.email
      },
      month: {
        year: parseInt(year),
        month: parseInt(month),
        monthName: new Date(year, month - 1).toLocaleString('default', {
          month: 'long',
          timeZone: "Europe/Helsinki"
        })
      },

      clients: detailedClients,

      tasks: {
        total: allTasks.length,
        pending: allTasks.filter(t => !t.accountingDone).length,
        completed: allTasks.filter(t => t.accountingDone).length,
        list: allTasks
      },

      notes: {
        total: allNotes.length,
        clientNotes: allNotes.filter(n => n.source === 'client').length,
        employeeNotes: allNotes.filter(n => n.source === 'employee').length,
        unviewedCount: allNotes.filter(n => n.isUnviewed).length,  // ADDED
        list: allNotes
      }
    });

  } catch (error) {
    console.error("Employee month details error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching month details"
    });
  }
});

/* ===============================
   3. GET CLIENT CONTACT FOR SPECIFIC TASK
================================ */
router.get("/dashboard/client-contact", auth, async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    // Check if employee is assigned to this client
    const isAssigned = await Client.findOne({
      clientId,
      "employeeAssignments.employeeId": employeeId,
      "employeeAssignments.isRemoved": false
    });

    if (!isAssigned) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this client"
      });
    }

    const client = await Client.findOne(
      { clientId },
      {
        clientId: 1,
        name: 1,
        email: 1,
        phone: 1,
        address: 1,
        businessName: 1,
        businessNature: 1,
        vatPeriod: 1
      }
    ).lean();

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Get employee info for activity log
    const employee = await Employee.findOne(
      { employeeId },
      { employeeId: 1, name: 1 }
    ).lean();

    // ===== ACTIVITY LOG: EMPLOYEE VIEWED CLIENT CONTACT =====
    try {
      await ActivityLog.create({
        userName: employee?.name || "Employee",
        role: "EMPLOYEE",
        employeeId: employeeId,
        employeeName: employee?.name || "Employee",
        clientId: client.clientId,
        clientName: client.name,
        action: "EMPLOYEE_CLIENT_CONTACT_VIEWED",
        details: `Employee "${employee?.name || "Employee"}" viewed contact details for client "${client.name}"`,
        metadata: {
          clientId: client.clientId,
          clientName: client.name,
          employeeId: employeeId,
          employeeName: employee?.name || "Employee"
        }
      });

      logToConsole("INFO", "ACTIVITY_LOG_CREATED_CLIENT_CONTACT_VIEW", {
        employeeId,
        clientId
      });
    } catch (logError) {
      logToConsole("ERROR", "ACTIVITY_LOG_FAILED_CLIENT_CONTACT", {
        error: logError.message,
        employeeId,
        clientId
      });
    }

    logToConsole("SUCCESS", "EMPLOYEE_CLIENT_CONTACT_FETCHED", {
      employeeId,
      clientId: client.clientId
    });

    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        phone: client.phone || "Not provided",
        address: client.address || "Not provided",
        businessName: client.businessName || "Not specified",
        businessNature: client.businessNature || "Not specified",
        vatPeriod: client.vatPeriod || "Monthly"
      }
    });

  } catch (error) {
    console.error("Client contact error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching client contact"
    });
  }
});

/* ===============================
   TEST ROUTE
================================ */
router.get("/test", (req, res) => {
  console.log("✅ EMPLOYEE DASHBOARD TEST ROUTE HIT!");
  res.json({
    success: true,
    message: "Employee Dashboard route is working!",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;