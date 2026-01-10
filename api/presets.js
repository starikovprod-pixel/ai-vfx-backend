export const PRESETS = {
  vfx_plate_locked: {
    title: "VFX Plate — Locked Camera",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: "false",
    promptTemplate: "cinematic realistic {scene}, locked camera, stable composition, film-like contrast",
  },

  kling_v26: {
    title: "Kling v2.6 (base)",
    model: "kwaivgi/kling-v2.6",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: "false",
    promptTemplate: "{scene}",
  },
};
