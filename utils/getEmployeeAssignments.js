const Employee = require("../models/Employee");
const EmployeeAssignment = require("../models/EmployeeAssignment");

async function getEmployeeAssignments(employeeId) {
  // 1. Get from OLD array
  const employee = await Employee.findOne({ employeeId });
  const oldAssignments = employee?.assignedClients || [];
  
  // 2. Get from NEW collection
  let newDoc = await EmployeeAssignment.findOne({ employeeId });
  const newAssignments = newDoc?.assignedClients || [];
  
  // 3. MERGE - new collection data takes priority (newer assignedAt wins)
  const mergedMap = new Map();
  
  for (const assign of oldAssignments) {
    const key = `${assign.clientId}-${assign.year}-${assign.month}-${assign.task}`;
    if (!mergedMap.has(key) || new Date(assign.assignedAt) > new Date(mergedMap.get(key).assignedAt)) {
      mergedMap.set(key, assign);
    }
  }
  
  for (const assign of newAssignments) {
    const key = `${assign.clientId}-${assign.year}-${assign.month}-${assign.task}`;
    if (!mergedMap.has(key) || new Date(assign.assignedAt) > new Date(mergedMap.get(key).assignedAt)) {
      mergedMap.set(key, assign);
    }
  }
  
  return Array.from(mergedMap.values());
}

async function updateEmployeeAssignment(employeeId, employeeName, employeeEmail, newAssignments) {
  let doc = await EmployeeAssignment.findOne({ employeeId });
  
  if (!doc) {
    doc = new EmployeeAssignment({
      employeeId,
      employeeName,
      employeeEmail,
      assignedClients: []
    });
  }
  
  // Update name/email (in case they changed)
  doc.employeeName = employeeName;
  doc.employeeEmail = employeeEmail;
  
  // Merge existing + new assignments
  for (const newAssign of newAssignments) {
    const existingIndex = doc.assignedClients.findIndex(
      a => a.clientId === newAssign.clientId &&
           a.year === newAssign.year &&
           a.month === newAssign.month &&
           a.task === newAssign.task
    );
    
    if (existingIndex !== -1) {
      // Update existing
      doc.assignedClients[existingIndex] = { ...doc.assignedClients[existingIndex], ...newAssign };
    } else {
      // Add new
      doc.assignedClients.push(newAssign);
    }
  }
  
  await doc.save();
  return doc;
}

module.exports = { getEmployeeAssignments, updateEmployeeAssignment };