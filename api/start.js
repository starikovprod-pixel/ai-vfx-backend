import { pool } from "../lib/db.js";
import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function parseForm(req) {
  const form = formidable({ multiples: false, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}
function pickFile(f){ return Array.isArray(f) ? f[0] : f; }
function fileToDataUri(file) {
  const filepath = file.filepath || file.path;
  const mime = file.mimetype || "application/octet-stream";
  const buf = fs.readFileSync(filepath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}
function normalizeBool(v){ return String(v || "false").toLowerCase() === "true"; }

async function getUserFromSupabase(accessToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase auth failed: ${r.status} ${txt}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    // 1) берем токен
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    // 2) валидируем токен через Supabase → получаем реальный user.id
    const user = await getUserFromSupabase(token);
    const userId = user.id;

    // 3) парсим форму
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "").trim();
    const scene = String(fields.scene || "a cinematic realistic shot, film-like contrast").trim();
    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });

    const imageFile = pickFile(files.image);
    if (!imageFile) return res.status(400).json({ error: "Image required (field name must be 'image')" });

    const startImage = fileToDataUri(imageFile);
    const prompt = (preset.promptTemplate || "{scene}").replaceAll("{scene}", scene).trim();

    const duration = Number(fields.duration || preset.duration || 5);
    const aspectRatio = String(fields.aspect_ratio || preset.aspect_ratio || "16:9");
    const generateAudio = normalizeBool(fields.generate_audio ?? preset.generate_audio);

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    const prediction = await replicate.predictions.create({
      model: preset.model,
      input: {
        prompt,
        start_image: startImage,
        duration,
        aspect_ratio: aspectRatio,
        generate_audio: generateAudio,
      },
    });

    // 4) сохраняем в БД строго по userId из Supabase
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
      userId,
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error", details: String(err?.message || err) });
  }
}
