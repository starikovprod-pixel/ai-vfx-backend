import { pool } from "../lib/db.js";
import Replicate from "replicate";

function pickOutputUrl(output) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.find((x) => typeof x === "string") || null;
  if (typeof output === "object") {
    if (typeof output.video === "string") return output.video;
    if (typeof output.url === "string") return output.url;
  }
  return null;
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    const jobId = String(req.query.jobId || "").trim();
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const prediction = await replicate.predictions.get(jobId);

    const outputUrl = pickOutputUrl(prediction.output);
    const errText = prediction.error ? String(prediction.error) : null;

    // ✅ ТОЛЬКО UPDATE (никаких INSERT)
    const r = await pool.query(
      `
      UPDATE generations
      SET
        status = $2,
        output_video_url = COALESCE($3, output_video_url),
        error = $4
      WHERE replicate_prediction_id = $1
      RETURNING id
      `,
      [jobId, prediction.status, outputUrl, errText]
    );

    if (r.rowCount === 0) {
      // Если строки нет — это проблема старта (или база другая)
      return res.status(404).json({
        ok: false,
        error: "Generation not found in DB for this jobId. Start endpoint probably didn't insert it.",
        jobId,
        status: prediction.status,
        output: outputUrl,
      });
    }

    return res.status(200).json({
      ok: true,
      jobId,
      status: prediction.status,
      output: outputUrl,
      error: errText,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}

