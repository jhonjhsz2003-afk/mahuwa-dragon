export const translationDefaults=Object.freeze({targetLanguage:'pt',sourceLanguage:'auto',engine:'gemini',translator:'gemini',autoTranslate:true,translateSfx:false,fontFamily:'comic',fontScale:1,cleanup:'smart',minConfidence:82,glossary:'',rememberCache:true});
let currentContext=null;
const providerPauses=new Map();
export function activateTranslationContext(context){currentContext=context;}
export function throwIfAborted(signal){if(signal?.aborted)throw new DOMException('Tradução cancelada.','AbortError');}
export class TranslationError extends Error{
  constructor(message,details={}){super(message);this.name='TranslationError';for(const key of ['status','code','provider','retryable','retryAfter','resetAt','quotaScope'])if(details[key]!==undefined)this[key]=details[key];}
}
function retrySeconds(value){if(value===null||value===undefined)return 0;const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds):Math.max(0,Math.ceil((Date.parse(value)-Date.now())/1000))||0;}
export function translationPause(provider){
  const pause=providerPauses.get(provider);if(!pause)return null;
  if(pause.until<=Date.now()){providerPauses.delete(provider);return null;}
  return new TranslationError(pause.error.message,{...pause.error,retryAfter:Math.ceil((pause.until-Date.now())/1000)});
}
export function canFallbackToBasic(error){return error?.name!=='AbortError'&&!['request','google'].includes(error?.provider)&&(/^(?:GEMINI_|DAILY_)/.test(error?.code||'')||[401,429,502,503].includes(error?.status));}
function rememberPause(error){
  if(![401,429,502,503].includes(error.status))return;
  const seconds=error.retryAfter||([401,502,503].includes(error.status)?30:60),reset=Date.parse(error.resetAt||'');
  const until=Number.isFinite(reset)?Math.max(Date.now()+seconds*1000,reset):Date.now()+seconds*1000;
  providerPauses.set(error.provider||'request',{until,error});
}
export async function postTranslation(path,body,signal=currentContext?.signal){
  if(!['/api/translate/text','/api/translate/vision'].includes(path))throw new Error('Rota de tradução inválida.');
  throwIfAborted(signal);
  const provider=path.endsWith('/vision')||body.provider==='gemini'?'gemini':'google',paused=translationPause('request')||translationPause(provider)||(provider==='google'&&translationPause('cloudflare'));if(paused)throw paused;
  let response;try{response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});}catch(error){if(error.name==='AbortError')throw error;throw new TranslationError('A conexão com o tradutor falhou. Verifique sua internet.',{status:503,code:'TRANSLATION_UNAVAILABLE',provider,retryable:true,retryAfter:15});}
  let data;try{data=await response.json();}catch{throw new TranslationError('O servidor de tradução não respondeu corretamente.',{status:response.status||502,code:'TRANSLATION_UNAVAILABLE',provider,retryable:true,retryAfter:15});}
  throwIfAborted(signal);
  if(!response.ok||!data?.ok){
    const error=new TranslationError(data?.error||`Não foi possível traduzir (${response.status}).`,{status:response.status,code:data?.code||'TRANSLATION_UNAVAILABLE',provider:data?.provider||provider,retryable:data?.retryable??[429,502,503].includes(response.status),retryAfter:retrySeconds(data?.retryAfter||response.headers.get('Retry-After')),resetAt:data?.resetAt,quotaScope:data?.quotaScope});
    rememberPause(error);throw error;
  }
  providerPauses.delete(provider);
  if(provider==='google')providerPauses.delete('cloudflare');
  return data;
}
export function sanitizeTranslationSettings(settings={}){
  return {...translationDefaults,targetLanguage:String(settings.targetLanguage||'pt').slice(0,20),sourceLanguage:String(settings.sourceLanguage||'auto').slice(0,20),engine:settings.engine==='local'?'local':'gemini',translator:settings.engine==='local'?'google':'gemini',autoTranslate:settings.autoTranslate!==false,translateSfx:!!settings.translateSfx,fontFamily:['sans','serif'].includes(settings.fontFamily)?settings.fontFamily:'comic',fontScale:Math.max(.6,Math.min(1.8,Number(settings.fontScale)||1)),cleanup:settings.cleanup==='solid'?'solid':'smart',minConfidence:Math.max(0,Math.min(95,Number(settings.minConfidence??40))),glossary:String(settings.glossary||'').slice(0,5000),rememberCache:settings.rememberCache!==false};
}
globalThis.SD={DEFAULTS:translationDefaults,targetLanguage:settings=>settings.targetLanguage&&settings.targetLanguage!=='auto'?settings.targetLanguage:(navigator.language||'pt').split('-')[0],assetURL:path=>new URL(`/translation/${path}`,location.origin).href,uid:()=>crypto.randomUUID(),requestJSON:postTranslation,checkCancelled:()=>throwIfAborted(currentContext?.signal)};
