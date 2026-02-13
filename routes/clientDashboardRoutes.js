// routes/clientDashboard.js
const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");

const Client = require("../models/Client");
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

        // Generate all months between start and end
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
        // Default to this month
        months = [{ year: currentYear, month: currentMonth }];
      }
      break;

    default:
      months = [{ year: currentYear, month: currentMonth }];
  }

  // Sort months: newest first
  months.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return months;
};

/* ===============================
   HELPER: GET DOCUMENT STATUS FOR CATEGORY
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
   HELPER: GET OTHER CATEGORIES STATUS
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

  // Get assignments for this month (not removed)
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

  // Get employee details for assigned tasks
  const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
  const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];

  let employees = [];
  if (employeeIds.length > 0) {
    employees = await Employee.find(
      { employeeId: { $in: employeeIds } },
      { employeeId: 1, name: 1, email: 1, phone: 1 }
    ).lean();
  }

  // Add employee contact info to tasks
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
   HELPER: GET NOTES FOR MONTH WITH VIEW STATUS
================================ */
const getNotesForMonth = (monthData, clientId = null) => {
  const allNotes = [];

  if (!monthData) {
    return { total: 0, notes: [] };
  }

  // 1. Month-level notes → ALWAYS CLIENT
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

  // 2. Category notes for required categories → ALWAYS CLIENT (delete reasons)
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

  // 3. File notes (inside files array) → ALWAYS EMPLOYEE
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

  // 4. Other categories → Same pattern
  if (monthData.other && Array.isArray(monthData.other)) {
    monthData.other.forEach(otherCat => {
      if (otherCat.document) {
        // Category notes for other categories → CLIENT (delete reasons)
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

        // File notes for other categories → EMPLOYEE
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

  // Sort by date (newest first)
  allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  return {
    total: allNotes.length,
    notes: allNotes,
    unviewedCount: clientId ? allNotes.filter(note => note.isUnviewedByClient).length : 0
  };
};

/* ===============================
   HELPER: COUNT ALL NOTES IN CLIENT DOCUMENTS (FIXED)
================================ */
const countAllNotesInClient = (client) => {
  // Convert to plain object
  const clientObj = client.toObject ? client.toObject() : client;
  let totalCount = 0;
  const documents = clientObj.documents || {};

  if (!documents || typeof documents !== 'object') {
    return 0;
  }

  // Helper function to count notes in an array
  const countNotesInArray = (notesArray) => {
    if (!notesArray || !Array.isArray(notesArray)) return 0;
    return notesArray.filter(note =>
      note &&
      typeof note === 'object' &&
      (note.note || note.noteText)
    ).length;
  };

  // Get years properly
  let years = [];
  if (documents instanceof Map) {
    years = Array.from(documents.keys());
  } else {
    years = Object.keys(documents).filter(key =>
      !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
    );
  }

  // Iterate through all years and months
  years.forEach(year => {
    let yearData;
    if (documents instanceof Map) {
      yearData = documents.get(year);
    } else {
      yearData = documents[year];
    }

    if (!yearData || typeof yearData !== 'object') return;

    // Get months for this year
    let months = [];
    if (yearData instanceof Map) {
      months = Array.from(yearData.keys());
    } else {
      months = Object.keys(yearData).filter(key =>
        !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
      );
    }

    months.forEach(month => {
      let monthData;
      if (yearData instanceof Map) {
        monthData = yearData.get(month);
      } else {
        monthData = yearData[month];
      }

      if (!monthData || typeof monthData !== 'object') return;

      // Month-level notes
      if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
        totalCount += countNotesInArray(monthData.monthNotes);
      }

      // Required categories
      ['sales', 'purchase', 'bank'].forEach(category => {
        const categoryData = monthData[category];
        if (categoryData && typeof categoryData === 'object') {
          // Category notes
          if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
            totalCount += countNotesInArray(categoryData.categoryNotes);
          }

          // File notes
          if (categoryData.files && Array.isArray(categoryData.files)) {
            categoryData.files.forEach(file => {
              if (file && typeof file === 'object') {
                totalCount += countNotesInArray(file.notes);
              }
            });
          }
        }
      });

      // Other categories
      if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCat => {
          if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
            if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
              totalCount += countNotesInArray(otherCat.document.categoryNotes);
            }

            if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
              otherCat.document.files.forEach(file => {
                if (file && typeof file === 'object') {
                  totalCount += countNotesInArray(file.notes);
                }
              });
            }
          }
        });
      }
    });
  });

  return totalCount;
};

/* ===============================
   HELPER: COUNT UNVIEWED NOTES FOR CLIENT (FIXED)
================================ */
const countUnviewedNotesInClient = (client, clientId) => {
  // Convert to plain object
  const clientObj = client.toObject ? client.toObject() : client;
  let unviewedCount = 0;
  const documents = clientObj.documents || {};

  if (!documents || typeof documents !== 'object') {
    return 0;
  }

  // Helper function to count unviewed notes in an array
  const countUnviewedNotesInArray = (notesArray) => {
    if (!notesArray || !Array.isArray(notesArray)) return 0;
    return notesArray.filter(note =>
      note &&
      typeof note === 'object' &&
      (note.note || note.noteText) &&
      !note.isViewedByClient
    ).length;
  };

  // Get years properly
  let years = [];
  if (documents instanceof Map) {
    years = Array.from(documents.keys());
  } else {
    years = Object.keys(documents).filter(key =>
      !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
    );
  }

  // Iterate through all years and months
  years.forEach(year => {
    let yearData;
    if (documents instanceof Map) {
      yearData = documents.get(year);
    } else {
      yearData = documents[year];
    }

    if (!yearData || typeof yearData !== 'object') return;

    // Get months for this year
    let months = [];
    if (yearData instanceof Map) {
      months = Array.from(yearData.keys());
    } else {
      months = Object.keys(yearData).filter(key =>
        !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
      );
    }

    months.forEach(month => {
      let monthData;
      if (yearData instanceof Map) {
        monthData = yearData.get(month);
      } else {
        monthData = yearData[month];
      }

      if (!monthData || typeof monthData !== 'object') return;

      // Month-level notes
      if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
        unviewedCount += countUnviewedNotesInArray(monthData.monthNotes);
      }

      // Required categories
      ['sales', 'purchase', 'bank'].forEach(category => {
        const categoryData = monthData[category];
        if (categoryData && typeof categoryData === 'object') {
          // Category notes
          if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
            unviewedCount += countUnviewedNotesInArray(categoryData.categoryNotes);
          }

          // File notes
          if (categoryData.files && Array.isArray(categoryData.files)) {
            categoryData.files.forEach(file => {
              if (file && typeof file === 'object') {
                unviewedCount += countUnviewedNotesInArray(file.notes);
              }
            });
          }
        }
      });

      // Other categories
      if (monthData.other && Array.isArray(monthData.other)) {
        monthData.other.forEach(otherCat => {
          if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
            if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
              unviewedCount += countUnviewedNotesInArray(otherCat.document.categoryNotes);
            }

            if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
              otherCat.document.files.forEach(file => {
                if (file && typeof file === 'object') {
                  unviewedCount += countUnviewedNotesInArray(file.notes);
                }
              });
            }
          }
        });
      }
    });
  });

  return unviewedCount;
};

/* ===============================
   HELPER: MARK ALL NOTES AS VIEWED FOR CLIENT (COMPLETELY FIXED)
================================ */
const markAllNotesAsViewedForClient = async (clientId) => {
  try {
    logToConsole("DEBUG", "MARK_ALL_NOTES_VIEWED_START", {
      clientId,
      timestamp: new Date().toISOString()
    });

    // Use lean() to get plain JavaScript object
    let client = await Client.findOne({ clientId });
    if (!client) {
      logToConsole("ERROR", "CLIENT_NOT_FOUND", { clientId });
      return { success: false, notesMarked: 0 };
    }

    // Convert to plain object to avoid Mongoose issues
    const clientObj = client.toObject ? client.toObject() : client;

    let updateCount = 0;
    const now = new Date();
    const viewEntry = {
      userId: clientId,
      userType: 'client',
      viewedAt: now
    };

    // Helper function to update a single note
    const updateNote = (note) => {
      if (!note || typeof note !== 'object' || note === null) return false;

      // Check if it's a valid note object (must have note text)
      if (!note.note && !note.noteText) return false;

      // Check if already viewed by this client
      const alreadyViewed = note.viewedBy?.some(
        view => view && view.userId === clientId && view.userType === 'client'
      );

      if (!alreadyViewed) {
        // Initialize viewedBy array if not exists
        note.viewedBy = note.viewedBy || [];
        note.viewedBy.push(viewEntry);
        note.isViewedByClient = true;
        return true;
      } else if (alreadyViewed && note.isViewedByClient !== true) {
        // Ensure consistency - if in viewedBy but flag is false
        note.isViewedByClient = true;
        return true;
      }
      return false;
    };

    // Helper function to update notes array
    const updateNotesArray = (notesArray) => {
      if (!notesArray || !Array.isArray(notesArray)) return 0;

      let count = 0;
      notesArray.forEach(note => {
        if (updateNote(note)) {
          count++;
        }
      });
      return count;
    };

    // Debug: Check initial state
    logToConsole("DEBUG", "CLIENT_DOCUMENTS_STRUCTURE", {
      clientId,
      hasDocuments: !!clientObj.documents,
      documentsType: typeof clientObj.documents,
      isMap: clientObj.documents instanceof Map,
      keys: clientObj.documents ? Object.keys(clientObj.documents) : []
    });

    // 1. Update notes in all document locations
    const documents = clientObj.documents || {};

    if (!documents || typeof documents !== 'object') {
      logToConsole("WARN", "NO_DOCUMENTS_FOUND", { clientId });
      return {
        success: true,
        notesMarked: 0,
        totalNotes: 0,
        unviewedNotes: 0
      };
    }

    // FIXED: Properly iterate through documents - handle Map or Object
    let years = [];
    if (documents instanceof Map) {
      years = Array.from(documents.keys());
    } else {
      years = Object.keys(documents).filter(key =>
        !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
      );
    }

    logToConsole("DEBUG", "FOUND_YEARS", {
      clientId,
      years,
      yearsCount: years.length
    });

    for (const year of years) {
      let yearData;
      if (documents instanceof Map) {
        yearData = documents.get(year);
      } else {
        yearData = documents[year];
      }

      if (!yearData || typeof yearData !== 'object') continue;

      // Get months for this year
      let months = [];
      if (yearData instanceof Map) {
        months = Array.from(yearData.keys());
      } else {
        months = Object.keys(yearData).filter(key =>
          !key.startsWith('$') && !key.startsWith('_') && !isNaN(Number(key))
        );
      }

      logToConsole("DEBUG", "PROCESSING_YEAR", {
        year,
        monthsCount: months.length,
        months: months
      });

      for (const month of months) {
        let monthData;
        if (yearData instanceof Map) {
          monthData = yearData.get(month);
        } else {
          monthData = yearData[month];
        }

        if (!monthData || typeof monthData !== 'object') continue;

        logToConsole("DEBUG", "PROCESSING_MONTH", {
          year,
          month,
          hasMonthNotes: !!(monthData.monthNotes && monthData.monthNotes.length > 0)
        });

        // Month-level notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
          const monthNotesCount = updateNotesArray(monthData.monthNotes);
          updateCount += monthNotesCount;

          if (monthNotesCount > 0) {
            logToConsole("DEBUG", "UPDATED_MONTH_NOTES", {
              year,
              month,
              count: monthNotesCount
            });
          }
        }

        // Required categories (sales, purchase, bank)
        ['sales', 'purchase', 'bank'].forEach(category => {
          const categoryData = monthData[category];
          if (categoryData && typeof categoryData === 'object') {
            // Category notes
            if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
              const catNotesCount = updateNotesArray(categoryData.categoryNotes);
              updateCount += catNotesCount;

              if (catNotesCount > 0) {
                logToConsole("DEBUG", "UPDATED_CATEGORY_NOTES", {
                  year,
                  month,
                  category,
                  count: catNotesCount
                });
              }
            }

            // File notes
            if (categoryData.files && Array.isArray(categoryData.files)) {
              categoryData.files.forEach((file, fileIndex) => {
                if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
                  const fileNotesCount = updateNotesArray(file.notes);
                  updateCount += fileNotesCount;

                  if (fileNotesCount > 0) {
                    logToConsole("DEBUG", "UPDATED_FILE_NOTES", {
                      year,
                      month,
                      category,
                      fileIndex,
                      fileName: file.fileName,
                      count: fileNotesCount
                    });
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
              // Category notes
              if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
                const otherCatNotesCount = updateNotesArray(otherCat.document.categoryNotes);
                updateCount += otherCatNotesCount;

                if (otherCatNotesCount > 0) {
                  logToConsole("DEBUG", "UPDATED_OTHER_CATEGORY_NOTES", {
                    year,
                    month,
                    categoryName: otherCat.categoryName,
                    count: otherCatNotesCount
                  });
                }
              }

              // File notes
              if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
                otherCat.document.files.forEach((file, fileIndex) => {
                  if (file && typeof file === 'object' && file.notes && Array.isArray(file.notes)) {
                    const otherFileNotesCount = updateNotesArray(file.notes);
                    updateCount += otherFileNotesCount;

                    if (otherFileNotesCount > 0) {
                      logToConsole("DEBUG", "UPDATED_OTHER_FILE_NOTES", {
                        year,
                        month,
                        categoryName: otherCat.categoryName,
                        fileIndex,
                        fileName: file.fileName,
                        count: otherFileNotesCount
                      });
                    }
                  }
                });
              }
            }
          });
        }
      }
    }

    // Save the updated client document
    if (updateCount > 0) {
      try {
        // Update the actual Mongoose document
        // We need to manually update the document structure
        client = await Client.findOne({ clientId });

        // Apply all the updates we made to clientObj back to the Mongoose document
        // This is a simplified approach - in reality, you'd need to update each field

        // Mark as modified to ensure save
        client.markModified('documents');

        // Save with the updated documents
        client.documents = clientObj.documents;

        await client.save();
        logToConsole("SUCCESS", "CLIENT_SAVED_SUCCESSFULLY", {
          clientId,
          notesMarked: updateCount
        });

      } catch (saveError) {
        logToConsole("ERROR", "SAVE_FAILED", {
          error: saveError.message,
          stack: saveError.stack
        });
        return {
          success: false,
          error: saveError.message,
          notesMarked: 0
        };
      }
    } else {
      logToConsole("WARN", "NO_NOTES_TO_MARK", {
        clientId,
        updateCount,
        yearsFound: years.length,
        possibleReasons: [
          "No notes found in the documents",
          "All notes already viewed",
          "Documents structure might be empty"
        ]
      });
    }

    return {
      success: true,
      notesMarked: updateCount,
      yearsProcessed: years.length
    };

  } catch (error) {
    logToConsole("ERROR", "MARK_NOTES_AS_VIEWED_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId
    });
    return {
      success: false,
      error: error.message,
      notesMarked: 0
    };
  }
};

/* ===============================
   HELPER: GET UNVIEWED NOTES COUNT FOR CLIENT
================================ */
const getUnviewedNotesCountForClient = async (clientId) => {
  try {
    const client = await Client.findOne({ clientId });
    if (!client) return 0;

    return countUnviewedNotesInClient(client, clientId);

  } catch (error) {
    logToConsole("ERROR", "COUNT_UNVIEWED_NOTES_FAILED", {
      error: error.message,
      clientId
    });
    return 0;
  }
};

/* ===============================
   HELPER: GET ALL NOTES WITH VIEW STATUS FOR ALERT
================================ */
const getAllNotesForAlert = async (clientId, limit = 5) => {
  try {
    const client = await Client.findOne({ clientId });
    if (!client) return { notes: [], unviewedCount: 0, totalNotes: 0 };

    const allNotes = [];
    const documents = client.documents || {};

    // Check if documents is valid
    if (!documents || typeof documents !== 'object') {
      return { notes: [], preview: [], unviewedCount: 0, totalNotes: 0, hasUnviewedNotes: false };
    }

    // Helper to add note with metadata
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

    // Collect all notes with metadata
    Object.keys(documents).forEach(year => {
      const yearData = documents[year];
      if (!yearData || typeof yearData !== 'object') return;

      Object.keys(yearData).forEach(month => {
        const monthData = yearData[month];
        if (!monthData || typeof monthData !== 'object') return;

        const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

        // Month-level notes
        if (monthData.monthNotes && Array.isArray(monthData.monthNotes)) {
          monthData.monthNotes.forEach(note => {
            addNoteWithMetadata(note, {
              location: 'month',
              year: parseInt(year),
              month: parseInt(month),
              monthName: monthName,
              category: 'General',
              type: 'month_note',
              source: 'client'
            });
          });
        }

        // Required categories
        ['sales', 'purchase', 'bank'].forEach(category => {
          const categoryData = monthData[category];
          if (!categoryData || typeof categoryData !== 'object') return;

          // Category notes
          if (categoryData.categoryNotes && Array.isArray(categoryData.categoryNotes)) {
            categoryData.categoryNotes.forEach(note => {
              addNoteWithMetadata(note, {
                location: 'category',
                year: parseInt(year),
                month: parseInt(month),
                monthName: monthName,
                category: category.charAt(0).toUpperCase() + category.slice(1),
                type: 'delete_reason',
                source: 'client'
              });
            });
          }

          // File notes
          if (categoryData.files && Array.isArray(categoryData.files)) {
            categoryData.files.forEach(file => {
              if (file && file.notes && Array.isArray(file.notes)) {
                file.notes.forEach(note => {
                  addNoteWithMetadata(note, {
                    location: 'file',
                    year: parseInt(year),
                    month: parseInt(month),
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

        // Other categories
        if (monthData.other && Array.isArray(monthData.other)) {
          monthData.other.forEach(otherCat => {
            if (otherCat && otherCat.document && typeof otherCat.document === 'object') {
              // Category notes
              if (otherCat.document.categoryNotes && Array.isArray(otherCat.document.categoryNotes)) {
                otherCat.document.categoryNotes.forEach(note => {
                  addNoteWithMetadata(note, {
                    location: 'category',
                    year: parseInt(year),
                    month: parseInt(month),
                    monthName: monthName,
                    category: otherCat.categoryName,
                    type: 'delete_reason',
                    source: 'client'
                  });
                });
              }

              // File notes
              if (otherCat.document.files && Array.isArray(otherCat.document.files)) {
                otherCat.document.files.forEach(file => {
                  if (file && file.notes && Array.isArray(file.notes)) {
                    file.notes.forEach(note => {
                      addNoteWithMetadata(note, {
                        location: 'file',
                        year: parseInt(year),
                        month: parseInt(month),
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
      });
    });

    // Sort by date (newest first)
    allNotes.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    const unviewedCount = allNotes.filter(note => note.isUnviewedByClient).length;
    const totalNotes = allNotes.length;

    // Get latest notes for preview
    const previewNotes = allNotes.slice(0, limit);

    return {
      notes: allNotes,
      preview: previewNotes,
      unviewedCount,
      totalNotes,
      hasUnviewedNotes: unviewedCount > 0
    };

  } catch (error) {
    logToConsole("ERROR", "GET_ALL_NOTES_FOR_ALERT_FAILED", {
      error: error.message,
      clientId
    });
    return { notes: [], preview: [], unviewedCount: 0, totalNotes: 0, hasUnviewedNotes: false };
  }
};

/* ===============================
   1. GET UNVIEWED NOTES COUNT (FOR ALERT CARD)
================================ */
router.get("/notes/unviewed-count", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;

    logToConsole("INFO", "UNVIEWED_NOTES_COUNT_REQUEST", {
      clientId
    });

    const unviewedCount = await getUnviewedNotesCountForClient(clientId);

    logToConsole("SUCCESS", "UNVIEWED_NOTES_COUNT_FETCHED", {
      clientId,
      unviewedCount
    });

    res.json({
      success: true,
      clientId,
      unviewedCount,
      hasUnviewedNotes: unviewedCount > 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "UNVIEWED_NOTES_COUNT_FAILED", {
      error: error.message,
      clientId: req.user?.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching unviewed notes count"
    });
  }
});

/* ===============================
   2. MARK ALL NOTES AS VIEWED (WHEN MODAL OPENS) - UPDATED
================================ */
router.post("/notes/mark-all-viewed", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;

    logToConsole("INFO", "MARK_ALL_NOTES_VIEWED_REQUEST", {
      clientId,
      timestamp: new Date().toISOString(),
      user: req.user.name
    });

    const result = await markAllNotesAsViewedForClient(clientId);

    if (!result.success) {
      logToConsole("ERROR", "MARK_ALL_NOTES_FAILED", {
        clientId,
        error: result.error
      });

      return res.status(500).json({
        success: false,
        message: "Failed to mark notes as viewed",
        error: result.error
      });
    }

    // Create activity log
    await ActivityLog.create({
      userName: req.user.name || "Client",
      role: "CLIENT",
      clientId: clientId,
      action: "NOTES_VIEWED",
      details: `Client marked all notes as viewed (${result.notesMarked} notes marked, total: ${result.totalNotes})`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        clientId,
        notesMarked: result.notesMarked,
        totalNotes: result.totalNotes,
        unviewedNotes: result.unviewedNotes,
        initialUnviewedNotes: result.initialUnviewedNotes,
        actionType: "mark_all_viewed",
        timestamp: new Date().toISOString()
      }
    });

    logToConsole("SUCCESS", "ALL_NOTES_MARKED_AS_VIEWED", {
      clientId,
      notesMarked: result.notesMarked,
      totalNotes: result.totalNotes,
      unviewedNotes: result.unviewedNotes,
      initialUnviewedNotes: result.initialUnviewedNotes,
      percentage: result.totalNotes > 0 ? Math.round((result.notesMarked / result.totalNotes) * 100) : 0,
      reduction: result.initialUnviewedNotes - result.unviewedNotes
    });

    res.json({
      success: true,
      clientId,
      notesMarked: result.notesMarked,
      totalNotes: result.totalNotes,
      unviewedNotes: result.unviewedNotes,
      initialUnviewedNotes: result.initialUnviewedNotes,
      message: result.notesMarked > 0
        ? `Marked ${result.notesMarked} notes as viewed`
        : `All ${result.totalNotes} notes were already viewed`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "MARK_ALL_NOTES_VIEWED_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.user?.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error marking notes as viewed",
      error: error.message
    });
  }
});

/* ===============================
   3. GET ALL NOTES FOR ALERT CARD (WITH NEW BADGES)
================================ */
router.get("/notes/alert-preview", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const limit = parseInt(req.query.limit) || 5;

    logToConsole("INFO", "NOTES_ALERT_PREVIEW_REQUEST", {
      clientId,
      limit
    });

    const result = await getAllNotesForAlert(clientId, limit);

    logToConsole("SUCCESS", "NOTES_ALERT_PREVIEW_FETCHED", {
      clientId,
      totalNotes: result.totalNotes,
      unviewedCount: result.unviewedCount,
      previewCount: result.preview.length
    });

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
        isNew: note.isUnviewedByClient // For badge display
      })),
      hasUnviewedNotes: result.hasUnviewedNotes,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logToConsole("ERROR", "NOTES_ALERT_PREVIEW_FAILED", {
      error: error.message,
      clientId: req.user?.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching notes preview"
    });
  }
});

/* ===============================
   4. GET CLIENT DASHBOARD OVERVIEW (UPDATED)
================================ */
router.get("/dashboard/overview", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { timeFilter = 'this_month', customStart, customEnd } = req.query;

    logToConsole("INFO", "CLIENT_DASHBOARD_REQUEST", {
      clientId,
      timeFilter,
      customStart,
      customEnd
    });

    // Get client data with all fields
    const client = await Client.findOne(
      { clientId },
      {
        clientId: 1,
        name: 1,
        email: 1,
        phone: 1,
        address: 1,
        firstName: 1,
        lastName: 1,
        visaType: 1,
        businessAddress: 1,
        businessName: 1,
        vatPeriod: 1,
        businessNature: 1,
        planSelected: 1,
        enrollmentDate: 1,
        createdAt: 1,
        documents: 1,
        employeeAssignments: 1
      }
    ).lean();

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_DASHBOARD", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Get unviewed notes count for alert card
    const unviewedNotesCount = await getUnviewedNotesCountForClient(clientId);

    // Get notes preview for alert card
    const notesPreview = await getAllNotesForAlert(clientId, 3);

    // Create activity log for dashboard view
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "DASHBOARD_VIEWED",
      details: `Client viewed dashboard overview with filter: ${timeFilter}`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        timeFilter,
        customStart,
        customEnd,
        clientName: client.name,
        unviewedNotesCount
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "DASHBOARD_VIEWED",
      clientId: client.clientId,
      unviewedNotesCount
    });

    // Get month range based on filter
    const months = getMonthRange(timeFilter, customStart, customEnd);

    const monthData = [];
    const allTasksSummary = {
      totalAssigned: 0,
      totalCompleted: 0,
      totalTasks: 0
    };
    const allNotesSummary = {
      totalNotes: 0,
      clientNotes: 0,
      employeeNotes: 0,
      unviewedNotes: unviewedNotesCount
    };

    // Process each month
    for (const month of months) {
      const yearKey = String(month.year);
      const monthKey = String(month.month);
      const monthDocuments = client.documents?.[yearKey]?.[monthKey];

      // 1. Document Status
      const requiredCategories = ['sales', 'purchase', 'bank'];
      const categoryStatus = requiredCategories.map(cat =>
        getCategoryDocumentStatus(monthDocuments?.[cat], cat)
      );

      const otherCategories = getOtherCategoriesStatus(monthDocuments?.other);

      const totalRequiredFiles = categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0);
      const totalRequiredCategories = categoryStatus.filter(cat => cat.uploadedFiles > 0).length;

      // 2. Task Status
      const taskStatus = await getTaskStatusForMonth(
        client.employeeAssignments || [],
        month.year,
        month.month
      );

      const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
      const completedTasks = taskStatus.filter(task => task.accountingDone === true);

      // 3. Notes (with view status for this client)
      const notes = getNotesForMonth(monthDocuments, clientId);
      const clientNotes = notes.notes.filter(note => note.source === 'client');
      const employeeNotes = notes.notes.filter(note => note.source === 'employee');
      const unviewedNotes = notes.notes.filter(note => note.isUnviewedByClient);

      // Update summaries
      allTasksSummary.totalAssigned += assignedTasks.length;
      allTasksSummary.totalCompleted += completedTasks.length;
      allTasksSummary.totalTasks += taskStatus.length;

      allNotesSummary.totalNotes += notes.total;
      allNotesSummary.clientNotes += clientNotes.length;
      allNotesSummary.employeeNotes += employeeNotes.length;

      // Month summary
      monthData.push({
        year: month.year,
        month: month.month,
        monthName: new Date(month.year, month.month - 1).toLocaleString('default', { month: 'long' }),

        // Document Summary
        documents: {
          requiredCategories: categoryStatus,
          otherCategories: otherCategories,
          summary: {
            totalUploadedFiles: totalRequiredFiles,
            uploadedCategories: totalRequiredCategories,
            totalRequiredCategories: requiredCategories.length,
            status: totalRequiredCategories === requiredCategories.length ? 'complete' :
              totalRequiredCategories > 0 ? 'partial' : 'none'
          }
        },

        // Task Summary
        tasks: {
          list: taskStatus,
          summary: {
            totalTasks: taskStatus.length,
            assignedTasks: assignedTasks.length,
            completedTasks: completedTasks.length,
            completionRate: taskStatus.length > 0 ? Math.round((completedTasks.length / taskStatus.length) * 100) : 0
          }
        },

        // Notes Summary (with view status)
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

        // Month Status
        monthStatus: {
          isLocked: monthDocuments?.isLocked || false,
          accountingDone: monthDocuments?.accountingDone || false,
          accountingDoneAt: monthDocuments?.accountingDoneAt,
          accountingDoneBy: monthDocuments?.accountingDoneBy
        }
      });
    }

    // Enhanced client info with all fields
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
      activeSince: client.enrollmentDate
        ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
        : new Date(client.createdAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }),
      enrollmentDate: client.enrollmentDate
        ? new Date(client.enrollmentDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
        : "Not available"
    };

    logToConsole("SUCCESS", "CLIENT_DASHBOARD_FETCHED", {
      clientId,
      monthsCount: monthData.length,
      totalTasks: allTasksSummary.totalTasks,
      unviewedNotes: unviewedNotesCount
    });

    res.json({
      success: true,
      client: clientInfo,
      timeFilter,
      months: months.map(m => ({
        year: m.year,
        month: m.month,
        display: `${new Date(m.year, m.month - 1).toLocaleString('default', { month: 'long' })} ${m.year}`
      })),
      data: monthData,
      summaries: {
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
    logToConsole("ERROR", "CLIENT_DASHBOARD_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.user?.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching client dashboard data"
    });
  }
});

/* ===============================
   5. GET SPECIFIC MONTH DETAILS (UPDATED)
================================ */
router.get("/dashboard/month-details", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { year, month } = req.query;

    if (!year || !month) {
      logToConsole("WARN", "MONTH_DETAILS_MISSING_PARAMS", {
        clientId,
        year,
        month
      });
      return res.status(400).json({
        success: false,
        message: "Year and month are required"
      });
    }

    logToConsole("INFO", "CLIENT_MONTH_DETAILS_REQUEST", {
      clientId,
      year,
      month
    });

    const client = await Client.findOne(
      { clientId },
      {
        clientId: 1,
        name: 1,
        email: 1,
        documents: 1,
        employeeAssignments: 1
      }
    ).lean();

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_MONTH_DETAILS", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Create activity log for month details view
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "MONTH_DETAILS_VIEWED",
      details: `Client viewed details for ${year}-${month}`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        year,
        month,
        clientName: client.name
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "MONTH_DETAILS_VIEWED",
      clientId: client.clientId
    });

    const yearKey = String(year);
    const monthKey = String(month);
    const monthData = client.documents?.[yearKey]?.[monthKey];

    // Document Status
    const requiredCategories = ['sales', 'purchase', 'bank'];
    const categoryStatus = requiredCategories.map(cat =>
      getCategoryDocumentStatus(monthData?.[cat], cat)
    );

    const otherCategories = getOtherCategoriesStatus(monthData?.other);

    // Task Status with employee details
    const taskStatus = await getTaskStatusForMonth(
      client.employeeAssignments || [],
      parseInt(year),
      parseInt(month)
    );

    // All Notes for this month with view status
    const notes = getNotesForMonth(monthData, clientId);

    // Get employee details for assigned tasks
    const assignedTasks = taskStatus.filter(task => task.status === 'assigned');
    const employeeIds = [...new Set(assignedTasks.map(task => task.employeeId))];

    let employees = [];
    if (employeeIds.length > 0) {
      employees = await Employee.find(
        { employeeId: { $in: employeeIds } },
        { employeeId: 1, name: 1, email: 1, phone: 1 }
      ).lean();
    }

    logToConsole("SUCCESS", "MONTH_DETAILS_FETCHED", {
      clientId,
      year,
      month,
      totalTasks: taskStatus.length,
      assignedTasks: assignedTasks.length,
      notesCount: notes.total,
      unviewedNotes: notes.unviewedCount
    });

    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email
      },
      month: {
        year: parseInt(year),
        month: parseInt(month),
        monthName: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
      },

      // Documents
      documents: {
        requiredCategories,
        status: categoryStatus,
        otherCategories,
        summary: {
          totalRequiredCategories: requiredCategories.length,
          uploadedCategories: categoryStatus.filter(cat => cat.uploadedFiles > 0).length,
          totalFiles: categoryStatus.reduce((sum, cat) => sum + cat.uploadedFiles, 0),
          status: categoryStatus.every(cat => cat.uploadedFiles > 0) ? 'complete' :
            categoryStatus.some(cat => cat.uploadedFiles > 0) ? 'partial' : 'none'
        }
      },

      // Tasks
      tasks: {
        list: taskStatus,
        assignedEmployees: employees.map(emp => ({
          employeeId: emp.employeeId,
          name: emp.name,
          email: emp.email,
          phone: emp.phone,
          assignedTasks: assignedTasks
            .filter(task => task.employeeId === emp.employeeId)
            .map(task => task.taskName)
        })),
        summary: {
          totalTasks: taskStatus.length,
          assignedTasks: assignedTasks.length,
          completedTasks: taskStatus.filter(task => task.accountingDone).length,
          notAssignedTasks: taskStatus.filter(task => task.status === 'not_assigned').length
        }
      },

      // Notes with view status
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

      // Month Status
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
    logToConsole("ERROR", "MONTH_DETAILS_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.user?.clientId,
      year: req.query?.year,
      month: req.query?.month
    });

    res.status(500).json({
      success: false,
      message: "Error fetching month details"
    });
  }
});

/* ===============================
   6. GET EMPLOYEE CONTACT FOR SPECIFIC TASK
================================ */
router.get("/dashboard/employee-contact", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { employeeId } = req.query;

    if (!employeeId) {
      logToConsole("WARN", "EMPLOYEE_CONTACT_MISSING_ID", {
        clientId
      });
      return res.status(400).json({
        success: false,
        message: "Employee ID is required"
      });
    }

    logToConsole("INFO", "EMPLOYEE_CONTACT_REQUEST", {
      clientId,
      employeeId
    });

    const client = await Client.findOne({ clientId }).lean();
    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_EMPLOYEE_CONTACT", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    const employee = await Employee.findOne(
      { employeeId },
      {
        employeeId: 1,
        name: 1,
        email: 1,
        phone: 1,
        isActive: 1
      }
    ).lean();

    if (!employee) {
      logToConsole("WARN", "EMPLOYEE_NOT_FOUND", {
        clientId,
        employeeId
      });
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Create activity log for employee contact view
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      employeeId: employee.employeeId,
      employeeName: employee.name,
      action: "EMPLOYEE_CONTACT_VIEWED",
      details: `Client viewed contact details for employee: ${employee.name}`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        employeeId,
        employeeName: employee.name,
        clientName: client.name
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "EMPLOYEE_CONTACT_VIEWED",
      clientId: client.clientId,
      employeeId: employee.employeeId
    });

    logToConsole("SUCCESS", "EMPLOYEE_CONTACT_FETCHED", {
      clientId,
      employeeId,
      employeeName: employee.name
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
    logToConsole("ERROR", "EMPLOYEE_CONTACT_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.user?.clientId,
      employeeId: req.query?.employeeId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching employee contact"
    });
  }
});

/* ===============================
   7. GET DOCUMENT UPLOAD HISTORY
================================ */
router.get("/dashboard/upload-history", auth, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { limit = 10 } = req.query;

    logToConsole("INFO", "UPLOAD_HISTORY_REQUEST", {
      clientId,
      limit
    });

    const client = await Client.findOne(
      { clientId },
      {
        documents: 1,
        name: 1,
        clientId: 1
      }
    ).lean();

    if (!client) {
      logToConsole("WARN", "CLIENT_NOT_FOUND_UPLOAD_HISTORY", {
        clientId
      });
      return res.status(404).json({
        success: false,
        message: "Client not found"
      });
    }

    // Create activity log for upload history view
    await ActivityLog.create({
      userName: client.name,
      role: "CLIENT",
      clientId: client.clientId,
      action: "UPLOAD_HISTORY_VIEWED",
      details: `Client viewed document upload history (limit: ${limit})`,
      // dateTime: new Date().toLocaleString("en-IN"),
      metadata: {
        limit,
        clientName: client.name
      }
    });

    logToConsole("INFO", "ACTIVITY_LOG_CREATED", {
      action: "UPLOAD_HISTORY_VIEWED",
      clientId: client.clientId
    });

    const uploadHistory = [];
    const documents = client.documents || {};

    // Extract all uploads from all months
    Object.keys(documents).forEach(year => {
      Object.keys(documents[year]).forEach(month => {
        const monthData = documents[year][month];

        // Check required categories
        ['sales', 'purchase', 'bank'].forEach(category => {
          const categoryData = monthData[category];
          if (categoryData && categoryData.files) {
            categoryData.files.forEach(file => {
              if (file.uploadedAt && file.fileName) {
                uploadHistory.push({
                  year: parseInt(year),
                  month: parseInt(month),
                  monthName: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
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

        // Check other categories
        if (monthData.other && Array.isArray(monthData.other)) {
          monthData.other.forEach(otherCat => {
            if (otherCat.document && otherCat.document.files) {
              otherCat.document.files.forEach(file => {
                if (file.uploadedAt && file.fileName) {
                  uploadHistory.push({
                    year: parseInt(year),
                    month: parseInt(month),
                    monthName: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
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
      });
    });

    // Sort by upload date (newest first)
    uploadHistory.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // Limit results
    const limitedHistory = uploadHistory.slice(0, parseInt(limit));

    logToConsole("SUCCESS", "UPLOAD_HISTORY_FETCHED", {
      clientId,
      totalUploads: uploadHistory.length,
      returnedUploads: limitedHistory.length
    });

    res.json({
      success: true,
      totalUploads: uploadHistory.length,
      uploads: limitedHistory,
      summary: {
        byCategory: uploadHistory.reduce((acc, upload) => {
          acc[upload.category] = (acc[upload.category] || 0) + 1;
          return acc;
        }, {}),
        byMonth: uploadHistory.reduce((acc, upload) => {
          const key = `${upload.year}-${upload.month}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logToConsole("ERROR", "UPLOAD_HISTORY_FAILED", {
      error: error.message,
      stack: error.stack,
      clientId: req.user?.clientId
    });

    res.status(500).json({
      success: false,
      message: "Error fetching upload history"
    });
  }
});

module.exports = router;