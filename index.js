const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();

app.set("trust proxy", 1);

// ===============================
// MongoDB Connection
// ===============================
const connectDB = require("./config/mongodb");
connectDB();

// ===============================
// Middlewares
// ===============================
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
    cors({
        origin: [
            "https://credence-two.vercel.app",
            "http://localhost:5173",
            "https://credence.techorses.com",
            "https://jladgroup.fi"
        ],
        credentials: true
    })
);

app.use(cookieParser());

// ===============================
// ROUTES
// ===============================
const adminRoutes = require("./routes/admin");
const ClientEnrollment = require("./routes/clientEnrollment");
const ClientAuth = require("./routes/clientAuth");
const AdminEmployee = require("./routes/adminEmployee");
const EmployeeRoutes = require("./routes/employee");
const EmployeeTasks = require("./routes/employeeTaskLog");
const clientUpload = require("./routes/clientUpload");
const Employee_task_info = require("./routes/employee-task");
const scheduleCallRoutes = require("./routes/scheduleCallRoutes");
const paymentReminderRoutes = require("./routes/paymentReminders");
const documentUploadReminderRoutes = require("./routes/documentUploadReminders"); // NEW LINE
const clientManagementRoutes = require("./routes/clientManagement");
const adminDashboardRoutes = require('./routes/adminDashboard');
const clientDashboardRoutes = require('./routes/clientDashboardRoutes');
const employeeDashboard = require('./routes/employeeDashboard');
const activityLogsRoutes = require("./routes/activityLogs");



app.use("/client-enrollment", ClientEnrollment);
app.use("/client", ClientAuth);
app.use("/clientupload", clientUpload);

app.use("/admin", adminRoutes);
app.use("/admin-employee", AdminEmployee);

app.use("/employee", EmployeeRoutes);
app.use("/employee-task", EmployeeTasks);

app.use("/admin", Employee_task_info);

app.use("/schedule-call", scheduleCallRoutes);
app.use("/payment-reminders", paymentReminderRoutes);
app.use("/document-upload-reminders", documentUploadReminderRoutes); // NEW LINE
app.use("/client-management", clientManagementRoutes);

app.use('/admin', adminDashboardRoutes);
app.use('/client', clientDashboardRoutes);
app.use('/employee', employeeDashboard);
app.use("/activity-logs", activityLogsRoutes);




// ===============================
// BASIC ROUTE
// ===============================
app.get("/", (req, res) => {
    res.send("Accounting Portal Backend is running new updated credence");
});

// ===============================
// PAYMENT REMINDER INITIALIZATION
// ===============================
console.log("⏰ Payment Reminder System: Checking schedule...");
console.log("📅 First Reminder: 20th of each month at 12:00 PM IST");
console.log("📅 Final Reminder: 25th of each month at 12:00 PM IST");

// ===============================
// DOCUMENT UPLOAD REMINDER INITIALIZATION
// ===============================
console.log("⏰ Document Upload Reminder System: Checking schedule...");
console.log("📅 Document Upload Reminder: 15th of each month at 12:00 PM IST");

// Display current and next month info
const currentDate = new Date();
const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

const previousMonthYear = previousMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
});

const nextMonthYear = nextMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric"
});

console.log(`📊 Next Document Upload Reminder:`);
console.log(`   - Will remind for: ${previousMonthYear}`);
console.log(`   - Due on: 15th ${nextMonthYear}`);
console.log(`   - Deadline: 25th ${nextMonthYear}`);

console.log(`⏰ Current Server Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);

// ===============================
// SERVER
// ===============================
const PORT = process.env.PORT || 3043;

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`💰 Payment Reminder System: ACTIVE`);
    console.log(`📄 Document Upload Reminder System: ACTIVE`);
});