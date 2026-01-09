import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload } from "../lib/bunny.js";

export const config = {
  api: {
    bodyParser: false,
  },
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

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { fields, files } = await parseForm(req);

    // ВАЖНО: ключ именно presetId (как ты и отправляешь)
    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "a cinematic scene");

    const preset = PRESETS?.[presetId];

    if (!preset) {
      return res.status(400).json({
        error: "Unknown preset",
        presetId,
        available: Object.keys(PRESETS || {}),
      });
    }

    // Replicate требует EITHER version OR model
    const version = preset.version ? String(preset.version) : "";
    const model = preset.model ? String(preset.model) : "";

    if (!version && !model) {
      return res.status(500).json({
        error: "Preset misconfigured: missing `version` or `model`",
        presetId,
        presetKeys: Object.keys(preset || {}),
        hint:
          "Open lib/presets.js and add `version: \"...\"` (or `model: \"owner/model\"`) for this preset.",
      });
    }

    const imageFile = files?.image;
    if (!imageFile) {
      return res.status(400).json({ error: "Image required" });
    }

    // upload image to BunnyCDN (в твоём текущем стиле — URL возвращается из bunnyUpload)
    const inputImageUrl = await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_API_KEY,
      region: process.env.BUNNY_REGION || "global",
      remotePath: `inputs/${Date.now()}-${imageFile.originalFilename}`,
      buffer: fs.readFileSync(imageFile.filepath),
      contentType: imageFile.mimetype || "application/octet-stream",
    });

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // Собираем input: базовый preset.input + image + prompt
    const input = {
      ...(preset.input || {}),
      image: inputImageUrl,
      prompt: scene,
    };

    // Вариант A: если есть version
    // Вариант B: если есть model (на всякий случай)
    const payload = version
      ? { version, input }
      : { model, input };

    const prediction = await replicate.predictions.create(payload);

    return res.status(200).json({
      ok: true,
      presetId,
      jobId: prediction.id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.stack || err),
    });
  }
}
