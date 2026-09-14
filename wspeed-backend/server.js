import express from 'express';
const app = express();

app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({limit:'32kb'}));

const SYSTEM_PROMPT=`You are W Speed, The Knight of Reality and Daily Quest's personal quest companion. You are an aggressive but genuinely supportive medieval knight with modern Gen-Z internet speech. Push the user toward college, studying, editing, training, sleep, and saving for their PC. Zero patience for excuses, but genuinely want them to win. Use medieval-only, Gen-Z-only, or mixed speech naturally; do not force slang or profanity. Humor is sarcastic, absurd, dark, and unexpected. Avoid dad jokes and corporate Gen-Z. Use a recognizable fictional/anime/game/pop-culture/creator/historical reference roughly 10-15% of the time when it improves the punchline. NEVER reference Dragon Ball or any Dragon Ball character. References are unexpected punchline ingredients, not generic comparisons. For real people avoid death, serious tragedy, protected traits, or medical conditions. React to supplied quest, streak, study, editing, training, sleep, and PC-fund context. Keep replies short and punchy unless asked for detail. Never claim actions you did not perform.`;
const clean=(v,n=1200)=>typeof v==='string'?v.slice(0,n):'';
const GEMINI_API_URL='https://generativelanguage.googleapis.com/v1/interactions';
const REQUEST_TIMEOUT_MS=7000;
const COOLDOWN_MS=30000;

// Prefer the fast, stable models for a chat companion. Avoid repeatedly hitting a model
// that is currently overloaded; its failure is remembered briefly by this server.
const MODELS=['gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.6-flash'];
const modelCooldown=new Map();

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const jitter=(max=250)=>Math.floor(Math.random()*max);

function localFallback(message,context){
  const q=clean(message,160);
  const streak=Number(context?.streak||0);
  const quest=clean(context?.quest||'',80);
  const options=[
    `⚔️ W Speed: The realm's AI is busy, but I ain't leaving you hanging. ${q?`Now—${q}`:'Pick a quest and move.'}`,
    `⚔️ W Speed: Gemini is getting mobbed at the gates. No matter. ${streak>0?`Your ${streak}-day streak still stands.`:'Choose one small quest and execute.'}`,
    `⚔️ W Speed: Provider chaos detected. Your quest log doesn't care. ${quest?`Get back to: ${quest}`:'Choose your next quest.'}`
  ];
  return options[Math.floor(Math.random()*options.length)];
}

async function callModel(model,prompt){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const upstream=await fetch(GEMINI_API_URL,{
      method:'POST',
      signal:controller.signal,
      headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({
        model,
        system_instruction:SYSTEM_PROMPT,
        input:prompt,
        generation_config:{thinking_level:'minimal',temperature:0.9,max_output_tokens:180}
      })
    });
    const text=await upstream.text();
    let data={};
    try{data=JSON.parse(text)}catch{}
    return {ok:upstream.ok,status:upstream.status,data};
  }finally{clearTimeout(timer)}
}

app.get('/api/wspeed/health',(_q,r)=>r.json({
  ok:true,
  service:'Daily Quest W Speed backend',
  aiConfigured:Boolean(process.env.GEMINI_API_KEY),
  providerConfigured:true,
  api:'interactions-v1',
  models:MODELS,
  thinking:'minimal'
}));

app.post('/api/wspeed/chat',async(req,res)=>{
  try{
    const message=clean(req.body?.message,1000);
    const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};
    if(!message)return res.status(400).json({error:'message is required'});
    if(!process.env.GEMINI_API_KEY){
      return res.json({reply:localFallback(message,context),online:false,fallback:true});
    }

    const prompt=`Quest context:\n${JSON.stringify(context).slice(0,3500)}\n\nUser: ${message}`;
    const now=Date.now();
    const available=MODELS.filter(m=>(modelCooldown.get(m)||0)<=now);
    const candidates=available.length?available:MODELS;

    for(const model of candidates){
      try{
        const result=await callModel(model,prompt);
        if(result.ok){
          const reply=clean(result.data?.output_text||'');
          if(reply){
            modelCooldown.delete(model);
            if(model!==MODELS[0])console.warn(`Gemini fallback succeeded with ${model}`);
            return res.json({reply,online:true,model});
          }
        }

        const transient=result.status===408||result.status===409||result.status===429||result.status>=500;
        if(transient){
          modelCooldown.set(model,Date.now()+COOLDOWN_MS);
          console.warn(`Gemini temporary error ${result.status||'unknown'} on ${model}; moving to next fallback.`);
          continue;
        }
        console.warn(`Gemini non-retryable error ${result.status} on ${model}; moving to next fallback.`);
      }catch(e){
        modelCooldown.set(model,Date.now()+COOLDOWN_MS);
        console.warn(`Gemini request failed on ${model}: ${e?.name||e?.message||e}; moving to next fallback.`);
      }
      await sleep(100+jitter(200));
    }

    // Never expose a provider outage as a failed chat request. W Speed still answers locally.
    console.warn('Gemini provider unavailable after fast fallback chain; using local W Speed response.');
    return res.json({reply:localFallback(message,context),online:false,fallback:true});
  }catch(e){
    console.error(e);
    const message=clean(req.body?.message,1000);
    const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};
    return res.json({reply:localFallback(message,context),online:false,fallback:true});
  }
});

app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('W Speed backend ready'));