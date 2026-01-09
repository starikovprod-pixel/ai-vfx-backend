import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload } from "../lib/bunny.js";

export const config = {
  api: { bodyParser: false },
};

// --- helper: parse multipart/form-data (formidable) ---
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

// --- helper: normalize formidable file object across versions ---
function getFirstFile(fileMaybeArray) {
  if (!fileMaybeArray) return null;
  return Array.isArray(fileMaybeArray) ? fileMaybeArray[0] : fileMaybeArray;
}

function getFilePath(file) {
  // formidable v2+: filepath
  // formidable v1: path
  return file?.filepath || file?.path || null;
}

function getOriginalName(file) {
  // formidable v2+: originalFilename
  // formidable v1: name
  return file?.originalFilename || file?.name || "image.png";
}

function getMime(file) {
  // v2+: mimetype, v1: type
  return file?.mimetype || file?.type || "application/octet-stream";
}

function missingEnvVars() {
  const required = [
    "BUNNY_STORAGE_ZONE",
    "BUNNY_STORAGE_API_KEY",
    "BUNNY_REGION", // можно оставить "global", но переменная ок
    "REPLICATE_API_TOKEN",
  ];
  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  return missing;
}

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // --- env check (чтобы не было тупых падений) ---
  const missing = missingEnvVars();
  if (missing.length) {
    return res.status(500).json({
      error: "Missing env vars",
      missing,
      hint: "Проверь Variables в Vercel + сделай Redeploy после изменений.",
    });
  }

  try {
    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "a cinematic realistic shot, film-like contrast");

    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({
        error: "Unknown preset",
        presetId,
        available: Object.keys(PRESETS),
      });
    }

    // --- get uploaded file ---
    const imageFile = getFirstFile(files?.image);
    if (!imageFile) {
      return res.status(400).json({ error: "Image required (field name must be 'image')" });
    }

    const localPath = getFilePath(imageFile);
    if (!localPath) {
      return res.status(500).json({
        error: "Upload parsed but file path is missing",
        debug: {
          keys: Object.keys(imageFile || {}),
          note: "В formidable иногда файл приходит в другом формате — этот обработчик уже максимально совместимый. Если всё равно null — пришли скрин Object.keys(imageFile).",
        },
      });
    }

    const buffer = fs.readFileSync(localPath);
    const remotePath = `inputs/${Date.now()}-${getOriginalName(imageFile)}`;

    // --- upload image to Bunny ---
    const inputImageUrl = await bunnyUpload({
      storageZone: process.env.BUNNY_STORAGE_ZONE,
      storagePassword: process.env.BUNNY_STORAGE_API_KEY,
      region: process.env.BUNNY_REGION || "global",
      remotePath,
      buffer,
      contentType: getMime(imageFile),
    });

    // --- build prompt (если у пресета есть promptTemplate) ---
    const prompt =
      preset.promptTemplate
        ? String(preset.promptTemplate).replaceAll("{scene}", scene)
        : scene;

    // --- Replicate client ---
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    // --- build replicate input ---
    // ВАЖНО: для Kling обычно поле start_image, а не image.
    // Поэтому лучше задавать в пресете preset.imageField = "start_image"
    const imageField = preset.imageField || "image";

    const replicateInput = {
      ...(preset.input || {}),
      [imageField]: inputImageUrl,
      prompt,
    };

    // --- create prediction: requires model OR version ---
    let prediction;
    if (preset.version) {
      prediction = await replicate.predictions.create({
        version: preset.version,
        input: replicateInput,
      });
    } else if (preset.model) {
      prediction = await replicate.predictions.create({
        model: preset.model,
        input: replicateInput,
      });
    } else {
      return res.status(500).json({
        error: "Preset misconfigured",
        details: "Need preset.version or preset.model",
        hint: 'Например для Kling можно указать preset.model = "kwaivgi/kling-v2.6"',
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: prediction.id,
      inputImageUrl,
      used: {
        presetId,
        model: preset.model || null,
        version: preset.version || null,
        imageField,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal error",
      details: err?.message || String(err),
    });
  }
}
