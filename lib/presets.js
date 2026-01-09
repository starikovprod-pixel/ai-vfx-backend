export const PRESETS = {
  vfx_plate_locked: {
    title: "VFX Plate — Locked Camera",
    model: "kwaivgi/kling-v2.6",
    input: {
      // эти поля точнее возьмёшь из Schema
      aspect_ratio: "16:9",
      duration: 5,
      generate_audio: false
    }
  },

  vfx_micro_handheld: {
    title: "VFX Plate — Micro Handheld",
    model: "kwaivgi/kling-v2.6",
    input: {
      aspect_ratio: "16:9",
      duration: 5,
      generate_audio: false
    }
  }
};
