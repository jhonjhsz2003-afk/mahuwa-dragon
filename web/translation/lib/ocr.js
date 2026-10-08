(function (root) {
  'use strict';
  const PACKS = Object.freeze({ en:'eng', pt:'por', es:'spa', fr:'fra', de:'deu', it:'ita', ru:'rus', ar:'ara', ja:'jpn', 'ja-vert':'jpn_vert', ko:'kor', 'zh-CN':'chi_sim', 'zh-TW':'chi_tra' });
  const AUTO_LANGUAGES = ['eng', 'jpn', 'kor', 'chi_sim', 'chi_tra', 'rus', 'ara'];
  let worker = null;
  let workerKey = '';
  let activeProgress = () => {};

  function canvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width; element.height = height;
    return element;
  }
  function languagePacks(settings = {}) {
    if (settings.ocrLanguages) {
      const available = new Set([...Object.values(PACKS), 'jpn_vert']);
      const requested = (Array.isArray(settings.ocrLanguages) ? settings.ocrLanguages : String(settings.ocrLanguages).split(/[+,\s]+/)).filter(item => available.has(item));
      if (requested.length) return [...new Set(requested)];
    }
    if (settings.sourceLanguage && settings.sourceLanguage !== 'auto') {
      const pack = PACKS[settings.sourceLanguage] || PACKS[settings.sourceLanguage.split('-')[0]];
      if (!pack) throw new Error('Este idioma não possui OCR local instalado. Selecione a tradução por IA no leitor.');
      return pack === 'eng' ? ['eng'] : [pack, 'eng'];
    }
    return AUTO_LANGUAGES;
  }
  async function getWorker(settings, progress) {
    activeProgress = progress;
    const languages = languagePacks(settings);
    const key = `${languages.join('+')}:${settings.sourceLanguage === 'ja-vert' ? 'vertical' : 'sparse'}`;
    if (worker && workerKey === key) return worker;
    if (worker) { await worker.terminate(); worker = null; }
    if (!root.Tesseract?.createWorker) throw new Error('O motor OCR local não carregou. Recarregue o site e tente novamente.');
    const resolve = path => SD.assetURL(path);
    try {
      worker = await Tesseract.createWorker(languages, Tesseract.OEM?.LSTM_ONLY ?? 1, {
        workerPath: resolve('vendor/worker.min.js'),
        corePath: resolve('vendor/tesseract-core'),
        langPath: resolve('tessdata'),
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'write',
        logger: event => activeProgress(event.progress || 0, event.status || 'OCR'),
        errorHandler: () => {}
      });
      workerKey = key;
      await worker.setParameters({ tessedit_pageseg_mode: settings.sourceLanguage === 'ja-vert' ? Tesseract.PSM?.SINGLE_BLOCK_VERT_TEXT ?? '5' : Tesseract.PSM?.SPARSE_TEXT ?? '11', preserve_interword_spaces: '1', user_defined_dpi: '200' });
      return worker;
    } catch (error) {
      worker = null; workerKey = '';
      throw new Error(`Não foi possível iniciar o OCR local: ${error.message || error}`);
    }
  }
  function planTiles(width, height, maxHeight = 1900, overlap = 180) {
    if (height <= maxHeight) return [{ x:0, y:0, w:width, h:height }];
    const tiles = [];
    const stride = Math.max(1, maxHeight - overlap);
    for (let y = 0; y < height; y += stride) {
      tiles.push({ x:0, y, w:width, h:Math.min(maxHeight, height-y) });
      if (y + maxHeight >= height) break;
    }
    return tiles;
  }
  function cleanText(text) {
    return String(text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[ \t]+/g, ' ').replace(/([\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]) +(?=[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])/g, '$1').trim();
  }
  function boxOf(bbox, tile, scale = 1) {
    if (!bbox) return null;
    const x = bbox.x0 / scale + tile.x, y = bbox.y0 / scale + tile.y;
    const w = (bbox.x1 - bbox.x0) / scale, h = (bbox.y1 - bbox.y0) / scale;
    return [x,y,w,h].every(Number.isFinite) && w > 0 && h > 0 ? {x,y,w,h} : null;
  }
  function flattenLines(data, tile, scale, threshold) {
    const lines = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          const text = cleanText(line.text), box = boxOf(line.bbox, tile, scale);
          const confidence = Number(line.confidence) || 0;
          const punctuationOnly=/^[.!?,:;…。！？、—…'"“”‘’()\-]{1,8}$/.test(text);
          if (!box || confidence < (punctuationOnly ? Math.min(threshold,15) : threshold) || !(/[\p{L}\p{N}]/u.test(text) || punctuationOnly) || text.length > 2200) continue;
          const wordBoxes = (line.words || []).filter(word => cleanText(word.text)).map(word => boxOf(word.bbox, tile, scale)).filter(Boolean);
          lines.push({ text, box, confidence, punctuationOnly,cleanupBoxes:wordBoxes.length ? wordBoxes : [box], group:lines.length });
        }
      }
    }
    return lines;
  }
  function unionBox(a, b) {
    const x = Math.min(a.x,b.x), y = Math.min(a.y,b.y);
    return { x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y };
  }
  function overlapRatio(a, b) {
    const w = Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
    const h = Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    return w*h / Math.max(1,Math.min(a.w*a.h,b.w*b.h));
  }
  function deduplicate(blocks) {
    const chosen = [];
    const key = text => cleanText(text).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
    for (const block of [...blocks].sort((a,b) => (b.confidence || 0)-(a.confidence || 0) || b.text.length-a.text.length)) {
      const match = chosen.find(item => overlapRatio(item.box,block.box) > 0.62 && (key(item.text) === key(block.text) || key(item.text).includes(key(block.text)) || key(block.text).includes(key(item.text))));
      if (!match) chosen.push(block);
    }
    return chosen.sort((a,b) => a.box.y-b.box.y || a.box.x-b.box.x);
  }
  function clearCorridor(context,x0,y0,x1,y1,horizontal=false) {
    if (!context) return true;
    const length=Math.hypot(x1-x0,y1-y0);
    if (length<=1) return true;
    const steps=Math.min(100,Math.ceil(length/2));
    const rows=[];
    for(let step=0;step<=steps;step++) {
      const fraction=step/steps,x=x0+(x1-x0)*fraction,y=y0+(y1-y0)*fraction;
      const samples=[];
      for(const offset of [-3,0,3]) {
        const px=Math.round(x+(horizontal?0:offset)),py=Math.round(y+(horizontal?offset:0));
        if(px<0||py<0||px>=context.canvas.width||py>=context.canvas.height) return false;
        const pixel=context.getImageData(px,py,1,1).data;
        samples.push((pixel[0]+pixel[1]+pixel[2])/3);
      }
      rows.push(samples);
    }
    const values=rows.flat().sort((a,b)=>a-b),median=values[Math.floor(values.length/2)];
    // Compare with the corridor's actual background: black balloons with white
    // type should merge as well, while light/dark outlines separate balloons.
    return rows.every(samples=>samples.filter(value=>Math.abs(value-median)>85).length<2);
  }
  function similarBackground(context, first, second) {
    const cx=(first.x+first.w/2+second.x+second.w/2)/2;
    const start=first.y+first.h+2,end=second.y-2;
    return end<=start || clearCorridor(context,cx,start,cx,end);
  }
  function mergeBaselines(lines,context) {
    const rows=[];
    const sorted=deduplicate(lines).sort((a,b)=>a.box.x-b.box.x || a.box.y-b.box.y);
    for (const line of sorted) {
      let best=null,bestGap=Infinity;
      for(const row of rows) {
        const previous=row.lastBox,gap=line.box.x-(previous.x+previous.w);
        const height=Math.max(previous.h,line.box.h);
        const centerDifference=Math.abs(previous.y+previous.h/2-line.box.y-line.box.h/2);
        const overlap=Math.max(0,Math.min(previous.y+previous.h,line.box.y+line.box.h)-Math.max(previous.y,line.box.y));
        const aligned=overlap/Math.min(previous.h,line.box.h)>.6 || centerDifference<height*.3;
        const permittedGap=height*(line.punctuationOnly || row.punctuationOnly ? 1.05 : 1.6);
        const cy=(previous.y+previous.h/2+line.box.y+line.box.h/2)/2;
        if(aligned && gap>=-height*.12 && gap<=permittedGap && gap<bestGap && clearCorridor(context,previous.x+previous.w+1,cy,line.box.x-1,cy,true)) {best=row;bestGap=gap;}
      }
      if(best) {
        const previous=best.lastBox;
        const height=Math.max(previous.h,line.box.h);
        const punctuation=line.punctuationOnly && !/^[('"“‘]/.test(line.text) || best.punctuationOnly && /^[('"“‘]/.test(best.text);
        const joinedWord=bestGap<height*.48 && /[\p{L}\p{N}]$/u.test(best.text) && /^[\p{L}\p{N}]/u.test(line.text);
        const cjk=/[\u3040-\u30ff\u3400-\u9fff]$/u.test(best.text) || /^[\u3040-\u30ff\u3400-\u9fff]/u.test(line.text);
        best.text+=punctuation || joinedWord || cjk ? line.text : ` ${line.text}`;
        best.box=unionBox(best.box,line.box);best.lastBox=line.box;
        best.cleanupBoxes.push(...line.cleanupBoxes);
        best.confidence=Math.max(best.confidence,line.confidence);best.punctuationOnly=best.punctuationOnly && line.punctuationOnly;
      } else rows.push({...line,box:{...line.box},lastBox:line.box,cleanupBoxes:[...line.cleanupBoxes]});
    }
    return rows.filter(row=>!row.punctuationOnly).map(({lastBox,...row})=>row).sort((a,b)=>a.box.y-b.box.y || a.box.x-b.box.x);
  }
  function mergeLines(lines, context) {
    const sorted = mergeBaselines(lines,context);
    const groups = [];
    for (const line of sorted) {
      let best = null, bestGap = Infinity;
      for (const group of groups) {
        const last = group.lines[group.lines.length-1];
        const gap = line.box.y - (last.box.y+last.box.h);
        const averageHeight = (last.box.h+line.box.h)/2;
        const overlap = Math.max(0, Math.min(last.box.x+last.box.w,line.box.x+line.box.w)-Math.max(last.box.x,line.box.x));
        const aligned = overlap/Math.min(last.box.w,line.box.w) >= 0.52;
        const centered = Math.abs((last.box.x+last.box.w/2)-(line.box.x+line.box.w/2)) < averageHeight*0.9;
        const extent = unionBox(group.box,line.box);
        if (gap >= -averageHeight*0.12 && gap <= averageHeight*(overlap/Math.min(last.box.w,line.box.w)>.8 ? 1.5 : 1.1) && (aligned || centered) && extent.w <= Math.max(group.box.w,line.box.w)*1.25 && similarBackground(context,last.box,line.box) && gap < bestGap) {
          best = group; bestGap = gap;
        }
      }
      if (best) { best.lines.push(line); best.box = unionBox(best.box,line.box); }
      else groups.push({ lines:[line],box:{...line.box} });
    }
    return groups.map((group,index) => ({
      id:`block-${index+1}`, text:group.lines.map(line => line.text).join('\n'), translated:'', box:group.box,
      cleanupBoxes:group.lines.flatMap(line => line.cleanupBoxes),
      confidence:group.lines.reduce((sum,line) => sum+line.confidence,0)/group.lines.length,
      sourceLanguage:'auto'
    }));
  }
  function mergeVerticalLines(lines,context){
    const columns=deduplicate(lines).filter(line=>line.box.h>line.box.w*1.45).sort((a,b)=>b.box.x-a.box.x||a.box.y-b.box.y),groups=[];
    for(const line of columns){
      let best=null,bestGap=Infinity;
      for(const group of groups){
        const previous=group.lines[group.lines.length-1],gap=previous.box.x-(line.box.x+line.box.w),averageWidth=(previous.box.w+line.box.w)/2;
        const overlap=Math.max(0,Math.min(previous.box.y+previous.box.h,line.box.y+line.box.h)-Math.max(previous.box.y,line.box.y));
        const cy=(previous.box.y+previous.box.h/2+line.box.y+line.box.h/2)/2;
        if(gap>=-averageWidth*.12&&gap<=averageWidth*1.6&&overlap/Math.min(previous.box.h,line.box.h)>.5&&gap<bestGap&&clearCorridor(context,line.box.x+line.box.w+1,cy,previous.box.x-1,cy,true)){best=group;bestGap=gap;}
      }
      if(best){best.lines.push(line);best.box=unionBox(best.box,line.box);}else groups.push({lines:[line],box:{...line.box}});
    }
    const vertical=groups.map((group,index)=>({id:`vertical-${index+1}`,text:group.lines.map(line=>line.text).join('\n'),translated:'',box:group.box,cleanupBoxes:group.lines.flatMap(line=>line.cleanupBoxes),confidence:group.lines.reduce((sum,line)=>sum+line.confidence,0)/group.lines.length,sourceLanguage:'ja'}));
    const horizontal=mergeLines(lines.filter(line=>line.box.h<=line.box.w*1.45),context);
    return [...vertical,...horizontal].sort((a,b)=>a.box.y-b.box.y||b.box.x-a.box.x).map((block,index)=>({...block,id:`block-${index+1}`}));
  }
  async function extract(source, settings, progress = () => {}, checkCancelled = () => {}) {
    const warnings = [];
    const ocr = await getWorker(settings, (value,status) => progress(value*0.08, `Preparando OCR: ${status}`));
    const tiles = planTiles(source.width,source.height);
    const lines = [];
    for (let index=0; index<tiles.length; index++) {
      checkCancelled();
      const tile = tiles[index];
      const scale = Math.min(1.5, 2400/tile.w);
      const input = canvas(Math.round(tile.w*scale),Math.round(tile.h*scale));
      const context = input.getContext('2d',{willReadFrequently:true});
      context.fillStyle = '#fff'; context.fillRect(0,0,input.width,input.height);
      context.drawImage(source,tile.x,tile.y,tile.w,tile.h,0,0,input.width,input.height);
      activeProgress = (value,status) => progress(0.08+0.92*(index+value)/tiles.length, `OCR ${index+1}/${tiles.length}: ${status}`);
      const result = await ocr.recognize(input, {}, { text:true,blocks:true });
      lines.push(...flattenLines(result.data,tile,scale,Number(settings.minConfidence ?? 40)));
      input.width=1; input.height=1;
    }
    checkCancelled();
    const originalContext=source.getContext('2d',{willReadFrequently:true});
    const detected = (settings.sourceLanguage==='ja-vert'?mergeVerticalLines:mergeLines)(lines,originalContext);
    // Only enclosed dialogue is sent to a translation provider. The detector
    // always reads original pixels and fails closed when enclosure is unclear.
    const blocks=[];
    for(const block of detected){
      checkCancelled();
      const balloon=root.SDRender?.findSpeechBalloon?.(originalContext,block,checkCancelled);
      if(balloon)blocks.push(balloon);
    }
    if(detected.length>blocks.length)warnings.push((detected.length-blocks.length)+' área(s) sem balão de fala fechado e seguro foram ignoradas para preservar personagens, títulos e o desenho.');
    if (blocks.length > 180) warnings.push('Há muitos blocos nesta imagem. A revisão manual pode melhorar a leitura.');
    if (settings.sourceLanguage === 'auto') warnings.push('O OCR automático local cobre os alfabetos instalados; letras estilizadas e idiomas semelhantes podem exigir revisão ou tradução por IA.');
    progress(1,'OCR concluído');
    return {blocks:blocks.slice(0,260),warnings};
  }
  async function terminate() {
    if (worker) await worker.terminate();
    worker=null; workerKey='';
  }
  root.SDOCR = { extract,terminate,planTiles,languagePacks,flattenLines,mergeLines,mergeVerticalLines,mergeBaselines,deduplicate,cleanText,unionBox,overlapRatio };
})(globalThis);
