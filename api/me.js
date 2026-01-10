import { pool } from "../lib/db.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
      return res.status(400).json({
        error: "Missing env vars",
        missing: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
      });
    }

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    // ---- DIAG: где мы реально в БД ----
    const diag = await pool.query(`
      select
        current_database() as db,
        current_schema() as schema,
        current_user as db_user
    `);

    // ---- DIAG: есть ли таблица user_balances ----
    const reg = await pool.query(`select to_regclass('public.user_balances') as t`);
    const hasBalancesTable = !!reg.rows?.[0]?.t;

    // ---- credits: НИКОГДА не падаем ----
    let credits = 0;
    if (hasBalancesTable) {
      const bal = await pool.query(
        `select credits from public.user_balances where user_id = $1 limit 1`,
        [userId]
      );
      credits = bal.rows[0]?.credits ?? 0;
    }

    // ---- generations: тоже не падаем ----
    let generations = [];
    try {
      const gens = await pool.query(
        `
        select id, status, output_url, created_at
        from generations
        where user_id = $1
        order by created_at desc
        limit 24
        `,
        [userId]
      );
      generations = gens.rows;
    } catch (e) {
      generations = [];
    }

    return res.status(200).json({
      ok: true,
      user: { id: userId, email },
      credits,
      generations,
      debug: {
        db: diag.rows?.[0] || null,
        hasBalancesTable,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
