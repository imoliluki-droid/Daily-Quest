export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: 'Daily Quest W Speed backend',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
}
