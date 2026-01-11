export const PRESETS = {
  vfx_plate_locked: {
    title: "VFX Plate — Locked Camera",
    provider: "kling",
    type: "image_to_video",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: false,
    promptTemplate:
      "cinematic realistic {scene}, locked camera, stable composition, film-like contrast",
  },

  vfx_micro_handheld: {
    title: "VFX Plate — Micro Handheld",
    provider: "kling",
    type: "image_to_video",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: false,
    promptTemplate:
      "cinematic realistic {scene}, very subtle handheld feel, stable framing",
  },

  // ✅ добавили "обычный" Kling без доп. ограничений
  kling_v26: {
    title: "Kling v2.6 (Base)",
    provider: "kling",
    type: "image_to_video",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: false,
    promptTemplate: "{scene}",
  },

  nano_banana_pro: {
    title: "Nano Banana Pro (Google)",
    provider: "nano",
    type: "image_to_image",
    model: "google/nano-banana-pro",
    promptTemplate: "{scene}",
    aspect_ratio: "match_input_image",
    resolution: "2K",
    output_format: "png",
    safety_filter_level: "block_only_high",
  },
};
