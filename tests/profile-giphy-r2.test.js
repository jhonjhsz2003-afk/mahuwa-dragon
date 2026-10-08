import assert from 'node:assert/strict';
import {auth} from '../server/auth.js';
import {media} from '../server/media.js';
import {giphyAvatar,giphyMarker} from '../server/giphy-avatar.js';
import {giphy} from '../server/giphy.js';
import {giphyRequest,giphyMedia,giphyAnalyticsUrl} from '../web/js/giphy.js';
import {createDB,request,call,register} from './account-support.js';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYyQAAAAASUVORK5CYII=','base64'));
class FakeR2 {
  constructor(){this.objects=new Map();this.deleted=[]}
  async put(key,bytes,options={}){this.objects.set(key,{bytes:new Uint8Array(bytes),options})}
  async get(key){const value=this.objects.get(key);return value?{body:value.bytes,httpMetadata:value.options.httpMetadata,customMetadata:value.options.customMetadata}:null}
  async delete(key){this.deleted.push(key);this.objects.delete(key)}
}

const marker=giphyMarker('abc123',{x:25,y:75,zoom:180});
assert.equal(marker,'giphy:abc123?x=25&y=75&zoom=180');
assert.deepEqual(giphyAvatar(marker),{id:'abc123',frame:{x:25,y:75,zoom:180}});
assert.equal(giphyMarker('../bad'),null);
assert.equal(giphyMedia('https://media2.giphy.com/media/abc/giphy.gif'),'https://media2.giphy.com/media/abc/giphy.gif');
assert.equal(giphyMedia('https://giphy.evil.example/giphy.gif'),null);
assert.equal(giphyAnalyticsUrl({analytics:{onload:{url:'https://giphy-analytics.giphy.com/simple'}}},'onload'),'https://giphy-analytics.giphy.com/simple');
assert.match(giphyRequest(null,{query:'manga anime'}),/^\/api\/giphy\/search\?/);
console.log('PASS: GIPHY markers, official media hosts, analytics hosts and same-origin request builder are validated');

const DB=createDB(),AVATARS=new FakeR2(),env={DB,AVATARS,GIPHY_API_KEY:'public-web-key'};
const alice=await register(auth,env,'✨ Manga Reader ✨','giphy-r2@example.com');
let response=await call(media,request('/api/profile/avatar?x=30&y=70&zoom=160',{method:'POST',cookie:alice.cookie,body:png}),env);
assert.equal(response.status,200);const uploaded=await response.json();assert.equal(uploaded.storage,'r2');assert.ok(uploaded.avatar.includes('?v='));
const row=DB.sqlite.prepare('SELECT storage,object_key,length(data) parent_bytes,byte_length FROM profile_media WHERE user_id=?').get(alice.user.id);
assert.equal(row.storage,'r2');assert.equal(row.parent_bytes,0);assert.equal(row.byte_length,png.length);assert.ok(AVATARS.objects.has(row.object_key));
response=await call(media,request(uploaded.avatar),env);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/immutable/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
const head=await call(media,request(uploaded.avatar,{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
console.log('PASS: avatar upload prefers R2, persists only metadata in D1 and serves immutable versioned media');

const oldKey=row.object_key;
const realFetch=globalThis.fetch;globalThis.fetch=async url=>{const value=String(url);if(value.startsWith('https://api.giphy.com/v1/gifs/xyz789'))return Response.json({data:{id:'xyz789'},meta:{status:200}});return realFetch(url);};
response=await call(media,request('/api/profile/avatar/giphy?x=40&y=60&zoom=150',{method:'POST',cookie:alice.cookie,data:{id:'xyz789'}}),env);
assert.equal(response.status,200);const selected=await response.json();assert.equal(selected.provider,'giphy');assert.equal(selected.avatar,'giphy:xyz789?x=40&y=60&zoom=150');assert.ok(AVATARS.deleted.includes(oldKey));assert.equal(AVATARS.objects.has(oldKey),false);
const own=await call(auth,request('/api/auth/me',{cookie:alice.cookie}),env);const ownData=await own.json();assert.equal(ownData.user.avatar,selected.avatar);assert.deepEqual(ownData.user.avatarFrame,{x:40,y:60,zoom:150});
assert.equal(DB.sqlite.prepare('SELECT COUNT(*) total FROM profile_media WHERE user_id=?').get(alice.user.id).total,0);
console.log('PASS: selecting a GIPHY avatar validates the provider ID, stores only ID/frame and removes the replaced R2 object');
globalThis.fetch=realFetch;

const requests=[];globalThis.fetch=async url=>{requests.push(String(url));return Response.json({data:[{id:'proxy1'}],pagination:{count:1,total_count:1},meta:{status:200}});};
const proxied=await giphy(request('/api/giphy/search?q=manhwa&offset=0'),{GIPHY_API_KEY:'server-secret'});assert.equal(proxied.status,200);assert.match(requests[0],/^https:\/\/api\.giphy\.com\/v1\/gifs\/search\?/);assert.match(requests[0],/api_key=server-secret/);assert.ok(!JSON.stringify(await proxied.json()).includes('server-secret'));
const config=await giphy(request('/api/giphy/config'),{GIPHY_API_KEY:'server-secret'});const configData=await config.json();assert.equal(configData.configured,true);assert.equal('apiKey' in configData,false);
console.log('PASS: GIPHY secret stays on the Worker and search uses the same-origin proxy');
globalThis.fetch=realFetch;DB.sqlite.close();
