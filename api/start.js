import { pool } from "../lib/db.js";
import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";

export const config = {
  api: { bodyParser: false },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

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

function parseForm(req) {
  const form = formidable({
    multiples: true,         // ✅ важно: Nano может принимать несколько картинок
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function pickField(fields, name) {
  const v = fields?.[name];
  return Array.isArray(v) ? v[0] : v;
}

function pickFiles(files, name) {
  const f = files?.[name];
  if (!f) return [];
  return Array.isArray(f) ? f : [f];
}

function fileToDataUri(file) {
  const filepath = file.filepath || file.path;
  const mime = file.mimetype || "application/octet-stream";
  const buf = fs.readFileSync(filepath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function normalizeBool(v) {
  return String(v ?? "false").toLowerCase() === "true";
}

export default async function handler(req, res) {
  // CORS
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

    // AUTH
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });
    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    // form
    const { fields, files } = await parseForm(req);

    const presetId = String(pickField(fields, "presetId") || "").trim();
    const scene = String(pickField(fields, "scene") || "").trim();

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    // -------------------------
    // ✅ KLING (image required)
    // -------------------------
    if (preset.provider === "kling") {
      const imageFile = pickFiles(files, "image")[0];
      if (!imageFile) {
        return res.status(400).json({ error: "Image required (field name must be 'image')" });
      }

      const startImage = fileToDataUri(imageFile);
      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "a cinematic realistic shot, film-like contrast")
        .trim();

      const duration = Number(pickField(fields, "duration") || preset.duration || 5);
      const aspectRatio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "16:9");
      const generateAudio = normalizeBool(pickField(fields, "generate_audio") ?? preset.generate_audio);

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

      await pool.query(
        `
        insert into public.generations
          (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration, aspect_ratio, generate_audio)
        values
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [userId, presetId, prediction.id, preset.model, prompt, prediction.status, duration, aspectRatio, generateAudio]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
      });
    }

    // -----------------------------------------
    // ✅ NANO BANANA PRO (image optional, multi)
    // -----------------------------------------
    if (preset.provider === "nano") {
      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "high quality, detailed")
        .trim();

      // Nano: принимает image_input[] (можно пусто)
      const imageFiles = pickFiles(files, "image_input"); // ✅ поле назовём image_input на фронте
      const image_input = imageFiles.slice(0, 14).map(fileToDataUri);

      const aspect_ratio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "match_input_image");
      const resolution = String(pickField(fields, "resolution") || preset.resolution || "2K");
      const output_format = String(pickField(fields, "output_format") || preset.output_format || "png");
      const safety_filter_level = String(
        pickField(fields, "safety_filter_level") || preset.safety_filter_level || "block_only_high"
      );

      const prediction = await replicate.predictions.create({
        model: preset.model, // "google/nano-banana-pro"
        input: {
          prompt,
          image_input, // может быть []
          aspect_ratio,
          resolution,
          output_format,
          safety_filter_level,
        },
      });

      await pool.query(
        `
        insert into public.generations
          (user_id, preset_id, replicate_prediction_id, model, prompt, status, aspect_ratio)
        values
          ($1, $2, $3, $4, $5, $6, $7)
        `,
        [userId, presetId, prediction.id, preset.model, prompt, prediction.status, aspect_ratio]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
      });
    }

    return res.status(400).json({ error: "Unsupported provider", provider: preset.provider });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
