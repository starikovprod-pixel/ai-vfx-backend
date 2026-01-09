import Replicate from "replicate";
import fs from "fs";
import formidable from "formidable";
import { PRESETS } from "../presets.js"; // поправь путь, если у тебя иначе

export const config = {
  api: { bodyParser: false }, // ОБЯЗАТЕЛЬНО для multipart/form-data
};

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

function pickFile(files, key) {
  // formidable может вернуть либо объект, либо массив
  const f = files?.[key];
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // мини-лог, чтобы понимать, видит ли Vercel токен (в логах Vercel)
    console.log("HAS REPLICATE TOKEN?", !!process.env.REPLICATE_API_TOKEN);

    const { fields, files } = await parseForm(req);

    const presetId = String(fields.presetId || "");
    const scene = String(fields.scene || "");
    const duration = fields.duration ? Number(fields.duration) : undefined;
    const aspect_ratio = fields.aspect_ratio ? String(fields.aspect_ratio) : undefined;
    const generate_audio =
      fields.generate_audio != null
        ? String(fields.generate_audio) === "true"
        : undefined;

    if (!presetId) return res.status(400).json({ error: "presetId required" });

    const preset = PRESETS?.[presetId];
    if (!preset) return res.status(400).json({ error: `Unknown presetId: ${presetId}` });

    // важно: бекенд ждёт поле image (не start_image)
    const file = pickFile(files, "image");
    if (!file) return res.status(400).json({ error: "Image required (field name: image)" });

    // у formidable бывает filepath (новое) или path (старое)
    const filePath = file.filepath || file.path;
    if (!filePath) {
      console.log("FILES DEBUG:", Object.keys(files || {}), file);
      return res.status(400).json({ error: "Failed to read uploaded file path" });
    }

    const imageBuffer = fs.readFileSync(filePath);

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // preset.model должен быть типа "kwaivgi/kling-v2.6"
    // preset.modelVersion (если используешь) — конкретная версия, необязательно
    const input = {
      prompt: (preset.promptTemplate || "{scene}").replace("{scene}", scene || ""),
      ...(preset.negative ? { negative_prompt: preset.negative } : {}),
      ...(duration != null ? { duration } : preset.duration != null ? { duration: preset.duration } : {}),
      ...(aspect_ratio ? { aspect_ratio } : {}),
      ...(generate_audio != null ? { generate_audio } : {}),
      // Kling принимает start_image. Но мы ему отдаём буфер как файл:
      start_image: imageBuffer,
    };

    // ВАЖНО: createPrediction нужен если хочешь prediction.id гарантированно
    const prediction = await replicate.predictions.create({
      model: preset.model,
      input,
    });

    return res.status(200).json({
      ok: true,
      jobId: prediction.id,
      status: prediction.status,
      model: preset.model,
    });
  } catch (err) {
    console.error("START ERROR:", err);
    return res.status(500).json({
      error: "Internal error",
      details: String(err?.message || err),
    });
  }
}
