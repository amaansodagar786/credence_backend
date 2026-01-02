const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();

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
        origin: "http://localhost:5173",
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

app.use("/admin", adminRoutes);
app.use("/client-enrollment", ClientEnrollment);
app.use("/client", ClientAuth);
app.use("/admin-employee", AdminEmployee);
app.use("/employee", EmployeeRoutes);




// ===============================
// BASIC ROUTE
// ===============================
app.get("/", (req, res) => {
    res.send("Accounting Portal Backend is running");
});

// ===============================
// SERVER
// ===============================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
