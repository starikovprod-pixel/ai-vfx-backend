import Replicate from "replicate";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jobId } = req.query;
  if (!jobId) {
    return res.status(400).json({ error: "jobId required" });
  }

  try {
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const prediction = await replicate.predictions.get(jobId);

    return res.status(200).json({
      ok: true,
      id: prediction.id,
      status: prediction.status, // starting | processing | succeeded | failed
      output: prediction.output || null,
      error: prediction.error || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Failed to fetch status",
      details: String(err?.message || err),
    });
  }
}
