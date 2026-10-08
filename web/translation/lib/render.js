(function (root) {
  'use strict';
  const MAX_PIXELS = 24000000;
  const MAX_DIMENSION = 30000;
  function canvas(width,height) {
    const element=document.createElement('canvas'); element.width=width; element.height=height;
    return element;
  }
  async function load(dataUrl) {
    if (typeof dataUrl!=='string' || !/^data:image\/(png|jpe?g|webp|gif|bmp|avif);base64,/i.test(dataUrl)) throw new Error('A imagem deve ser um arquivo de imagem válido.');
    if (dataUrl.length>95000000) throw new Error('A imagem é muito grande. Selecione uma região menor.');
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));image.src=dataUrl;});
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Imagem sem dimensões válidas.');
    if(image.naturalWidth>MAX_DIMENSION||image.naturalHeight>MAX_DIMENSION||image.naturalWidth*image.naturalHeight>MAX_PIXELS)throw new Error('A página excede o limite de 24 milhões de pixels ou 30.000 pixels por lado. Divida a imagem em páginas menores para traduzi-la sem reduzir sua qualidade.');
    const output=canvas(image.naturalWidth,image.naturalHeight);
    const context=output.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('O navegador não consegue abrir esta página na resolução original. Divida-a em imagens menores.');
    context.imageSmoothingEnabled=false;context.drawImage(image,0,0);
    return {canvas:output,scale:1,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,warnings:[]};
  }
  function clampBox(box,width,height,padding=0) {
    if (!box || ![box.x,box.y,box.w,box.h].every(Number.isFinite) || box.w<=0 || box.h<=0) return null;
    const x=Math.max(0,Math.floor(box.x-padding)),y=Math.max(0,Math.floor(box.y-padding));
    const right=Math.min(width,Math.ceil(box.x+box.w+padding)),bottom=Math.min(height,Math.ceil(box.y+box.h+padding));
    if (right<=x || bottom<=y) return null;
    return {x,y,w:right-x,h:bottom-y};
  }
  function samplesAround(context,box) {
    const patch=clampBox(box,context.canvas.width,context.canvas.height,5);
    const image=context.getImageData(patch.x,patch.y,patch.w,patch.h);
    const samples=[];
    const step=Math.max(1,Math.floor(Math.max(patch.w,patch.h)/90));
    for (let y=0;y<patch.h;y+=step) {
      for (let x=0;x<patch.w;x+=step) {
        const globalX=x+patch.x,globalY=y+patch.y;
        if (globalX>=box.x && globalX<=box.x+box.w && globalY>=box.y && globalY<=box.y+box.h) continue;
        const index=(y*patch.w+x)*4;
        samples.push([image.data[index],image.data[index+1],image.data[index+2]]);
      }
    }
    if (!samples.length) {
      const data=image.data;
      for (let x=0;x<patch.w;x+=step) {const top=x*4,bottom=((patch.h-1)*patch.w+x)*4;samples.push([data[top],data[top+1],data[top+2]],[data[bottom],data[bottom+1],data[bottom+2]]);}
    }
    return {samples,patch,image};
  }
  function background(context,box) {
    const {samples}=samplesAround(context,box);
    const buckets=new Map();
    for (const pixel of samples) {
      const key=pixel.map(value=>Math.round(value/24)).join(',');
      if (!buckets.has(key)) buckets.set(key,[]); buckets.get(key).push(pixel);
    }
    const dominant=[...buckets.values()].sort((a,b)=>b.length-a.length)[0] || [[255,255,255]];
    const color=[0,1,2].map(channel=>Math.round(dominant.reduce((sum,pixel)=>sum+pixel[channel],0)/dominant.length));
    const near=samples.filter(pixel=>Math.max(...pixel.map((value,index)=>Math.abs(value-color[index])))<32);
    return {color,flat:near.length/Math.max(1,samples.length)>.72,uniformity:near.length/Math.max(1,samples.length)};
  }
  function rgb(color) { return `rgb(${color.map(value=>Math.max(0,Math.min(255,Math.round(value)))).join(',')})`; }
  function nearbyPunctuation(context,originalBox,color) {
    const marginX=Math.max(3,Math.min(18,Math.ceil(originalBox.h*.55)));
    const marginY=Math.max(3,Math.min(8,Math.ceil(originalBox.h*.2)));
    const patch=clampBox({x:originalBox.x-marginX,y:originalBox.y-marginY,w:originalBox.w+marginX*2,h:originalBox.h+marginY*2},context.canvas.width,context.canvas.height);
    if(!patch || patch.w*patch.h>400000) return [];
    const image=context.getImageData(patch.x,patch.y,patch.w,patch.h),seen=new Uint8Array(patch.w*patch.h),components=[];
    const ink=index=>Math.max(Math.abs(image.data[index*4]-color[0]),Math.abs(image.data[index*4+1]-color[1]),Math.abs(image.data[index*4+2]-color[2]))>58;
    for(let index=0;index<seen.length;index++) {
      if(seen[index] || !ink(index)) continue;
      const stack=[index];seen[index]=1;
      let left=patch.w,right=0,top=patch.h,bottom=0,count=0,touchesEdge=false;
      while(stack.length) {
        const current=stack.pop(),x=current%patch.w,y=Math.floor(current/patch.w);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
        if(x===0||y===0||x===patch.w-1||y===patch.h-1) touchesEdge=true;
        const neighbours=[];
        if(x>0) neighbours.push(current-1);if(x<patch.w-1) neighbours.push(current+1);
        if(y>0) neighbours.push(current-patch.w);if(y<patch.h-1) neighbours.push(current+patch.w);
        for(const neighbour of neighbours) if(!seen[neighbour] && ink(neighbour)){seen[neighbour]=1;stack.push(neighbour);}
      }
      const box={x:patch.x+left,y:patch.y+top,w:right-left+1,h:bottom-top+1};
      const outside=box.x<originalBox.x || box.y<originalBox.y || box.x+box.w>originalBox.x+originalBox.w || box.y+box.h>originalBox.y+originalBox.h;
      // A nearby isolated small ink component is often punctuation omitted by
      // OCR. Outlines/illustration strokes crossing the patch edge are retained.
      if(outside && !touchesEdge && box.w<=Math.max(6,originalBox.h*.45) && box.h<=originalBox.h*1.5 && count<=Math.max(24,originalBox.h*originalBox.h*.33)) components.push(box);
    }
    return components;
  }
  function cleanupArea(context,originalBox) {
    const padding=Math.max(1,Math.min(3,Math.round(originalBox.h*0.035)));
    return clampBox(originalBox,context.canvas.width,context.canvas.height,padding);
  }
  function cleanupRectangle(context,originalBox,settings) {
    const area=cleanupArea(context,originalBox);
    if (!area) return false;
    const estimate=background(context,area);
    if (estimate.flat || settings.cleanup==='solid' || settings.cleanup==='flat') {
      const extra=estimate.flat ? nearbyPunctuation(context,originalBox,estimate.color) : [];
      context.fillStyle=rgb(estimate.color);
      // These rectangles come from the original OCR glyphs/lines, never a whole panel.
      context.fillRect(area.x,area.y,area.w,area.h);
      for(const component of extra) context.fillRect(component.x-1,component.y-1,component.w+2,component.h+2);
      return !estimate.flat;
    }
    // Safety first: smart mode never fabricates textured artwork. This avoids
    // smearing faces, hair, clothes or panel art when a detector is imperfect.
    if(settings.cleanup!=='solid' && settings.cleanup!=='flat') return false;
    const expanded=clampBox(area,context.canvas.width,context.canvas.height,2);
    const image=context.getImageData(expanded.x,expanded.y,expanded.w,expanded.h);
    const {data}=image;
    const read=(x,y)=>{
      x=Math.max(0,Math.min(expanded.w-1,x)); y=Math.max(0,Math.min(expanded.h-1,y));
      const index=(y*expanded.w+x)*4; return [data[index],data[index+1],data[index+2]];
    };
    const samples={top:[],bottom:[],left:[],right:[]};
    for (let x=0;x<area.w;x++) {samples.top.push(read(x+area.x-expanded.x,0));samples.bottom.push(read(x+area.x-expanded.x,expanded.h-1));}
    for (let y=0;y<area.h;y++) {samples.left.push(read(0,y+area.y-expanded.y));samples.right.push(read(expanded.w-1,y+area.y-expanded.y));}
    const cleaned=context.createImageData(area.w,area.h);
    for (let y=0;y<area.h;y++) {
      const vertical=(y+.5)/area.h;
      for (let x=0;x<area.w;x++) {
        const horizontal=(x+.5)/area.w,index=(y*area.w+x)*4;
        for (let channel=0;channel<3;channel++) {
          const verticalColor=samples.top[x][channel]*(1-vertical)+samples.bottom[x][channel]*vertical;
          const horizontalColor=samples.left[y][channel]*(1-horizontal)+samples.right[y][channel]*horizontal;
          const edgeDistanceV=Math.min(vertical,1-vertical),edgeDistanceH=Math.min(horizontal,1-horizontal);
          const weightV=1/Math.max(.03,edgeDistanceV),weightH=1/Math.max(.03,edgeDistanceH);
          cleaned.data[index+channel]=(verticalColor*weightV+horizontalColor*weightH)/(weightV+weightH);
        }
        cleaned.data[index+3]=255;
      }
    }
    context.putImageData(cleaned,area.x,area.y);
    return true;
  }
  function findSpeechBalloon(context,block,checkCancelled=()=>{}) {
    // A flat patch alone is not a speech balloon: it may be a face, shirt,
    // panel background or title. Require a closed, curved background region.
    const glyphs=(block.cleanupBoxes || [block.box]).map(box=>cleanupArea(context,box)).filter(Boolean);
    const text=clampBox(block.box,context.canvas.width,context.canvas.height);
    if(!text || !glyphs.length || /^[\s\d.,:;!?~…—-]+$/u.test(String(block.text || '')))return null;
    if(!glyphs.every(area=>background(context,area).flat))return null;
    const color=background(context,glyphs[0]).color;
    // A one-line glyph box can sit in a much taller balloon. Start with an
    // aspect-aware window, then expand only when the region reaches that window.
    const marginX=Math.max(48,text.w*.65,text.h*.5),marginY=Math.max(48,text.h*1.4,text.w*.35);
    function search(patch){
    const image=context.getImageData(patch.x,patch.y,patch.w,patch.h),pixels=image.data;
    const matching=index=>pixels[index*4+3]>=200 && Math.max(Math.abs(pixels[index*4]-color[0]),Math.abs(pixels[index*4+1]-color[1]),Math.abs(pixels[index*4+2]-color[2]))<=36;
    const seeds=[[text.x+text.w/2,text.y-2],[text.x+text.w/2,text.y+text.h+2],[text.x-2,text.y+text.h/2],[text.x+text.w+2,text.y+text.h/2]];
    let seed=-1;
    for(const [x,y]of seeds){const px=Math.floor(x-patch.x),py=Math.floor(y-patch.y);if(px>=0&&py>=0&&px<patch.w&&py<patch.h&&matching(py*patch.w+px)){seed=py*patch.w+px;break;}}
    if(seed<0)return null;
    const visited=new Uint8Array(patch.w*patch.h),queue=new Int32Array(visited.length);
    const left=new Int32Array(patch.h).fill(patch.w),right=new Int32Array(patch.h).fill(-1);
    let head=0,tail=1,minX=patch.w,maxX=0,minY=patch.h,maxY=0;
    queue[0]=seed;visited[seed]=1;
    while(head<tail){
      const index=queue[head++],x=index%patch.w,y=Math.floor(index/patch.w);
      if((head&16383)===0)checkCancelled();
      // This may be an open background OR a real balloon clipped by the search
      // window. Only an expanded, bounded search can distinguish these cases.
      if(x===0||y===0||x===patch.w-1||y===patch.h-1)return 'larger';
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      left[y]=Math.min(left[y],x);right[y]=Math.max(right[y],x);
      for(const next of [index-1,index+1,index-patch.w,index+patch.w])if(!visited[next]&&matching(next)){visited[next]=1;queue[tail++]=next;}
    }
    checkCancelled();
    const regionW=maxX-minX+1,regionH=maxY-minY+1;
    if(regionW<20||regionH<16)return null;
    const widest=Math.max(...right.subarray(minY,maxY+1).map((value,index)=>value-left[minY+index]+1));
    const upper=minY+Math.floor(regionH*.15),lower=maxY-Math.floor(regionH*.15);
    // Straight-sided rectangular panels/captions do not qualify as dialogue.
    if(right[upper]-left[upper]+1>widest*.84 || right[lower]-left[lower]+1>widest*.84)return null;
    const gap=Math.max(3,Math.min(10,Math.round(Math.min(regionW,regionH)*.05)));
    function writingBox(top,bottom){
      if(top<minY+gap||bottom>maxY-gap||bottom<=top)return null;
      let start=minX+gap,end=maxX-gap;
      for(let y=top;y<=bottom;y++){if(right[y]<left[y])return null;start=Math.max(start,left[y]+gap);end=Math.min(end,right[y]-gap);}
      const box={x:patch.x+start,y:patch.y+top,w:end-start,h:bottom-top};
      if(box.w<=0||box.h<=0||glyphs.some(area=>area.x<box.x||area.y<box.y||area.x+area.w>box.x+box.w||area.y+area.h>box.y+box.h))return null;
      // A closed outline may surround an illustration. Require the whole writing
      // rectangle to be background or precisely bounded original glyph pixels.
      for(let y=top;y<=bottom;y++)for(let x=start;x<=end;x++){
        if(visited[y*patch.w+x])continue;
        const gx=patch.x+x,gy=patch.y+y;
        if(!glyphs.some(area=>gx>=area.x&&gx<area.x+area.w&&gy>=area.y&&gy<area.y+area.h))return null;
      }
      return box;
    }
    let box=writingBox(Math.max(minY+gap,Math.floor(text.y-patch.y-text.h*.2)),Math.min(maxY-gap,Math.ceil(text.y+text.h-patch.y+text.h*.2)));
    // Expand writing into verified empty balloon space, not the original glyph
    // bounds. Every candidate remains inset from the real curved boundary.
    for(const inset of [.12,.16,.20,.24,.28,.32,.36]){
      checkCancelled();
      const candidate=writingBox(minY+gap+Math.ceil(regionH*inset),maxY-gap-Math.ceil(regionH*inset));
      if(candidate&&(!box||candidate.w*candidate.h>box.w*box.h))box=candidate;
    }
    return box?{...block,box,balloonDetected:true}:null;
    }
    let previous='';
    for(const factor of [1,2,4,8]){
      checkCancelled();
      const patch=clampBox({x:text.x-marginX*factor,y:text.y-marginY*factor,w:text.w+marginX*factor*2,h:text.h+marginY*factor*2},context.canvas.width,context.canvas.height);
      if(!patch||patch.w*patch.h>1800000)return null;
      const key=[patch.x,patch.y,patch.w,patch.h].join(',');
      if(key===previous)continue;
      previous=key;
      const result=search(patch);
      if(result!=='larger')return result;
    }
    return null;
  }
  function fontFamily(settings) {
    if (settings.fontFamily==='serif') return 'Georgia, "Noto Serif", "Times New Roman", serif';
    if (settings.fontFamily==='sans') return 'Arial, "Noto Sans", "Yu Gothic", Tahoma, sans-serif';
    return '"Comic Sans MS", "Comic Neue", "Trebuchet MS", "Yu Gothic", Tahoma, sans-serif';
  }
  function tokens(text,locale) {
    if (root.Intl?.Segmenter) return [...new Intl.Segmenter(locale || undefined,{granularity:'word'}).segment(text)].map(item=>item.segment);
    return text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]|[^\s\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+|\s+/g) || [];
  }
  function wrap(context,text,maxWidth,locale) {
    const lines=[];
    for (const paragraph of String(text).replace(/\r/g,'').split('\n')) {
      if (!paragraph.trim()) { if (lines.length) lines.push('');continue; }
      let line='';
      for (let token of tokens(paragraph,locale)) {
        if (!line && /^\s+$/.test(token)) continue;
        if (context.measureText(line+token).width<=maxWidth) {line+=token;continue;}
        if (line.trim()) {lines.push(line.trim());line='';}
        token=token.trimStart();
        if (!token) continue;
        if (context.measureText(token).width<=maxWidth) {line=token;continue;}
        for (const character of Array.from(token)) {
          if (line && context.measureText(line+character).width>maxWidth) {lines.push(line);line='';}
          line+=character;
        }
      }
      if (line.trim()) lines.push(line.trim());
    }
    return lines.length ? lines : [''];
  }
  function layout(context,text,box,settings,language) {
    const family=fontFamily(settings);
    const maxFont=Math.min(44,Math.max(8,box.h*.8),Math.max(8,Math.sqrt(box.w*box.h/(Math.max(1,text.length)*.55))*1.5)) * Math.min(1.8,Math.max(.6,Number(settings.fontScale)||1));
    let lower=4,upper=Math.max(4,maxFont),best=null;
    for (let iteration=0;iteration<15;iteration++) {
      const size=(lower+upper)/2; context.font=`600 ${size}px ${family}`;
      const lines=wrap(context,text,Math.max(2,box.w-4),language),lineHeight=size*1.18;
      const fits=lines.length*lineHeight<=box.h-2 && lines.every(line=>context.measureText(line).width<=box.w-3);
      if (fits) {best={size,lines,lineHeight,font:context.font};lower=size;} else upper=size;
    }
    if (!best) {
      context.font=`600 4px ${family}`;
      best={size:4,lines:wrap(context,text,Math.max(2,box.w-4),language),lineHeight:4.72,font:context.font};
      best.overflow=best.lines.length*best.lineHeight>box.h-2;
    }
    return best;
  }
  function drawText(context,block,settings,targetLanguage) {
    const box=clampBox(block.box,context.canvas.width,context.canvas.height,2);
    if (!box) return false;
    const estimate=background(context,box);
    const brightness=estimate.color[0]*.299+estimate.color[1]*.587+estimate.color[2]*.114;
    const text=String(block.translated).trim();
    const fitted=layout(context,text,box,settings,targetLanguage);
    const rtl=/^(ar|he|fa|ur)(-|$)/i.test(targetLanguage) || /[\u0590-\u08ff]/.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(text);
    context.save(); context.beginPath(); context.rect(box.x,box.y,box.w,box.h); context.clip();
    context.font=fitted.font; context.textAlign='center'; context.textBaseline='middle'; context.direction=rtl ? 'rtl' : 'ltr';
    context.fillStyle=brightness<128 ? '#fff' : '#15121b';
    const startY=box.y+(box.h-fitted.lines.length*fitted.lineHeight)/2+fitted.lineHeight/2;
    fitted.lines.forEach((line,index)=>context.fillText(line,box.x+box.w/2,startY+index*fitted.lineHeight));
    context.restore();
    block.renderFontSize=Math.round(fitted.size*10)/10;
    return !!fitted.overflow || fitted.size<7;
  }
  function sanitizeBlocks(blocks,width,height) {
    return (Array.isArray(blocks)?blocks:[]).slice(0,300).map((item,index)=>{
      const box=clampBox(item.box,width,height);
      if (!box || !String(item.translated || '').trim()) return null;
      // Original cleanup coordinates remain valid when a reviewer moves the
      // translated text box elsewhere in the same image.
      const cleanupBoxes=(Array.isArray(item.cleanupBoxes) ? item.cleanupBoxes : [box]).map(area=>clampBox(area,width,height)).filter(Boolean);
      return { ...item,id:String(item.id || `block-${index+1}`),text:String(item.text || '').slice(0,10000),translated:String(item.translated).slice(0,18000),box,cleanupBoxes:cleanupBoxes.length?cleanupBoxes:[box] };
    }).filter(Boolean);
  }
  async function render(source,blocks,settings,progress=()=>{},checkCancelled=()=>{}) {
    const output=canvas(source.width,source.height),context=output.getContext('2d',{willReadFrequently:true});
    context.drawImage(source,0,0);
    const detectedBlocks=sanitizeBlocks(blocks,source.width,source.height),warnings=[];
    // In smart mode, never draw translated text unless every original glyph line
    // sits on a flat background that cleanupRectangle can actually erase. Check
    // the identical padded area and threshold before changing any glyph line.
    // This intentionally skips false
    // OCR/vision hits over faces, hair, clothes and scenery instead of painting
    // text on top of the artwork.
    const cleanBlocks=[];let skippedUnsafe=0,skippedSmall=0;
    for(const block of detectedBlocks){
      const safe=settings.cleanup!=='smart'||block.cleanupBoxes.every(originalBox=>{
        const area=cleanupArea(context,originalBox);
        return area && background(context,area).flat;
      });
      if(!safe){skippedUnsafe++;continue;}
      const writeBox=clampBox(block.box,source.width,source.height,2);
      const fitted=writeBox&&layout(context,block.translated,writeBox,settings,SD.targetLanguage(settings));
      // Decide legibility before removing a single original glyph. Long text in
      // a tiny bubble stays original rather than becoming unreadable or clipped.
      if(!fitted||fitted.overflow||fitted.size<7){skippedSmall++;continue;}
      cleanBlocks.push(block);
    }
    let textured=false,tiny=false;
    for (let index=0;index<cleanBlocks.length;index++) {
      checkCancelled();
      for (const area of cleanBlocks[index].cleanupBoxes) if (cleanupRectangle(context,area,settings)) textured=true;
      progress(.6*(index+1)/Math.max(1,cleanBlocks.length),'Apagando texto original');
      if (index%8===0) await new Promise(resolve=>setTimeout(resolve,0));
    }
    const cleanedDataUrl=settings.includeCleanedImage ? output.toDataURL('image/png') : undefined;
    for (let index=0;index<cleanBlocks.length;index++) {
      checkCancelled();
      if (drawText(context,cleanBlocks[index],settings,SD.targetLanguage(settings))) tiny=true;
      progress(.6+.4*(index+1)/Math.max(1,cleanBlocks.length),'Compondo texto traduzido');
    }
    if(skippedUnsafe)warnings.push(`${skippedUnsafe} área(s) insegura(s) foram ignoradas para preservar personagens e o desenho.`);
    if(skippedSmall)warnings.push(skippedSmall+' fala(s) foram mantidas no original porque a tradução não cabe com fonte legível. Revise o texto ou o balão.');
    if (textured) warnings.push('Algumas áreas têm fundo não uniforme: a limpeza sólida pode apagar detalhes e precisa de revisão manual.');
    if (tiny) warnings.push('Alguns balões são pequenos para a tradução. Ajuste os blocos no editor para melhorar a legibilidade.');
    const dataUrl=output.toDataURL('image/png');if(!dataUrl.startsWith('data:image/png'))throw new Error('O navegador não conseguiu exportar esta página na resolução original. Divida a imagem em páginas menores.');
    return {dataUrl,width:output.width,height:output.height,blocks:cleanBlocks,warnings,...(cleanedDataUrl ? {cleanedDataUrl} : {})};
  }
  root.SDRender={load,render,canvas,clampBox,background,cleanupRectangle,findSpeechBalloon,nearbyPunctuation,wrap,layout,sanitizeBlocks};
})(globalThis);
