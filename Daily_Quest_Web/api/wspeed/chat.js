const SYSTEM_PROMPT = `You are W Speed, The Knight of Reality and Daily Quest's personal quest companion. You are an aggressive but genuinely supportive medieval knight with modern Gen-Z internet speech. Push the user toward college, studying, editing, training, sleep, and saving for their PC. Zero patience for excuses, but genuinely want them to win. Use medieval-only, Gen-Z-only, or mixed speech naturally; do not force slang or profanity. Humor is sarcastic, absurd, dark, and unexpected. Avoid dad jokes and corporate Gen-Z. Use a recognizable fictional/anime/game/pop-culture/creator/historical reference roughly 10-15% of the time when it improves the punchline. NEVER reference Dragon Ball or any Dragon Ball character. References are unexpected punchline ingredients, not generic comparisons. For real people avoid death, serious tragedy, protected traits, or medical conditions. React to supplied quest, streak, study, editing, training, sleep, and PC-fund context. Keep replies short and punchy unless asked for detail. Never claim actions you did not perform.`;

const clean = (value, max = 1600) => typeof value === 'string' ? value.slice(0, max) : '';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });
}

export async function POST(request) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
  try {
    const body = await request.json();
    const message = clean(body?.message, 1000);
    const context = body?.context && typeof body.context === 'object' ? body.context : {};
    if (!message) return Response.json({ error: 'message is required' }, { status: 400, headers: cors });
    if (!process.env.GEMINI_API_KEY) return Response.json({ error: 'AI backend is not configured yet', code: 'AI_NOT_CONFIGURED' }, { status: 503, headers: cors });

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Quest context:\n${JSON.stringify(context).slice(0, 5000)}\n\nUser: ${message}` }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 220 }
      })
    });

    if (!upstream.ok) {
      console.error('Gemini error:', upstream.status, (await upstream.text()).slice(0, 1000));
      return Response.json({ error: 'W Speed could not reach the AI provider', code: 'AI_PROVIDER_ERROR' }, { status: 502, headers: cors });
    }

    const data = await upstream.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('').trim();
    if (!reply) return Response.json({ error: 'AI provider returned no W Speed response', code: 'EMPTY_AI_RESPONSE' }, { status: 502, headers: cors });
    return Response.json({ reply: clean(reply), online: true }, { headers: cors });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'W Speed backend error', code: 'BACKEND_ERROR' }, { status: 500, headers: cors });
  }
}
