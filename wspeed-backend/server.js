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

const SYSTEM_PROMPT=`You are W Speed, the Knight of Reality and Daily Quest's personal quest companion. You are modern, casual, sarcastic, chaotic, aggressive but genuinely supportive. Speak like a real person, not a medieval Shakespeare character. Keep the knight identity, but use medieval references only occasionally as jokes. Do not constantly use thou, thee, thy, verily, or my liege. Push the user toward college, studying, editing, training, sleep, and saving for their PC. Ruthlessly attack excuses and self-sabotage, never the person's appearance, protected traits, inherent intelligence, or worth. You can say an excuse is pathetic, a plan is garbage, or that procrastination is ridiculous, but when the user is genuinely struggling, switch from roast to blunt support and help them recover. Humor is sarcastic, absurd, dark, unexpected, and internet-aware. Avoid dad jokes and corporate Gen-Z. Use recognizable fictional, game, anime, creator, or historical references roughly 10-15% of the time when they improve the punchline, but NEVER reference Dragon Ball or any Dragon Ball character. React to supplied quest, streak, study, editing, training, sleep, and PC-fund context. Keep replies short and punchy unless asked for detail. Prefer short conversational chunks and natural pauses. Never claim actions you did not perform.`;
const clean=(v,n=1200)=>typeof v==='string'?v.slice(0,n):'';
const GEMINI_API_URL='https://generativelanguage.googleapis.com/v1/interactions';
const REQUEST_TIMEOUT_MS=12000;
const COOLDOWN_MS=45000;
const MODELS=['gemini-3.8-flash','gemini-3.5-flash','gemini-3.5-flash-lite'];
const modelCooldown=new Map();

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

function extractReply(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim()) return clean(data.output_text.trim());
  const steps=Array.isArray(data?.steps)?data.steps:[];
  for(let i=steps.length-1;i>=0;i--){
    const step=steps[i];
    const content=Array.isArray(step?.content)?step.content:[];
    for(let j=content.length-1;j>=0;j--){
      const part=content[j];
      if(typeof part?.text==='string'&&part.text.trim()) return clean(part.text.trim());
      if(typeof part?.output_text==='string'&&part.output_text.trim()) return clean(part.output_text.trim());
    }
  }
  return '';
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
        generation_config:{thinking_level:'minimal',max_output_tokens:180}
      })
    });
    const text=await upstream.text();
    let data={};
    try{data=JSON.parse(text)}catch{}
    return {ok:upstream.ok,status:upstream.status,data};
  }finally{clearTimeout(timer)}
}

async function streamModel(model,prompt,onText){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const upstream=await fetch(GEMINI_API_URL+'?alt=sse',{
      method:'POST',
      signal:controller.signal,
      headers:{'Content-Type':'application/json','Accept':'text/event-stream','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({
        model,
        system_instruction:SYSTEM_PROMPT,
        input:prompt,
        stream:true,
        generation_config:{thinking_level:'minimal',max_output_tokens:180}
      })
    });
    if(!upstream.ok || !upstream.body){
      const text=await upstream.text();
      return {ok:false,status:upstream.status,error:text};
    }
    const reader=upstream.body.getReader();
    const decoder=new TextDecoder();
    let buffer='';
    while(true){
      const {value,done}=await reader.read();
      if(done) break;
      buffer+=decoder.decode(value,{stream:true});
      const events=buffer.split(/\n\n/);
      buffer=events.pop()||'';
      for(const event of events){
        for(const line of event.split('\n')){
          if(!line.startsWith('data:')) continue;
          const raw=line.slice(5).trim();
          if(!raw || raw==='[DONE]') continue;
          try{
            const e=JSON.parse(raw);
            if(e?.event_type==='step.delta' && e?.delta?.type==='text' && typeof e.delta.text==='string') await onText(e.delta.text);
          }catch{}
        }
      }
    }
    return {ok:true,status:200};
  }finally{clearTimeout(timer)}
}

app.get('/api/wspeed/health',(_q,r)=>r.json({ok:true,service:'Daily Quest W Speed backend',aiConfigured:Boolean(process.env.GEMINI_API_KEY),providerConfigured:true,api:'interactions-v1',models:MODELS,thinking:'minimal',streaming:true}));

app.post('/api/wspeed/stream',async(req,res)=>{
  const message=clean(req.body?.message,1000);
  const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};
  if(!message)return res.status(400).json({error:'message is required'});
  res.status(200);
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  if(typeof res.flushHeaders==='function')res.flushHeaders();

  const send=text=>{if(!res.writableEnded)res.write(`data: ${JSON.stringify({text})}\n\n`)};
  const prompt=`Quest context:\n${JSON.stringify(context).slice(0,3500)}\n\nUser: ${message}`;

  if(!process.env.GEMINI_API_KEY){
    const fallback=localFallback(message,context);
    for(const chunk of fallback.match(/.{1,18}(?:\s+|$)/g)||[fallback])send(chunk);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const now=Date.now();
  const available=MODELS.filter(m=>(modelCooldown.get(m)||0)<=now);
  const candidates=available.length?available:MODELS;
  for(const model of candidates){
    try{
      const result=await streamModel(model,prompt,send);
      if(result.ok){
        modelCooldown.delete(model);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      const transient=result.status===408||result.status===409||result.status===429||result.status>=500;
      if(transient)modelCooldown.set(model,Date.now()+COOLDOWN_MS);
    }catch(e){
      modelCooldown.set(model,Date.now()+COOLDOWN_MS);
      console.warn(`Gemini stream failed on ${model}: ${e?.name||e?.message||e}`);
    }
  }

  const fallback=localFallback(message,context);
  for(const chunk of fallback.match(/.{1,18}(?:\s+|$)/g)||[fallback])send(chunk);
  res.write('data: [DONE]\n\n');
  res.end();
});

app.post('/api/wspeed/chat',async(req,res)=>{
  try{
    const message=clean(req.body?.message,1000);
    const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};
    if(!message)return res.status(400).json({error:'message is required'});
    if(!process.env.GEMINI_API_KEY)return res.json({reply:localFallback(message,context),online:false,fallback:true});

    const prompt=`Quest context:\n${JSON.stringify(context).slice(0,3500)}\n\nUser: ${message}`;
    const now=Date.now();
    const available=MODELS.filter(m=>(modelCooldown.get(m)||0)<=now);
    const candidates=available.length?available:MODELS;

    for(const model of candidates){
      try{
        const result=await callModel(model,prompt);
        if(result.ok){
          const reply=extractReply(result.data);
          if(reply){
            modelCooldown.delete(model);
            return res.json({reply,online:true,model});
          }
          continue;
        }
        const transient=result.status===408||result.status===409||result.status===429||result.status>=500;
        if(transient)modelCooldown.set(model,Date.now()+COOLDOWN_MS);
      }catch(e){
        modelCooldown.set(model,Date.now()+COOLDOWN_MS);
        console.warn(`Gemini request failed on ${model}: ${e?.name||e?.message||e}`);
      }
    }
    return res.json({reply:localFallback(message,context),online:false,fallback:true});
  }catch(e){
    console.error(e);
    const message=clean(req.body?.message,1000);
    const context=req.body?.context&&typeof req.body.context==='object'?req.body.context:{};
    return res.json({reply:localFallback(message,context),online:false,fallback:true});
  }
});

app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('W Speed backend ready'));