import fs from "fs";
import formidable from "formidable";
import { pool } from "../lib/db.js";
import { PRESETS } from "../lib/presets.js";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
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

function parseForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 200 * 1024 * 1024, // 200MB
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

function pickFile(files, name) {
  const f = files?.[name];
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

function normalizeBool(v) {
  return String(v ?? "false").toLowerCase() === "true";
}

// ✅ Upload to Supabase Storage via REST (service_role)
async function uploadVideoToSupabase({ userId, file }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const buf = fs.readFileSync(file.filepath || file.path);

  const path = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`;

  // Storage REST API:
  // POST /storage/v1/object/<bucket>/<path>
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/inputs_video/${encodeURIComponent(path)}`;

  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "video/mp4",
      "x-upsert": "false",
    },
    body: buf,
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Supabase storage upload failed: ${r.status} ${text}`);
  }

  // public URL (bucket должен быть PUBLIC)
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/inputs_video/${encodeURIComponent(path)}`;
  return publicUrl;
}

async function falRequest(modelPath, payload) {
  const url = `https://fal.run/${modelPath}`;

  let r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (r.status === 401 || r.status === 403) {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) {}
  return { ok: r.ok, status: r.status, json, text };
}

export default async function handler(req, res) {
  // ✅ CORS (ставим сразу)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!process.env.FAL_KEY) missing.push("FAL_KEY");
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

const token = getBearerToken(req)

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    const { fields, files } = await parseForm(req);

    const presetId = String(pickField(fields, "presetId") || "").trim();
    const scene = String(pickField(fields, "scene") || "").trim();
    const keep_original_sound = normalizeBool(pickField(fields, "keep_original_sound") ?? true);

    if (!presetId) return res.status(400).json({ error: "presetId required" });

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });
    if (preset.provider !== "fal") return res.status(400).json({ error: "Preset is not fal", presetId });

    const videoFile = pickFile(files, "video");
    if (!videoFile) return res.status(400).json({ error: "MP4 required (field name: video)" });

    if (String(videoFile.mimetype || "") !== "video/mp4") {
      return res.status(400).json({ error: "Only MP4 supported", mimetype: videoFile.mimetype });
    }

    // ✅ upload mp4 via service_role (не зависит от policy на клиенте)
    const video_url = await uploadVideoToSupabase({ userId, file: videoFile });

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene || "edit the video")
      .trim();

    const fal = await falRequest(preset.model, { prompt, video_url, keep_original_sound });

    if (!fal.ok) {
      return res.status(400).json({
        error: "fal request failed",
        status: fal.status,
        details: fal.json && Object.keys(fal.json).length ? fal.json : fal.text,
        video_url,
      });
    }

    const j = fal.json || {};
    const requestId = j.request_id || j.id || null;
    if (!requestId) return res.status(400).json({ error: "fal: missing request_id", details: j });

    // ✅ пишем в БД только после успешного fal
    await pool.query(
      `
      insert into public.generations
        (user_id, preset_id, replicate_prediction_id, model, prompt, status)
      values
        ($1, $2, $3, $4, $5, $6)
      `,
      [userId, presetId, requestId, preset.model, prompt, "starting"]
    );

    return res.status(200).json({
      ok: true,
      user: { id: userId, email },
      jobId: requestId,
      status: "starting",
      provider: "fal",
      presetId,
      video_url,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
