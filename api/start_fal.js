import { pool } from "../lib/db.js";
import { PRESETS } from "../lib/presets.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function getUserFromSupabase(accessToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase auth failed: ${r.status} ${txt}`);
  }
  return r.json();
}

export default async function handler(req, res) {
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
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });
    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const presetId = String(body.presetId || "").trim();
    const scene = String(body.scene || "").trim();
    const video_url = String(body.video_url || "").trim();
    const keep_original_sound = String(body.keep_original_sound ?? "true").toLowerCase() === "true";

    if (!presetId) return res.status(400).json({ error: "presetId required" });
    if (!video_url) return res.status(400).json({ error: "video_url required" });

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });
    if (preset.provider !== "fal") return res.status(400).json({ error: "Preset is not fal", presetId });

    const prompt = (preset.promptTemplate || "{scene}").replaceAll("{scene}", scene || "edit the video").trim();

    // fal call
    const r = await fetch(`https://fal.run/${preset.model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, video_url, keep_original_sound }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(400).json({ error: "fal request failed", details: j });
    }

    const requestId = j.request_id || j.id || null;
    if (!requestId) return res.status(400).json({ error: "fal: missing request_id", details: j });

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
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
