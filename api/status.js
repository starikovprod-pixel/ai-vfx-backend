import { pool } from "../lib/db.js";
import Replicate from "replicate";

function pickOutputUrl(output) {
  // Replicate иногда отдаёт output как строку, иногда как массив ссылок, иногда как объект.
  if (!output) return null;

  if (typeof output === "string") return output;

  if (Array.isArray(output)) {
    // чаще всего Kling отдаёт массив, где [0] = mp4 url
    const first = output.find((x) => typeof x === "string") || null;
    return first;
  }

  if (typeof output === "object") {
    // на всякий случай, если будет { video: "..."} или { url: "..." }
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

    // получаем актуальный статус из Replicate
    const prediction = await replicate.predictions.get(jobId);

    const outputUrl = pickOutputUrl(prediction.output);
    const errText =
      prediction.error ? String(prediction.error) : null;

    // ✅ сохраняем/обновляем запись в БД
    // Важно: у тебя уже есть unique index по replicate_prediction_id
    await pool.query(
      `
      insert into generations (replicate_prediction_id, status, output_url, error)
      values ($1, $2, $3, $4)
      on conflict (replicate_prediction_id)
      do update set
        status = excluded.status,
        output_url = coalesce(excluded.output_url, generations.output_url),
        error = excluded.error,
        updated_at = now()
      `,
      [jobId, prediction.status, outputUrl, errText]
    );

    return res.status(200).json({
      ok: true,
      jobId,
      status: prediction.status,
      output: outputUrl,      // <-- вот это покажем на фронте как "скачать"
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
