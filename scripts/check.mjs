import {readdir,readFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function visit(directory){const files=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=resolve(directory,entry.name);if(entry.isDirectory()){if(!['node_modules','.local','.wrangler','vendor'].includes(entry.name))files.push(...await visit(file));}else if(/\.(js|mjs|json)$/.test(entry.name))files.push(file);}return files;}
const files=await visit(root);let checked=0;
for(const file of files) {
 const source=await readFile(file,'utf8');
 if(file.endsWith('.json'))JSON.parse(source);
 else {
  // V8 module parser is available with --experimental-vm-modules; normal Node
  // validation is performed by CI. Local check also imports Worker modules.
  if(vm.SourceTextModule)new vm.SourceTextModule(source,{identifier:file});
  else if(!/^\s*(import|export)\s/m.test(source))new vm.Script(source,{filename:file});
 }
 checked++;
}
await import('../worker.js');
console.log(`Checked ${checked} project files; Worker module graph imported successfully.`);
