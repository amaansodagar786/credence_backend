// const express = require("express");
// const axios = require("axios");
// const router = express.Router();

// router.post("/google-drive-proxy", async (req, res) => {
//   try {
//     const { fileId, accessToken } = req.body;

//     if (!fileId || !accessToken) {
//       return res.status(400).json({ error: "Missing fileId or accessToken" });
//     }

//     // 1. Get file metadata (name, mimeType)
//     const meta = await axios.get(
//       `https://www.googleapis.com/drive/v3/files/${fileId}`,
//       {
//         headers: { Authorization: `Bearer ${accessToken}` },
//         params: { fields: "name,mimeType" }
//       }
//     );

//     const { name, mimeType } = meta.data;
//     let downloadUrl;
//     let exportMime = mimeType;

//     // 2. Handle Google Workspace files (Docs, Sheets, Slides)
//     if (mimeType.includes("google-apps")) {
//       if (mimeType.includes("spreadsheet")) {
//         exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; // .xlsx
//       } else if (mimeType.includes("document")) {
//         exportMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; // .docx
//       } else if (mimeType.includes("presentation")) {
//         exportMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"; // .pptx
//       } else {
//         exportMime = "application/pdf";
//       }

//       downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
//     } else {
//       // Regular binary file
//       downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
//     }

//     // 3. Download the file/export
//     const fileRes = await axios({
//       method: "get",
//       url: downloadUrl,
//       headers: { Authorization: `Bearer ${accessToken}` },
//       responseType: "arraybuffer"
//     });

//     // 4. Send file with correct headers
//     res.setHeader("Content-Type", exportMime);
//     res.setHeader("X-File-Name", encodeURIComponent(name));
//     res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
//     res.send(fileRes.data);
//   } catch (error) {
//     console.error("Google Drive proxy error:", error.response?.data || error.message);
//     res.status(500).json({ error: "Failed to download file from Google Drive" });
//   }
// });

// module.exports = router;






const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "../uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── EXISTING: Download proxy ──────────────────────────────────────────────────
router.post("/google-drive-proxy", async (req, res) => {
  try {
    const { fileId, accessToken } = req.body;
    if (!fileId || !accessToken) {
      return res.status(400).json({ error: "Missing fileId or accessToken" });
    }

    const meta = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: "name,mimeType" }
      }
    );

    const { name, mimeType } = meta.data;
    let downloadUrl;
    let exportMime = mimeType;

    if (mimeType.includes("google-apps")) {
      if (mimeType.includes("spreadsheet")) {
        exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (mimeType.includes("document")) {
        exportMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (mimeType.includes("presentation")) {
        exportMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else {
        exportMime = "application/pdf";
      }
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const fileRes = await axios({
      method: "get",
      url: downloadUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer"
    });

    res.setHeader("Content-Type", exportMime);
    res.setHeader("X-File-Name", encodeURIComponent(name));
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(fileRes.data);
  } catch (error) {
    console.error("Google Drive proxy error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to download file from Google Drive" });
  }
});

// ── NEW: Upload files to server ───────────────────────────────────────────────
router.post("/google-drive-upload", (req, res) => {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    const savedFiles = [];

    files.forEach((file) => {
      const filePath = path.join(UPLOAD_DIR, file.name);
      const buffer = Buffer.from(file.data, "base64");
      fs.writeFileSync(filePath, buffer);
      savedFiles.push({ name: file.name, size: buffer.length });
    });

    res.json({
      message: "All files uploaded successfully",
      files: savedFiles
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

module.exports = router;