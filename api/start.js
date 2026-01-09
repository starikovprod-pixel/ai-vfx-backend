console.log("START TOKEN PREFIX:", (process.env.REPLICATE_API_TOKEN || "").slice(0, 6));

import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";

// Vercel / Next API config: allow multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

// helper: parse multipart form
function parseForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

// helper: normalize formidable file (can be array in some cases)
function pickFile(f) {
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

// helper: build data URI from uploaded file
function fileToDataUri(file) {
  const filepath = file.filepath || file.path; // compatibility
  const mime = file.mimetype || "application/octet-stream";
  const buf = fs.readFileSync(filepath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ---- env ----
    const missing = [];
    if (!process.env.REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
    if (missing.length) {
      return res.status(400).json({ error: "Missing env vars", missing });
    }

    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "").trim();
    const scene = String(fields.scene || "a cinematic realistic shot, film-like contrast").trim();

    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({ error: "Unknown preset", presetId });
    }

    const imageFile = pickFile(files.image);
    if (!imageFile) {
      return res.status(400).json({ error: "Image required (field name must be 'image')" });
    }

    // ---- build input for Kling ----
    // we pass image as data URI to avoid any storage dependency
    const startImage = fileToDataUri(imageFile);

    // prompt template support
    const prompt =
      (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene)
        .trim();

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // ---- IMPORTANT PART: use model, not version ----
    // This returns a Prediction with id -> you can poll /status endpoint
    const prediction = await replicate.predictions.create({
      model: preset.model, // e.g. "kwaivgi/kling-v2.6"
      input: {
        prompt,
        start_image: startImage,
        // defaults (you can override later by passing fields.* if you want)
        duration: Number(fields.duration || preset.duration || 5),
        aspect_ratio: String(fields.aspect_ratio || preset.aspect_ratio || "16:9"),
        generate_audio: String(fields.generate_audio || preset.generate_audio || "false") === "true",
      },
    });

    return res.status(200).json({
      ok: true,
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}
