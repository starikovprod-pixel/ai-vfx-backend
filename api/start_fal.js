// api/start_fal.js
import { pool } from "../lib/db.js";
import { createClient } from "@supabase/supabase-js";
import { PRESETS } from "../lib/presets.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "No token" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: user, error } =
      await supabase.auth.getUser(token);
    if (error) throw error;

    const {
      presetId,
      scene,
      video_storage_path
    } = req.body;

    const preset = PRESETS[presetId];
    if (!preset || preset.provider !== "fal") {
      return res.status(400).json({ error: "Invalid preset" });
    }

    const video_url =
      `${SUPABASE_URL}/storage/v1/object/public/inputs_video/${video_storage_path}`;

    const falResp = await fetch(
      `https://fal.run/${preset.model}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${process.env.FAL_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: scene,
          video_url,
          keep_original_sound: true
        })
      }
    );

    const falJson = await falResp.json();
    if (!falResp.ok) {
      return res.status(400).json({
        error: "fal failed",
        details: falJson
      });
    }

    const jobId = falJson.request_id;

    await pool.query(
      `insert into generations
       (user_id, preset_id, replicate_prediction_id, status)
       values ($1,$2,$3,'starting')`,
      [user.id, presetId, jobId]
    );

    res.json({ ok: true, jobId });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: "Internal error",
      details: String(e.message)
    });
  }
}
