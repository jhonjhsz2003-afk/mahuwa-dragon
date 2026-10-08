const MD='https://api.mangadex.org';
const JK='https://api.jikan.moe/v4';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memory=new Map(),pending=new Map(),paces=new Map();
export function clearCatalogCache(){memory.clear();pending.clear();paces.clear();}
const fail=(status,message)=>Object.assign(new Error(message),{status});
const int=(value,min,max,fallback=min)=>Math.min(max,Math.max(min,Math.trunc(Number(value))||fallback));
const text=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[\u0000-\u001f]/g,' ').trim();
const languageTitle=attributes=>attributes.title?.['pt-br']||attributes.title?.en||attributes.altTitles?.find(title=>title.en)?.en||Object.values(attributes.title||{})[0]||'Sem título';
const translatedGenres={Action:'Ação',Adventure:'Aventura',Fantasy:'Fantasia',Romance:'Romance',Comedy:'Comédia',Drama:'Drama',Horror:'Terror',Mystery:'Mistério',Magic:'Magia','Martial Arts':'Artes marciais',Isekai:'Isekai','Slice of Life':'Cotidiano','Sci-Fi':'Ficção científica',Supernatural:'Sobrenatural',Sports:'Esportes','Full Color':'Colorido','Web Comic':'Webtoon',Reincarnation:'Reencarnação'};
export const PROVIDERS=[{id:'mangadex',name:'MangaDex',role:'Capas, catálogo e capítulos disponibilizados pela fonte',url:'https://mangadex.org'},{id:'jikan',name:'Jikan / MyAnimeList',role:'Informações e capas de novels; não fornece capítulos',url:'https://jikan.moe'},{id:'local',name:'Estúdio Dragon',role:'Histórias originais e arquivos importados por você',url:'/'}];

async function pace(provider) {
 const previous=paces.get(provider)||Promise.resolve();
 const next=previous.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,provider==='md'?270:450)));
 paces.set(provider,next);await next;
}
export async function providerJSON(provider,path,parameters={},ttl=300000,env={}) {
 const url=new URL((provider==='md'?MD:JK)+path);
 for(const [key,value] of Object.entries(parameters))for(const item of Array.isArray(value)?value:[value])if(item!==undefined&&item!==null)url.searchParams.append(key,String(item));
 const key=url.href,existing=memory.get(key);
 if(existing?.until>Date.now())return existing.value;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
   await pace(provider);
   let response;
   try {response=await fetch(url,{headers:{Accept:'application/json','User-Agent':env.MANGADEX_USER_AGENT||'MahuwaDragon/1.0 (manga reading application)'},signal:AbortSignal.timeout(provider==='jk'?4500:12000),cf:{cacheTtl:Math.round(ttl/1000),cacheEverything:true}});}
   catch(_){throw fail(503,`A fonte ${provider==='md'?'MangaDex':'Jikan'} não respondeu. As outras fontes continuam disponíveis.`);}
   if(!response.ok)throw fail(response.status===429?429:502,response.status===429?'A fonte está limitando consultas. Aguarde antes de tentar novamente.':`A fonte ${provider==='md'?'MangaDex':'Jikan'} está indisponível agora (${response.status}).`);
   const value=await response.json();
   if(provider==='md'&&value.result!=='ok')throw fail(502,'A fonte não retornou os dados esperados.');
   memory.delete(key);memory.set(key,{value,until:Date.now()+ttl});
   while(memory.size>180)memory.delete(memory.keys().next().value);
   return value;
 })();pending.set(key,task);
 try{return await task;}finally{pending.delete(key);}
}
function coverPath(id,file,size=null) {
 return UUID.test(id)&&/^[a-zA-Z0-9._-]{1,180}\.(jpe?g|png|webp)$/i.test(file||'')?`/api/cover/md/${id}/${encodeURIComponent(file)}${size?`.${size}.jpg`:''}`:'/assets/poster-placeholder.svg';
}
export function normalizeManga(raw,statistics) {
 const a=raw.attributes||{},cover=raw.relationships?.find(item=>item.type==='cover_art')?.attributes?.fileName;
 const language=a.originalLanguage||'ja';
 const kind=language==='ko'?'manhwa':language.startsWith('zh')?'manhua':'manga';
 const coverUrl=coverPath(raw.id,cover);
 return {id:`md:${raw.id}`,title:languageTitle(a),originalTitle:Object.values(a.title||{})[0]||'',description:text(a.description?.['pt-br']||a.description?.en||Object.values(a.description||{})[0]).slice(0,5000),coverUrl,backdropUrl:coverUrl,kind,originLanguage:language,rating:Number(statistics?.rating?.bayesian||statistics?.rating?.average)||null,followers:statistics?.follows||null,status:a.status||'ongoing',year:a.year||null,tags:(a.tags||[]).map(tag=>tag.attributes?.name?.en).filter(Boolean).map(tag=>translatedGenres[tag]||tag),tagIds:(a.tags||[]).map(tag=>tag.id),authors:(raw.relationships||[]).filter(item=>['author','artist'].includes(item.type)&&item.attributes?.name).map(item=>item.attributes.name).filter((name,index,all)=>all.indexOf(name)===index),provider:'mangadex',chapterCount:a.lastChapter?Number(a.lastChapter)||null:null,url:`https://mangadex.org/title/${raw.id}`,available:Boolean(a.latestUploadedChapter),languages:a.availableTranslatedLanguages||[],latestChapterId:a.latestUploadedChapter?`md:${a.latestUploadedChapter}`:null,updatedAt:a.updatedAt||'',createdAt:a.createdAt||'',externalLinks:Object.entries(a.links||{}).filter(([key,url])=>['raw','engtl'].includes(key)&&/^https:\/\//i.test(url)).map(([name,url])=>({name:name==='raw'?'Publicação original':'Edição oficial',url}))};
}
export function normalizeNovel(raw) {
 const coverUrl=raw.images?.webp?.large_image_url||raw.images?.jpg?.large_image_url||'/assets/poster-placeholder.svg';
 return {id:`jk:${raw.mal_id}`,title:raw.title_english||raw.title||raw.titles?.[0]?.title||'Sem título',originalTitle:raw.title_japanese||'',description:text(raw.synopsis).slice(0,5000),coverUrl,backdropUrl:coverUrl,kind:'novel',originLanguage:'ja',rating:Number(raw.score)||null,status:raw.status||'',year:raw.published?.prop?.from?.year||null,tags:(raw.genres||[]).map(tag=>translatedGenres[tag.name]||tag.name),authors:(raw.authors||[]).map(author=>author.name),provider:'jikan',chapterCount:raw.chapters||null,url:raw.url||`https://myanimelist.net/manga/${raw.mal_id}`,available:false,languages:[],externalLinks:(raw.external||[]).filter(link=>/^https:\/\//i.test(link.url)).map(link=>({name:link.name,url:link.url}))};
}
export const ORIGINAL_MEDIA=[
 {id:'local:dragon',title:'A Biblioteca do Dragão',originalTitle:'The Dragon Library',description:'Uma história original curta do Estúdio Dragon. Entre na biblioteca entre mundos e experimente o leitor com tradução automática dos balões.',coverUrl:'/assets/sample/cover.png',backdropUrl:'/assets/dragon-art.webp',kind:'manhwa',originLanguage:'en',rating:null,status:'completed',year:2026,tags:['Fantasia','Aventura','Original Dragon'],authors:['Estúdio Mahuwa Dragon'],provider:'local',chapterCount:1,url:'#/title/local%3Adragon',available:true,languages:['en']},
 {id:'local:chronicles',title:'Crônicas de uma Chama',originalTitle:'Chronicles of a Flame',description:'Um conto original do Estúdio Dragon. Leitura de texto com tamanho de fonte, largura e tradução, sem imagens nem OCR.',coverUrl:'/assets/sample/novel-cover.png',backdropUrl:'/assets/dragon-art.webp',kind:'novel',originLanguage:'en',rating:null,status:'completed',year:2026,tags:['Fantasia','Conto','Original Dragon'],authors:['Estúdio Mahuwa Dragon'],provider:'local',chapterCount:1,url:'#/title/local%3Achronicles',available:true,languages:['en']}
];
const mangaParams={limit:24,'includes[]':['cover_art','author','artist'],'contentRating[]':['safe','suggestive'],'hasAvailableChapters':'true'};
export async function mangaList(params,env) {
 const data=await providerJSON('md','/manga',{...mangaParams,...params},300000,env);
 return {items:data.data.map(item=>normalizeManga(item)),total:data.total||0};
}
async function ratings(items,env) {
 const ids=[...new Set(items.filter(item=>item.provider==='mangadex').map(item=>item.id.slice(3)))].slice(0,100);
 if(!ids.length)return;
 const result=await providerJSON('md','/statistics/manga',{'manga[]':ids},3600000,env).catch(()=>null);
 if(result?.statistics)for(const item of items){const stat=result.statistics[item.id.slice(3)];if(stat){item.rating=Number(stat.rating?.bayesian||stat.rating?.average)||null;item.followers=stat.follows||null;}}
}
async function latestInfo(items,env) {
 const ids=[...new Set(items.map(item=>item.latestChapterId?.slice(3)).filter(id=>UUID.test(id||'')))].slice(0,50);
 if(!ids.length)return;
 const response=await providerJSON('md','/chapter',{'ids[]':ids,limit:50,'includes[]':['manga','scanlation_group']},120000,env).catch(()=>null);
 const byId=new Map((response?.data||[]).map(raw=>[`md:${raw.id}`,normalizeChapter(raw)]));
 for(const item of items){const chapter=byId.get(item.latestChapterId);if(chapter){item.latestChapter=chapter;item.updatedAt=chapter.publishedAt;}}
}
export async function home(env) {
 const queries=[
  ['popular',mangaList({limit:36,'order[followedCount]':'desc'},env)],
  ['updates',mangaList({limit:24,'order[latestUploadedChapter]':'desc'},env)],
  ['top',mangaList({limit:24,'order[rating]':'desc'},env)],
  ['manhwa',mangaList({limit:18,'originalLanguage[]':'ko','order[followedCount]':'desc'},env)],
  ['manhua',mangaList({limit:18,'originalLanguage[]':['zh','zh-hk'],'order[followedCount]':'desc'},env)],
  ['recent',mangaList({limit:18,'order[createdAt]':'desc'},env)],
  ['novels',providerJSON('jk','/top/manga',{type:'lightnovel',limit:18,sfw:true},86400000,env).then(data=>({items:(data.data||[]).map(normalizeNovel)}))]
 ];
 const settled=await Promise.allSettled(queries.map(([,task])=>task));const data={},warnings=[];
 settled.forEach((result,index)=>{const name=queries[index][0];if(result.status==='fulfilled')data[name]=result.value.items;else{data[name]=[];warnings.push(result.reason.message);}});
 const all=Object.values(data).flat();await Promise.all([ratings(all,env),latestInfo(data.updates,env)]);
 const featured=[...data.manhwa,...data.popular].filter((item,index,items)=>items.findIndex(other=>other.id===item.id)===index).slice(0,5);
 return {ok:true,...data,trending:data.popular,featured,originals:ORIGINAL_MEDIA,providers:PROVIDERS,partial:warnings.length>0,warnings:[...new Set(warnings)],updatedAt:new Date().toISOString()};
}
export async function discover(parameters,env) {
 const kind=parameters.get('kind')||'all',page=int(parameters.get('page'),1,kind==='novel'?1000:417),sort=parameters.get('sort')||'popular',q=(parameters.get('q')||'').trim().slice(0,120);
 if(kind==='original')return {ok:true,items:ORIGINAL_MEDIA.filter(item=>!q||item.title.toLowerCase().includes(q.toLowerCase())),page:1,totalPages:1,total:ORIGINAL_MEDIA.length,hasMore:false};
 if(kind==='novel') {
   const data=await providerJSON('jk',q?'/manga':'/top/manga',{type:'lightnovel',limit:24,page,sfw:true,...(q?{q}:{}),...(q?{order_by:sort==='rating'?'score':sort==='new'?'start_date':'members',sort:'desc'}:{})},86400000,env);
   return {ok:true,items:(data.data||[]).map(normalizeNovel),page,totalPages:data.pagination?.last_visible_page||1,total:data.pagination?.items?.total||null,hasMore:Boolean(data.pagination?.has_next_page)};
 }
 const order=q?'relevance':({popular:'followedCount',rating:'rating',updated:'latestUploadedChapter',new:'createdAt'})[sort]||'followedCount';
 const params={limit:Math.min(24,10000-(page-1)*24),offset:(page-1)*24,[`order[${order}]`]:'desc',...(q?{title:q}:{}),...(kind==='manhwa'?{'originalLanguage[]':'ko'}:kind==='manhua'?{'originalLanguage[]':['zh','zh-hk']}:kind==='manga'?{'originalLanguage[]':'ja'}:{})};
 if(/^[a-zA-Z-]{2,5}$/.test(parameters.get('language')||''))params['availableTranslatedLanguage[]']=parameters.get('language');
 if(UUID.test(parameters.get('tag')||''))params['includedTags[]']=parameters.get('tag');
 const result=await mangaList(params,env);await ratings(result.items,env);
 return {ok:true,...result,page,totalPages:Math.ceil(Math.min(result.total,10000)/24),hasMore:page*24<Math.min(result.total,10000)};
}
export async function detail(id,env) {
 if(id.startsWith('local:')){const item=ORIGINAL_MEDIA.find(item=>item.id===id);if(!item)throw fail(404,'História não encontrada.');return {ok:true,item,recommendations:ORIGINAL_MEDIA.filter(other=>other.id!==id)};}
 if(/^jk:[1-9]\d{0,8}$/.test(id)) {const response=await providerJSON('jk',`/manga/${id.slice(3)}/full`,{},86400000,env);if(!/^(light\s*novel|novel)$/i.test(response.data?.type||''))throw fail(404,'Esta entrada não é uma novel. Procure a versão em quadrinhos no catálogo.');return {ok:true,item:normalizeNovel(response.data),recommendations:[]};}
 if(!id.startsWith('md:')||!UUID.test(id.slice(3)))throw fail(400,'Obra inválida.');
 const response=await providerJSON('md',`/manga/${id.slice(3)}`,{'includes[]':['cover_art','author','artist']},600000,env);
 if(!['safe','suggestive'].includes(response.data.attributes?.contentRating))throw fail(404,'Este título não está disponível neste catálogo.');
 const item=normalizeManga(response.data);await ratings([item],env);
 return {ok:true,item,recommendations:[]};
}
export function normalizeChapter(raw) {
 const a=raw.attributes||{};return {id:`md:${raw.id}`,mediaId:`md:${raw.relationships?.find(item=>item.type==='manga')?.id||''}`,number:a.chapter??'',title:a.title||'',language:a.translatedLanguage||'en',pages:a.pages||0,publishedAt:a.publishAt||a.createdAt||'',group:raw.relationships?.find(item=>item.type==='scanlation_group')?.attributes?.name||'Fonte MangaDex',externalUrl:/^https:\/\//.test(a.externalUrl||'')?a.externalUrl:null,volume:a.volume||''};
}
export async function chapters(id,parameters,env) {
 if(id==='local:dragon'||id==='local:chronicles') {const chapter={id:id==='local:dragon'?'local:dragon-chapter-1':'local:chronicles-chapter-1',mediaId:id,number:'1',title:'A primeira chama',language:'en',pages:id==='local:dragon'?3:1,publishedAt:'2026-10-05',group:'Estúdio Mahuwa Dragon',externalUrl:null,volume:'1'};const language=parameters.get('language');const items=!language||language==='all'||language==='en'?[chapter]:[];return {ok:true,chapters:items,page:1,totalPages:1,total:items.length,hasMore:false};}
 if(id.startsWith('jk:'))return {ok:true,chapters:[],page:1,totalPages:0,total:0,hasMore:false,notice:'Esta fonte fornece informações e capas. Para ler, abra uma edição oficial ou importe um arquivo seu.'};
 if(!id.startsWith('md:')||!UUID.test(id.slice(3)))throw fail(400,'Obra inválida.');
 const page=int(parameters.get('page'),1,200),language=parameters.get('language')||'pt-br',order=parameters.get('order')==='desc'?'desc':'asc';
 const response=await providerJSON('md',`/manga/${id.slice(3)}/feed`,{limit:50,offset:(page-1)*50,'order[volume]':order,'order[chapter]':order,'includes[]':['manga','scanlation_group'],'contentRating[]':['safe','suggestive'],includeEmptyPages:'0',includeFutureUpdates:'0',...(language!=='all'&&/^[a-z-]{2,5}$/.test(language)?{'translatedLanguage[]':language}:{})},120000,env);
 const visibleTotal=Math.min(response.total||0,10000);
 return {ok:true,chapters:response.data.map(normalizeChapter),page,totalPages:Math.ceil(visibleTotal/50),total:response.total||0,hasMore:page*50<visibleTotal,...(response.total>10000?{notice:'A fonte limita a busca aos primeiros 10.000 capítulos. Filtre o idioma para reduzir a lista.'}:{})};
}
export async function atHome(id,env) {
 if(!UUID.test(id))throw fail(400,'Capítulo inválido.');
 const data=await providerJSON('md',`/at-home/server/${id}`,{forcePort443:true},9*60000,env);
 const base=new URL(data.baseUrl);
 if(base.protocol!=='https:'||base.port&&base.port!=='443'||!/(^|\.)mangadex\.(network|org)$/.test(base.hostname)||base.username||base.password)throw fail(502,'Servidor de imagens inesperado.');
 if(!/^[a-zA-Z0-9]{20,100}$/.test(data.chapter?.hash||''))throw fail(502,'Capítulo inválido na fonte.');
 return data;
}
export async function chapterDetail(id,parameters,env) {
 if(id.startsWith('local:')) {
   const novel=id==='local:chronicles-chapter-1';if(!novel&&id!=='local:dragon-chapter-1')throw fail(404,'Capítulo não encontrado.');
   const media=ORIGINAL_MEDIA[novel?1:0];const chapter={id,mediaId:media.id,number:'1',title:'A primeira chama',language:'en',kind:media.kind};
   const pages=novel?[{index:0,filename:'chronicles.txt',text:'The smallest flame was born in a library where every book opened a door to another world. Lina had never seen a dragon, but she had heard its voice between the pages.\n\nOne evening, a green light crossed the shelves. A little dragon emerged from an unfinished story. "A story cannot live without a reader," it said. "Will you help me find my ending?"\n\nLina opened the first book. Beyond its cover, a sky full of floating islands waited for her. She took the dragon in her hands and stepped into the adventure. For the first time, she understood that courage could begin as a very small flame.'}]:[1,2,3].map((number,index)=>({index,filename:`page-${number}.png`,url:`/assets/sample/page-${number}.png`}));
   return {ok:true,chapter,media,pages,previousId:null,nextId:null};
 }
 if(!id.startsWith('md:')||!UUID.test(id.slice(3)))throw fail(400,'Capítulo inválido.');
 const response=await providerJSON('md',`/chapter/${id.slice(3)}`,{'includes[]':['manga','scanlation_group']},300000,env);const chapter=normalizeChapter(response.data);
 if(chapter.externalUrl){const media=chapter.mediaId==='md:'?null:(await detail(chapter.mediaId,env)).item;return {ok:true,chapter,media,pages:[],externalUrl:chapter.externalUrl,previousId:null,nextId:null};}
 const imageData=await atHome(id.slice(3),env);const quality=parameters.get('quality')==='lite'?'lite':'original';
 const files=quality==='lite'&&imageData.chapter.dataSaver?.length?imageData.chapter.dataSaver:imageData.chapter.data;
 const pages=(files||[]).map((filename,index)=>({filename,index,url:`/api/page/md/${id.slice(3)}/${index}?quality=${quality}`}));
 const media=chapter.mediaId==='md:'?null:(await detail(chapter.mediaId,env)).item;
 let previousId=null,nextId=null;
 try {
   const group=response.data.relationships?.find(item=>item.type==='scanlation_group')?.id;
   const aggregate=await providerJSON('md',`/manga/${chapter.mediaId.slice(3)}/aggregate`,{'translatedLanguage[]':chapter.language,...(UUID.test(group||'')?{'groups[]':group}:{})},300000,env);
   const flattened=Object.values(aggregate.volumes||{}).flatMap(volume=>Object.values(volume.chapters||{}).map(entry=>({...entry,volume:volume.volume})));
   const number=value=>value==='none'||value===null?-1:Number.parseFloat(value)||0;
   flattened.sort((a,b)=>number(a.volume)-number(b.volume)||number(a.chapter)-number(b.chapter));
   const index=flattened.findIndex(entry=>entry.id===id.slice(3)||(entry.others||[]).includes(id.slice(3)));
   if(index>=0){previousId=flattened[index-1]?.id?`md:${flattened[index-1].id}`:null;nextId=flattened[index+1]?.id?`md:${flattened[index+1].id}`:null;}
 } catch(_) {}
 return {ok:true,chapter,media,pages,previousId,nextId};
}
