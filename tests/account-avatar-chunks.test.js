import assert from 'node:assert/strict';
import {auth,digest} from '../server/auth.js';
import {database,schema,SCHEMA_VERSION} from '../server/database.js';
import {media,MAX_AVATAR_BYTES,MAX_TOTAL_AVATAR_BYTES,AVATAR_CHUNK_BYTES,AVATAR_RESERVE_SQL,imageDimensions} from '../server/media.js';
import {createDB,request,call,register} from './account-support.js';

// Valid two-frame 1x1 GIF with a large comment extension. The backend must
// preserve every byte, including animation frames and metadata, without resize.
function animatedGIF(commentBytes=2250000){
  const header=Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021fe','hex');
  const chunks=[header];for(let left=commentBytes;left>0;left-=255){const size=Math.min(left,255);chunks.push(Buffer.from([size]),Buffer.alloc(size,65));}chunks.push(Buffer.from([0]));
  chunks.push(Buffer.from('21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex'));return new Uint8Array(Buffer.concat(chunks));
}
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYyQAAAAASUVORK5CYII=','base64'));
const gif=animatedGIF(),DB=createDB(),env={DB},alice=await register(auth,env,'GIF Reader','gif@example.com');
assert.ok(gif.length>2*1024*1024&&gif.length<MAX_AVATAR_BYTES);assert.deepEqual(imageDimensions(gif),{width:1,height:1});assert.equal(MAX_AVATAR_BYTES,20*1024*1024);assert.equal(MAX_TOTAL_AVATAR_BYTES,256*1024*1024);
let queries=0;DB.before=()=>queries++;
const uploaded=await call(media,request('/api/profile/avatar?x=30&y=70&zoom=200',{method:'POST',cookie:alice.cookie,body:gif}),env);assert.equal(uploaded.status,200);const result=await uploaded.json();assert.equal(result.animated,true);assert.equal(result.bytes,gif.length);assert.ok(queries<=32);DB.before=null;
const stored=DB.sqlite.prepare('SELECT * FROM profile_media WHERE user_id=?').get(alice.user.id),chunks=DB.sqlite.prepare('SELECT length(data) bytes FROM profile_media_chunks WHERE user_id=? ORDER BY seq').all(alice.user.id);assert.equal(stored.data.length,0);assert.equal(stored.byte_length,gif.length);assert.equal(stored.chunk_count,3);assert.ok(chunks.every(chunk=>chunk.bytes<=AVATAR_CHUNK_BYTES));
queries=0;DB.before=()=>queries++;const read=await call(media,request(result.avatar),env);assert.equal(read.headers.get('Content-Type'),'image/gif');assert.equal(Number(read.headers.get('Content-Length')),gif.length);assert.deepEqual(new Uint8Array(await read.arrayBuffer()),gif);assert.ok(queries<=23);DB.before=null;
console.log('PASS: original multi-frame GIF larger than 2 MiB preserved exactly in <=1 MiB rows and streamed with bounded queries');

const oldVersion=stored.version;DB.before=sql=>{if(sql.startsWith('INSERT INTO profile_media_chunks'))throw new Error('Forced chunk write failure');};
const failed=await call(media,request('/api/profile/avatar',{method:'POST',cookie:alice.cookie,body:png}),env);DB.before=null;assert.equal(failed.status,500);assert.equal(DB.sqlite.prepare('SELECT version FROM profile_media WHERE user_id=?').get(alice.user.id).version,oldVersion);assert.deepEqual(new Uint8Array(await(await call(media,request(result.avatar),env)).arrayBuffer()),gif);
const invalid=png.slice();invalid.fill(0,16,20);assert.equal((await call(media,request('/api/profile/avatar',{method:'POST',cookie:alice.cookie,body:invalid}),env)).status,415);
const replacing=await call(media,request('/api/profile/avatar',{method:'POST',cookie:alice.cookie,body:png}),env);assert.equal(replacing.status,200);const replacement=await replacing.json();assert.equal(DB.sqlite.prepare('SELECT COUNT(*) total FROM profile_media_chunks WHERE user_id=?').get(alice.user.id).total,1);assert.deepEqual(new Uint8Array(await(await call(media,request(replacement.avatar),env)).arrayBuffer()),png);
console.log('PASS: failed chunk write rolls back full replacement, successful replacement removes old chunks, invalid dimensions rejected');

const bob=await register(auth,env,'Legacy Budget','legacy-budget@example.com'),charlie=await register(auth,env,'Quota Reader','quota@example.com');
DB.sqlite.prepare('INSERT INTO profile_media(user_id,mime,data,byte_length) VALUES(?,?,?,?)').run(bob.user.id,'image/png',png,1); // Corrupt counter intentionally: capacity must count actual BLOB bytes.
const currentBytes=png.length*2;
const quotaArgs=[charlie.user.id,'image/png',new ArrayBuffer(0),50,50,100,10,1,'quota-reject',charlie.user.id,charlie.user.id,10,currentBytes+9];
assert.equal(await DB.prepare(AVATAR_RESERVE_SQL).bind(...quotaArgs).first(),null);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) total FROM profile_media WHERE user_id=?').get(charlie.user.id).total,0);
DB.sqlite.exec('SAVEPOINT quota_probe');const own=await DB.prepare(AVATAR_RESERVE_SQL).bind(alice.user.id,'image/png',new ArrayBuffer(0),50,50,100,1,1,'quota-replace',alice.user.id,alice.user.id,1,png.length+1).first();assert.ok(own);DB.sqlite.exec('ROLLBACK TO quota_probe; RELEASE quota_probe');
queries=0;DB.before=()=>queries++;await database({DB:{prepare:DB.prepare.bind(DB),batch:DB.batch.bind(DB)}});DB.before=null;assert.equal(queries,1);
await call(media,request('/api/profile/avatar/reset',{method:'POST',cookie:alice.cookie}),env);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) total FROM profile_media_chunks WHERE user_id=?').get(alice.user.id).total,0);
await call(media,request('/api/profile/avatar',{method:'POST',cookie:alice.cookie,body:png}),env);const deletion=await call(auth,request('/api/auth/delete',{method:'POST',cookie:alice.cookie,data:{password:'A-real-password-123!'}}),env);assert.equal(deletion.status,200);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) total FROM profile_media_chunks WHERE user_id=?').get(alice.user.id).total,0);
console.log('PASS: capacity SQL counts real legacy/chunk bytes, replacement excludes own storage, cold current schema uses one probe, reset/deletion clean chunks');

const legacy=createDB(),legacyEnv={DB:legacy};
const oldSQL="CREATE TABLE profile_media(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL CHECK(length(data)<=1000000),x REAL NOT NULL DEFAULT 50,y REAL NOT NULL DEFAULT 50,zoom REAL NOT NULL DEFAULT 100)";
for(const sql of schema){if(sql.startsWith('CREATE TABLE IF NOT EXISTS profile_media_chunks'))continue;legacy.sqlite.exec(sql.startsWith('CREATE TABLE IF NOT EXISTS profile_media(')?oldSQL:sql);}
legacy.sqlite.prepare('INSERT INTO app_config VALUES(?,?)').run('installation_key','legacy-stable-secret-'.repeat(4));
const legacyId='88000000-0000-4000-8000-000000000001',now=new Date().toISOString();legacy.sqlite.prepare('INSERT INTO users(id,username,email,password_hash,password_salt,avatar_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(legacyId,'Legacy GIF','old@example.com','v1$not-used','legacy-salt','/api/avatar/'+legacyId+'?v=legacy',now,now);legacy.sqlite.prepare('INSERT INTO profile_media(user_id,mime,data,x,y,zoom) VALUES(?,?,?,?,?,?)').run(legacyId,'image/png',png,25,75,150);
const secret=(await database(legacyEnv)).AUTH_SECRET;assert.equal(secret,'legacy-stable-secret-'.repeat(4));assert.equal(legacy.sqlite.prepare("SELECT value FROM app_config WHERE key='schema_version'").get().value,SCHEMA_VERSION);assert.deepEqual(new Uint8Array(await(await call(media,request('/api/avatar/'+legacyId+'?v=legacy'),legacyEnv)).arrayBuffer()),png);
const token='c'.repeat(64);legacy.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await digest(token),legacyId,new Date(Date.now()+86400000).toISOString(),now);
const migratedUpload=await call(media,request('/api/profile/avatar',{method:'POST',cookie:'md_session='+token,body:gif}),legacyEnv);assert.equal(migratedUpload.status,200);const migratedAvatar=(await migratedUpload.json()).avatar;assert.deepEqual(new Uint8Array(await(await call(media,request(migratedAvatar),legacyEnv)).arrayBuffer()),gif);
console.log('PASS: v1 migration preserves existing secret/photo/crop and permits heavy GIF despite legacy 1 MB parent CHECK');
DB.sqlite.close();legacy.sqlite.close();console.log('All chunked avatar tests passed with actual SQLite and original image bytes.');
