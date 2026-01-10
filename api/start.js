import { pool } from "../lib/db.js";
import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";

// Vercel / Next API config: allow multipart
export const config = {
  api: { bodyParser: false },
};

// ===== Supabase token -> user =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function getUserFromBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { user: null, error: "NO_BEARER_TOKEN" };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { user: null, error: "SUPABASE_ENV_MISSING" };
  }

  const token = m[1].trim();
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return { user: null, error: `SUPABASE_AUTH_FAILED:${r.status}:${txt}` };
  }

  const user = await r.json(); // { id, email, ... }
  return { user, error: null, token };
}

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
  // ВАЖНО: добавили Authorization
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!process.env.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length)
      return res.status(400).json({ error: "Missing env vars", missing });

    // ✅ 1) AUTH: получаем юзера из Bearer токена
    const { user, error: authError } = await getUserFromBearer(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: authError });
    }

    const userId = user.id;          // <-- главный правильный user_id
    const email = user.email || null;

    // ✅ 2) multipart form
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "").trim();
    const scene = String(
      fields.scene || "a cinematic realistic shot, film-like contrast"
    ).trim();

    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({ error: "Unknown preset", presetId });
    }

    const imageFile = pickFile(files.image);
    if (!imageFile) {
      return res
        .status(400)
        .json({ error: "Image required (field name must be 'image')" });
    }

    const startImage = fileToDataUri(imageFile);

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene)
      .trim();

    if (!prompt) {
      return res.status(400).json({ error: "Prompt required" });
    }

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

    // ✅ 3) SAVE to DB, ПРИВЯЗАНО К user.id
    await pool.query(
      `
      insert into generations (
        user_id,
        email,
        preset_id,
        replicate_prediction_id,
        model,
        prompt,
        status,
        duration,
        aspect_ratio,
        generate_audio
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        userId,
        email,
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
      user: { id: userId, email },
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
