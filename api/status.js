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

    // 1) Сначала проверяем: есть ли такая генерация в БД
    const exists = await pool.query(
      `select id from generations where replicate_prediction_id = $1 limit 1`,
      [jobId]
    );

    if (exists.rowCount === 0) {
      // НЕ СОЗДАЁМ новую строку — иначе опять NOT NULL ад
      return res.status(404).json({
        ok: false,
        error: "Unknown jobId in DB. Start endpoint must create row first.",
        jobId,
      });
    }

    // 2) Запрашиваем статус из Replicate
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const prediction = await replicate.predictions.get(jobId);

    const outputUrl = pickOutputUrl(prediction.output);
    const errText = prediction.error ? String(prediction.error) : null;

    // 3) Только обновляем
    await pool.query(
      `
      update generations
      set
        status = $2,
        output_url = coalesce($3, output_url),
        error = $4
      where replicate_prediction_id = $1
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

