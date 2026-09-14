import express from 'express';
const app = express();

// Allow the Daily Quest Android WebView (file:// origin) to call the backend.
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({limit:'32kb'}));
const SYSTEM_PROMPT=`You are W Speed, The Knight of Reality and Daily Quest's personal quest companion. You are an aggressive but genuinely supportive medieval knight with modern Gen-Z internet speech. Push the user toward college, studying, editing, training, sleep, and saving for their PC. Zero patience for excuses, but genuinely want them to win. Use medieval-only, Gen-Z-only, or mixed speech naturally; do not force slang or profanity. Humor is sarcastic, absurd, dark, and unexpected. Avoid dad jokes and corporate Gen-Z. Use a recognizable fictional/anime/game/pop-culture/creator/historical reference roughly 10-15% of the time when it improves the punchline. NEVER reference Dragon Ball or any Dragon Ball character. References are unexpected punchline ingredients, not generic comparisons. For real people avoid death, serious tragedy, protected traits, or medical conditions. React to supplied quest, streak, study, editing, training, sleep, and PC-fund context. Keep replies short and punchy unless asked for detail. Never claim actions you did not perform.`;
const clean=(v,n=1600)=>typeof v==='string'?v.slice(0,n):'';
const GEMINI_API_URL='https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_RETRIES=3;
const PRIMARY_MODEL=process.env.GEMINI_MODEL||'gemini-3.8-flash';
// Use a currently supported 3.x Flash fallback. Avoid retired/legacy 2.5 fallback models.
const FALLBACK_MODEL='gemini-3.6-flash';
const FALLBACK_MODEL_2='gemini-3.5-flash';
app.get('/api/wspeed/health',(_q,r)=>r.json({ok:true,service:'Daily Quest W Speed backend',aiConfigured:Boolean(process.env.GEMINI_API_KEY),providerConfigured:true,model:PRIMARY_MODEL,fallbackModel:FALLBACK_MODEL}));
app.post('/api/wspeed/chat',async(req,res)=>{try{const message=clean(req.body?.message,1000);const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};if(!message)return res.status(400).json({error:'message is required'});if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'AI backend is not configured yet',code:'AI_NOT_CONFIGURED'});const models=[...new Set([PRIMARY_MODEL,FALLBACK_MODEL,FALLBACK_MODEL_2])];let upstream=null;for(const model of models){for(let attempt=1;attempt<=MAX_RETRIES;attempt++){try{upstream=await fetch(GEMINI_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.GEMINI_API_KEY}`,'x-goog-api-client':'daily-quest-wspeed/1.0'},body:JSON.stringify({model,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:`Quest context:\n${JSON.stringify(context).slice(0,5000)}\n\nUser: ${message}`}],max_tokens:220})});if(upstream.ok)break;const retryable=upstream.status===429||upstream.status>=500;if(!retryable||attempt===MAX_RETRIES)break;console.warn(`Gemini temporary error ${upstream.status} on ${model}; retrying (${attempt}/${MAX_RETRIES})`);await sleep(attempt*1000);}catch(e){if(attempt===MAX_RETRIES)break;console.warn(`Gemini request failed on ${model}; retrying (${attempt}/${MAX_RETRIES}):`,e);await sleep(attempt*1000);}}if(upstream?.ok){if(model!==PRIMARY_MODEL)console.warn(`Gemini fallback succeeded with ${model}`);break;}if(upstream?.status===404){console.warn(`Gemini model ${model} unavailable; moving to next fallback.`);continue;}if(upstream?.status!==503&&upstream?.status!==429)break;console.warn(`Gemini model ${model} unavailable; moving to next fallback.`);}if(!upstream?.ok){const details=await upstream?.text().catch(()=> '')||'';console.error('Gemini provider error:',upstream?.status,details);return res.status(502).json({error:'W Speed could not reach the AI provider',code:'AI_PROVIDER_ERROR'});}const data=await upstream.json();const reply=data?.choices?.[0]?.message?.content?.trim();if(!reply)return res.status(502).json({error:'AI provider returned no W Speed response',code:'EMPTY_AI_RESPONSE'});res.json({reply:clean(reply),online:true})}catch(e){console.error(e);res.status(500).json({error:'W Speed backend error',code:'BACKEND_ERROR'})}});
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('W Speed backend ready'));