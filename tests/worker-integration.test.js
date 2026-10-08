import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../worker.js';
import {normalizeManga,clearCatalogCache} from '../server/catalog.js';
import {validateMetadata} from '../server/community.js';
import {createDB,request,cookieOf} from './account-support.js';

// Real Worker dispatch + WebCrypto + SQLite. External provider responses are
// fixtures; this test never contacts MangaDex, Jikan, Google or Gemini.
const mangaId='aa000011-0000-4000-8000-000000000001';
const chapters=['bb000011-0000-4000-8000-000000000001','bb000011-0000-4000-8000-000000000002','bb000011-0000-4000-8000-000000000003'];
const externalId='ff000011-0000-4000-8000-000000000004';
const groupId='cc000011-0000-4000-8000-000000000001',coverFile='dd000011-0000-4000-8000-000000000001.jpg';
const rawManga={id:mangaId,attributes:{title:{en:'Integration Dragon'},originalLanguage:'ko',contentRating:'safe',latestUploadedChapter:chapters[1],availableTranslatedLanguages:['pt-br','en'],status:'ongoing'},relationships:[{type:'cover_art',attributes:{fileName:coverFile}}]};
const rawChapter={id:chapters[1],attributes:{chapter:'1.5',volume:'1',translatedLanguage:'pt-br',pages:2},relationships:[{type:'manga',id:mangaId},{type:'scanlation_group',id:groupId,attributes:{name:'Fixture Group'}}]};
const normalized=normalizeManga(rawManga);
assert.equal(validateMetadata(normalized,'md:'+mangaId,'https://mahuwa.test').coverUrl,normalized.coverUrl);
const DB=createDB(),env={DB,ASSETS:{fetch:async()=>new Response('<!doctype html><title>Fixture assets</title>',{headers:{'Content-Type':'text/html'}})}};
const background=[];const ctx={waitUntil:promise=>background.push(promise)};
const fetchWorker=req=>worker.fetch(req,env,ctx);
const nativeFetch=globalThis.fetch,nativeCaches=globalThis.caches,providerCalls=[];
clearCatalogCache();
const cached=new Map();
globalThis.caches={default:{match:async key=>cached.get(key.url)?.clone(),put:async(key,response)=>{cached.set(key.url,response);}}};
globalThis.fetch=async input=>{
  const url=new URL(input);providerCalls.push(url);
  if(url.hostname==='api.mangadex.org'){
    if(url.pathname==='/manga')return Response.json({result:'ok',data:[rawManga],total:12000});
    if(url.pathname===`/manga/${mangaId}`)return Response.json({result:'ok',data:rawManga});
    if(url.pathname===`/manga/${mangaId}/feed`)return Response.json({result:'ok',data:[rawChapter],total:12050});
    if(url.pathname===`/chapter/${chapters[1]}`)return Response.json({result:'ok',data:rawChapter});
    if(url.pathname===`/chapter/${externalId}`)return Response.json({result:'ok',data:{...rawChapter,id:externalId,attributes:{...rawChapter.attributes,pages:0,externalUrl:'https://example.org/external-chapter'}}});
    if(url.pathname===`/manga/${mangaId}/aggregate`)return Response.json({result:'ok',volumes:{'2':{volume:'2',chapters:{'1':{chapter:'1',id:chapters[2]}}},'1':{volume:'1',chapters:{'1.5':{chapter:'1.5',id:'ee000011-0000-4000-8000-000000000001',others:[chapters[1]]},'1':{chapter:'1',id:chapters[0]}}}}});
    if(url.pathname===`/at-home/server/${chapters[1]}`)return Response.json({result:'ok',baseUrl:'https://images.mangadex.network',chapter:{hash:'0123456789abcdef0123456789abcdef',data:['001.page.jpg','002.png'],dataSaver:['001.small.jpg','002.small.jpg']}});
    if(url.pathname==='/statistics/manga')return Response.json({result:'ok',statistics:{[mangaId]:{rating:{bayesian:8.6},follows:1200}}});
    if(url.pathname==='/chapter')return Response.json({result:'ok',data:[rawChapter]});
  }
  if(url.hostname==='api.jikan.moe')throw new Error('Fixture provider unavailable');
  if(url.hostname==='uploads.mangadex.org'&&url.pathname.endsWith('/reject-redirect.jpg'))return new Response(null,{status:302,headers:{Location:'https://evil.example/private.png'}});
  if(url.hostname==='uploads.mangadex.org'&&url.pathname.endsWith('/reject-mime.jpg'))return new Response('<script>invalid image</script>',{headers:{'Content-Type':'text/html'}});
  if(['uploads.mangadex.org','images.mangadex.network'].includes(url.hostname))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png','Content-Length':'4'}});
  if(url.hostname==='generativelanguage.googleapis.com')return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({translations:[{text:'Olá, dragão!',sourceLanguage:'en'}]})}]}}]});
  throw new Error('Unexpected external fetch: '+url.href);
};
try{
  assert.equal((await fetchWorker(request('/'))).status,200);
  const config=await(await fetchWorker(request('/api/config'))).json();assert.equal(config.registrationAvailable,true);assert.equal(config.translation.gemini,false);assert.ok(!JSON.stringify(config).includes('AUTH_SECRET'));
  const absent=await worker.fetch(request('/api/auth/register',{method:'POST',data:{name:'Offline Reader',email:'offline@example.com',password:'A-real-password-123!'}}),{ASSETS:env.ASSETS},ctx);assert.equal(absent.status,503);
  const signup=await fetchWorker(request('/api/auth/register',{method:'POST',data:{name:'Integration Reader',email:'integration@example.com',password:'A-real-password-123!'}}));assert.equal(signup.status,200);const cookie=cookieOf(signup),user=(await signup.json()).user;
  assert.equal((await(await fetchWorker(request('/api/auth/me',{cookie}))).json()).user.id,user.id);
  const freshSettings=await(await fetchWorker(request('/api/settings',{cookie}))).json();assert.equal(freshSettings.settings.autoTranslate,true);assert.equal(freshSettings.settings.targetLanguage,'pt');
  assert.equal((await fetchWorker(request('/api/library',{method:'POST',cookie,data:{mediaId:'local:dragon',kind:'favorite'}}))).status,200);
  const library=await(await fetchWorker(request('/api/library',{cookie}))).json();assert.equal(library.items[0].item.coverUrl,'/assets/sample/cover.png');assert.equal(library.items[0].item.url,'/#/title/local%3Adragon');
  assert.equal((await fetchWorker(request('/api/progress',{method:'POST',cookie,data:{mediaId:'local:dragon',chapterId:'local:dragon-chapter-1',page:2,totalPages:3,percent:66}}))).status,200);
  assert.equal((await fetchWorker(request('/api/settings',{method:'POST',cookie,data:{settings:{autoTranslate:true,readerDirection:'rtl',motion:false,economy:true}}}))).status,200);
  const appearance=await(await fetchWorker(request('/api/settings',{cookie}))).json();assert.equal(appearance.settings.motion,false);assert.equal(appearance.settings.economy,true);assert.equal(appearance.settings.autoTranslate,true);
  const profile=await(await fetchWorker(request('/api/profiles/'+user.id))).json();assert.equal(profile.private,true);assert.equal(profile.user.email,undefined);assert.deepEqual(profile.library,[]);
  console.log('PASS: Worker account/library/progress/settings/profile routes use real DB, canonical local metadata and safe public profiles');

  const cover=await fetchWorker(request(normalized.coverUrl));assert.equal(cover.status,200);assert.equal(cover.headers.get('Content-Type'),'image/png');await Promise.all(background);
  const callsAtCover=providerCalls.length,coverHead=await fetchWorker(request(normalized.coverUrl,{method:'HEAD'}));assert.equal(coverHead.status,200);assert.equal(coverHead.body,null);assert.equal(providerCalls.length,callsAtCover);
  assert.equal((await fetchWorker(request(`/api/cover/md/${mangaId}/..%2Fprivate.jpg`))).status,400);
  assert.equal((await fetchWorker(request(`/api/cover/md/${mangaId}/%E0%A4%A.jpg`))).status,400);
  assert.equal((await fetchWorker(request(`/api/cover/md/${mangaId}/reject-redirect.jpg`))).status,502);assert.ok(!providerCalls.some(url=>url.hostname==='evil.example'));
  assert.equal((await fetchWorker(request(`/api/cover/md/${mangaId}/reject-mime.jpg`))).status,502);
  assert.equal((await fetchWorker(request(`/api/page/md/${chapters[1]}/9999`))).status,404);
  const image=await fetchWorker(request(`/api/page/md/${chapters[1]}/0?quality=lite`));assert.equal(image.status,200);assert.ok(providerCalls.some(url=>url.pathname.endsWith('/data-saver/0123456789abcdef0123456789abcdef/001.small.jpg')));
  console.log('PASS: canonical cover matches image proxy; cached HEAD has no body; traversal and missing page rejected; lite page maps to approved source');

  const listing=await(await fetchWorker(request(`/api/catalog/md%3A${mangaId}/chapters?language=all&page=200&order=desc`))).json();assert.equal(listing.page,200);assert.equal(listing.totalPages,200);assert.equal(listing.hasMore,false);assert.ok(listing.notice);
  const feedCall=providerCalls.find(url=>url.pathname.endsWith('/feed'));assert.equal(feedCall.searchParams.get('offset'),'9950');assert.equal(feedCall.searchParams.get('order[chapter]'),'desc');assert.equal(feedCall.searchParams.get('translatedLanguage[]'),null);
  const chapter=await(await fetchWorker(request('/api/chapters/md%3A'+chapters[1]))).json();assert.equal(chapter.previousId,'md:'+chapters[0]);assert.equal(chapter.nextId,'md:'+chapters[2]);assert.equal(chapter.pages.length,2);assert.ok(chapter.pages.every(page=>page.url.startsWith('/api/page/md/')));
  assert.ok(providerCalls.some(url=>url.pathname.endsWith('/aggregate')&&url.searchParams.get('translatedLanguage[]')==='pt-br'&&url.searchParams.get('groups[]')===groupId));
  const external=await(await fetchWorker(request('/api/chapters/md%3A'+externalId))).json();assert.equal(external.media.id,'md:'+mangaId);assert.deepEqual(external.pages,[]);assert.equal(external.externalUrl,'https://example.org/external-chapter');assert.ok(!providerCalls.some(url=>url.pathname===`/at-home/server/${externalId}`));
  const lastDiscover=await(await fetchWorker(request('/api/catalog/discover?q=integration-limit&page=417'))).json();assert.equal(lastDiscover.page,417);assert.equal(lastDiscover.totalPages,417);assert.equal(lastDiscover.hasMore,false);const lastQuery=providerCalls.find(url=>url.searchParams.get('title')==='integration-limit');assert.equal(lastQuery.searchParams.get('offset'),'9984');assert.equal(lastQuery.searchParams.get('limit'),'16');
  console.log('PASS: bounded last chapter/catalog pages; decimal chapters and aggregate alternate IDs retain correct previous/next in language/group');

  const home=await(await fetchWorker(request('/api/catalog/home'))).json();assert.equal(home.ok,true);assert.equal(home.partial,true);assert.equal(home.popular[0].id,'md:'+mangaId);assert.equal(home.popular[0].provider,'mangadex');assert.equal(home.novels.length,0);assert.ok(home.warnings.some(warning=>warning.includes('Jikan')));assert.ok(home.originals.every(item=>item.provider==='local'));
  await Promise.all(background);const before=providerCalls.length;await fetchWorker(request('/api/catalog/home'));assert.equal(providerCalls.length,before);
  const novelChapter=await(await fetchWorker(request('/api/chapters/local%3Achronicles-chapter-1'))).json();assert.equal(novelChapter.chapter.kind,'novel');assert.ok(novelChapter.pages[0].text.length>200);assert.equal((await(await fetchWorker(request('/api/catalog/jk%3A123/chapters'))).json()).chapters.length,0);
  console.log('PASS: provider JSON creates actual catalog entries; source failure is explicit; response cache works; Jikan metadata has no fictional chapters');

  const geminiEnv={...env,GEMINI_API_KEY:'fixture-server-secret',GEMINI_TEXT_USER_DAILY:'1'};
  const textBody={texts:['Hello, dragon!'],provider:'gemini',targetLanguage:'pt',sourceLanguage:'auto'};
  assert.equal((await worker.fetch(request('/api/translate/text',{method:'POST',data:textBody}),geminiEnv,ctx)).status,401);
  const first=await worker.fetch(request('/api/translate/text',{method:'POST',cookie,data:textBody}),geminiEnv,ctx);assert.equal(first.status,200);assert.equal((await first.json()).quota.used,1);
  const second=await worker.fetch(request('/api/translate/text',{method:'POST',cookie,data:textBody}),geminiEnv,ctx);assert.equal(second.status,429);assert.equal(DB.sqlite.prepare("SELECT used FROM translation_usage WHERE user_id=? AND kind='text'").get(user.id).used,1);assert.equal(DB.sqlite.prepare("SELECT used FROM translation_usage WHERE user_id='__global__' AND kind='text'").get().used,1);
  console.log('PASS: translation dispatch requires real login, reserves SQLite user/global quotas atomically and rejects second use at limit');
}finally{globalThis.fetch=nativeFetch;globalThis.caches=nativeCaches;clearCatalogCache();DB.sqlite.close();}
// Exercise the shipped preview adapter without importing the HTTP server or
// opening a port. Its prepared/batch block has no network or process side effects.
const source=await readFile(new URL('../scripts/local.mjs',import.meta.url),'utf8');
const start=source.indexOf('function prepared('),end=source.indexOf('const mime=');assert.ok(start>=0&&end>start);
const localSQLite=createDB().sqlite;localSQLite.exec('CREATE TABLE adapter_probe(id TEXT PRIMARY KEY)');
const adapter=new Function('sqlite',source.slice(start,end)+';return DB;')(localSQLite);
const initial=adapter.prepare('INSERT INTO adapter_probe VALUES(?) RETURNING id'),firstBinding=initial.bind('bind-user'),secondBinding=initial.bind('bind-global');assert.notEqual(firstBinding,secondBinding);
const bindingRows=await adapter.batch([firstBinding,secondBinding]);assert.deepEqual(bindingRows.map(item=>item.results[0].id),['bind-user','bind-global']);
const concurrent=await Promise.allSettled([adapter.batch([initial.bind('batch-a'),initial.bind('batch-b')]),adapter.batch([initial.bind('batch-c')])]);assert.ok(concurrent.every(item=>item.status==='fulfilled'),'Local SQLite transactions must not interleave across await points');
assert.equal(localSQLite.prepare('SELECT COUNT(*) total FROM adapter_probe').get().total,5);localSQLite.close();
console.log('PASS: shipped local D1 adapter has immutable binds, RETURNING rows and non-interleaving concurrent transactions');
console.log('All Worker integration tests passed. SQLite/WebCrypto are real; external network responses are mocked.');
