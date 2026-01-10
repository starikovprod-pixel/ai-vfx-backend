import { pool } from "../lib/db.js";

const SUPABASE_URL = process.env.SUPABASE_URL; // https://xxxx.supabase.co
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // anon public

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(400).json({ error: "Missing env vars", missing: ["SUPABASE_URL", "SUPABASE_ANON_KEY"] });
    }

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    // баланс
    const bal = await pool.query(
      `SELECT credits FROM user_balances WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const credits = bal.rows[0]?.credits ?? 0;

    // последние генерации (подгони поля под свою таблицу)
    const gens = await pool.query(
      `
      SELECT id, status, output_url, created_at
      FROM generations
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 24
      `,
      [userId]
    );

    return res.status(200).json({
      ok: true,
      user: { id: userId, email },
      credits,
      generations: gens.rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
