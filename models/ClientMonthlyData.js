const mongoose = require("mongoose");

/* ===============================
   NOTE VIEW TRACKING SCHEMA
================================ */
const noteViewSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true },
        userType: { type: String, required: true, enum: ['client', 'employee', 'admin'] },
        viewedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

/* ===============================
   NOTE SCHEMA
================================ */
const noteSchema = new mongoose.Schema(
    {
        note: { type: String, required: true },
        addedBy: { type: String },
        addedAt: { type: Date, default: Date.now },
        employeeId: { type: String },
        viewedBy: { type: [noteViewSchema], default: [] },
        isViewedByClient: { type: Boolean, default: false },
        isViewedByEmployee: { type: Boolean, default: false },
        isViewedByAdmin: { type: Boolean, default: false }
    },
    { _id: false }
);

/* ===============================
   SINGLE DOCUMENT (FILE LEVEL)
================================ */
const singleDocumentSchema = new mongoose.Schema(
    {
        url: String,
        uploadedAt: Date,
        uploadedBy: String,
        fileName: String,
        fileSize: Number,
        fileType: String,
        notes: [noteSchema]
    },
    { _id: false }
);

/* ===============================
   CATEGORY WITH MULTIPLE FILES
================================ */
const categorySchema = new mongoose.Schema(
    {
        files: [singleDocumentSchema],
        isLocked: { type: Boolean, default: false },
        lockedAt: Date,
        lockedBy: String,
        categoryNotes: [noteSchema],
        wasLockedOnce: { type: Boolean, default: false }
    },
    { _id: false }
);

/* ===============================
   OTHER CATEGORY
================================ */
const otherCategorySchema = new mongoose.Schema(
    {
        categoryName: { type: String, required: true },
        document: categorySchema
    },
    { _id: false }
);

/* ===============================
   MONTH DATA SCHEMA (ONE MONTH)
================================ */
const monthDataSchema = new mongoose.Schema(
    {
        year: { type: Number, required: true },
        month: { type: Number, required: true },
        sales: categorySchema,
        purchase: categorySchema,
        bank: categorySchema,
        other: [otherCategorySchema],
        isLocked: { type: Boolean, default: false },
        wasLockedOnce: { type: Boolean, default: false },
        lockedAt: Date,
        lockedBy: String,
        autoLockDate: Date,
        monthNotes: [noteSchema],
        accountingDone: { type: Boolean, default: false },
        accountingDoneAt: Date,
        accountingDoneBy: String,
        monthActiveStatus: { type: String, enum: ['active', 'inactive'], default: 'active' },
        monthStatusChangedAt: Date,
        monthStatusChangedBy: String,
        monthStatusReason: String,
        paymentStatus: { type: Boolean, default: false },
        paymentUpdatedAt: Date,
        paymentUpdatedBy: String,
        paymentUpdatedByName: String,
        paymentNotes: String,
        paymentHistory: [
            {
                status: { type: Boolean, required: true },
                changedAt: { type: Date, default: Date.now },
                changedBy: String,
                changedByName: String,
                notes: String
            }
        ]
    },
    { _id: false }
);

/* ===============================
   CLIENT MONTHLY DATA SCHEMA
   One document per client with months array
================================ */
const clientMonthlyDataSchema = new mongoose.Schema(
    {
        clientId: { type: String, required: true, unique: true, index: true },
        clientName: { type: String },
        clientEmail: { type: String },
        months: [monthDataSchema]  // 👈 ARRAY of months
    },
    { timestamps: true }
);

module.exports = mongoose.model("ClientMonthlyData", clientMonthlyDataSchema);