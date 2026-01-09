import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload, bunnyPublicUrl } from "../lib/bunny.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

// helper для formidable
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "a cinematic scene");
    const preset = PRESETS[presetId];

    if (!preset) {
      return res.status(400).json({ error: "Unknown preset" });
    }

    const imageFile = files.image;
    if (!imageFile) {
      return res.status(400).json({ error: "Image required" });
    }

    // upload image to bunny
    const inputImageUrl = await bunnyUpload(
      imageFile.filepath,
      `inputs/${Date.now()}-${imageFile.originalFilename}`
    );

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const prediction = await replicate.predictions.create({
      version: preset.version,
      input: {
        ...preset.input,
        image: inputImageUrl,
        prompt: scene,
      },
    });

    return res.status(200).json({
      ok: true,
      jobId: prediction.id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err),
    });
  }
}
