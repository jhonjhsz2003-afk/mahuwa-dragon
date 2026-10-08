import {translationDefaults,sanitizeTranslationSettings,activateTranslationContext,throwIfAborted,translationPause,canFallbackToBasic} from './translation-bridge.js';
export const defaults=translationDefaults;
let loaded=null,tail=Promise.resolve();
const memory=new Map();
const MAX_CACHE_BYTES=32*1024*1024;
function loadScript(path){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=path;script.onload=resolve;script.onerror=()=>reject(new Error('Não foi possível carregar o motor local. Recarregue a página.'));document.head.append(script);});}
async function loadEngine(){
  if(!loaded)loaded=(async()=>{await loadScript('/translation/vendor/tesseract.min.js');for(const name of ['ocr','render','providers'])await loadScript(`/translation/lib/${name}.js`);})().catch(error=>{loaded=null;throw error;});
  await loaded;
}
function queue(operation,signal){const result=tail.catch(()=>{}).then(()=>{throwIfAborted(signal);return operation();});tail=result.catch(()=>{});return result;}
function cacheDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('mahuwa-translation',1);request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function cacheRead(key){if(memory.has(key))return memory.get(key);const db=await cacheDB();try{return await new Promise((resolve,reject)=>{const request=db.transaction('images').objectStore('images').get(key);request.onsuccess=()=>resolve(request.result?.result||null);request.onerror=()=>reject(request.error);});}finally{db.close();}}
async function cacheWrite(key,result){
  const size=result.dataUrl?.length||JSON.stringify(result).length*2;if(size>12*1024*1024)return;
  memory.set(key,result);while(memory.size>4)memory.delete(memory.keys().next().value);
  const db=await cacheDB();try{await new Promise((resolve,reject)=>{const transaction=db.transaction('images','readwrite'),store=transaction.objectStore('images');store.put({key,result,size,time:Date.now()});const request=store.getAll();request.onsuccess=()=>{let bytes=0;request.result.sort((a,b)=>b.time-a.time).forEach((item,index)=>{bytes+=item.size;if(index>=20||bytes>MAX_CACHE_BYTES)store.delete(item.key);});};transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}
}
async function hash(dataUrl,settings,prefix='render-dialogue-only-v5:'){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prefix+dataUrl+JSON.stringify(settings)));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
function boundedProgress(callback){let previous=0;return(value,status)=>{previous=Math.max(previous,Math.max(0,Math.min(1,value)));callback?.({progress:previous,status});};}
export async function translateImage(dataUrl,inputSettings={},options={}){
  const settings=sanitizeTranslationSettings(inputSettings),{signal}=options;
  return queue(async()=>{
    activateTranslationContext({signal});const progress=boundedProgress(options.onProgress),check=()=>throwIfAborted(signal);let source;
    try{
      progress(.01,'Preparando tradução');const key=settings.rememberCache?await hash(dataUrl,settings):null;
      if(key){const cached=await cacheRead(key).catch(()=>null);if(cached){check();progress(1,'Tradução recuperada do cache');return {...cached,cached:true};}}
      await loadEngine();check();const loadedImage=await SDRender.load(dataUrl);source=loadedImage.canvas;
      let blocks=[],warnings=[...loadedImage.warnings],sourceLanguage='auto',usedEngine=settings.engine,fallbackReason=null;
      if(settings.engine==='gemini'){
        try{
          const tiles=SDOCR.planTiles(source.width,source.height,1700,180);
          for(let index=0;index<tiles.length;index++){
            check();const tile=tiles[index],ratio=Math.min(1,1536/tile.w),input=SDRender.canvas(Math.round(tile.w*ratio),Math.round(tile.h*ratio));
            try{
              input.getContext('2d').drawImage(source,tile.x,tile.y,tile.w,tile.h,0,0,input.width,input.height);
              progress(.05+.65*index/tiles.length,`IA lendo e traduzindo ${index+1}/${tiles.length}`);
              let image=input.toDataURL('image/jpeg',.9);if(image.length>2600000)image=input.toDataURL('image/jpeg',.72);
              const analysisKey=settings.rememberCache?await hash(image,{width:tile.w,height:tile.h,targetLanguage:settings.targetLanguage,glossary:settings.glossary,minConfidence:settings.minConfidence},'vision-dialogue-only-v2:'):null;
              let result=analysisKey?await cacheRead(analysisKey).catch(()=>null):null;
              if(!result){const paused=translationPause('gemini');if(paused)throw paused;result=await SDProviders.vision(image,tile.w,tile.h,settings);if(analysisKey)await cacheWrite(analysisKey,result).catch(()=>{});}
              check();const offset=box=>({...box,x:box.x+tile.x,y:box.y+tile.y});
              blocks.push(...result.blocks.map(block=>({...block,box:offset(block.box),cleanupBoxes:block.cleanupBoxes.map(offset)})));warnings.push(...result.warnings);
            }finally{input.width=1;input.height=1;}
          }
        }catch(error){
          check();if(!canFallbackToBasic(error))throw error;
          fallbackReason=error;usedEngine='local';progress(.25,'IA indisponível · continuando pelo modo básico');
          warnings.push(`${error.message} Esta página continuou pelo OCR local e tradução básica; revise as falas.`);
        }
        const originalContext=source.getContext('2d',{willReadFrequently:true}),detected=SDOCR.deduplicate(blocks);
        blocks=detected.map(block=>SDRender.findSpeechBalloon(originalContext,block,check)).filter(Boolean);
        if(detected.length>blocks.length)warnings.push(`${detected.length-blocks.length} área(s) indicadas pela IA não tinham um balão seguro e foram mantidas no original.`);
      }
      if(usedEngine==='local'){
        const localSettings={...settings,engine:'local',translator:'google'};let recognized;
        try{recognized=await SDOCR.extract(source,localSettings,(value,status)=>progress(.03+.55*value,status),check);}catch(error){check();if(fallbackReason){fallbackReason.message=`${fallbackReason.message} O modo básico também não conseguiu reconhecer esta página: ${error.message}`;throw fallbackReason;}throw error;}
        warnings.push(...recognized.warnings);
        // Reuse successfully translated AI balloons after a later tile fails.
        // Recognition always reads the original canvas, never edited pixels.
        const remaining=recognized.blocks.filter(block=>!blocks.some(done=>SDOCR.overlapRatio(done.box,block.box)>.5));
        if(remaining.length){const result=await SDProviders.translate(remaining.map(block=>block.text),localSettings,(value,status)=>progress(.6+.19*value,status),undefined,check);warnings.push(...result.warnings);blocks.push(...remaining.map((block,index)=>({...block,translated:result.translations[index].text,sourceLanguage:result.translations[index].sourceLanguage})));}
      }
      blocks=SDOCR.deduplicate(blocks).map((block,index)=>({...block,id:`block-${index+1}`}));sourceLanguage=SDProviders.majorityLanguage(blocks);
      check();if(!blocks.length)throw new Error('Nenhum balão de fala com texto legível e área segura foi identificado. O desenho original foi preservado; use Revisar para selecionar uma fala manualmente.');
      const rendered=await SDRender.render(source,blocks,settings,(value,status)=>progress(.8+.19*value,status),check);
      const result={...rendered,sourceLanguage,targetLanguage:SD.targetLanguage(settings),originalScale:loadedImage.scale,usedEngine,...(fallbackReason?{fallbackCode:fallbackReason.code||'GEMINI_UNAVAILABLE'}:{}),warnings:[...new Set([...warnings,...rendered.warnings])]};
      if(key)await cacheWrite(key,result).catch(()=>{});check();progress(1,'Tradução concluída');return result;
    }finally{if(source){source.width=1;source.height=1;}activateTranslationContext(null);}
  },signal);
}
export async function renderImage(dataUrl,blocks,inputSettings={},options={}){
  return queue(async()=>{activateTranslationContext({signal:options.signal});let source;try{await loadEngine();throwIfAborted(options.signal);const loadedImage=await SDRender.load(dataUrl);source=loadedImage.canvas;return {...await SDRender.render(source,blocks,sanitizeTranslationSettings(inputSettings),()=>{},()=>throwIfAborted(options.signal)),originalScale:loadedImage.scale};}finally{if(source){source.width=1;source.height=1;}activateTranslationContext(null);}},options.signal);
}
export async function translateTexts(texts,inputSettings={},options={}){
  return queue(async()=>{activateTranslationContext({signal:options.signal});try{await loadEngine();return await SDProviders.translate(texts,sanitizeTranslationSettings(inputSettings),(progress,status)=>options.onProgress?.({progress,status}),undefined,()=>throwIfAborted(options.signal));}finally{activateTranslationContext(null);}},options.signal);
}
export async function clearTranslationCache(){memory.clear();const db=await cacheDB();try{await new Promise((resolve,reject)=>{const transaction=db.transaction('images','readwrite');transaction.objectStore('images').clear();transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}}
