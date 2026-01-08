// migration_fix_task_issue.js
const mongoose = require('mongoose');
require('dotenv').config();

// Import your models
const Client = require('./models/Client');
const Employee = require('./models/Employee');

async function fixTaskIssue() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/credence';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n=== STARTING MIGRATION: Fixing task field issue ===\n');
    
    // ===== CHECK ALL CLIENTS =====
    console.log('1. Checking ALL Clients...');
    const allClients = await Client.find({});
    console.log(`   Total clients in database: ${allClients.length}`);
    
    let clientsWithAssignments = 0;
    let clientUpdated = 0;
    let assignmentFixed = 0;
    
    for (const client of allClients) {
      if (client.employeeAssignments && client.employeeAssignments.length > 0) {
        clientsWithAssignments++;
        let needsUpdate = false;
        
        for (const assignment of client.employeeAssignments) {
          // Check if task field exists or is empty
          if (!assignment.task || assignment.task === '') {
            assignment.task = 'Bookkeeping';
            needsUpdate = true;
            assignmentFixed++;
          }
        }
        
        if (needsUpdate) {
          try {
            await client.save();
            clientUpdated++;
            console.log(`   ✓ Client "${client.name || client.clientId}": Fixed ${client.employeeAssignments.length} assignments`);
          } catch (saveError) {
            console.log(`   ✗ Error saving client ${client.name || client.clientId}:`, saveError.message);
          }
        }
      }
    }
    
    console.log(`\n   📊 Client Results:`);
    console.log(`   - Total clients: ${allClients.length}`);
    console.log(`   - Clients with assignments: ${clientsWithAssignments}`);
    console.log(`   - Clients updated: ${clientUpdated}`);
    console.log(`   - Assignments fixed: ${assignmentFixed}`);
    
    // ===== CHECK ALL EMPLOYEES =====
    console.log('\n2. Checking ALL Employees...');
    const allEmployees = await Employee.find({});
    console.log(`   Total employees in database: ${allEmployees.length}`);
    
    let employeesWithAssignments = 0;
    let employeeUpdated = 0;
    let empAssignmentFixed = 0;
    
    for (const employee of allEmployees) {
      if (employee.assignedClients && employee.assignedClients.length > 0) {
        employeesWithAssignments++;
        let needsUpdate = false;
        
        for (const assignment of employee.assignedClients) {
          // Check if task field exists or is empty
          if (!assignment.task || assignment.task === '') {
            assignment.task = 'Bookkeeping';
            needsUpdate = true;
            empAssignmentFixed++;
          }
        }
        
        if (needsUpdate) {
          try {
            await employee.save();
            employeeUpdated++;
            console.log(`   ✓ Employee "${employee.name}": Fixed ${employee.assignedClients.length} assignments`);
          } catch (saveError) {
            console.log(`   ✗ Error saving employee ${employee.name}:`, saveError.message);
          }
        }
      }
    }
    
    console.log(`\n   📊 Employee Results:`);
    console.log(`   - Total employees: ${allEmployees.length}`);
    console.log(`   - Employees with assignments: ${employeesWithAssignments}`);
    console.log(`   - Employees updated: ${employeeUpdated}`);
    console.log(`   - Assignments fixed: ${empAssignmentFixed}`);
    
    // ===== CHECK FOR VALIDATION ERRORS =====
    console.log('\n3. Checking for schema validation issues...');
    
    // Temporarily update schemas to be more lenient
    const clientSchema = Client.schema;
    const employeeSchema = Employee.schema;
    
    console.log('   Client schema task field:', clientSchema.path('employeeAssignments.task'));
    console.log('   Employee schema task field:', employeeSchema.path('assignedClients.task'));
    
    // ===== FINAL SUMMARY =====
    console.log('\n=== MIGRATION COMPLETE ===');
    console.log(`📊 FINAL SUMMARY:`);
    console.log(`   Clients updated: ${clientUpdated}`);
    console.log(`   Employees updated: ${employeeUpdated}`);
    console.log(`   Total assignments fixed: ${assignmentFixed + empAssignmentFixed}`);
    
    if (assignmentFixed + empAssignmentFixed === 0) {
      console.log('\n⚠️  No assignments needed fixing.');
      console.log('   The error might be due to schema validation.');
      console.log('   Let me check your current data...');
      
      // Show sample data
      const sampleClient = await Client.findOne({});
      if (sampleClient && sampleClient.employeeAssignments && sampleClient.employeeAssignments.length > 0) {
        console.log('\n   Sample client assignment:', JSON.stringify(sampleClient.employeeAssignments[0], null, 2));
      }
      
      const sampleEmployee = await Employee.findOne({});
      if (sampleEmployee && sampleEmployee.assignedClients && sampleEmployee.assignedClients.length > 0) {
        console.log('\n   Sample employee assignment:', JSON.stringify(sampleEmployee.assignedClients[0], null, 2));
      }
    } else {
      console.log('\n✅ Migration successful! Try assigning clients now.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the migration
fixTaskIssue();