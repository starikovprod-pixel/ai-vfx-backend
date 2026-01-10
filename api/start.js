import { pool } from "../lib/db.js";
import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";

// Vercel / Next API config: allow multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL; // https://xxxx.supabase.co
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // anon public

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

function pickField(fields, name) {
  const v = fields?.[name];
  if (Array.isArray(v)) return v[0];
  return v;
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

async function getUserFromSupabase(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

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

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
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

    // ---- AUTH ----
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id; // uuid string
    const email = user.email || null;

    // ---- PARSE FORM ----
    const { fields, files } = await parseForm(req);

    const presetId = String(pickField(fields, "presetId") || "").trim();
    const scene = String(
      pickField(fields, "scene") || "a cinematic realistic shot, film-like contrast"
    ).trim();

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });

    const imageFile = pickFile(files.image);
    if (!imageFile) {
      return res.status(400).json({ error: "Image required (field name must be 'image')" });
    }

    const startImage = fileToDataUri(imageFile);

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene)
      .trim();

    const duration = Number(pickField(fields, "duration") || preset.duration || 5);
    const aspectRatio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "16:9");
    const generateAudio = normalizeBool(
      pickField(fields, "generate_audio") ?? preset.generate_audio
    );

    // ---- OPTIONAL CREDITS ----
    const enforceCredits = String(process.env.ENFORCE_CREDITS || "false").toLowerCase() === "true";
    const cost = Number(process.env.CREDITS_COST || 1);

    let remainingCredits = null;

    if (enforceCredits && cost > 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO user_balances (user_id, credits)
           VALUES ($1, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );

        const upd = await client.query(
          `UPDATE user_balances
           SET credits = credits - $2,
               updated_at = now()
           WHERE user_id = $1
             AND credits >= $2
           RETURNING credits`,
          [userId, cost]
        );

        if (upd.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(402).json({ error: "Not enough credits", cost });
        }

        remainingCredits = upd.rows[0].credits;
        await client.query("COMMIT");
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    }

    // ---- REPLICATE ----
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    const prediction = await replicate.predictions.create({
      model: preset.model, // e.g. "kwaivgi/kling-v2.6"
      input: {
        prompt,
        start_image: startImage,
        duration,
        aspect_ratio: aspectRatio,
        generate_audio: generateAudio,
      },
    });

    // ---- DB INSERT (user_id = supabase user.id) ----
    await pool.query(
      `
      INSERT INTO generations (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      user: { id: userId, email },
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
      credits: remainingCredits, // null если ENFORCE_CREDITS=false
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}

