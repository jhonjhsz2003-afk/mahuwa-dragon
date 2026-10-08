import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {esc,safeUrl,parseRoute,titleLink,readLink,safeAvatar,identity,frameStyle,mediaCard,dateLabel,createRouteTrail,validAppRoute,workProgress,validateAvatarFile,AVATAR_MAX_BYTES,uploadAvatar} from '../web/js/ui.js';

assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
assert.equal(safeUrl('javascript:alert(1)'),'/assets/poster-placeholder.svg');
assert.equal(safeUrl('//malicious.example/cover'),'/assets/poster-placeholder.svg');
assert.equal(safeUrl('/api/cover/md/test/cover.jpg?size=small'),'/api/cover/md/test/cover.jpg?size=small');
assert.equal(safeUrl('https://example.com/cover.jpg'),'https://example.com/cover.jpg');
const reserved='md:chapter/with space?query#part';
assert.equal(parseRoute(readLink(reserved)).id,reserved);
assert.equal(parseRoute(titleLink('md:123')).page,'title');
assert.equal(parseRoute('#/catalog?kind=novel&q=A%26B').params.get('q'),'A&B');
assert.equal(parseRoute('#/title/%E0%A4%A').id,'');
assert.equal(safeAvatar('https://outside.example/avatar.svg'),'/assets/avatar-default.svg');
assert.equal(identity({identity:{cover:'" onclick="evil',frame:'../../',title:'Readable'}}).cover,'aurora');
assert.equal(frameStyle({x:999,y:-22,zoom:999}),'object-position:100% 0%;transform:translate(-100%,100%) scale(3)');
assert(dateLabel('2026-10-05').startsWith('05'));
assert(!mediaCard({id:'md:1',title:'No score',coverUrl:'javascript:evil',kind:'manga'}).includes('card-rating'));
const filteredRoute='#/catalog?kind=manhwa&q=Blue%20Dragon&page=2';
const trail=createRouteTrail(filteredRoute);trail.observe(titleLink('md:42'));assert.equal(trail.back(),filteredRoute);trail.observe(filteredRoute);assert.equal(trail.back(),'#/');
assert.equal(createRouteTrail('#/profile').back(),'#/');assert.equal(createRouteTrail('#/profile/reader').back(),'#/profile');assert.equal(createRouteTrail('#/title/md%3A42').back(),'#/catalog');
assert.equal(validAppRoute('https://outside.example'),false);assert.equal(validAppRoute('#/https://outside.example'),false);
const bounded=createRouteTrail('#/');for(let i=0;i<60;i++)bounded.observe('#/catalog?page='+i);let oldest;for(let i=0;i<50;i++){oldest=bounded.back();bounded.observe(oldest);}assert.equal(oldest,'#/catalog?page=9');assert.equal(bounded.back(),'#/');
assert(!workProgress('Carregando').includes('aria-valuenow'));assert(!workProgress('Carregando').includes('%'));assert(workProgress('Páginas',42).includes('aria-valuenow="42"'));assert(workProgress('<script>',500).includes('aria-valuenow="100"'));
assert.equal(validateAvatarFile({size:AVATAR_MAX_BYTES,type:'image/gif'}).size,20*1024*1024);assert.throws(()=>validateAvatarFile({size:AVATAR_MAX_BYTES+1,type:'image/gif'}),/excede 20 MB/);
const oldXHR=Object.getOwnPropertyDescriptor(globalThis,'XMLHttpRequest');let uploadRequest;
class UploadXHR{constructor(){uploadRequest=this;this.upload={};this.headers={};}open(method,path){this.method=method;this.path=path;}setRequestHeader(key,value){this.headers[key]=value;}send(file){this.file=file;}abort(){this.onabort?.();}}
Object.defineProperty(globalThis,'XMLHttpRequest',{value:UploadXHR,configurable:true,writable:true});
try{const original=new File([new Uint8Array([71,73,70,56,57,97])],'animated.gif',{type:'image/gif'}),events=[];let confirmed=false;const pending=uploadAvatar(original,{x:50,y:50,zoom:100},{onProgress:event=>events.push(event)}).then(result=>{confirmed=true;return result;});assert.equal(uploadRequest.file,original);assert.equal(uploadRequest.headers['Content-Type'],'image/gif');uploadRequest.upload.onprogress({lengthComputable:true,loaded:3,total:6});assert.equal(events.at(-1).percent,50);uploadRequest.upload.onprogress({lengthComputable:true,loaded:6,total:6});assert.equal(events.at(-1).phase,'saving');assert.equal(confirmed,false);uploadRequest.status=200;uploadRequest.responseText=JSON.stringify({ok:true,avatar:'/api/avatar/reader?v=1'});uploadRequest.onload();assert.equal((await pending).avatar,'/api/avatar/reader?v=1');const cancel=new AbortController();const cancelled=uploadAvatar(original,{}, {signal:cancel.signal});cancel.abort();await assert.rejects(cancelled,error=>error.name==='AbortError');}finally{if(oldXHR)Object.defineProperty(globalThis,'XMLHttpRequest',oldXHR);else delete globalThis.XMLHttpRequest;}

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const {document,window}=parseHTML(html);
const keys=['document','window','location','localStorage','navigator','fetch','indexedDB','IntersectionObserver','setTimeout','clearTimeout'];
const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const timers=new Set(),realTimeout=globalThis.setTimeout,realClear=globalThis.clearTimeout;
const saved={},requests=[];
window.HTMLElement.prototype.focus=function(){};
window.HTMLElement.prototype.scrollBy=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
window.scrollTo=()=>{};window.scrollY=0;
if(!Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value')?.set)Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value||this.options?.[0]?.value||'';},set(value){this._value=String(value);},configurable:true});
let hash='#/',loginAccepted=false;
const location={origin:'https://mahuwa.test',pathname:'/',get hash(){return hash;},set hash(value){hash=value;window.dispatchEvent(new window.Event('hashchange'));}};
const item={id:'local:ui-fixture',title:'Fixture <img src=x onerror=alert(1)>',description:'Literal <script>unsafe()</script>',coverUrl:'/assets/sample/fixture.webp',kind:'manhwa',originLanguage:'en',status:'ongoing',tags:['Fantasia'],tagIds:['00000000-0000-0000-0000-000000000001'],authors:['Author'],provider:'local',available:true};
const user={id:'ui-user',name:'Reader',email:'reader@example.test',bio:'Bio',avatar:'/assets/avatar-default.svg',avatarFrame:{x:50,y:50,zoom:100},nameColor:'ice',visibility:'private',identity:{cover:'aurora',frame:'flame',title:'Leitor'}};
const apiResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const fetchMock=async(path,options={})=>{
  requests.push({path,options});
  if(path==='/api/config')return apiResponse({ok:true,registrationAvailable:true,translation:{google:true,gemini:false}});
  if(path==='/api/auth/me')return apiResponse({ok:true,user:null});
  if(path==='/api/catalog/home')return apiResponse({ok:true,featured:[item],trending:[item],recent:[],updates:[],top:[],manhwa:[item],manhua:[],novels:[],originals:[],partial:false});
  if(path.startsWith('/api/catalog/discover'))return apiResponse({ok:true,items:[item],page:1,totalPages:1,hasMore:false});
  if(path.includes('/chapters?'))return apiResponse({ok:true,chapters:path.includes('language=all')?[{id:'local:fixture-chapter',mediaId:item.id,number:1,title:'Chapter',language:'en',pages:3}]:[],page:1,totalPages:1,hasMore:false});
  if(path.startsWith('/api/catalog/'))return apiResponse({ok:true,item,recommendations:[]});
  if(path.startsWith('/api/comments?'))return apiResponse({ok:true,items:[]});
  if(path==='/api/auth/login')return loginAccepted?apiResponse({ok:true,user}):apiResponse({ok:false,error:'Credenciais inválidas'},401);
  if(path==='/api/library'||path==='/api/progress')return apiResponse({ok:true,items:[]});
  if(path==='/api/settings')return apiResponse({ok:true,settings:{}});
  if(path.startsWith('/api/profile/avatar'))return apiResponse({ok:true,avatar:'/assets/avatar-default.svg',avatarFrame:{x:50,y:50,zoom:100}});
  return apiResponse({ok:true});
};
for(const [key,value]of Object.entries({document,window,location,localStorage:{getItem:key=>saved[key]||null,setItem:(key,value)=>saved[key]=value},navigator:{language:'pt-BR',clipboard:{writeText:async()=>{}}},fetch:fetchMock,indexedDB:{open(){throw new Error('Persistent file storage intentionally unavailable in this DOM test.');}},IntersectionObserver:class{observe(){}disconnect(){}},setTimeout:(fn,ms,...args)=>{if(ms>1000)return 0;const timer=realTimeout(()=>{timers.delete(timer);fn(...args);},ms);timers.add(timer);return timer;},clearTimeout:timer=>{timers.delete(timer);realClear(timer);}}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
function click(selector){const element=document.querySelector(selector);assert(element,'Missing element '+selector);element.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));return element;}
try{
  const app=await import('../web/js/app.js');
  await settle();
  assert.equal(document.querySelector('.sidebar'),null);
  for(const destination of ['library','import','settings'])assert(document.querySelector(`.header-menu a[href="#/${destination}"]`));
  assert(document.querySelector('.hero h1').textContent.includes('<img'));
  assert.equal(document.querySelectorAll('img[onerror],script:not([src])').length,0);
  assert(document.querySelector('.hero .description').textContent.includes('<script>'));
  click('[data-save-id]');await settle();
  assert.equal(JSON.parse(saved.mh_library_guest).length,1);
  assert.equal(requests.filter(request=>request.path==='/api/library').length,0);
  assert.equal(document.querySelector('[data-app-back]'),null);
  location.hash=filteredRoute;await settle();location.hash=titleLink(item.id);await settle();click('[data-app-back]');await settle();assert.equal(location.hash,filteredRoute);assert.equal(document.querySelector('#catalog-query').value,'Blue Dragon');

  location.hash=titleLink(item.id);await settle();
  assert(document.querySelector('#chapters-results').textContent.includes('Sem capítulos em português'));
  click('[data-all-chapters]');await settle();
  assert.equal(document.querySelector('#chapter-language').value,'all');
  assert.equal(document.querySelectorAll('.chapter-row').length,1);
  assert(document.querySelector('.detail-tags a').href.includes('00000000-0000-0000-0000-000000000001'));

  click('[data-auth="login"]');await settle();
  document.querySelector('#auth-email').value='reader@example.test';
  document.querySelector('#auth-password').value='password-that-must-not-persist';
  await document.querySelector('#auth-form').onsubmit({preventDefault(){}});await settle();
  assert.equal(document.querySelector('#auth-error').textContent,'Credenciais inválidas');
  assert(!JSON.stringify(saved).includes('password-that-must-not-persist'));
  click('[data-close-auth]');

  location.hash='#/import';await settle();
  const input=document.querySelector('#import-files');
  Object.defineProperty(input,'files',{value:[new File(['First paragraph.\n\n<script>literal</script>'],'My Novel.txt',{type:'text/plain'})],configurable:true});
  await input.onchange({target:input});await settle();
  assert(document.querySelector('#import-message').textContent.includes('nesta sessão'));
  const importedId=parseRoute(document.querySelector('.import-item a').getAttribute('href')).id;
  location.hash=titleLink(importedId);await settle();
  assert(document.querySelector('.detail-description').textContent.includes('Conteúdo importado'));
  assert.equal(requests.filter(request=>request.path.includes('/api/comments?mediaId=import')).length,0);
  click('[data-save-kind="favorite"]');await settle();
  assert.equal(JSON.parse(saved.mh_library_imports).length,1);

  click('[data-auth="login"]');await settle();loginAccepted=true;
  document.querySelector('#auth-email').value='reader@example.test';document.querySelector('#auth-password').value='correct-password';
  await document.querySelector('#auth-form').onsubmit({preventDefault(){}});await settle();
  assert(document.querySelector('.profile-chip').textContent.includes('Reader'));
  assert.equal(JSON.parse(saved.mh_library_imports).length,1);
  click('[data-save-kind="later"]');await settle();
  assert.equal(requests.filter(request=>request.path==='/api/library'&&request.options.method==='POST').length,0,'Imported bookmarks must stay local even while signed in.');
  location.hash='#/library';await settle();
  assert(document.querySelector('#library-results').textContent.includes('My Novel'));
  assert(document.querySelector('#library-results').textContent.includes('Neste dispositivo'));
  saved['mahuwa.reader.preferences']=JSON.stringify({autoTranslate:false});
  location.hash=readLink(importedId);await settle();
  assert(document.querySelector('.site-header .header-more'));
  assert(document.querySelector('.md-novel-page').textContent.includes('<script>literal</script>'));
  assert.equal(document.querySelectorAll('.md-novel-page script').length,0);
  await new Promise(resolve=>realTimeout(resolve,480));await settle();
  assert.equal(JSON.parse(saved.mh_progress_imports)[0].mediaId,importedId);
  assert.equal(requests.filter(request=>request.path==='/api/progress'&&request.options.method==='POST').length,0,'Imported progress must stay local while signed in.');
  location.hash='#/library';await settle();

  await app.api('/api/settings',{method:'POST',body:{settings:{readerMode:'paged'}}});
  const request=requests.at(-1);assert.equal(request.options.body,'{"settings":{"readerMode":"paged"}}');assert.equal(request.options.headers['Content-Type'],'application/json');
  const binary=new File([new Uint8Array([1,2,3])],'avatar.png',{type:'image/png'});
  await app.api('/api/profile/avatar',{method:'POST',body:binary,headers:{'Content-Type':'image/png'}});
  assert.equal(requests.at(-1).options.body,binary);assert.equal(requests.at(-1).options.headers['Content-Type'],'image/png');
  assert.equal(app.textPages('A\n\nB').map(page=>page.text).join(''),'A\n\nB');
  assert.throws(()=>app.textPages('x'.repeat(3010000)),/300 seções/);
  console.log('PASS: UI URL/XSS boundaries, encoded routes, guest bookmarks, PT/all chapters, failed auth/no password persistence, novel session import, signed-in import isolation, object JSON bodies and binary avatar preservation. Catalog/auth transport mocked; no live-provider claim.');
}finally{
  for(const timer of timers)realClear(timer);
  for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
