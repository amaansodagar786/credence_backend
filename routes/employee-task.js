const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Client = require('../models/Client');

// GET: Employee Work Tracking View
// URL: GET /api/admin/employee-work-tracker
router.get('/employee-work-tracker', async (req, res) => {
  try {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    // 1. Get all active employees (name and email only)
    const employees = await Employee.find(
      { isActive: true },
      { name: 1, email: 1, _id: 0, employeeId: 1 }
    ).sort({ name: 1 });

    // 2. Get all client assignments
    const allClients = await Client.find(
      { isActive: true },
      { 
        clientId: 1, 
        name: 1, 
        employeeAssignments: 1 
      }
    );

    // 3. Prepare response structure
    const response = {
      employees: [],          // Left sidebar data
      workAssignments: []     // Right table data
    };

    // 4. Prepare employees list for sidebar
    response.employees = employees.map(emp => ({
      name: emp.name,
      email: emp.email
    }));

    // 5. Process assignments for table
    const allAssignments = [];

    allClients.forEach(client => {
      if (!client.employeeAssignments || client.employeeAssignments.length === 0) {
        return;
      }

      client.employeeAssignments.forEach(assignment => {
        if (assignment.isRemoved) return;

        // Calculate sort priority
        let sortPriority = 0;
        if (assignment.year === currentYear && assignment.month === currentMonth) {
          sortPriority = 100; // Current month gets highest priority
        } else if (assignment.year > currentYear || 
                  (assignment.year === currentYear && assignment.month > currentMonth)) {
          sortPriority = 50; // Future months
        } else {
          sortPriority = assignment.year * 12 + assignment.month; // Past months
        }

        allAssignments.push({
          employeeName: assignment.employeeName,
          employeeEmail: assignment.employeeId,
          clientName: client.name,
          clientId: client.clientId,
          year: assignment.year,
          month: assignment.month,
          task: assignment.task,
          status: assignment.accountingDone ? 'DONE' : 'PENDING',
          assignedDate: assignment.assignedAt,
          completedDate: assignment.accountingDoneAt,
          assignedBy: assignment.adminName || assignment.assignedBy,
          sortPriority: sortPriority
        });
      });
    });

    // 6. Sort assignments: current month first, then future, then past (descending)
    response.workAssignments = allAssignments.sort((a, b) => {
      // First by employee name
      if (a.employeeName < b.employeeName) return -1;
      if (a.employeeName > b.employeeName) return 1;
      
      // Then by sort priority (descending - current first)
      return b.sortPriority - a.sortPriority;
    });

    // 7. Remove sortPriority from final response
    response.workAssignments = response.workAssignments.map(item => {
      const { sortPriority, ...rest } = item;
      return rest;
    });

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Error in employee-work-tracker:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;