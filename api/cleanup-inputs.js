import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// bucket + TTL
const BUCKET = "inputs";
const TTL_HOURS = 72;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(400).json({
        error: "Missing env vars",
        missing: [
          !SUPABASE_URL ? "SUPABASE_URL" : null,
          !SERVICE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
        ].filter(Boolean),
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // cut-off time
    const cutoff = new Date(Date.now() - TTL_HOURS * 3600 * 1000);

    // list objects (Supabase storage doesn't support "list all recursively" in one call,
    // so мы чистим по папкам user_id (у тебя так и пишется).
    // Здесь простой вариант: пробуем пройти top-level folders через list("").
    const { data: top, error: topErr } = await supabase.storage.from(BUCKET).list("", {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

    if (topErr) throw topErr;

    const toRemove = [];

    for (const item of top || []) {
      // item.name может быть папкой (user_id) или файлом
      // если это папка — листаем её
      const folder = item.name;

      // list folder content
      const { data: files, error: filesErr } = await supabase.storage.from(BUCKET).list(folder, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });

      if (filesErr) {
        // если это не папка (а файл), попробуем обработать как файл
        // Но supabase list обычно возвращает только объекты в папке, так что пропускаем аккуратно
        continue;
      }

      for (const f of files || []) {
        // f может быть и под-папкой — игнорируем
        if (!f.name) continue;

        // у supabase storage list возвращает updated_at / created_at в зависимости от версии
        const dtStr = f.updated_at || f.created_at || f.last_modified || null;
        if (!dtStr) continue;

        const dt = new Date(dtStr);
        if (Number.isNaN(dt.getTime())) continue;

        if (dt < cutoff) {
          toRemove.push(`${folder}/${f.name}`);
        }
      }
    }

    if (toRemove.length === 0) {
      return res.status(200).json({ ok: true, removed: 0, ttl_hours: TTL_HOURS });
    }

    // Supabase remove лимитирует размер пачки — удаляем чанками
    let removed = 0;
    const CHUNK = 200;

    for (let i = 0; i < toRemove.length; i += CHUNK) {
      const batch = toRemove.slice(i, i + CHUNK);
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(batch);
      if (delErr) throw delErr;
      removed += batch.length;
    }

    return res.status(200).json({
      ok: true,
      removed,
      ttl_hours: TTL_HOURS,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
