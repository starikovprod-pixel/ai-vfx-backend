import { pool } from "../lib/db.js";
import Replicate from "replicate";

function pickOutputUrl(output) {
  if (!output) return null;

  if (typeof output === "string") return output;

  if (Array.isArray(output)) {
    const first = output.find((x) => typeof x === "string") || null;
    return first;
  }

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

    // 1) актуальный статус из Replicate
    const prediction = await replicate.predictions.get(jobId);

    const outputUrl = pickOutputUrl(prediction.output);
    const errText = prediction.error ? String(prediction.error) : null;

    // 2) пишем в БД (ВАЖНО: у тебя колонка называется output_video_url)
    await pool.query(
      `
      insert into generations (replicate_prediction_id, status, output_video_url, error)
      values ($1, $2, $3, $4)
      on conflict (replicate_prediction_id)
      do update set
        status = excluded.status,
        output_video_url = coalesce(excluded.output_video_url, generations.output_video_url),
        error = excluded.error
      `,
      [jobId, prediction.status, outputUrl, errText]
    );

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
