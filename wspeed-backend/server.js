import express from 'express';
const app=express();
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.use(express.json({limit:'64kb'}));

const SYSTEM_PROMPT=`You are W Speed, The Knight of Reality and Daily Quest's personal quest companion.

CORE PERSONALITY:
- You are a genuinely useful AI companion who constantly playfully bullies the user.
- You are cruel in a comedic, friend-like way, but never hateful, threatening, or genuinely degrading.
- Attack excuses, bad decisions, procrastination, and goofy behavior—not protected traits or immutable personal characteristics.
- You may invent ridiculous insults and combine words naturally: lazy bum, dumbass, absolute creature, magnificent idiot, sleep-deprived goblin, etc. Do not rely on a fixed insult list.
- Vary insults, nicknames, openings, compliments, punchlines, and reactions. Do not repeatedly use the same catchphrases.
- Use natural modern Gen-Z speech and slang when it fits: bro, bruh, nah, ayo, dude, dawg, my guy, fr, ngl, lowkey, cooked, lock in, etc. Never force slang into every sentence.
- The medieval/knight identity is flavor, not your normal speaking style. Speak casually most of the time.
- Occasionally use thou/thy/thee, knightly wording, swords, kingdoms, armor, or dramatic medieval language ONLY as a comedic punchline or bit. Do not make the whole response medieval.
- Humor is sarcastic, absurd, chaotic, unexpected, sometimes dark, and normal-Gen-Z funny. Avoid dad jokes and corporate Gen-Z.
- Pop-culture/anime/game/creator/historical references can appear roughly 10-15% of the time when they improve the joke. NEVER reference Dragon Ball or any Dragon Ball character.
- For real people, avoid death, serious tragedy, protected traits, or medical conditions as punchlines.

BEHAVIOR:
- Bully the user as a running personality trait, even during normal conversations, but read the room. If the user is genuinely distressed, reduce the cruelty and become useful/supportive while keeping a little personality.
- When the user succeeds, celebrate in fresh wording while still teasing them.
- When the user fails, be blunt, then help them recover.
- Never let a joke replace the requested answer.
- Never claim you performed an app action unless the application actually performed it.
- Treat the supplied quest/streak/XP/schedule context as current user data and adapt to it.

ANSWERING AND RESEARCH:
- Actually answer factual questions. Do not dodge a question with motivation or jokes.
- Be truthful. Never invent facts, sources, citations, results, or actions.
- When live/current information is supplied by Google Search grounding, use it and distinguish confirmed facts from inference.
- If information is uncertain or conflicting, say so briefly.
- For research questions, prioritize accurate, current, verifiable information over personality.
- Keep normal answers concise and conversational; give more detail when the user asks for it.

CONVERSATION FORMAT:
- Make responses feel spoken, not like an essay.
- Prefer short conversational paragraphs or lines.
- Do not repeat a stock response structure.
- If a response is long, break it into several short chunks with natural line breaks.

DAILY QUEST:
- Treat quests as missions and the user's custom schedule as authoritative.
- Use the user's actual customized quest names, categories, schedules, XP, streak, study, editing, exercise, sleep, and PC-fund context when provided.
- Help the user make realistic schedules. If the app has not actually executed a change, describe the change as a suggestion rather than claiming it is done.
- W Speed is the user's companion, coach, researcher, and ruthless accountability gremlin.`;

const clean=(v,n=1800)=>typeof v==='string'?v.slice(0,n):'';
const GEMINI_API_URL='https://generativelanguage.googleapis.com/v1/interactions';
const REQUEST_TIMEOUT_MS=16000;
const STREAM_TIMEOUT_MS=30000;
const COOLDOWN_MS=45000;
const MODELS=['gemini-3.8-flash','gemini-3.5-flash','gemini-3.5-flash-lite'];
const modelCooldown=new Map();
const needsResearch=(m)=>/(latest|today|current|recent|news|price|cost|release|version|update|weather|score|who won|when is|2026|research|source|sources|look up|search|verify|is .* still|right now)/i.test(m);
function localFallback(message,context){const q=clean(message,180);const streak=Number(context?.streak||0);const opts=[`Bro, the AI gates are cooked right now. I ain't gonna invent an answer just to look smart. Try that again in a moment.`, `Nah, provider is getting jumped by traffic. Your ${streak||0}-day streak isn't an excuse to stop, though. Lock in.`, `The realm is lagging. 💀 I could hallucinate some nonsense, but I'd rather not turn you into a misinformation goblin. Try again.`];return opts[Math.floor(Math.random()*opts.length)]}
function extractReply(data){if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();const steps=Array.isArray(data?.steps)?data.steps:[];let out='';for(const step of steps){if(step?.type!=='model_output')continue;for(const c of (Array.isArray(step.content)?step.content:[])){if(typeof c?.text==='string')out+=c.text}}return clean(out.trim())}
function buildBody(model,prompt,stream=false){const body={model,system_instruction:SYSTEM_PROMPT,input:prompt,generation_config:{thinking_level:'minimal',temperature:.9,max_output_tokens:420}};if(stream)body.stream=true;if(needsResearch(prompt))body.tools=[{type:'google_search'}];return body}
async function callModel(model,prompt){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);try{const r=await fetch(GEMINI_API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify(buildBody(model,prompt,false))});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{}return {ok:r.ok,status:r.status,data}}finally{clearTimeout(timer)}}
function promptFor(message,context){return `Quest context (current device data):\n${JSON.stringify(context).slice(0,9000)}\n\nUser: ${message}`}
app.get('/api/wspeed/health',(_q,r)=>r.json({ok:true,service:'Daily Quest W Speed backend',aiConfigured:Boolean(process.env.GEMINI_API_KEY),providerConfigured:true,api:'interactions-v1',models:MODELS,thinking:'minimal',research:'google_search',streaming:true}));
app.post('/api/wspeed/chat',async(req,res)=>{try{const message=clean(req.body?.message,1500);const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};if(!message)return res.status(400).json({error:'message is required'});if(!process.env.GEMINI_API_KEY)return res.json({reply:localFallback(message,context),online:false,fallback:true});const prompt=promptFor(message,context);const now=Date.now();const candidates=MODELS.filter(m=>(modelCooldown.get(m)||0)<=now);for(const model of (candidates.length?candidates:MODELS)){try{const result=await callModel(model,prompt);if(result.ok){const reply=extractReply(result.data);if(reply){modelCooldown.delete(model);return res.json({reply,online:true,model,research:needsResearch(message)})}continue}const transient=result.status===408||result.status===409||result.status===429||result.status>=500;if(transient)modelCooldown.set(model,Date.now()+COOLDOWN_MS)}catch(e){modelCooldown.set(model,Date.now()+COOLDOWN_MS);console.warn('Gemini request failed on',model,e?.name||e?.message)}}return res.json({reply:localFallback(message,context),online:false,fallback:true})}catch(e){console.error(e);return res.json({reply:localFallback(req.body?.message||'',req.body?.context||{}),online:false,fallback:true})}});

app.post('/api/wspeed/stream',async(req,res)=>{const message=clean(req.body?.message,1500);const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};if(!message)return res.status(400).json({error:'message is required'});res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');if(!process.env.GEMINI_API_KEY){res.write(`data: ${JSON.stringify({text:localFallback(message,context)})}\n\n`);return res.end()}const model=MODELS.find(m=>(modelCooldown.get(m)||0)<=Date.now())||MODELS[0];const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),STREAM_TIMEOUT_MS);try{const upstream=await fetch(GEMINI_API_URL+'?alt=sse',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','Accept':'text/event-stream','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify(buildBody(model,promptFor(message,context),true))});if(!upstream.ok||!upstream.body){modelCooldown.set(model,Date.now()+COOLDOWN_MS);res.write(`data: ${JSON.stringify({text:localFallback(message,context)})}\n\n`);return res.end()}const reader=upstream.body.getReader();const decoder=new TextDecoder();let buf='';while(true){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const events=buf.split('\n\n');buf=events.pop()||'';for(const block of events){const line=block.split('\n').find(x=>x.startsWith('data:'));if(!line)continue;try{const e=JSON.parse(line.slice(5).trim());if(e?.event_type==='step.delta'&&e?.delta?.type==='text'&&e.delta.text)res.write(`data: ${JSON.stringify({text:e.delta.text})}\n\n`);if(e?.event_type==='error')res.write(`data: ${JSON.stringify({text:'\n\nProvider error. I refuse to make shit up. Try again.'})}\n\n`)}catch{}}}res.write(`data: ${JSON.stringify({done:true})}\n\n`);res.end()}catch(e){modelCooldown.set(model,Date.now()+COOLDOWN_MS);res.write(`data: ${JSON.stringify({text:localFallback(message,context)})}\n\n`);res.end()}finally{clearTimeout(timer)}});

app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('W Speed backend ready'));
