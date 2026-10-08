const fail=(status,message)=>Object.assign(new Error(message),{status});
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const idPattern=/^[a-zA-Z0-9]{1,80}$/;
const API='https://api.giphy.com/v1/gifs';
function key(env){const value=String(env.GIPHY_API_KEY||'').trim();if(!value)throw fail(503,'A galeria do GIPHY não está conectada neste deploy.');return value;}
function timeoutSignal(request){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);request.signal?.addEventListener('abort',()=>controller.abort(),{once:true});return {signal:controller.signal,done:()=>clearTimeout(timer)};}
function upstreamUrl(env,type,params){const apiKey=key(env),url=new URL(type==='id'?`${API}/${params.id}`:`${API}/${type}`);url.searchParams.set('api_key',apiKey);if(type!=='id'){url.searchParams.set('limit','24');url.searchParams.set('offset',String(params.offset));url.searchParams.set('rating','pg-13');if(type==='search'){url.searchParams.set('q',params.query);url.searchParams.set('lang','pt');}}return url;}

export async function validateGiphyId(id,env){
 if(!idPattern.test(id||''))return false;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
 try{
   const response=await fetch(upstreamUrl(env,'id',{id}),{signal:controller.signal,headers:{Accept:'application/json'}});
   if(!response.ok)return false;
   const data=await response.json();
   return data?.data?.id===id;
 }catch{return false;}finally{clearTimeout(timer);}
}
export async function giphy(request,env){
 if(request.method!=='GET')throw fail(405,'Método não permitido.');
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/giphy/config')return json({ok:true,configured:Boolean(String(env.GIPHY_API_KEY||'').trim()),proxy:true,rating:'pg-13',language:'pt'});
 let type,params={};
 const match=path.match(/^\/api\/giphy\/gifs\/([a-zA-Z0-9]{1,80})$/);
 if(match){type='id';params.id=match[1];}
 else if(path==='/api/giphy/search'){type='search';params.query=String(url.searchParams.get('q')||'manga anime').trim().slice(0,50)||'manga anime';params.offset=Math.max(0,Math.min(4999,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));}
 else if(path==='/api/giphy/trending'){type='trending';params.offset=Math.max(0,Math.min(499,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));}
 else throw fail(404,'Rota GIPHY não encontrada.');
 if(type==='id'&&!idPattern.test(params.id))throw fail(400,'GIF inválido.');
 const timer=timeoutSignal(request);
 try{
   const response=await fetch(upstreamUrl(env,type,params),{signal:timer.signal,headers:{Accept:'application/json'}});
   if(response.status===429)throw fail(429,'A galeria atingiu o limite de consultas. Aguarde um pouco.');
   if(!response.ok)throw fail(502,'O GIPHY não respondeu agora. Tente novamente em instantes.');
   const data=await response.json();
   if(data?.meta?.status&&data.meta.status!==200)throw fail(502,'O GIPHY recusou esta consulta.');
   return json(data,200,{'Cache-Control':type==='id'?'public,max-age=900,s-maxage=3600':'public,max-age=30,s-maxage=90'});
 }catch(error){if(error?.name==='AbortError')throw fail(504,'O GIPHY demorou demais para responder.');throw error;}finally{timer.done();}
}
