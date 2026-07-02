/**
 * server.js - Async job architecture
 * POST /api/generate-pptx -> returns {jobId} immediately
 * GET  /api/status/:jobId  -> returns {status, url} when done
 */
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { generatePptx } = require("./agent");

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || "pptx-files";
const TMP_DIR = process.env.TMP_DIR || os.tmpdir();

// In-memory job store (1-hour TTL)
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of jobs.entries()) if (job.createdAt < cutoff) jobs.delete(id);
}, 600000);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// POST: queue job, return jobId immediately
app.post("/api/generate-pptx", (req, res) => {
  const { topic } = req.body ?? {};
  if (!topic || typeof topic !== "string") return res.status(400).json({ error: "topic required" });
  const jobId = uuidv4();
  jobs.set(jobId, { status: "processing", createdAt: Date.now() });
  console.log(`[${jobId}] Queued: "${topic}"`);
  res.json({ success: true, jobId, status: "processing" });
  runJob(jobId, topic).catch(err => console.error(`[${jobId}] Fatal:`, err));
});

// GET: poll job status
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

async function runJob(jobId, topic) {
  const workDir = path.join(TMP_DIR, "pptx-agent", jobId);
  const outputPath = path.join(workDir, "output.pptx");
  try {
    await generatePptx(topic, workDir, outputPath);
    const buf = fs.readFileSync(outputPath);
    const storagePath = `${jobId}/presentation.pptx`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    console.log(`[${jobId}] Done: ${data.publicUrl}`);
    jobs.set(jobId, { status: "done", url: data.publicUrl, filename: "presentation.pptx", createdAt: jobs.get(jobId).createdAt });
  } catch (err) {
    console.error(`[${jobId}] Error:`, err.message);
    jobs.set(jobId, { status: "error", error: err.message, createdAt: jobs.get(jobId)?.createdAt ?? Date.now() });
  } finally {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PPTX Agent server running on port ${PORT}`);
  console.log(`  Model : ${process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5"}`);
  console.log(`  Bucket: ${BUCKET}`);
});
