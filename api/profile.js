import { pool } from "../lib/db.js";

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;

    // Ensure row exists
    await pool.query(
      `insert into public.user_profiles (user_id)
       values ($1)
       on conflict (user_id) do nothing`,
      [userId]
    );

    if (req.method === "GET") {
      const p = await pool.query(
        `select has_password from public.user_profiles where user_id = $1 limit 1`,
        [userId]
      );
      return res.status(200).json({ ok: true, user_id: userId, has_password: !!p.rows[0]?.has_password });
    }

    // POST: set has_password=true (мы делаем это после успешного updateUser(password))
    const body = req.body || {};
    const hasPassword = body?.has_password === true;

    if (!hasPassword) {
      return res.status(400).json({ error: "Only has_password=true is allowed" });
    }

    await pool.query(
      `update public.user_profiles
       set has_password = true, updated_at = now()
       where user_id = $1`,
      [userId]
    );

    return res.status(200).json({ ok: true, user_id: userId, has_password: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
