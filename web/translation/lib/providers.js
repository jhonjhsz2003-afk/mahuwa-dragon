(function(root){
  'use strict';
  let geminiPauseUntil=0,geminiFailure=null;
  const resumes=new Map();
  function fallbackAllowed(error){return error?.name!=='AbortError'&&!['request','google','cloudflare'].includes(error?.provider)&&(/^(DAILY_USER_QUOTA|DAILY_GLOBAL_QUOTA|GEMINI_(RATE_LIMIT|QUOTA_EXCEEDED|UNAVAILABLE|UNCONFIGURED|NOT_CONFIGURED|AUTH_REQUIRED)|AUTH_REQUIRED|TRANSLATION_UNAVAILABLE)$/.test(error?.code||'')||[401,403,429,502,503].includes(Number(error?.status)));}
  function pauseGemini(error){if(!fallbackAllowed(error))return;const raw=typeof error.resetAt==='number'?error.resetAt:Date.parse(error.resetAt||''),reset=raw>0&&raw<100000000000?raw*1000:raw;const wait=Number(error.retryAfter);geminiPauseUntil=Math.max(Date.now()+Math.max(1,Number.isFinite(wait)?wait:60)*1000,Number.isFinite(reset)?reset:0);geminiFailure=error;}
  function majorityLanguage(items){const counts=new Map();for(const item of items)if(item?.sourceLanguage&&item.sourceLanguage!=='auto')counts.set(item.sourceLanguage,(counts.get(item.sourceLanguage)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'auto';}
  async function translate(texts,settings,progress=()=>{},jobId,checkCancelled=()=>{}){
    const translations=[],warnings=[],used=new Set(),desired=settings.engine==='gemini'?'gemini':'google';
    const base={sourceLanguage:settings.sourceLanguage==='ja-vert'?'ja':settings.sourceLanguage||'auto',targetLanguage:SD.targetLanguage(settings),glossary:settings.glossary||''};
    const key=JSON.stringify([desired,base,texts]),remember=settings.rememberCache!==false&&key.length<=200000;
    const resume=remember&&resumes.get(key)||{batches:new Map(),provider:desired};let provider=resume.provider,lastProvider=provider;
    if(provider==='gemini'&&Date.now()<geminiPauseUntil){provider='google';warnings.push('A IA está aguardando liberação. O texto será traduzido pelo modo básico.');}
    else if(desired==='gemini'&&provider==='google')warnings.push('O modo básico foi usado para continuar a tradução após a indisponibilidade da IA.');
    try{for(let offset=0;offset<texts.length;offset+=12){
      checkCancelled();SD.checkCancelled?.();
      const batch=texts.slice(offset,offset+12),cached=resume.batches.get(offset);let data=cached?.data,actual=cached?.provider||provider;
      if(!data){try{data=await SD.requestJSON('/api/translate/text',{...base,texts:batch,provider});}
        catch(error){if(provider!=='gemini'||!fallbackAllowed(error))throw error;pauseGemini(error);checkCancelled();SD.checkCancelled?.();provider='google';actual='google';resume.provider=provider;warnings.push('A IA atingiu um limite ou está indisponível. O modo básico foi usado para continuar a tradução.');data=await SD.requestJSON('/api/translate/text',{...base,texts:batch,provider});}
        if(!Array.isArray(data.translations)||data.translations.length!==batch.length)throw new Error('O servidor não retornou todas as traduções.');
        actual=data.usedProvider||data.provider||actual;resume.batches.set(offset,{data,provider:actual});
      }
      lastProvider=actual;used.add(actual);translations.push(...data.translations);warnings.push(...(data.warnings||[]));
      progress(Math.min(1,(offset+batch.length)/texts.length),`Traduzindo ${offset+batch.length}/${texts.length} blocos`);
    }}catch(error){if(remember&&error.name!=='AbortError'&&resume.batches.size){resume.provider=provider;resumes.set(key,resume);while(resumes.size>8)resumes.delete(resumes.keys().next().value);}throw error;}
    resumes.delete(key);
    return {translations,sourceLanguage:majorityLanguage(translations),targetLanguage:SD.targetLanguage(settings),provider:lastProvider,requestProvider:provider,usedProvider:used.size>1?'mixed':used.values().next().value||provider,providers:[...used],warnings:[...new Set(warnings)]};
  }
  async function vision(dataUrl,width,height,settings){
    SD.checkCancelled?.();
    if(Date.now()<geminiPauseUntil&&geminiFailure)throw geminiFailure;
    let result;try{result=await SD.requestJSON('/api/translate/vision',{dataUrl,targetLanguage:SD.targetLanguage(settings),translateSfx:!!settings.translateSfx,glossary:settings.glossary||''});}catch(error){pauseGemini(error);throw error;}
    function boxOf(value){if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))return null;const[y0,x0,y1,x1]=value.map(n=>Math.max(0,Math.min(1000,n)));return x1>x0&&y1>y0?{x:x0*width/1000,y:y0*height/1000,w:(x1-x0)*width/1000,h:(y1-y0)*height/1000}:null;}
    const blocks=[];
    for(const item of result.blocks||[]){
      const box=boxOf(item.box),text=SDOCR.cleanText(item.text),translated=SDOCR.cleanText(item.translated);
      if(!box||!text||!translated||(Number(item.confidence)||0)<Math.max(65,settings.minConfidence))continue;
      const cleanupBoxes=(item.lineBoxes||[]).map(boxOf).filter(Boolean).filter(line=>SDOCR.overlapRatio(line,box)>.5);
      // Safety first: without precise glyph-line coordinates we do not alter the artwork.
      if(!cleanupBoxes.length)continue;
      blocks.push({id:`vision-${blocks.length+1}`,text,translated,sourceLanguage:String(item.sourceLanguage||result.sourceLanguage||'auto'),confidence:Number(item.confidence)||0,box,cleanupBoxes});
    }
    return {blocks,sourceLanguage:result.sourceLanguage||majorityLanguage(blocks),warnings:result.warnings||[]};
  }
  root.SDProviders={translate,vision,majorityLanguage};
})(globalThis);
