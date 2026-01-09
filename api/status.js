import Replicate from "replicate";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.REPLICATE_API_TOKEN || "";
  console.log("STATUS: HAS TOKEN?", !!token, "PREFIX:", token ? token.slice(0, 6) : "none");

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(400).json({ error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
  }

  try {
    let jobId = String(req.query.jobId || "").trim();

    // защита от кавычек (часто прилетает из копипаста)
    jobId = jobId.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

    if (!jobId) return res.status(400).json({ error: "jobId required" });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    // стандартный путь
    const prediction = await replicate.predictions.get(jobId);

    return res.status(200).json({
      ok: true,
      id: prediction.id,
      status: prediction.status,
      output: prediction.output ?? null,
      error: prediction.error ?? null,
      logs: prediction.logs ?? null,
    });
  } catch (err) {
    console.error("STATUS ERROR:", err);

    return res.status(500).json({
      error: "Failed to fetch status",
      details: String(err?.message || err),
    });
  }
}
