import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload } from "../lib/bunny.js";

export const config = {
  api: { bodyParser: false },
};

// helper для formidable
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
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
    // --- env check (чтобы сразу было понятно, чего не хватает) ---
    const requiredEnv = [
      "BUNNY_STORAGE_ZONE",
      "BUNNY_STORAGE_API_KEY",
      "REPLICATE_API_TOKEN",
    ];
    const missing = requiredEnv.filter((k) => !process.env[k]);
    if (missing.length) {
      return res.status(500).json({
        error: "Missing env vars",
        missing,
      });
    }

    const { fields, files } = await parseForm(req);

    // поля из form-data
    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "a cinematic scene");

    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({
        error: "Unknown preset",
        got: presetId,
        allowed: Object.keys(PRESETS),
      });
    }

    // файл
    let imageFile = files.image;
    if (Array.isArray(imageFile)) imageFile = imageFile[0];

    if (!imageFile || !imageFile.filepath) {
      return res.status(400).json({ error: "Image required" });
    }

    // upload image to Bunny (ВАЖНО: bunnyUpload ждёт ОБЪЕКТ)
    const remoteName = imageFile.originalFilename || "input.png";
    const remotePath = `inputs/${Date.now()}-${remoteName}`;

    const inputImageUrl = await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_API_KEY,
      region: process.env.BUNNY_REGION || "global",
      remotePath,
      buffer: fs.readFileSync(imageFile.filepath),
      contentType: imageFile.mimetype || "image/png",
    });

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // создаём prediction
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
      inputImageUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.stack || err),
    });
  }
}

