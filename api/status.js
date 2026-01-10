import Replicate from "replicate";
import { pool } from "../lib/db.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

function pickOutputUrl(prediction) {
  const out = prediction?.output;

  // Часто output — это URL строкой
  if (typeof out === "string") return out;

  // Иногда — массив URL
  if (Array.isArray(out) && out.length) {
    const first = out.find((x) => typeof x === "string") || out[0];
    return typeof first === "string" ? first : null;
  }

  // Иногда — объект (на всякий случай)
  if (out && typeof out === "object") {
    if (typeof out.url === "string") return out.url;
    if (typeof out.mp4 === "string") return out.mp4;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    const jobId = String(req.query.jobId || "").trim();
    if (!jobId) return res.status(400).json({ error: "Missing jobId" });

    // AUTH
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;

    // ownership check
    const own = await pool.query(
      `SELECT id FROM generations WHERE user_id = $1 AND replicate_prediction_id = $2 LIMIT 1`,
      [userId, jobId]
    );
    if (own.rowCount === 0) return res.status(404).json({ error: "Job not found" });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const prediction = await replicate.predictions.get(jobId);

    const outputUrl = pickOutputUrl(prediction);

    await pool.query(
  `
  UPDATE generations
  SET status = $1,
      output_url = COALESCE($2, output_url),
      output_video_url = COALESCE($2, output_video_url)
  WHERE replicate_prediction_id = $3
  `,
  [prediction.status, outputUrl, jobId]
);


    return res.status(200).json({
      ok: true,
      jobId,
      status: prediction.status,
      output_url: outputUrl,
      prediction,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
