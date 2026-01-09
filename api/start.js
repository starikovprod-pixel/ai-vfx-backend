import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload } from "../lib/bunny.js";

export const config = {
  api: { bodyParser: false },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function missingEnv(names) {
  const missing = names.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  return missing;
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // ---- ENV CHECK ----
  const missing = missingEnv([
    "REPLICATE_API_TOKEN",
    "BUNNY_STORAGE_ZONE",
    "BUNNY_STORAGE_API_KEY",
    "BUNNY_REGION",
  ]);

  if (missing.length) {
    return res.status(500).json({ error: "Missing env vars", missing });
  }

  try {
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "a cinematic scene");

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });

    const imageFile = files.image;
    if (!imageFile) return res.status(400).json({ error: "Image required" });

    // ---- upload image to Bunny ----
    const buffer = fs.readFileSync(imageFile.filepath);
    const remotePath = `inputs/${Date.now()}-${imageFile.originalFilename || "image.png"}`;

    const inputImageUrl = await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_API_KEY,
      region: process.env.BUNNY_REGION || "global",
      remotePath,
      buffer,
      contentType: imageFile.mimetype || "application/octet-stream",
    });

    // ---- Replicate run (как в примере на сайте) ----
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    const input = {
      ...(preset.input || {}),
      prompt: scene,
      // ВАЖНО: проверь в Schema, как называется поле:
      start_image: inputImageUrl,
      // если в Schema поле называется image -> замени на:
      // image: inputImageUrl,
    };

    const output = await replicate.run(preset.model, { input });

    return res.status(200).json({
      ok: true,
      presetId,
      model: preset.model,
      inputImageUrl,
      output,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.stack || err?.message || err),
    });
  }
}
