export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "ai-vfx-backend",
    ts: Date.now()
  });
}
