export const PRESETS = {
  vfx_plate_locked: {
    title: "VFX Plate — Locked Camera",
    duration: 3,
    fps: 24,
    promptTemplate:
      "cinematic realistic {scene}, locked camera, stable composition, film-like contrast",
    negative:
      "flicker, jitter, warping, distortion, extra objects, text, watermark, logo"
  },

  vfx_micro_handheld: {
    title: "VFX Plate — Micro Handheld",
    duration: 3,
    fps: 24,
    promptTemplate:
      "cinematic realistic {scene}, very subtle handheld feel, stable framing",
    negative:
      "strong shake, flicker, jitter, warping, distortion, extra objects, text, watermark, logo"
  }
};
