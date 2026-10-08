import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Pixel buffers are real RGBA arrays; glyph painting is recorded, not rasterized.
// This checks the erasure decision independently of a browser's font engine.
class Raster {
  constructor(width,height,pattern=()=>[255,255,255]){
    this.canvas={width,height};this.pixels=new Uint8ClampedArray(width*height*4);this.textDraws=0;this.fills=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)this.pixels.set([...pattern(x,y),255],(y*width+x)*4);
  }
  paint(x,y,w,h,color){
    for(let row=Math.max(0,y);row<Math.min(this.canvas.height,y+h);row++)for(let col=Math.max(0,x);col<Math.min(this.canvas.width,x+w);col++)this.pixels.set([...color,255],(row*this.canvas.width+col)*4);
  }
  getImageData(x,y,w,h){
    const data=new Uint8ClampedArray(w*h*4);
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){const offset=((y+row)*this.canvas.width+x+col)*4;data.set(this.pixels.subarray(offset,offset+4),(row*w+col)*4);}
    return {data,width:w,height:h};
  }
  fillRect(x,y,w,h){this.fills++;this.paint(x,y,w,h,this.fillStyle==='#fff'?[255,255,255]:this.fillStyle.match(/[\d.]+/g).map(Number));}
  drawImage(source){this.pixels.set(source.raster.pixels);}
  measureText(text){return {width:String(text).length*Number(this.font?.match(/([\d.]+)px/)?.[1]||8)*.5};}
  fillText(){this.textDraws++;}
  save(){} restore(){} beginPath(){} rect(){} clip(){}
}
const created=[];
const sandbox={Intl,setTimeout,Uint8Array,Uint8ClampedArray,Map,SD:{targetLanguage:()=> 'pt',assetURL:path=>'https://qa.local/'+path},document:{createElement(){
  const canvas={width:0,height:0,getContext(){if(!this.raster){this.raster=new Raster(this.width,this.height);this.raster.canvas=this;}return this.raster;},toDataURL:()=> 'data:image/png;base64,AAAA'};
  created.push(canvas);return canvas;
}}};
vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../web/translation/lib/render.js',import.meta.url),'utf8'),sandbox);
const render=sandbox.SDRender,mask={x:45,y:40,w:20,h:14},block={id:'balloon',text:'Original',translated:'Olá',box:{x:25,y:22,w:70,h:50},cleanupBoxes:[mask]};
const stripes=x=>x%10<6?[255,255,255]:[210,30,30];
const mixed=new Raster(120,100,stripes);mixed.paint(mask.x,mask.y,mask.w,mask.h,[0,0,0]);
const unsafeUniformity=render.background(mixed,mask).uniformity;
assert.ok(unsafeUniformity>=.50&&unsafeUniformity<=.72,'Fixture uniformity must expose the former threshold gap: '+unsafeUniformity);
const original=mixed.pixels.slice(),source={width:120,height:100,raster:mixed};
const rejected=await render.render(source,[block],{cleanup:'smart',fontScale:1});
const rejectedPixels=created.at(-1).raster;
assert.equal(rejected.blocks.length,0,'A background that cannot be erased must not receive translated glyphs');
assert.equal(rejectedPixels.textDraws,0);assert.equal(rejectedPixels.fills,0);assert.deepEqual(rejectedPixels.pixels,original);assert.match(rejected.warnings.join(' '),/preservar/);

const partial=new Raster(120,100,x=>x<65?[255,255,255]:stripes(x));
const first={x:20,y:20,w:12,h:12},second={x:80,y:40,w:12,h:12};
for(const area of [first,second])partial.paint(area.x,area.y,area.w,area.h,[0,0,0]);
const partialOriginal=partial.pixels.slice();
const partialResult=await render.render({width:120,height:100,raster:partial},[{...block,cleanupBoxes:[first,second]}],{cleanup:'smart',fontScale:1});
assert.equal(partialResult.blocks.length,0,'Every glyph area must be safe before any part of a balloon is erased');
assert.equal(created.at(-1).raster.fills,0);assert.deepEqual(created.at(-1).raster.pixels,partialOriginal);
console.log('PASS: smart render rejects intermediate/unsafe backgrounds without drawing over originals or partially erasing balloons (controlled RGBA arrays)');

const flat=new Raster(120,100);flat.paint(mask.x,mask.y,mask.w,mask.h,[0,0,0]);const flatOriginal=flat.pixels.slice();
const composed=await render.render({width:120,height:100,raster:flat},[block],{cleanup:'smart',fontScale:1});
assert.equal(composed.blocks.length,1);assert.ok(created.at(-1).raster.textDraws>0);
const offset=(45*120+50)*4;assert.deepEqual([...created.at(-1).raster.pixels.subarray(offset,offset+4)],[255,255,255,255]);
assert.deepEqual(flat.pixels,flatOriginal,'Rendering must leave the source available for restoration');
console.log('PASS: flat balloons erase original glyph pixels before translated text is drawn and retain the original source (font drawing mocked)');

const ellipse=new Raster(120,100,(x,y)=>{
  const radius=((x-60)/45)**2+((y-50)/35)**2;
  return radius>=.88&&radius<=1?[0,0,0]:[255,255,255];
});
ellipse.paint(mask.x,mask.y,mask.w,mask.h,[0,0,0]);
const dialogue={text:'Hello',box:mask,cleanupBoxes:[mask],confidence:95};
const enclosed=render.findSpeechBalloon(ellipse,dialogue);
assert.ok(enclosed,'A closed curved speech balloon must be recognized');
assert.ok(enclosed.box.w*enclosed.box.h>mask.w*mask.h*2,'Verified empty balloon space must be used for a legible writing box');
assert.ok(enclosed.box.x>15&&enclosed.box.y>15&&enclosed.box.x+enclosed.box.w<105&&enclosed.box.y+enclosed.box.h<85);
assert.deepEqual(enclosed.cleanupBoxes,dialogue.cleanupBoxes,'The writing rectangle must not enlarge the original glyph cleanup mask');
const opened=new Raster(120,100);opened.pixels.set(ellipse.pixels);opened.paint(98,43,18,14,[255,255,255]);
assert.equal(render.findSpeechBalloon(opened,dialogue),null,'An open outline cannot establish safe enclosed dialogue');
assert.equal(render.findSpeechBalloon(flat,dialogue),null,'Uniform open page/background alone is not a balloon');
const panel=new Raster(120,100);panel.paint(14,14,93,73,[0,0,0]);panel.paint(17,17,87,67,[255,255,255]);panel.paint(mask.x,mask.y,mask.w,mask.h,[0,0,0]);
assert.equal(render.findSpeechBalloon(panel,dialogue),null,'Straight rectangular panels/captions cannot qualify as dialogue');
assert.equal(render.findSpeechBalloon(ellipse,{...dialogue,text:'12'}),null,'Page numbering is not translated as dialogue');
assert.throws(()=>render.findSpeechBalloon(ellipse,dialogue,()=>{throw new Error('cancelled');}),/cancelled/);
console.log('PASS: closed curved balloon enclosure, interior writing bounds, glyph-only masks; open artwork, panels, numbering and cancellation fail closed (controlled RGBA arrays)');

const tiny=await render.render({width:120,height:100,raster:flat},[{...block,box:{x:45,y:40,w:20,h:14},translated:'Esta tradução extensa não cabe no pequeno espaço de escrita disponível.'}],{cleanup:'smart',fontScale:1});
assert.equal(tiny.blocks.length,0);assert.equal(created.at(-1).raster.textDraws,0);assert.equal(created.at(-1).raster.fills,0);assert.deepEqual(created.at(-1).raster.pixels,flatOriginal);assert.match(tiny.warnings.join(' '),/fonte legível/);
console.log('PASS: font size/overflow preflight preserves original pixels when the translated dialogue cannot fit legibly');

const floating={x:90,y:86,w:20,h:10};ellipse.paint(floating.x,floating.y,floating.w,floating.h,[0,0,0]);
const line=(text,box)=>({text,confidence:95,bbox:{x0:box.x*1.5,y0:box.y*1.5,x1:(box.x+box.w)*1.5,y1:(box.y+box.h)*1.5}});
sandbox.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{blocks:[{paragraphs:[{lines:[line('Hello',mask),line('TITLE',floating)]}]}]}}),terminate:async()=>{}})};
vm.runInContext(await readFile(new URL('../web/translation/lib/ocr.js',import.meta.url),'utf8'),sandbox);
const extracted=await sandbox.SDOCR.extract({width:120,height:100,raster:ellipse,getContext:()=>ellipse},{sourceLanguage:'en',minConfidence:35});
assert.equal(extracted.blocks.length,1);assert.equal(extracted.blocks[0].text,'Hello');assert.equal(extracted.blocks[0].balloonDetected,true);assert.match(extracted.warnings.join(' '),/1 área/);
console.log('PASS: OCR extraction filters floating title text before translation providers receive blocks (OCR transcription mocked)');
