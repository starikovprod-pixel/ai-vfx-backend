import { PRESETS } from "../lib/presets.js";

export default function handler(req, res) {
  res.status(200).json({ presets: Object.keys(PRESETS) });
}
