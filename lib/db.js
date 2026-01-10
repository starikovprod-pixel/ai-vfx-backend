import pg from "pg";

const { Pool } = pg;

function sanitizeNeonUrl(raw) {
  if (!raw) return raw;
  const u = new URL(raw);

  // Neon pooled ругается на эти startup options
  u.searchParams.delete("search_path");
  u.searchParams.delete("options");

  return u.toString();
}

export const pool = new Pool({
  connectionString: sanitizeNeonUrl(process.env.POSTGRES_URL),
  ssl: { rejectUnauthorized: false },
});
