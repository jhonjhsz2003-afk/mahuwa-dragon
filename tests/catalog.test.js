import assert from 'node:assert/strict';
import {normalizeManga,normalizeNovel,normalizeChapter,detail,chapters,chapterDetail,atHome,discover,UUID} from '../server/catalog.js';
import {imageResponse} from '../server/images.js';
const mangaId='11111111-1111-4111-8111-111111111111',chapterId='22222222-2222-4222-8222-222222222222';
const raw={id:mangaId,attributes:{title:{ko:'원래'},altTitles:[{en:'Dragon Chronicle'}],description:{'pt-br':'<script>bad</script>Uma aventura [oficial](https://example.org).'},originalLanguage:'ko',status:'ongoing',contentRating:'safe',latestUploadedChapter:chapterId,availableTranslatedLanguages:['pt-br','en'],tags:[{id:mangaId,attributes:{name:{en:'Fantasy'}}}]},relationships:[{type:'cover_art',attributes:{fileName:'33333333-3333-4333-8333-333333333333.jpg'}},{type:'author',attributes:{name:'Autora'}}]};
const media=normalizeManga(raw,{rating:{bayesian:8.4},follows:200});
assert.equal(media.title,'Dragon Chronicle');assert.equal(media.kind,'manhwa');assert.equal(media.rating,8.4);assert.match(media.coverUrl,/^\/api\/cover\/md\//);assert.ok(!media.description.includes('<script>'));assert.deepEqual(media.tags,['Fantasia']);
const novel=normalizeNovel({mal_id:123,title:'Book',type:'Light Novel',chapters:25,images:{webp:{large_image_url:'https://cdn.myanimelist.net/image.jpg'}}});
assert.equal(novel.available,false);assert.equal(novel.kind,'novel');assert.equal(novel.chapterCount,25);
assert.equal(normalizeChapter({id:chapterId,attributes:{chapter:'12.5',translatedLanguage:'pt-br',externalUrl:'javascript:alert(1)'},relationships:[{id:mangaId,type:'manga'}]}).externalUrl,null);
const local=await detail('local:dragon',{});assert.equal(local.item.provider,'local');assert.equal((await chapters('local:dragon',new URLSearchParams(),{})).chapters[0].pages,3);
const localChapter=await chapterDetail('local:chronicles-chapter-1',new URLSearchParams(),{});assert.ok(localChapter.pages[0].text.length>100);assert.equal(localChapter.chapter.kind,'novel');
assert.equal((await chapters('jk:123',new URLSearchParams(),{})).chapters.length,0);
await assert.rejects(()=>detail('invalid',{}),/inválida/);assert.equal(UUID.test('localhost'),false);
const nativeFetch=globalThis.fetch;const calls=[];
try {
 globalThis.fetch=async(input)=>{
  const url=new URL(input);calls.push(url);
  if(url.pathname.startsWith('/at-home/'))return Response.json({result:'ok',baseUrl:'https://images.mangadex.network/token',chapter:{hash:'1234567890abcdef1234567890abcdef',data:['page.png'],dataSaver:['page.jpg']}});
  if(url.hostname==='images.mangadex.network')return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  return Response.json({result:'ok',data:[raw],total:1,statistics:{}});
 };
 const data=await discover(new URLSearchParams({kind:'manhwa',q:'dragon',page:'1'}),{});assert.equal(data.items[0].kind,'manhwa');assert.ok(calls.some(url=>url.searchParams.get('originalLanguage[]')==='ko'));assert.ok(calls.some(url=>url.searchParams.get('title')==='dragon'));
 const response=await imageResponse(new Request(`https://site.example/api/page/md/${chapterId}/0`),{},{});assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.status,200);
 await assert.rejects(()=>imageResponse(new Request('https://site.example/api/cover/md/invalid/path.jpg'),{},{}),/inválida/);
 await assert.rejects(()=>imageResponse(new Request(`https://site.example/api/page/md/${chapterId}/200`),{},{}),/não encontrada/);
 const badId='44444444-4444-4444-8444-444444444444';globalThis.fetch=async()=>Response.json({result:'ok',baseUrl:'http://127.0.0.1:1234',chapter:{hash:'1234567890abcdef1234567890abcdef',data:['a.jpg']}});
 await assert.rejects(()=>atHome(badId,{}),/inesperado/);
}finally{globalThis.fetch=nativeFetch;}
console.log('PASS catalog: language types, cover proxy, metadata vs chapters, original stories, source filtering, safe image endpoints and SSRF rejection. Network responses mocked.');
