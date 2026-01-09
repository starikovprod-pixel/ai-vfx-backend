import Replicate from "replicate";
import {
  bunnyExists,
  bunnyUpload,
  bunnyPublicUrl
} from "../lib/bunny.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const jobId = req.query.jobId;
  if (!jobId) {
    return res.status(400).json({ error: "jobId required" });
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN
  });

  const prediction = await replicate.predictions.get(jobId);

  if (prediction.status !== "succeeded") {
    return res.json({ status: prediction.status });
  }

  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output.at(-1)
    : prediction.output;

  if (!outputUrl) {
    return res.status(500).json({ error: "No output URL" });
  }

  const remotePath = `outputs/${jobId}.mp4`;
  const publicUrl = bunnyPublicUrl(
    process.env.BUNNY_PULL_ZONE_URL,
    remotePath
  );

  const exists = await bunnyExists(
    process.env.BUNNY_PULL_ZONE_URL,
    remotePath
  );

  if (!exists) {
    const videoRes = await fetch(outputUrl);
    const buffer = Buffer.from(await videoRes.arrayBuffer());

    await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_PASSWORD,
      region: process.env.BUNNY_REGION || "global",
      remotePath,
      buffer,
      contentType: "video/mp4"
    });
  }

  return res.json({
    status: "succeeded",
    url: publicUrl
  });
}
