// routes/googleDrive.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

router.post("/google-drive-proxy", async (req, res) => {
  const { fileId, accessToken } = req.body;

  if (!fileId || !accessToken) {
    return res.status(400).json({
      success: false,
      error: "Missing fileId or accessToken",
    });
  }

  try {
    // Get metadata
    const metadata = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const { mimeType, name } = metadata.data;

    let downloadUrl;

    if (mimeType.includes("google-apps")) {
      if (mimeType.includes("document")) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
      } else if (mimeType.includes("spreadsheet")) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
      } else if (mimeType.includes("presentation")) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation`;
      }
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const response = await axios.get(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: "stream",
    });

    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Type", mimeType);

    response.data.pipe(res);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      success: false,
      error: "Google Drive API error",
    });
  }
});

module.exports = router;