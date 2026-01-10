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
    const regBalances = await pool.query(`select to_regclass('public.user_balances') as t`);
    const hasBalancesTable = !!regBalances.rows?.[0]?.t;

    // ---- DIAG: есть ли таблица user_profiles ----
    const regProfiles = await pool.query(`select to_regclass('public.user_profiles') as t`);
    const hasProfilesTable = !!regProfiles.rows?.[0]?.t;

    // ---- credits: НИКОГДА не падаем ----
    let credits = 0;
    if (hasBalancesTable) {
      const bal = await pool.query(
        `select credits from public.user_balances where user_id = $1 limit 1`,
        [userId]
      );
      credits = bal.rows[0]?.credits ?? 0;
    }

    // ---- has_password: по флажку в user_profiles ----
    let has_password = false;
    if (hasProfilesTable) {
      // ensure row exists
      await pool.query(
        `insert into public.user_profiles (user_id)
         values ($1)
         on conflict (user_id) do nothing`,
        [userId]
      );

      const p = await pool.query(
        `select has_password from public.user_profiles where user_id = $1 limit 1`,
        [userId]
      );
      has_password = !!p.rows?.[0]?.has_password;
    } else {
      // если таблицы ещё нет — просто считаем, что пароля нет
      has_password = false;
    }

    // ---- generations: тоже не падаем ----
    let generations = [];
    try {
      const gens = await pool.query(
        `
        SELECT
          id,
          status,
          COALESCE(output_url, output_video_url) AS output_url,
          created_at
        FROM public.generations
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 24
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
      has_password,
      generations,
      debug: {
        db: diag.rows?.[0] || null,
        hasBalancesTable,
        hasProfilesTable,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}

