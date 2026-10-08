import {readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=(await readdir(resolve(root,'tests'))).filter(name=>/\.(test|tests)\.(js|mjs|cjs)$/.test(name)).sort();
if(!files.length)throw new Error('No tests found.');
for(const file of files){console.log(`\nRunning ${file}`);await import(pathToFileURL(resolve(root,'tests',file)));}
