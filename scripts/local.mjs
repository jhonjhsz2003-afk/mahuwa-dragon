import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../worker.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(resolve(root,'.local'),{recursive:true});
const sqlite=new DatabaseSync(resolve(root,'.local/mahuwa-dragon.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
function prepared(sql,args=[]) {return {bind(...values){return prepared(sql,values.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value));},async first(column){const row=sqlite.prepare(sql).get(...args)||null;return column&&row?row[column]:row;},async all(){return {success:true,results:sqlite.prepare(sql).all(...args)};},run(){const statement=sqlite.prepare(sql);if(statement.columns().length){const results=statement.all(...args);const meta=sqlite.prepare('SELECT changes() changes,last_insert_rowid() last_row_id').get();return {success:true,results,meta};}const result=statement.run(...args);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}};}
const DB={prepare(sql){return prepared(sql);},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},async exec(sql){sqlite.exec(sql);}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.gz':'application/gzip','.txt':'text/plain; charset=utf-8'};
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"};
async function asset(request) {
 let pathname;try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch(_){return new Response('Invalid URL',{status:400});}
 if(pathname==='/')pathname='/index.html';
 const web=resolve(root,'web'),file=resolve(web,'.'+pathname);
 if(!file.startsWith(web+sep))return new Response('Forbidden',{status:403});
 try{return new Response(await readFile(file),{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store',...security}});}
 catch(_){if(!extname(pathname))return new Response(await readFile(resolve(web,'index.html')),{headers:{'Content-Type':'text/html; charset=utf-8',...security}});return new Response('Not found',{status:404});}
}
const variables={};
try{for(const line of (await readFile(resolve(root,'.dev.vars'),'utf8')).split(/\r?\n/)){if(!line||line.trim().startsWith('#'))continue;const match=line.match(/^([A-Z_]+)=(.*)$/);if(match)variables[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}}catch(_){}
const env={DB,ASSETS:{fetch:asset},...variables,...Object.fromEntries(['AUTH_SECRET','GEMINI_API_KEY','GEMINI_MODEL','GEMINI_VISION_USER_DAILY','GEMINI_VISION_GLOBAL_DAILY','GEMINI_TEXT_USER_DAILY','GEMINI_TEXT_GLOBAL_DAILY','MANGADEX_USER_AGENT'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))};
const server=http.createServer(async(req,res)=>{
 try {
  const avatarUpload=req.method==='POST'&&new URL(req.url,'http://local.invalid').pathname==='/api/profile/avatar';
  const bodyLimit=avatarUpload?24*1024*1024:12500000;
  let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>bodyLimit){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
  const origin=`http://${req.headers.host}`,request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,env,{waitUntil:task=>task.catch(error=>console.error('Background operation failed:',error.message))});
  res.writeHead(response.status,Object.fromEntries(response.headers));
  if(!response.body){res.end();return;}
  for await(const chunk of response.body){if(!res.write(Buffer.from(chunk)))await new Promise(resolve=>res.once('drain',resolve));}res.end();
 }catch(error){console.error('Local request failed:',error.message);if(!res.headersSent)res.writeHead(500);res.end('Erro no servidor local.');}
});
const port=Number(process.env.PORT||8790);server.listen(port,'127.0.0.1',()=>console.log(`Mahuwa Dragon: http://127.0.0.1:${port}\nCatálogo real via API; contas e progresso persistem em SQLite local.\nNenhuma conta Cloudflare foi acessada.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{sqlite.close();process.exit();}));
