import {UUID,atHome} from './catalog.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function allowed(url) {
 return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&/(^|\.)mangadex\.(org|network)$/.test(url.hostname);
}
async function remoteImage(url,request,env) {
 for(let redirect=0;redirect<3;redirect++) {
   if(!allowed(url))throw fail(502,'Servidor de imagens não autorizado.');
   const response=await fetch(url,{headers:{'User-Agent':env.MANGADEX_USER_AGENT||'MahuwaDragon/1.0 (manga reading application)',Accept:'image/avif,image/webp,image/png,image/jpeg,image/*'},redirect:'manual',signal:AbortSignal.timeout(20000),cf:{cacheTtl:3600,cacheEverything:true}});
   if([301,302,303,307,308].includes(response.status)){const destination=response.headers.get('Location');if(!destination)throw fail(502,'Redirecionamento inválido.');url=new URL(destination,url);continue;}
   if(!response.ok)throw fail(response.status===404?404:response.status===429?429:502,'A fonte não conseguiu entregar esta imagem. Tente novamente em alguns instantes.');
   const type=(response.headers.get('Content-Type')||'').split(';')[0];
   if(!/^image\/(png|jpeg|webp|gif|avif)$/i.test(type))throw fail(502,'A fonte devolveu um formato inesperado.');
   const length=Number(response.headers.get('Content-Length'))||0;
   if(length>24*1024*1024)throw fail(413,'Imagem grande demais. Selecione qualidade econômica.');
   const headers={'Content-Type':type,'Cache-Control':'public, max-age=300, s-maxage=3600','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
   if(length)headers['Content-Length']=String(length);
   return new Response(request.method==='HEAD'?null:response.body,{status:200,headers});
 }
 throw fail(502,'Muitos redirecionamentos na fonte de imagens.');
}
export async function imageResponse(request,env,ctx) {
 const path=new URL(request.url).pathname;
 const cover=path.match(/^\/api\/cover\/md\/([^/]+)\/([^/]+)$/);
 const page=path.match(/^\/api\/page\/md\/([^/]+)\/(\d{1,4})$/);
 if(!['GET','HEAD'].includes(request.method))throw fail(405,'Método não permitido.');
 const cache=globalThis.caches?.default,key=new Request(request.url,{method:'GET'});
 const hit=cache?await cache.match(key):null;
 if(hit)return request.method==='HEAD'?new Response(null,{status:hit.status,headers:hit.headers}):hit;
 let url;
 if(cover) {
   const id=cover[1];let file;try{file=decodeURIComponent(cover[2]);}catch(_){throw fail(400,'Capa inválida.');}
   if(!UUID.test(id)||!(/^[a-zA-Z0-9_-]{1,100}\.(jpe?g|png|webp)(\.(256|512)\.jpg)?$/i.test(file)))throw fail(400,'Capa inválida.');
   url=new URL(`https://uploads.mangadex.org/covers/${id}/${file}`);
 } else if(page) {
   if(!UUID.test(page[1]))throw fail(400,'Capítulo inválido.');
   const data=await atHome(page[1],env),quality=new URL(request.url).searchParams.get('quality');
   const lite=quality==='lite'&&data.chapter.dataSaver?.length;
   const files=lite?data.chapter.dataSaver:data.chapter.data,index=Number(page[2]),file=files?.[index];
   if(!file||!/^[a-zA-Z0-9._-]{1,220}\.(jpe?g|png|webp)$/i.test(file))throw fail(404,'Página não encontrada.');
   url=new URL(`${data.baseUrl.replace(/\/$/,'')}/${lite?'data-saver':'data'}/${data.chapter.hash}/${file}`);
 } else throw fail(404,'Imagem não encontrada.');
 const response=await remoteImage(url,request,env);
 if(cache&&request.method==='GET')ctx?.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
 return response;
}
