const mongoose = require("mongoose");

const deletedFileSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileUrl: String,
    fileSize: Number,
    fileType: String,
    year: Number,
    month: Number,
    categoryType: String, // sales, purchase, bank, other
    categoryName: String, // for "other" categories
    uploadedBy: String,
    uploadedAt: Date,
    deletedBy: String, // clientId or adminId
    deletedAt: {
        type: Date,
        default: Date.now
    },
    deleteNote: String, // Reason for deletion
    wasReplaced: {
        type: Boolean,
        default: false
    },
    replacedByFile: String // New file that replaced this one
}, {
    timestamps: true
});

module.exports = mongoose.model("DeletedFile", deletedFileSchema);