import formidable from "formidable";
import Replicate from "replicate";
import { PRESETS } from "../lib/presets.js";
import { bunnyUpload, bunnyPublicUrl } from "../lib/bunny.js";

export const config = { api: { bodyParser: false } };

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false });
    form.parse(req, (err, fields, files) =>
      err ? reject(err) : resolve({ fields, files })
    );
  });
}

export default async function handler(req, res) {
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

    const {
      REPLICATE_API_TOKEN,
      REPLICATE_MODEL,
      BUNNY_STORAGE_ZONE,
      BUNNY_STORAGE_PASSWORD,
      BUNNY_PULL_ZONE_URL,
      BUNNY_REGION = "global"
    } = process.env;

    if (!REPLICATE_API_TOKEN || !REPLICATE_MODEL) {
      return res.status(500).json({ error: "Replicate env missing" });
    }

    const fs = await import("node:fs/promises");
    const buffer = await fs.readFile(imageFile.filepath);

    const inputPath = `inputs/${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.png`;

    await bunnyUpload({
      storageZone: BUNNY_STORAGE_ZONE,
      storagePassword: BUNNY_STORAGE_PASSWORD,
      region: BUNNY_REGION,
      remotePath: inputPath,
      buffer,
      contentType: "image/png"
    });

    const imageUrl = bunnyPublicUrl(BUNNY_PULL_ZONE_URL, inputPath);

    const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

    const prompt = preset.promptTemplate.replace("{scene}", scene);

    const prediction = await replicate.predictions.create({
      model: REPLICATE_MODEL,
      input: {
        image: imageUrl,
        prompt,
        negative_prompt: preset.negative,
        fps: preset.fps,
        duration: preset.duration
      }
    });

    return res.json({
      jobId: prediction.id,
      status: prediction.status
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
