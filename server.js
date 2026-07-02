/**
 * server.js
 * Express HTTP server â receives a topic, generates a PPTX via Claude agent,
 * uploads to Supabase Storage, and returns the public download URL.
 *
 * POST /api/generate-pptx
 *   Body: { "topic": "ë¯¸ëì°¨ ì¬ë¼ì´ë 10ì¥" }
 *   Response: { "success": true, "url": "https://...", "filename": "presentation.pptx" }
 */

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { generatePptx } = require("./agent");

const app = express();
app.use(express.json());

// âââ Clients ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // Use service role key (server-side only!)
);

const BUCKET = process.env.SUPABASE_BUCKET || "pptx-files";
const TMP_DIR = process.env.TMP_DIR || os.tmpdir();

// âââ Routes âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get("/health", (_req, res) => res.json({ status: "ok" }));

/**
 * POST /api/generate-pptx
 * Main endpoint â topic â Claude agent â Supabase Storage URL
 */
app.post("/api/generate-pptx", async (req, res) => {
  const { topic } = req.body ?? {};

  if (!topic || typeof topic !== "string") {
    return res.status(400).json({ error: "topic (string) is required" });
  }

  const jobId = uuidv4();
  const workDir = path.join(TMP_DIR, "pptx-agent", jobId);
  const outputPath = path.join(workDir, "output.pptx");

  console.log(`[${jobId}] Starting: "${topic}"`);

  try {
    // 1. Generate PPTX via Claude agent
    await generatePptx(topic, workDir, outputPath);
    console.log(`[${jobId}] PPTX generated: ${outputPath}`);

    // 2. Upload to Supabase Storage
    const fileBuffer = fs.readFileSync(outputPath);
    const storagePath = `${jobId}/presentation.pptx`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // 3. Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    console.log(`[${jobId}] Uploaded: ${urlData.publicUrl}`);

    // 4. Cleanup temp files
    fs.rmSync(workDir, { recursive: true, force: true });

    return res.json({
      success: true,
      jobId,
      url: urlData.publicUrl,
      filename: "presentation.pptx",
    });
  } catch (err) {
    console.error(`[${jobId}] Error:`, err);

    // Cleanup even on error
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    return res.status(500).json({
      success: false,
      error: err.message ?? "Unknown error",
    });
  }
});

// âââ Start ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PPTX Agent server running on port ${PORT}`);
  console.log(`  Model : ${process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5"}`);
  console.log(`  Bucket: ${BUCKET}`);
});
