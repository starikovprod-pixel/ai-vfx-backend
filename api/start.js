import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload } from "../lib/bunny.js";

export const config = {
  api: { bodyParser: false },
};

// helper for formidable
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
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // DEBUG (safe)
  const token = process.env.REPLICATE_API_TOKEN || "";
  console.log("START: HAS TOKEN?", !!token, "PREFIX:", token ? token.slice(0, 6) : "none");

  // env check (optional but helpful)
  const missing = [];
  if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
  if (!process.env.BUNNY_STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!process.env.BUNNY_STORAGE_API_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (!process.env.BUNNY_REGION) missing.push("BUNNY_REGION");
  if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

  try {
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "").trim();
    const scene = String(fields.scene || "").trim();

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset" });

    const imageFile = files.image;
    if (!imageFile) return res.status(400).json({ error: "Image required (field name: image)" });

    // upload image to Bunny -> URL
    const inputImageUrl = await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_API_KEY,
      region: process.env.BUNNY_REGION || "global",
      remotePath: `inputs/${Date.now()}-${imageFile.originalFilename || "image"}`,
      buffer: fs.readFileSync(imageFile.filepath),
      contentType: imageFile.mimetype || "image/png",
    });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    // IMPORTANT:
    // Replicate требует model ИЛИ version.
    // Для kwaivgi/kling-v2.6 норм использовать model.
    const prediction = await replicate.predictions.create({
      model: preset.model, // например "kwaivgi/kling-v2.6"
      // version: preset.version, // если когда-то понадобится — можно добавить
      input: {
        ...(preset.input || {}),
        prompt: preset.promptTemplate
          ? preset.promptTemplate.replace("{scene}", scene || "")
          : scene,
        // Kling использует start_image (как на странице модели)
        start_image: inputImageUrl,
        // если у модели другое имя поля (image/start_image) — поправим в preset
      },
    });

    return res.status(200).json({
      ok: true,
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
      replicateGetUrl: prediction?.urls?.get || null,   // супер важно для дебага
      replicateCancelUrl: prediction?.urls?.cancel || null,
    });
  } catch (err) {
    console.error("START ERROR:", err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}
