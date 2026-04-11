// routes/clientDashboard.js
const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");

const Client = require("../models/Client");
const ClientMonthlyData = require("../models/ClientMonthlyData");
const Employee = require("../models/Employee");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// Console logging
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
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
   HELPER: GET MONTH DATA FROM BOTH SOURCES
================================ */
const getMonthDataFromBoth = async (clientId, year, month) => {
  // FIRST: Check NEW ClientMonthlyData collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      const foundMonth = newDoc.months.find(m => m.year === year && m.month === month);
      if (foundMonth) {
        return { data: foundMonth, source: 'new' };
      }
    }
  } catch (err) {
    logToConsole("WARN", "ERROR_GETTING_NEW_MONTH_DATA", { error: err.message });
  }

  // SECOND: Check OLD client.documents
  const client = await Client.findOne({ clientId }).lean();
  if (client && client.documents) {
    const yearKey = String(year);
    const monthKey = String(month);
    if (client.documents[yearKey] && client.documents[yearKey][monthKey]) {
      return { data: client.documents[yearKey][monthKey], source: 'old' };
    }
  }

  return null;
};

/* ===============================
   HELPER: GET DOCUMENT STATUS FOR CATEGORY (UPDATED)
================================ */
const getCategoryDocumentStatus = (categoryData, categoryName) => {
  if (!categoryData) {
    return {
      category: categoryName,
      status: 'not_uploaded',
      files: [],
      totalFiles: 0,
      uploadedFiles: 0
    };
  }

  const files = categoryData.files || [];
  const uploadedFiles = files.filter(file => file.url && file.fileName);

  return {
    category: categoryName,
    status: uploadedFiles.length > 0 ? 'uploaded' : 'not_uploaded',
    files: uploadedFiles.map(file => ({
      fileName: file.fileName,
      uploadedAt: file.uploadedAt,
      uploadedBy: file.uploadedBy
    })),
    totalFiles: files.length,
    uploadedFiles: uploadedFiles.length,
    isLocked: categoryData.isLocked || false,
    notes: categoryData.categoryNotes || []
  };
};

/* ===============================
   HELPER: GET OTHER CATEGORIES STATUS (UPDATED)
================================ */
const getOtherCategoriesStatus = (otherCategories = []) => {
  return otherCategories.map(cat => {
    if (!cat.document) {
      return {
        categoryName: cat.categoryName,
        status: 'not_uploaded',
        files: [],
        uploadedFiles: 0
      };
    }

    const files = cat.document.files || [];
    const uploadedFiles = files.filter(file => file.url && file.fileName);

    return {
      categoryName: cat.categoryName,
      status: uploadedFiles.length > 0 ? 'uploaded' : 'not_uploaded',
      files: uploadedFiles.map(file => ({
        fileName: file.fileName,
        uploadedAt: file.uploadedAt,
        uploadedBy: file.uploadedBy
      })),
      uploadedFiles: uploadedFiles.length,
      notes: cat.document.categoryNotes || []
    };
  });
};

/* ===============================
   HELPER: GET TASK STATUS FOR MONTH
================================ */
const getTaskStatusForMonth = async (employeeAssignments = [], year, month) => {
  const allTasks = [
    { id: 'bookkeeping', name: 'Bookkeeping', required: true },
    { id: 'vat_computation', name: 'VAT Filing Computation', required: true },
    { id: 'vat_filing', name: 'VAT Filing', required: true },
    { id: 'financial_statements', name: 'Financial Statement Generation', required: true }
  ];

  const monthAssignments = employeeAssignments.filter(assignment =>
    assignment.year === year &&
    assignment.month === month &&
    assignment.isRemoved === false
  );

  const taskStatus = allTasks.map(task => {
    const assignment = monthAssignments.find(a => a.task === task.name);

    if (assignment) {
      return {
        taskId: task.id,
        taskName: task.name,
        status: 'assigned',
        accountingDone: assignment.accountingDone || false,
        accountingDoneAt: assignment.accountingDoneAt,
        accountingDoneBy: assignment.accountingDoneBy,
        employeeId: assignment.employeeId,
        employeeName: assignment.employeeName,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy
      };
    }

    return {
      taskId: task.id,
      taskName: task.name,
      status: 'not_assigned',
      accountingDone: false
    };
  });

  const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
  const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];

  let employees = [];
  if (employeeIds.length > 0) {
    employees = await Employee.find(
      { employeeId: { $in: employeeIds } },
      { employeeId: 1, name: 1, email: 1, phone: 1 }
    ).lean();
  }

  return taskStatus.map(task => {
    if (task.status === 'assigned') {
      const employee = employees.find(emp => emp.employeeId === task.employeeId);
      return {
        ...task,
        employeeEmail: employee?.email || null,
        employeePhone: employee?.phone || null
      };
    }
    return task;
  });
};

/* ===============================
   HELPER: GET NOTES FOR MONTH WITH VIEW STATUS (UPDATED)
================================ */
const getNotesForMonth = (monthData, clientId = null) => {
  const allNotes = [];

  if (!monthData) {
    return { total: 0, notes: [] };
  }

  if (monthData.monthNotes && monthData.monthNotes.length > 0) {
    monthData.monthNotes.forEach(note => {
      const isUnviewedByClient = clientId ? !note.isViewedByClient : false;
      allNotes.push({
        type: 'month_note',
        category: 'General',
        note: note.note,
        addedBy: note.addedBy || 'Client',
        addedAt: note.addedAt,
        addedById: note.employeeId,
        source: 'client',
        isUnviewedByClient,
        viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
        totalViews: note.viewedBy?.length || 0
      });
    });
  }

  ['sales', 'purchase', 'bank'].forEach(category => {
    const categoryData = monthData[category];
    if (categoryData && categoryData.categoryNotes && categoryData.categoryNotes.length > 0) {
      categoryData.categoryNotes.forEach(note => {
        const isUnviewedByClient = clientId ? !note.isViewedByClient : false;
        allNotes.push({
          type: 'delete_reason',
          category: category.charAt(0).toUpperCase() + category.slice(1),
          note: note.note,
          addedBy: note.addedBy || 'Client',
          addedAt: note.addedAt,
          addedById: note.employeeId,
          source: 'client',
          isUnviewedByClient,
          viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
          totalViews: note.viewedBy?.length || 0
        });
      });
    }
  });

  ['sales', 'purchase', 'bank'].forEach(category => {
    const categoryData = monthData[category];
    if (categoryData && categoryData.files) {
      categoryData.files.forEach(file => {
        if (file.notes && file.notes.length > 0) {
          file.notes.forEach(note => {
            const isUnviewedByClient = clientId ? !note.isViewedByClient : false;
            allNotes.push({
              type: 'file_feedback',
              category: category.charAt(0).toUpperCase() + category.slice(1),
              fileName: file.fileName,
              note: note.note,
              addedBy: note.addedBy || 'Employee',
              addedAt: note.addedAt,
              addedById: note.employeeId,
              source: 'employee',
              isUnviewedByClient,
              viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
              totalViews: note.viewedBy?.length || 0
            });
          });
        }
      });
    }
  });

  if (monthData.other && Array.isArray(monthData.other)) {
    monthData.other.forEach(otherCat => {
      if (otherCat.document) {
        if (otherCat.document.categoryNotes && otherCat.document.categoryNotes.length > 0) {
          otherCat.document.categoryNotes.forEach(note => {
            const isUnviewedByClient = clientId ? !note.isViewedByClient : false;
            allNotes.push({
              type: 'delete_reason',
              category: otherCat.categoryName,
              note: note.note,
              addedBy: note.addedBy || 'Client',
              addedAt: note.addedAt,
              addedById: note.employeeId,
              source: 'client',
              isUnviewedByClient,
              viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
              totalViews: note.viewedBy?.length || 0
            });
          });
        }

        if (otherCat.document.files) {
          otherCat.document.files.forEach(file => {
            if (file.notes && file.notes.length > 0) {
              file.notes.forEach(note => {
                const isUnviewedByClient = clientId ? !note.isViewedByClient : false;
                allNotes.push({
                  type: 'file_feedback',
                  category: otherCat.categoryName,
                  fileName: file.fileName,
                  note: note.note,
                  addedBy: note.addedBy || 'Employee',
                  addedAt: note.addedAt,
                  addedById: note.employeeId,
                  source: 'employee',
                  isUnviewedByClient,
                  viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
                  totalViews: note.viewedBy?.length || 0
                });
              });
            }
          });
        }
      }
    });
  }

  allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  return {
    total: allNotes.length,
    notes: allNotes,
    unviewedCount: clientId ? allNotes.filter(note => note.isUnviewedByClient).length : 0
  };
};

/* ===============================
   HELPER: COUNT ALL NOTES IN CLIENT (UPDATED - CHECKS BOTH)
================================ */
const countAllNotesInClient = async (clientId) => {
  let totalCount = 0;

  // Helper to count notes in an array
  const countNotesInArray = (notesArray) => {
    if (!notesArray || !Array.isArray(notesArray)) return 0;
    return notesArray.filter(note => note && typeof note === 'object' && (note.note || note.noteText)).length;
  };

  // Helper to process month data
  const processMonthData = (monthData) => {
    if (!monthData || typeof monthData !== 'object') return 0;
    let count = 0;

    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      count += countNotesInArray(monthData.monthNotes);
    }

    ['sales', 'purchase', 'bank'].forEach(category => {
      const categoryData = monthData[category];
      if (categoryData && typeof categoryData === 'object') {
        if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
          count += countNotesInArray(categoryData.categoryNotes);
        }
        if (categoryData.files && Array.isArray(categoryData.files)) {
          categoryData.files.forEach(file => {
            if (file && typeof file === 'object') {
              count += countNotesInArray(file.notes);
            }
          });
        }
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
          if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
            count += countNotesInArray(otherCat.document.categoryNotes);
          }
          if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
            otherCat.document.files.forEach(file => {
              if (file && typeof file === 'object') {
                count += countNotesInArray(file.notes);
              }
            });
          }
        }
      });
    }

    return count;
  };

  // 1. Check NEW collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      for (const monthData of newDoc.months) {
        totalCount += processMonthData(monthData);
      }
    }
  } catch (err) {
    logToConsole("WARN", "COUNT_NOTES_NEW_FAILED", { error: err.message });
  }

  // 2. Check OLD client.documents
  const client = await Client.findOne({ clientId }).lean();
  if (client && client.documents) {
    const documents = client.documents;
    let years = [];
    if (documents instanceof Map) {
      years = Array.from(documents.keys());
    } else {
      years = Object.keys(documents).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
    }

    for (const year of years) {
      let yearData;
      if (documents instanceof Map) {
        yearData = documents.get(year);
      } else {
        yearData = documents[year];
      }
      if (!yearData || typeof yearData !== 'object') continue;

      let months = [];
      if (yearData instanceof Map) {
        months = Array.from(yearData.keys());
      } else {
        months = Object.keys(yearData).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
      }

      for (const month of months) {
        let monthData;
        if (yearData instanceof Map) {
          monthData = yearData.get(month);
        } else {
          monthData = yearData[month];
        }
        if (monthData && typeof monthData === 'object') {
          totalCount += processMonthData(monthData);
        }
      }
    }
  }

  return totalCount;
};

/* ===============================
   HELPER: COUNT UNVIEWED NOTES FOR CLIENT (UPDATED - CHECKS BOTH)
================================ */
const countUnviewedNotesInClient = async (clientId) => {
  let unviewedCount = 0;

  const countUnviewedInArray = (notesArray) => {
    if (!notesArray || !Array.isArray(notesArray)) return 0;
    return notesArray.filter(note => note && typeof note === 'object' && (note.note || note.noteText) && !note.isViewedByClient).length;
  };

  const processMonthData = (monthData) => {
    if (!monthData || typeof monthData !== 'object') return 0;
    let count = 0;

    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      count += countUnviewedInArray(monthData.monthNotes);
    }

    ['sales', 'purchase', 'bank'].forEach(category => {
      const categoryData = monthData[category];
      if (categoryData && typeof categoryData === 'object') {
        if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
          count += countUnviewedInArray(categoryData.categoryNotes);
        }
        if (categoryData.files && Array.isArray(categoryData.files)) {
          categoryData.files.forEach(file => {
            if (file && typeof file === 'object') {
              count += countUnviewedInArray(file.notes);
            }
          });
        }
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
          if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
            count += countUnviewedInArray(otherCat.document.categoryNotes);
          }
          if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
            otherCat.document.files.forEach(file => {
              if (file && typeof file === 'object') {
                count += countUnviewedInArray(file.notes);
              }
            });
          }
        }
      });
    }

    return count;
  };

  // 1. Check NEW collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      for (const monthData of newDoc.months) {
        unviewedCount += processMonthData(monthData);
      }
    }
  } catch (err) {
    logToConsole("WARN", "COUNT_UNVIEWED_NEW_FAILED", { error: err.message });
  }

  // 2. Check OLD client.documents
  const client = await Client.findOne({ clientId }).lean();
  if (client && client.documents) {
    const documents = client.documents;
    let years = [];
    if (documents instanceof Map) {
      years = Array.from(documents.keys());
    } else {
      years = Object.keys(documents).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
    }

    for (const year of years) {
      let yearData;
      if (documents instanceof Map) {
        yearData = documents.get(year);
      } else {
        yearData = documents[year];
      }
      if (!yearData || typeof yearData !== 'object') continue;

      let months = [];
      if (yearData instanceof Map) {
        months = Array.from(yearData.keys());
      } else {
        months = Object.keys(yearData).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
      }

      for (const month of months) {
        let monthData;
        if (yearData instanceof Map) {
          monthData = yearData.get(month);
        } else {
          monthData = yearData[month];
        }
        if (monthData && typeof monthData === 'object') {
          unviewedCount += processMonthData(monthData);
        }
      }
    }
  }

  return unviewedCount;
};

/* ===============================
   HELPER: MARK ALL NOTES AS VIEWED FOR CLIENT (UPDATED - HANDLES BOTH)
================================ */
const markAllNotesAsViewedForClient = async (clientId) => {
  let totalMarked = 0;
  const now = new Date();
  const viewEntry = {
    userId: clientId,
    userType: 'client',
    viewedAt: now
  };

  const markNotesInArray = (notesArray) => {
    if (!notesArray || !Array.isArray(notesArray)) return 0;
    let count = 0;
    notesArray.forEach(note => {
      if (!note || typeof note !== 'object') return;
      if (!note.note && !note.noteText) return;

      const alreadyViewed = note.viewedBy?.some(view => view && view.userId === clientId && view.userType === 'client');
      if (!alreadyViewed) {
        note.viewedBy = note.viewedBy || [];
        note.viewedBy.push(viewEntry);
        note.isViewedByClient = true;
        count++;
      } else if (alreadyViewed && note.isViewedByClient !== true) {
        note.isViewedByClient = true;
        count++;
      }
    });
    return count;
  };

  const processMonthData = (monthData) => {
    if (!monthData || typeof monthData !== 'object') return 0;
    let count = 0;

    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      count += markNotesInArray(monthData.monthNotes);
    }

    ['sales', 'purchase', 'bank'].forEach(category => {
      const categoryData = monthData[category];
      if (categoryData && typeof categoryData === 'object') {
        if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
          count += markNotesInArray(categoryData.categoryNotes);
        }
        if (categoryData.files && Array.isArray(categoryData.files)) {
          categoryData.files.forEach(file => {
            if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
              count += markNotesInArray(file.notes);
            }
          });
        }
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
          if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
            count += markNotesInArray(otherCat.document.categoryNotes);
          }
          if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
            otherCat.document.files.forEach(file => {
              if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
                count += markNotesInArray(file.notes);
              }
            });
          }
        }
      });
    }

    return count;
  };

  // 1. Update NEW collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      let modified = false;
      for (const monthData of newDoc.months) {
        const monthMarked = processMonthData(monthData);
        if (monthMarked > 0) {
          totalMarked += monthMarked;
          modified = true;
        }
      }
      if (modified) {
        await newDoc.save();
        logToConsole("INFO", "MARKED_NOTES_IN_NEW_COLLECTION", { clientId, marked: totalMarked });
      }
    }
  } catch (err) {
    logToConsole("ERROR", "MARK_NOTES_NEW_FAILED", { error: err.message, clientId });
  }

  // 2. Update OLD client.documents
  try {
    const client = await Client.findOne({ clientId });
    if (client && client.documents) {
      let clientModified = false;
      const documents = client.documents;
      let years = [];
      if (documents instanceof Map) {
        years = Array.from(documents.keys());
      } else {
        years = Object.keys(documents).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
      }

      for (const year of years) {
        let yearData;
        if (documents instanceof Map) {
          yearData = documents.get(year);
        } else {
          yearData = documents[year];
        }
        if (!yearData || typeof yearData !== 'object') continue;

        let months = [];
        if (yearData instanceof Map) {
          months = Array.from(yearData.keys());
        } else {
          months = Object.keys(yearData).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
        }

        for (const month of months) {
          let monthData;
          if (yearData instanceof Map) {
            monthData = yearData.get(month);
          } else {
            monthData = yearData[month];
          }
          if (monthData && typeof monthData === 'object') {
            const monthMarked = processMonthData(monthData);
            if (monthMarked > 0) {
              totalMarked += monthMarked;
              clientModified = true;
            }
          }
        }
      }

      if (clientModified) {
        client.markModified('documents');
        await client.save();
        logToConsole("INFO", "MARKED_NOTES_IN_OLD_COLLECTION", { clientId, marked: totalMarked });
      }
    }
  } catch (err) {
    logToConsole("ERROR", "MARK_NOTES_OLD_FAILED", { error: err.message, clientId });
  }

  return { success: true, notesMarked: totalMarked };
};

/* ===============================
   HELPER: GET ALL NOTES FOR ALERT (UPDATED - CHECKS BOTH)
================================ */
const getAllNotesForAlert = async (clientId, limit = 5) => {
  const allNotes = [];

  const addNoteWithMetadata = (note, metadata) => {
    if (!note || typeof note !== 'object') return;
    const isUnviewedByClient = !note.isViewedByClient;
    allNotes.push({
      ...note,
      ...metadata,
      isUnviewedByClient,
      viewedByClients: note.viewedBy?.filter(v => v.userType === 'client') || [],
      totalViews: note.viewedBy?.length || 0
    });
  };

  const processMonthData = (monthData, year, month, monthName) => {
    if (!monthData || typeof monthData !== 'object') return;

    if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
      monthData.monthNotes.forEach(note => {
        addNoteWithMetadata(note, {
          location: 'month',
          year: year,
          month: month,
          monthName: monthName,
          category: 'General',
          type: 'month_note',
          source: 'client'
        });
      });
    }

    ['sales', 'purchase', 'bank'].forEach(category => {
      const categoryData = monthData[category];
      if (!categoryData || typeof categoryData !== 'object') return;

      if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
        categoryData.categoryNotes.forEach(note => {
          addNoteWithMetadata(note, {
            location: 'category',
            year: year,
            month: month,
            monthName: monthName,
            category: category.charAt(0).toUpperCase() + category.slice(1),
            type: 'delete_reason',
            source: 'client'
          });
        });
      }

      if (categoryData.files && Array.isArray(categoryData.files)) {
        categoryData.files.forEach(file => {
          if (file && file.notes && Array.isArray(file.notes)) {
            file.notes.forEach(note => {
              addNoteWithMetadata(note, {
                location: 'file',
                year: year,
                month: month,
                monthName: monthName,
                category: category.charAt(0).toUpperCase() + category.slice(1),
                fileName: file.fileName,
                type: 'file_feedback',
                source: 'employee'
              });
            });
          }
        });
      }
    });

    if (monthData.other && Array.isArray(monthData.other)) {
      monthData.other.forEach(otherCat => {
        if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
          if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
            otherCat.document.categoryNotes.forEach(note => {
              addNoteWithMetadata(note, {
                location: 'category',
                year: year,
                month: month,
                monthName: monthName,
                category: otherCat.categoryName,
                type: 'delete_reason',
                source: 'client'
              });
            });
          }

          if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
            otherCat.document.files.forEach(file => {
              if (file && file.notes && Array.isArray(file.notes)) {
                file.notes.forEach(note => {
                  addNoteWithMetadata(note, {
                    location: 'file',
                    year: year,
                    month: month,
                    monthName: monthName,
                    category: otherCat.categoryName,
                    fileName: file.fileName,
                    type: 'file_feedback',
                    source: 'employee'
                  });
                });
              }
            });
          }
        }
      });
    }
  };

  // 1. Get from NEW collection
  try {
    const newDoc = await ClientMonthlyData.findOne({ clientId });
    if (newDoc && newDoc.months) {
      for (const monthData of newDoc.months) {
        const monthName = new Date(monthData.year, monthData.month - 1).toLocaleString('default', { month: 'long' });
        processMonthData(monthData, monthData.year, monthData.month, monthName);
      }
    }
  } catch (err) {
    logToConsole("WARN", "GET_NOTES_NEW_FAILED", { error: err.message });
  }

  // 2. Get from OLD client.documents
  const client = await Client.findOne({ clientId }).lean();
  if (client && client.documents) {
    const documents = client.documents;
    let years = [];
    if (documents instanceof Map) {
      years = Array.from(documents.keys());
    } else {
      years = Object.keys(documents).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
    }

    for (const year of years) {
      let yearData;
      if (documents instanceof Map) {
        yearData = documents.get(year);
      } else {
        yearData = documents[year];
      }
      if (!yearData || typeof yearData !== 'object') continue;

      let months = [];
      if (yearData instanceof Map) {
        months = Array.from(yearData.keys());
      } else {
        months = Object.keys(yearData).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
      }

      for (const month of months) {
        let monthData;
        if (yearData instanceof Map) {
          monthData = yearData.get(month);
        } else {
          monthData = yearData[month];
        }
        if (monthData && typeof monthData === 'object') {
          const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
          processMonthData(monthData, parseInt(year), parseInt(month), monthName);
        }
      }
    }
  }

  allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  const unviewedCount = allNotes.filter(note => note.isUnviewedByClient).length;
  const totalNotes = allNotes.length;
  const previewNotes = allNotes.slice(0, limit);

  return {
    notes: allNotes,
    preview: previewNotes,
    unviewedCount,
    totalNotes,
    hasUnviewedNotes: unviewedCount > 0
  };
};

/* ===============================
   1. GET UNVIEWED NOTES COUNT (FOR ALERT CARD) - UPDATED
================================ */
router.get("/notes/unviewed-count", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    logToConsole("INFO", "UNVIEWED_NOTES_COUNT_REQUEST", { clientId });

    const unviewedCount = await countUnviewedNotesInClient(clientId);

    logToConsole("SUCCESS", "UNVIEWED_NOTES_COUNT_FETCHED", { clientId, unviewedCount });

    res.json({
      success: true,
      clientId,
      unviewedCount,
      hasUnviewedNotes: unviewedCount > 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logToConsole("ERROR", "UNVIEWED_NOTES_COUNT_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching unviewed notes count" });
  }
});

/* ===============================
   2. MARK ALL NOTES AS VIEWED - UPDATED
================================ */
router.post("/notes/mark-all-viewed", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    logToConsole("INFO", "MARK_ALL_NOTES_VIEWED_REQUEST", { clientId, timestamp: new Date().toISOString() });

    const result = await markAllNotesAsViewedForClient(clientId);

    if (!result.success) {
      return res.status(500).json({ success: false, message: "Failed to mark notes as viewed", error: result.error });
    }

    await ActivityLog.create({
      userName: req.user.name || "Client",
      role: "CLIENT",
      clientId: clientId,
      action: "NOTES_VIEWED",
      details: `Client marked all notes as viewed (${result.notesMarked} notes marked)`,
      metadata: { clientId, notesMarked: result.notesMarked, timestamp: new Date().toISOString() }
    });

    logToConsole("SUCCESS", "ALL_NOTES_MARKED_AS_VIEWED", { clientId, notesMarked: result.notesMarked });

    res.json({
      success: true,
      clientId,
      notesMarked: result.notesMarked,
      message: result.notesMarked > 0 ? `Marked ${result.notesMarked} notes as viewed` : "All notes were already viewed",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logToConsole("ERROR", "MARK_ALL_NOTES_VIEWED_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error marking notes as viewed" });
  }
});

/* ===============================
   3. GET ALL NOTES FOR ALERT CARD - UPDATED
================================ */
router.get("/notes/alert-preview", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const limit = parseInt(req.query.limit) || 5;

    logToConsole("INFO", "NOTES_ALERT_PREVIEW_REQUEST", { clientId, limit });

    const result = await getAllNotesForAlert(clientId, limit);

    logToConsole("SUCCESS", "NOTES_ALERT_PREVIEW_FETCHED", { clientId, totalNotes: result.totalNotes, unviewedCount: result.unviewedCount });

    res.json({
      success: true,
      clientId,
      summary: {
        totalNotes: result.totalNotes,
        unviewedNotes: result.unviewedCount,
        viewedNotes: result.totalNotes - result.unviewedCount
      },
      preview: result.preview.map(note => ({
        id: `${note.location}_${note.year}_${note.month}_${Date.now()}_${Math.random()}`,
        note: note.note.length > 100 ? note.note.substring(0, 100) + '...' : note.note,
        fullNote: note.note,
        addedBy: note.addedBy,
        addedAt: note.addedAt,
        category: note.category,
        type: note.type,
        source: note.source,
        fileName: note.fileName,
        month: `${note.monthName} ${note.year}`,
        isUnviewed: note.isUnviewedByClient,
        isNew: note.isUnviewedByClient
      })),
      hasUnviewedNotes: result.hasUnviewedNotes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logToConsole("ERROR", "NOTES_ALERT_PREVIEW_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching notes preview" });
  }
});

/* ===============================
   4. GET CLIENT DASHBOARD OVERVIEW - UPDATED
================================ */
router.get("/dashboard/overview", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { timeFilter = 'this_month', customStart, customEnd } = req.query;

    logToConsole("INFO", "CLIENT_DASHBOARD_REQUEST", { clientId, timeFilter });

    const client = await Client.findOne({ clientId }, {
      clientId: 1, name: 1, email: 1, phone: 1, address: 1, firstName: 1, lastName: 1,
      visaType: 1, businessAddress: 1, businessName: 1, vatPeriod: 1, businessNature: 1,
      planSelected: 1, enrollmentDate: 1, createdAt: 1, employeeAssignments: 1
    }).lean();

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const unviewedNotesCount = await countUnviewedNotesInClient(clientId);
    const notesPreview = await getAllNotesForAlert(clientId, 3);
    const months = getMonthRange(timeFilter, customStart, customEnd);

    const monthData = [];
    const allTasksSummary = { totalAssigned: 0, totalCompleted: 0, totalTasks: 0 };
    const allNotesSummary = { totalNotes: 0, clientNotes: 0, employeeNotes: 0, unviewedNotes: unviewedNotesCount };

    for (const month of months) {
      const monthResult = await getMonthDataFromBoth(clientId, month.year, month.month);
      const monthDocuments = monthResult ? monthResult.data : null;

      const requiredCategories = ['sales', 'purchase', 'bank'];
      const categoryStatus = requiredCategories.map(cat => getCategoryDocumentStatus(monthDocuments?.[cat], cat));
      const otherCategories = getOtherCategoriesStatus(monthDocuments?.other);

      const totalRequiredFiles = categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0);
      const totalRequiredCategories = categoryStatus.filter(cat => cat.uploadedFiles > 0).length;

      const taskStatus = await getTaskStatusForMonth(client.employeeAssignments || [], month.year, month.month);
      const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
      const completedTasks = taskStatus.filter(task => task.accountingDone === true);
      const notes = getNotesForMonth(monthDocuments, clientId);
      const clientNotes = notes.notes.filter(note => note.source === 'client');
      const employeeNotes = notes.notes.filter(note => note.source === 'employee');
      const unviewedNotes = notes.notes.filter(note => note.isUnviewedByClient);

      allTasksSummary.totalAssigned += assignedTasks.length;
      allTasksSummary.totalCompleted += completedTasks.length;
      allTasksSummary.totalTasks += taskStatus.length;
      allNotesSummary.totalNotes += notes.total;
      allNotesSummary.clientNotes += clientNotes.length;
      allNotesSummary.employeeNotes += employeeNotes.length;

      monthData.push({
        year: month.year,
        month: month.month,
        monthName: new Date(month.year, month.month - 1).toLocaleString('default', { month: 'long' }),
        documents: {
          requiredCategories: categoryStatus,
          otherCategories: otherCategories,
          summary: {
            totalUploadedFiles: totalRequiredFiles,
            uploadedCategories: totalRequiredCategories,
            totalRequiredCategories: requiredCategories.length,
            status: totalRequiredCategories === requiredCategories.length ? 'complete' : totalRequiredCategories > 0 ? 'partial' : 'none'
          }
        },
        tasks: {
          list: taskStatus,
          summary: {
            totalTasks: taskStatus.length,
            assignedTasks: assignedTasks.length,
            completedTasks: completedTasks.length,
            completionRate: taskStatus.length > 0 ? Math.round((completedTasks.length / taskStatus.length) * 100) : 0
          }
        },
        notes: {
          list: notes.notes.slice(0, 5),
          summary: {
            totalNotes: notes.total,
            clientNotes: clientNotes.length,
            employeeNotes: employeeNotes.length,
            unviewedNotes: unviewedNotes.length,
            unviewedPercentage: notes.total > 0 ? Math.round((unviewedNotes.length / notes.total) * 100) : 0
          }
        },
        monthStatus: {
          isLocked: monthDocuments?.isLocked || false,
          accountingDone: monthDocuments?.accountingDone || false,
          accountingDoneAt: monthDocuments?.accountingDoneAt,
          accountingDoneBy: monthDocuments?.accountingDoneBy
        }
      });
    }

    const clientInfo = {
      clientId: client.clientId,
      name: client.name,
      firstName: client.firstName || "",
      lastName: client.lastName || "",
      email: client.email,
      phone: client.phone,
      address: client.address,
      businessName: client.businessName || "Not specified",
      businessNature: client.businessNature || "Not specified",
      vatPeriod: client.vatPeriod || "Monthly",
      visaType: client.visaType || "Not specified",
      businessAddress: client.businessAddress || "Not specified",
      planSelected: client.planSelected || "Basic Accounting Services",
      activeSince: client.enrollmentDate ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date(client.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      enrollmentDate: client.enrollmentDate ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : "Not available"
    };

    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "DASHBOARD_VIEWED",
      details: `Client viewed dashboard overview with filter: ${timeFilter}`,
      metadata: { timeFilter, clientName: client.name, unviewedNotesCount }
    });

    res.json({
      success: true,
      client: clientInfo,
      timeFilter,
      months: months.map(m => ({ year: m.year, month: m.month, display: `${new Date(m.year, m.month - 1).toLocaleString('default', { month: 'long' })} ${m.year}` })),
      data: monthData,
      summaries: { tasks: allTasksSummary, notes: allNotesSummary },
      alertInfo: { hasUnviewedNotes: unviewedNotesCount > 0, unviewedNotesCount, totalNotes: notesPreview.totalNotes, previewNotes: notesPreview.preview, lastChecked: new Date().toISOString() }
    });
  } catch (error) {
    logToConsole("ERROR", "CLIENT_DASHBOARD_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching client dashboard data" });
  }
});

/* ===============================
   5. GET SPECIFIC MONTH DETAILS - UPDATED
================================ */
router.get("/dashboard/month-details", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ success: false, message: "Year and month are required" });
    }

    logToConsole("INFO", "CLIENT_MONTH_DETAILS_REQUEST", { clientId, year, month });

    const client = await Client.findOne({ clientId }, {
      clientId: 1, name: 1, email: 1, employeeAssignments: 1
    }).lean();

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const monthResult = await getMonthDataFromBoth(clientId, parseInt(year), parseInt(month));
    const monthData = monthResult ? monthResult.data : null;

    const requiredCategories = ['sales', 'purchase', 'bank'];
    const categoryStatus = requiredCategories.map(cat => getCategoryDocumentStatus(monthData?.[cat], cat));
    const otherCategories = getOtherCategoriesStatus(monthData?.other);
    const taskStatus = await getTaskStatusForMonth(client.employeeAssignments || [], parseInt(year), parseInt(month));
    const notes = getNotesForMonth(monthData, clientId);

    const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
    const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];
    let employees = [];
    if (employeeIds.length > 0) {
      employees = await Employee.find({ employeeId: { $in: employeeIds } }, { employeeId: 1, name: 1, email: 1, phone: 1 }).lean();
    }

    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "MONTH_DETAILS_VIEWED",
      details: `Client viewed details for ${year}-${month}`,
      metadata: { year, month, clientName: client.name }
    });

    res.json({
      success: true,
      client: { clientId: client.clientId, name: client.name, email: client.email },
      month: { year: parseInt(year), month: parseInt(month), monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' }) },
      documents: {
        requiredCategories,
        status: categoryStatus,
        otherCategories,
        summary: {
          totalRequiredCategories: requiredCategories.length,
          uploadedCategories: categoryStatus.filter(cat => cat.uploadedFiles > 0).length,
          totalFiles: categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0),
          status: categoryStatus.every(cat => cat.uploadedFiles > 0) ? 'complete' : categoryStatus.some(cat => cat.uploadedFiles > 0) ? 'partial' : 'none'
        }
      },
      tasks: {
        list: taskStatus,
        assignedEmployees: employees.map(emp => ({
          employeeId: emp.employeeId,
          name: emp.name,
          email: emp.email,
          phone: emp.phone,
          assignedTasks: assignedTasks.filter(task => task.employeeId === emp.employeeId).map(task => task.taskName)
        })),
        summary: {
          totalTasks: taskStatus.length,
          assignedTasks: assignedTasks.length,
          completedTasks: taskStatus.filter(task => task.accountingDone).length,
          notAssignedTasks: taskStatus.filter(task => task.status === 'not_assigned').length
        }
      },
      notes: {
        total: notes.total,
        list: notes.notes,
        unviewedCount: notes.unviewedCount,
        summary: {
          clientNotes: notes.notes.filter(n => n.source === 'client').length,
          employeeNotes: notes.notes.filter(n => n.source === 'employee').length,
          unviewedClientNotes: notes.notes.filter(n => n.source === 'client' && n.isUnviewedByClient).length,
          unviewedEmployeeNotes: notes.notes.filter(n => n.source === 'employee' && n.isUnviewedByClient).length
        }
      },
      monthStatus: {
        isLocked: monthData?.isLocked || false,
        wasLockedOnce: monthData?.wasLockedOnce || false,
        lockedAt: monthData?.lockedAt,
        lockedBy: monthData?.lockedBy,
        accountingDone: monthData?.accountingDone || false,
        accountingDoneAt: monthData?.accountingDoneAt,
        accountingDoneBy: monthData?.accountingDoneBy,
        autoLockDate: monthData?.autoLockDate
      }
    });
  } catch (error) {
    logToConsole("ERROR", "MONTH_DETAILS_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching month details" });
  }
});

/* ===============================
   6. GET EMPLOYEE CONTACT FOR SPECIFIC TASK (NO CHANGE)
================================ */
router.get("/dashboard/employee-contact", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { employeeId } = req.query;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }

    const client = await Client.findOne({ clientId }).lean();
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const employee = await Employee.findOne({ employeeId }, { employeeId: 1, name: 1, email: 1, phone: 1, isActive: 1 }).lean();

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      employeeId: employee.employeeId,
      employeeName: employee.name,
      action: "EMPLOYEE_CONTACT_VIEWED",
      details: `Client viewed contact details for employee: ${employee.name}`,
      metadata: { employeeId, employeeName: employee.name, clientName: client.name }
    });

    res.json({
      success: true,
      employee: {
        employeeId: employee.employeeId,
        name: employee.name,
        email: employee.email,
        phone: employee.phone || "Not provided",
        isActive: employee.isActive
      }
    });
  } catch (error) {
    logToConsole("ERROR", "EMPLOYEE_CONTACT_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching employee contact" });
  }
});

/* ===============================
   7. GET DOCUMENT UPLOAD HISTORY - UPDATED
================================ */
router.get("/dashboard/upload-history", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { limit = 10 } = req.query;

    logToConsole("INFO", "UPLOAD_HISTORY_REQUEST", { clientId, limit });

    const client = await Client.findOne({ clientId }, { name: 1, clientId: 1 }).lean();
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const uploadHistory = [];

    const addUploadsFromMonthData = (monthData, year, month, monthName, source) => {
      if (!monthData) return;

      ['sales', 'purchase', 'bank'].forEach(category => {
        const categoryData = monthData[category];
        if (categoryData && categoryData.files) {
          categoryData.files.forEach(file => {
            if (file.uploadedAt && file.fileName) {
              uploadHistory.push({
                year, month, monthName, source,
                category: category.charAt(0).toUpperCase() + category.slice(1),
                fileName: file.fileName,
                uploadedAt: file.uploadedAt,
                uploadedBy: file.uploadedBy || "System",
                fileType: file.fileType,
                fileSize: file.fileSize
              });
            }
          });
        }
      });

      if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCat => {
          if (otherCat.document && otherCat.document.files) {
            otherCat.document.files.forEach(file => {
              if (file.uploadedAt && file.fileName) {
                uploadHistory.push({
                  year, month, monthName, source,
                  category: otherCat.categoryName,
                  fileName: file.fileName,
                  uploadedAt: file.uploadedAt,
                  uploadedBy: file.uploadedBy || "System",
                  fileType: file.fileType,
                  fileSize: file.fileSize
                });
              }
            });
          }
        });
      }
    };

    // 1. Get from NEW collection
    try {
      const newDoc = await ClientMonthlyData.findOne({ clientId });
      if (newDoc && newDoc.months) {
        for (const monthData of newDoc.months) {
          const monthName = new Date(monthData.year, monthData.month - 1).toLocaleString('default', { month: 'short' });
          addUploadsFromMonthData(monthData, monthData.year, monthData.month, monthName, 'new');
        }
      }
    } catch (err) {
      logToConsole("WARN", "UPLOAD_HISTORY_NEW_FAILED", { error: err.message });
    }

    // 2. Get from OLD client.documents
    const oldClient = await Client.findOne({ clientId }).lean();
    if (oldClient && oldClient.documents) {
      const documents = oldClient.documents;
      let years = [];
      if (documents instanceof Map) {
        years = Array.from(documents.keys());
      } else {
        years = Object.keys(documents).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
      }

      for (const year of years) {
        let yearData;
        if (documents instanceof Map) {
          yearData = documents.get(year);
        } else {
          yearData = documents[year];
        }
        if (!yearData || typeof yearData !== 'object') continue;

        let months = [];
        if (yearData instanceof Map) {
          months = Array.from(yearData.keys());
        } else {
          months = Object.keys(yearData).filter(key => !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key)));
        }

        for (const month of months) {
          let monthData;
          if (yearData instanceof Map) {
            monthData = yearData.get(month);
          } else {
            monthData = yearData[month];
          }
          if (monthData && typeof monthData === 'object') {
            const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'short' });
            addUploadsFromMonthData(monthData, parseInt(year), parseInt(month), monthName, 'old');
          }
        }
      }
    }

    uploadHistory.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const limitedHistory = uploadHistory.slice(0, parseInt(limit));

    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "UPLOAD_HISTORY_VIEWED",
      details: `Client viewed document upload history (limit: ${limit})`,
      metadata: { limit, clientName: client.name }
    });

    res.json({
      success: true,
      totalUploads: uploadHistory.length,
      uploads: limitedHistory,
      summary: {
        byCategory: uploadHistory.reduce((acc, upload) => { acc[upload.category] = (acc[upload.category] || 0) + 1; return acc; }, {}),
        byMonth: uploadHistory.reduce((acc, upload) => { const key = `${upload.year}-${upload.month}`; acc[key] = (acc[key] || 0) + 1; return acc; }, {})
      }
    });
  } catch (error) {
    logToConsole("ERROR", "UPLOAD_HISTORY_FAILED", { error: error.message, clientId: req.user?.clientId });
    res.status(500).json({ success: false, message: "Error fetching upload history" });
  }
});

module.exports = router;