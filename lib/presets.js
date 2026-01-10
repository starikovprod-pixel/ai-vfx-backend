export const PRESETS = {
  vfx_plate_locked: {
    title: "VFX Plate — Locked Camera",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: false,
    promptTemplate:
      "cinematic realistic {scene}, locked camera, stable composition, film-like contrast",
  },

  vfx_micro_handheld: {
    title: "VFX Plate — Micro Handheld",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: false,
    promptTemplate:
      "cinematic realistic {scene}, very subtle handheld feel, stable framing",
  },

  nano_banana_pro: {
    title: "Nano Banana Pro (Google)",
    provider: "nano",
    type: "image_to_image", // или text_to_image (мы сделаем image optional)
    model: "google/nano-banana-pro",
    promptTemplate: "{scene}",

    // дефолты
    aspect_ratio: "match_input_image",
    resolution: "2K",
    output_format: "png",
    safety_filter_level: "block_only_high",
  },
};
