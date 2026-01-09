import { pool } from "../lib/db.js";
import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import crypto from "crypto";

// Vercel / Next API config: allow multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

function parseForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function pickFile(f) {
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

function fileToDataUri(file) {
  const filepath = file.filepath || file.path;
  const mime = file.mimetype || "application/octet-stream";
  const buf = fs.readFileSync(filepath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function normalizeBool(v) {
  return String(v || "false").toLowerCase() === "true";
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  // добавил X-User-Id на будущее (если решишь слать из фронта)
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (missing.length)
      return res.status(400).json({ error: "Missing env vars", missing });

    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "").trim();
    const scene = String(
      fields.scene || "a cinematic realistic shot, film-like contrast"
    ).trim();

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });

    const imageFile = pickFile(files.image);
    if (!imageFile) {
      return res
        .status(400)
        .json({ error: "Image required (field name must be 'image')" });
    }

    // --- user_id (НЕ NULL) ---
    // 1) если фронт прислал fields.user_id — используем
    // 2) иначе генерим на сервере (красиво и стабильно для БД)
    const userIdFromForm = String(fields.user_id || "").trim();
    const userIdFromHeader = String(req.headers["x-user-id"] || "").trim();
    const userId = userIdFromForm || userIdFromHeader || crypto.randomUUID();

    const startImage = fileToDataUri(imageFile);

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene)
      .trim();

    const duration = Number(fields.duration || preset.duration || 5);
    const aspectRatio = String(fields.aspect_ratio || preset.aspect_ratio || "16:9");
    const generateAudio = normalizeBool(fields.generate_audio ?? preset.generate_audio);

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    const prediction = await replicate.predictions.create({
      model: preset.model, // "kwaivgi/kling-v2.6"
      input: {
        prompt,
        start_image: startImage,
        duration,
        aspect_ratio: aspectRatio,
        generate_audio: generateAudio,
      },
    });

    // ✅ СОХРАНЯЕМ В БАЗУ (generations)
    // ВАЖНО: колонка в БД у тебя называется generate_audio (а не has_audio)
    await pool.query(
      `
      insert into generations (
        user_id,
        preset_id,
        replicate_prediction_id,
        model,
        prompt,
        status,
        duration,
        aspect_ratio,
        generate_audio
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        userId,
        presetId,
        prediction.id,
        preset.model,
        prompt,
        prediction.status,
        duration,
        aspectRatio,
        generateAudio,
      ]
    );

    return res.status(200).json({
      ok: true,
      userId, // 👈 вернём, чтобы фронт мог сохранить и слать дальше
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}

