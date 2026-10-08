import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import vm from 'node:vm';

// Native PNG decoder for this project's non-interlaced 8-bit RGB/RGBA fixtures.
// No downloaded image, third-party decoder, OCR service or font rendering.
async function raster(name){
  const file=await readFile(new URL('../web/assets/sample/'+name,import.meta.url));
  assert.equal(file.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let width,height,channels;const compressed=[];
  for(let offset=8;offset<file.length;){
    const size=file.readUInt32BE(offset),type=file.toString('ascii',offset+4,offset+8),chunk=file.subarray(offset+8,offset+8+size);
    if(type==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);assert.equal(chunk[8],8);assert.equal(chunk[12],0);channels=chunk[9]===6?4:chunk[9]===2?3:0;assert.ok(channels);}
    if(type==='IDAT')compressed.push(chunk);
    offset+=size+12;
  }
  const raw=inflateSync(Buffer.concat(compressed)),stride=width*channels,decoded=new Uint8Array(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  assert.equal(raw.length,(stride+1)*height);
  for(let y=0;y<height;y++){
    const type=raw[y*(stride+1)];assert.ok(type<=4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=channels?decoded[i-channels]:0,b=y?decoded[i-stride]:0,c=y&&x>=channels?decoded[i-stride-channels]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][type];
      decoded[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){pixels[i*4]=decoded[i*channels];pixels[i*4+1]=decoded[i*channels+1];pixels[i*4+2]=decoded[i*channels+2];pixels[i*4+3]=channels===4?decoded[i*channels+3]:255;}
  return {canvas:{width,height},pixels,getImageData(x,y,w,h){
    assert.ok(w*h<=1800000,'Every adaptive search must remain bounded');
    const data=new Uint8ClampedArray(w*h*4);
    for(let row=0;row<h;row++)data.set(pixels.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);
    return {data};
  }};
}
function glyphBox(context,top,bottom){
  let left=900,right=0,minY=1500,maxY=0;
  for(let y=top;y<bottom;y++)for(let x=130;x<870;x++){const i=(y*context.canvas.width+x)*4;if(context.pixels[i]<80&&context.pixels[i+1]<80&&context.pixels[i+2]<80){left=Math.min(left,x);right=Math.max(right,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  assert.ok(right>left&&maxY>minY,'Real printed fixture dialogue must exist');
  return {x:left,y:minY,w:right-left+1,h:maxY-minY+1};
}
const sandbox={};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../web/translation/lib/render.js',import.meta.url),'utf8'),sandbox);
let recognised=0;
for(const name of ['page-1.png','page-2.png','page-3.png']){
  const context=await raster(name);
  for(const rows of [[[200,240],[250,290]],[[1145,1185],[1195,1235]]]){
    const cleanupBoxes=rows.map(([top,bottom])=>glyphBox(context,top,bottom));
    const x=Math.min(...cleanupBoxes.map(box=>box.x)),y=Math.min(...cleanupBoxes.map(box=>box.y));
    const box={x,y,w:Math.max(...cleanupBoxes.map(box=>box.x+box.w))-x,h:Math.max(...cleanupBoxes.map(box=>box.y+box.h))-y};
    const block={text:'Real printed dialogue',box,cleanupBoxes};
    for(const candidate of [block,{...block,box:cleanupBoxes[0],cleanupBoxes:[cleanupBoxes[0]]}]){
      const detected=sandbox.SDRender.findSpeechBalloon(context,candidate);
      assert.ok(detected,name+' must retain native-scale enclosed dialogue, including a single-line OCR block');
      assert.ok(detected.box.w>600&&detected.box.h>(candidate.cleanupBoxes.length===1?30:150),'Writing space must expand safely while preserving any neighbouring line not included in the OCR mask');
      assert.deepEqual(detected.cleanupBoxes,candidate.cleanupBoxes);
      recognised++;
    }
  }
}
console.log('PASS: '+recognised+' native PNG cases from all three real sample pages detect large closed balloons, including single-line OCR boxes (glyph boxes measured from printed pixels; OCR not invoked)');
