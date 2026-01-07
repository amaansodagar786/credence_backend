const express = require("express");
const jwt = require("jsonwebtoken");

const Employee = require("../models/Employee");
const EmployeeTaskLog = require("../models/EmployeeTaskLog");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// Console logging utility
const logToConsole = (type, operation, data) => {
  const timestamp = new Date().toLocaleString("en-IN");
  const logEntry = {
    timestamp,
    type,
    operation,
    data
  };

  // Color-coded console output for better visibility
  const colors = {
    INFO: '\x1b[36m',    // Cyan
    SUCCESS: '\x1b[32m', // Green
    WARN: '\x1b[33m',    // Yellow
    ERROR: '\x1b[31m',   // Red
    DEBUG: '\x1b[35m',   // Magenta
    RESET: '\x1b[0m'     // Reset
  };

  const color = colors[type] || colors.RESET;
  console.log(`${color}[${timestamp}] ${type}: ${operation}${colors.RESET}`, data);

  return logEntry;
};

/* ===============================
   CREATE TASK LOG (START TASK)
================================ */
router.post("/create", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    
    // Console log: Task creation request
    logToConsole("INFO", "TASK_CREATE_REQUEST", {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_TASK_CREATE", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verified
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_TASK_CREATE", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_TASK_CREATE", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...'
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    const employee = await Employee.findOne({
      employeeId: decoded.employeeId
    });

    if (!employee) {
      // Console log: Employee not found
      logToConsole("ERROR", "EMPLOYEE_NOT_FOUND_FOR_TASK", {
        employeeId: decoded.employeeId
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(404).json({
        message: "Employee not found",
        clearedCookie: true
      });
    }

    const { date, projectName, description, startTime } = req.body;

    // Console log: Request body received
    logToConsole("DEBUG", "TASK_CREATE_REQUEST_BODY", {
      employeeId: employee.employeeId,
      date: !!date,
      projectName: !!projectName,
      description: !!description,
      startTime: !!startTime
    });

    if (!date || !projectName || !description || !startTime) {
      logToConsole("WARN", "MISSING_FIELDS_TASK_CREATE", {
        date: !!date,
        projectName: !!projectName,
        description: !!description,
        startTime: !!startTime
      });
      return res.status(400).json({
        message: "All fields except end time are required"
      });
    }

    // Console log: Creating task log
    logToConsole("INFO", "CREATING_TASK_LOG", {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      projectName,
      date,
      startTime
    });

    const taskLog = await EmployeeTaskLog.create({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      employeeEmail: employee.email,
      date,
      projectName,
      description,
      startTime
    });

    // Console log: Task log created
    logToConsole("SUCCESS", "TASK_LOG_CREATED", {
      taskId: taskLog._id,
      employeeId: employee.employeeId,
      projectName,
      status: taskLog.status
    });

    // Create activity log
    try {
      await ActivityLog.create({
        userName: employee.name,
        role: "EMPLOYEE",
        employeeId: employee.employeeId,
        action: "TASK_STARTED",
        details: `Task started: ${projectName}`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      // Console log: Activity log created
      logToConsole("INFO", "TASK_ACTIVITY_LOG_CREATED", {
        employeeId: employee.employeeId,
        action: "TASK_STARTED"
      });
    } catch (logError) {
      // Console log: Activity log error (non-critical)
      logToConsole("ERROR", "TASK_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: employee.employeeId,
        taskId: taskLog._id
      });
      // Don't fail the task creation if activity log fails
    }

    // Console log: Task creation successful
    logToConsole("SUCCESS", "TASK_CREATION_SUCCESSFUL", {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      projectName,
      taskId: taskLog._id,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Task started successfully",
      taskLog
    });

  } catch (error) {
    // Console log: Task creation error
    logToConsole("ERROR", "TASK_CREATE_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/create",
      body: req.body
    });

    res.status(500).json({
      message: "Error creating task log",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   UPDATE TASK LOG (END TASK)
================================ */
router.put("/complete/:taskId", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    const { taskId } = req.params;
    
    // Console log: Task completion request
    logToConsole("INFO", "TASK_COMPLETE_REQUEST", {
      taskId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_TASK_COMPLETE", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verified
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_TASK_COMPLETE", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_TASK_COMPLETE", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...'
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    const { endTime } = req.body;
    
    // Console log: Request body for completion
    logToConsole("DEBUG", "TASK_COMPLETE_REQUEST_BODY", {
      taskId,
      hasEndTime: !!endTime,
      employeeId: decoded.employeeId
    });

    if (!endTime) {
      logToConsole("WARN", "MISSING_END_TIME_TASK_COMPLETE", { taskId });
      return res.status(400).json({ message: "End time is required" });
    }

    // Find the task
    const task = await EmployeeTaskLog.findById(taskId);

    if (!task) {
      // Console log: Task not found
      logToConsole("ERROR", "TASK_NOT_FOUND_FOR_COMPLETION", {
        taskId,
        employeeId: decoded.employeeId
      });
      return res.status(404).json({ message: "Task log not found" });
    }

    // Check if employee owns this task
    if (task.employeeId !== decoded.employeeId) {
      // Console log: Access denied
      logToConsole("WARN", "TASK_ACCESS_DENIED", {
        taskId,
        taskEmployeeId: task.employeeId,
        requestEmployeeId: decoded.employeeId
      });
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if task is already completed
    if (task.status === "COMPLETED") {
      logToConsole("WARN", "TASK_ALREADY_COMPLETED", {
        taskId,
        employeeId: decoded.employeeId
      });
      return res.status(400).json({ message: "Task is already completed" });
    }

    // Console log: Updating task to completed
    logToConsole("INFO", "UPDATING_TASK_TO_COMPLETED", {
      taskId,
      employeeId: decoded.employeeId,
      projectName: task.projectName,
      endTime
    });

    // Update the task
    task.endTime = endTime;
    task.status = "COMPLETED";
    await task.save();

    // Console log: Task updated successfully
    logToConsole("SUCCESS", "TASK_UPDATED_SUCCESSFULLY", {
      taskId,
      employeeId: decoded.employeeId,
      projectName: task.projectName,
      duration: `${task.startTime} - ${endTime}`
    });

    // Create activity log
    try {
      await ActivityLog.create({
        userName: task.employeeName,
        role: "EMPLOYEE",
        employeeId: task.employeeId,
        action: "TASK_COMPLETED",
        details: `Task completed: ${task.projectName}`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      // Console log: Activity log created
      logToConsole("INFO", "TASK_COMPLETE_ACTIVITY_LOG_CREATED", {
        taskId,
        employeeId: decoded.employeeId,
        action: "TASK_COMPLETED"
      });
    } catch (logError) {
      // Console log: Activity log error (non-critical)
      logToConsole("ERROR", "TASK_COMPLETE_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        taskId,
        employeeId: decoded.employeeId
      });
      // Don't fail the task completion if activity log fails
    }

    // Console log: Task completion successful
    logToConsole("SUCCESS", "TASK_COMPLETION_SUCCESSFUL", {
      taskId,
      employeeId: decoded.employeeId,
      employeeName: task.employeeName,
      projectName: task.projectName,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Task completed successfully",
      task
    });

  } catch (error) {
    // Console log: Task completion error
    logToConsole("ERROR", "TASK_COMPLETE_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/complete/:taskId",
      taskId: req.params.taskId,
      body: req.body
    });

    res.status(500).json({
      message: "Error completing task",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   LIST OWN TASK LOGS
================================ */
router.get("/my-tasks", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    
    // Console log: Task list request
    logToConsole("INFO", "TASK_LIST_REQUEST", {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_TASK_LIST", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verified
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_TASK_LIST", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_TASK_LIST", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...'
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    // Console log: Fetching tasks for employee
    logToConsole("INFO", "FETCHING_EMPLOYEE_TASKS", {
      employeeId: decoded.employeeId
    });

    const tasks = await EmployeeTaskLog.find({
      employeeId: decoded.employeeId
    }).sort({ createdAt: -1 });

    // Console log: Tasks fetched successfully
    logToConsole("SUCCESS", "TASKS_FETCHED_SUCCESSFULLY", {
      employeeId: decoded.employeeId,
      taskCount: tasks.length,
      completedTasks: tasks.filter(t => t.status === "COMPLETED").length,
      inProgressTasks: tasks.filter(t => t.status === "IN_PROGRESS").length
    });

    // Create activity log
    try {
      await ActivityLog.create({
        userName: decoded.name,
        role: "EMPLOYEE",
        employeeId: decoded.employeeId,
        action: "FETCHED_TASK_LOGS",
        details: `Fetched ${tasks.length} task logs`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      // Console log: Activity log created
      logToConsole("INFO", "TASK_LIST_ACTIVITY_LOG_CREATED", {
        employeeId: decoded.employeeId,
        action: "FETCHED_TASK_LOGS"
      });
    } catch (logError) {
      // Console log: Activity log error (non-critical)
      logToConsole("ERROR", "TASK_LIST_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        employeeId: decoded.employeeId
      });
      // Don't fail the task list if activity log fails
    }

    // Console log: Task list response
    logToConsole("SUCCESS", "TASK_LIST_RESPONSE_SENT", {
      employeeId: decoded.employeeId,
      taskCount: tasks.length,
      timestamp: new Date().toISOString()
    });

    res.json(tasks);

  } catch (error) {
    // Console log: Task list error
    logToConsole("ERROR", "TASK_LIST_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/my-tasks"
    });

    res.status(500).json({
      message: "Error fetching task logs",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/* ===============================
   DELETE TASK LOG
================================ */
router.delete("/delete/:taskId", async (req, res) => {
  try {
    const token = req.cookies?.employeeToken;
    const { taskId } = req.params;
    
    // Console log: Task deletion request
    logToConsole("INFO", "TASK_DELETE_REQUEST", {
      taskId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (!token) {
      logToConsole("WARN", "NO_TOKEN_FOR_TASK_DELETE", { ip: req.ip });
      return res.status(401).json({ message: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Console log: Token verified
      logToConsole("DEBUG", "TOKEN_VERIFIED_FOR_TASK_DELETE", {
        employeeId: decoded.employeeId,
        name: decoded.name
      });
    } catch (jwtError) {
      // Console log: Token verification failed
      logToConsole("ERROR", "TOKEN_VERIFICATION_FAILED_TASK_DELETE", {
        error: jwtError.message,
        token: token.substring(0, 20) + '...'
      });

      // Clear invalid cookie
      res.clearCookie("employeeToken");

      return res.status(401).json({
        message: "Invalid or expired token",
        clearedCookie: true
      });
    }

    // Find the task
    const task = await EmployeeTaskLog.findById(taskId);

    if (!task) {
      // Console log: Task not found
      logToConsole("ERROR", "TASK_NOT_FOUND_FOR_DELETION", {
        taskId,
        employeeId: decoded.employeeId
      });
      return res.status(404).json({ message: "Task log not found" });
    }

    // Check if employee owns this task
    if (task.employeeId !== decoded.employeeId) {
      // Console log: Access denied
      logToConsole("WARN", "TASK_DELETE_ACCESS_DENIED", {
        taskId,
        taskEmployeeId: task.employeeId,
        requestEmployeeId: decoded.employeeId
      });
      return res.status(403).json({ message: "Access denied" });
    }

    // Console log: Deleting task
    logToConsole("INFO", "DELETING_TASK_LOG", {
      taskId,
      employeeId: decoded.employeeId,
      projectName: task.projectName,
      status: task.status
    });

    // Delete the task
    await EmployeeTaskLog.findByIdAndDelete(taskId);

    // Create activity log
    try {
      await ActivityLog.create({
        userName: decoded.name,
        role: "EMPLOYEE",
        employeeId: decoded.employeeId,
        action: "TASK_LOG_DELETED",
        details: `Task deleted: ${task.projectName}`,
        dateTime: new Date().toLocaleString("en-IN")
      });

      // Console log: Activity log created
      logToConsole("INFO", "TASK_DELETE_ACTIVITY_LOG_CREATED", {
        taskId,
        employeeId: decoded.employeeId,
        action: "TASK_LOG_DELETED"
      });
    } catch (logError) {
      // Console log: Activity log error (non-critical)
      logToConsole("ERROR", "TASK_DELETE_ACTIVITY_LOG_FAILED", {
        error: logError.message,
        taskId,
        employeeId: decoded.employeeId
      });
      // Don't fail the task deletion if activity log fails
    }

    // Console log: Task deletion successful
    logToConsole("SUCCESS", "TASK_DELETION_SUCCESSFUL", {
      taskId,
      employeeId: decoded.employeeId,
      employeeName: decoded.name,
      projectName: task.projectName,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: "Task deleted successfully",
      deletedTask: {
        _id: taskId,
        projectName: task.projectName
      }
    });

  } catch (error) {
    // Console log: Task deletion error
    logToConsole("ERROR", "TASK_DELETE_ENDPOINT_ERROR", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      endpoint: "/delete/:taskId",
      taskId: req.params.taskId
    });

    res.status(500).json({
      message: "Error deleting task log",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;