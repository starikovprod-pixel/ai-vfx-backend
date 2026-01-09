import Replicate from "replicate";

export default async function handler(req, res) {
  try {
    const jobId = String(req.query.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ error: "jobId required" });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({
        error: "Missing env vars",
        missing: ["REPLICATE_API_TOKEN"],
      });
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

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
    console.error(err);
    return res.status(500).json({
      error: "Failed to fetch status",
      details: String(err?.message || err),
    });
  }
}
