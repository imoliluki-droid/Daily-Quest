export function GET() {
  return Response.json({
    ok: true,
    service: 'Daily Quest W Speed backend',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
}
