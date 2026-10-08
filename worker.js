import {home,discover,detail,chapters,chapterDetail,PROVIDERS} from './server/catalog.js';
import {imageResponse} from './server/images.js';
import {auth,cleanupSessions} from './server/auth.js';
import {media} from './server/media.js';
import {community} from './server/community.js';
import {translation} from './server/translation.js';
import {giphy} from './server/giphy.js';
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...headers}});
const fail=(status,message)=>Object.assign(new Error(message),{status});
const decode=value=>{try{return decodeURIComponent(value);}catch(_){throw fail(400,'Endereço inválido.');}};
async function catalogRoute(request,env) {
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/catalog/home')return home(env);
 if(path==='/api/catalog/discover'||path==='/api/catalog/search')return discover(url.searchParams,env);
 const list=path.match(/^\/api\/catalog\/([^/]+)\/chapters$/);
 if(list)return chapters(decode(list[1]),url.searchParams,env);
 const item=path.match(/^\/api\/catalog\/([^/]+)$/);
 if(item)return detail(decode(item[1]),env);
 const chapter=path.match(/^\/api\/chapters\/([^/]+)$/);
 if(chapter)return chapterDetail(decode(chapter[1]),url.searchParams,env);
 throw fail(404,'Página não encontrada.');
}
export default {
 async fetch(request,env,ctx={waitUntil:promise=>promise.catch(()=>{})}) {
  const url=new URL(request.url);
  try {
   if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
   if(url.pathname.startsWith('/api/auth/'))return await auth(request,env);
   if(url.pathname.startsWith('/api/avatar/')||url.pathname.startsWith('/api/profile/avatar'))return await media(request,env);
   if(/^\/api\/(library|progress|settings|profiles|comments)(\/|$)/.test(url.pathname))return await community(request,env,async id=>(await detail(id,env)).item);
   if(url.pathname.startsWith('/api/translate/'))return await translation(request,env,ctx);
   if(url.pathname.startsWith('/api/cover/')||url.pathname.startsWith('/api/page/'))return await imageResponse(request,env,ctx);
   if(url.pathname.startsWith('/api/giphy/'))return await giphy(request,env);
   if(request.method!=='GET')throw fail(405,'Método não permitido.');
   if(url.pathname==='/api/health')return json({ok:true,service:'Mahuwa Dragon',version:'1.2.0',profile:{giphy:Boolean(String(env.GIPHY_API_KEY||'').trim()),r2:Boolean(env.AVATARS?.get)}});
   if(url.pathname==='/api/config')return json({ok:true,translation:{defaultEngine:env.GEMINI_API_KEY?'gemini':'local',google:true,cloudflare:Boolean(env.AI?.run),basicProvider:env.AI?.run?'cloudflare':'google',gemini:Boolean(env.GEMINI_API_KEY),geminiRequiresLogin:true},providers:PROVIDERS,registrationAvailable:Boolean(env.DB),profile:{giphy:Boolean(String(env.GIPHY_API_KEY||'').trim()),r2:Boolean(env.AVATARS?.get)}});
   if(!/^\/api\/(catalog|chapters)\//.test(url.pathname))throw fail(404,'Página não encontrada.');
   const cache=globalThis.caches?.default;
   const key=new Request(url.href,{method:'GET'}),hit=cache?await cache.match(key):null;
   if(hit)return hit;
   const data=await catalogRoute(request,env);
   const response=json(data,200,{'Cache-Control':data.partial?'public,max-age=20,s-maxage=60':'public,max-age=60,s-maxage=300'});
   if(cache)ctx.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
   return response;
  }catch(error) {
   return json({ok:false,error:error.status?error.message:'Não foi possível concluir agora. Tente novamente em alguns instantes.'},error.status||503);
  }
 },
 async scheduled(controller,env,ctx) {
   if(env.DB)ctx.waitUntil(cleanupSessions(env));
 }
};
