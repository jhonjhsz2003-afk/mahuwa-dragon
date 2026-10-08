import {giphyId} from './giphy.js';
export const esc=(value='')=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeUrl(value,fallback='/assets/poster-placeholder.svg'){
  if(typeof value!=='string'||value.length>4096)return fallback;
  if(/^\/(?!\/)[^\x00-\x20\\]*$/.test(value))return value;
  try{const parsed=new URL(value);return parsed.protocol==='https:'?parsed.href:fallback;}catch{return fallback;}
}
export function parseRoute(hash=''){
  const [path,query='']=(hash.replace(/^#\/?/,'')||'').split('?');
  const [page='home',...segments]=path.split('/');
  let id='';try{id=decodeURIComponent(segments.join('/'));}catch{id='';}
  return {page:page||'home',id,params:new URLSearchParams(query)};
}
export const titleLink=id=>`#/title/${encodeURIComponent(String(id))}`;
export const readLink=id=>`#/read/${encodeURIComponent(String(id))}`;
export function validAppRoute(hash){
  if(typeof hash!=='string'||hash.length>4096||!/^#\/[^\x00-\x20]*$/.test(hash))return false;
  const {page,id}=parseRoute(hash),allowed=['home','catalog','title','read','library','profile','gifs','import','settings'];
  if(!allowed.includes(page))return false;
  return !['title','read'].includes(page)||Boolean(id);
}
export function createRouteTrail(initialHash='#/'){
  const trail=[];let current=validAppRoute(initialHash)?initialHash:'#/',pendingBack=null;
  const fallback=hash=>{const {page,id}=parseRoute(hash);return ['title','read'].includes(page)?'#/catalog':page==='profile'&&id?'#/profile':'#/';};
  return {
    observe(next){
      if(!validAppRoute(next)||next===current)return false;
      if(pendingBack===next)pendingBack=null;
      else {pendingBack=null;if(trail.at(-1)===next)trail.pop();else {trail.push(current);if(trail.length>50)trail.shift();}}
      current=next;return true;
    },
    back(){
      let destination;
      while(trail.length&&!destination){const candidate=trail.pop();if(validAppRoute(candidate)&&candidate!==current)destination=candidate;}
      destination=destination||fallback(current);pendingBack=destination;return destination;
    }
  };
}
export const kindNames={manga:'Mangá',manhwa:'Manhwa',manhua:'Manhua',novel:'Novel'};
export const collectionNames={favorite:'Favoritos',later:'Ler depois',reading:'Lendo',completed:'Concluídos',paused:'Pausados',dropped:'Abandonados'};
export const colors={ice:'Gelo',blue:'Azul',cyan:'Ciano',green:'Verde',gold:'Dourado',orange:'Laranja',pink:'Rosa',violet:'Violeta'};
export const covers={aurora:'Aurora',inferno:'Fogo azul',nebula:'Nebulosa',moon:'Luar'};
export const frames={flame:'Chama azul',crystal:'Cristal',halo:'Halo dourado',plain:'Essencial'};
export const statusName=value=>({ongoing:'Em publicação',completed:'Concluído',hiatus:'Em pausa',cancelled:'Cancelado',finished:'Concluído'})[value]||value||'Status não informado';
export function safeAvatar(value){return /^\/api\/avatar\/[a-zA-Z0-9-]{1,80}(?:\?v=[a-zA-Z0-9-]+)?$/.test(value||'')?value:'/assets/avatar-default.svg';}
export function identity(user={}){const v=user.identity||{};return {cover:Object.hasOwn(covers,v.cover)?v.cover:'aurora',frame:Object.hasOwn(frames,v.frame)?v.frame:'flame',title:String(v.title||'Explorador de histórias').slice(0,40)};}
export function nameClass(value){return `name-${Object.hasOwn(colors,value)?value:'ice'}`;}
export function frameStyle(frame={}){const x=Math.max(0,Math.min(100,Number(frame.x??50)||0)),y=Math.max(0,Math.min(100,Number(frame.y??50)||0)),zoom=Math.max(100,Math.min(300,Number(frame.zoom??100)||100))/100;return `object-position:${x}% ${y}%;transform:translate(${(50-x)*(zoom-1)}%,${(50-y)*(zoom-1)}%) scale(${zoom})`;}
export function avatar(user={},cls='avatar'){const gif=giphyId(user.avatar);return `<span class="avatar-frame ${cls} ring-${identity(user).frame}"><img src="${esc(safeAvatar(user.avatar))}"${gif?` data-giphy-avatar="${esc(gif)}" title="GIF via GIPHY"`:''} style="${frameStyle(user.avatarFrame)}" alt="${esc(user.name||'Avatar')}"></span>`;}
export const dateLabel=value=>{const date=new Date(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(date);};
export function workProgress(label,value){const known=Number.isFinite(value),percent=known?Math.max(0,Math.min(100,Math.round(value))):0;return `<div class="work-progress${known?'':' is-indeterminate'}"><div class="work-progress-caption"><span>${esc(label)}</span>${known?`<strong>${percent}%</strong>`:'<span>Em andamento</span>'}</div><div class="work-progress-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100"${known?` aria-valuenow="${percent}"`:''}><div class="work-progress-fill"${known?` style="width:${percent}%"`:''}></div></div></div>`;}
export const AVATAR_MAX_BYTES=20*1024*1024;
export function validateAvatarFile(file){if(!file||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw new Error('Use JPG, PNG, WebP ou GIF.');if(file.size>AVATAR_MAX_BYTES)throw new Error('A imagem excede 20 MB. Escolha um arquivo menor.');return file;}
export function uploadAvatar(file,frame,{signal,onProgress}={}){
  validateAvatarFile(file);
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Envio cancelado.','AbortError'));return;}
    const xhr=new XMLHttpRequest();let settled=false;
    const cleanup=()=>{signal?.removeEventListener('abort',abort);xhr.upload.onprogress=null;};
    const finish=(error,data)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(data);};
    const abort=()=>xhr.abort();
    xhr.open('POST','/api/profile/avatar?'+new URLSearchParams(frame),true);xhr.withCredentials=true;xhr.timeout=180000;xhr.setRequestHeader('Content-Type',file.type);
    xhr.upload.onprogress=event=>onProgress?.({phase:event.lengthComputable&&event.loaded>=event.total?'saving':'upload',loaded:event.loaded,total:event.lengthComputable?event.total:null,percent:event.lengthComputable&&event.total>0?Math.min(100,event.loaded/event.total*100):undefined});
    xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{finish(new Error('O servidor não confirmou o salvamento da foto.'));return;}if(xhr.status<200||xhr.status>=300||data.ok!==true){finish(new Error(data.error||'Não foi possível salvar a foto.'));return;}if(!data.avatar){finish(new Error('O servidor não retornou a foto salva.'));return;}finish(null,data);};
    xhr.onerror=()=>finish(new Error('O envio da foto não foi concluído. Verifique a conexão e tente novamente.'));
    xhr.ontimeout=()=>finish(new Error('O envio demorou além do limite. Tente novamente.'));
    xhr.onabort=()=>finish(new DOMException('Envio cancelado.','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});xhr.send(file);
  });
}
export const store={get(key,fallback){try{return JSON.parse(localStorage.getItem('mh_'+key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem('mh_'+key,JSON.stringify(value));return true;}catch{return false;}}};
const symbols={home:'<path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/>',book:'<path d="M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Zm0 0v16"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',list:'<path d="M6 3h12v18l-6-4-6 4Z"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',import:'<path d="M4 16v5h16v-5M12 17V3m-5 5 5-5 5 5"/>',heart:'<path d="M12 21 3 12a5.5 5.5 0 0 1 9-7 5.5 5.5 0 0 1 9 7Z"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',next:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m15 5-7 7 7 7"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',spark:'<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',check:'<path d="m4 12 5 5 11-11"/>',plus:'<path d="M12 4v16M4 12h16"/>',like:'<path d="M7 10v11H3V10Zm0 0 5-7c2 0 2 2 1 5h5c2 0 3 1 2 4l-2 7c0 1-1 2-3 2H7"/>',share:'<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
export const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${symbols[name]||symbols.book}</svg>`;
export function poster(item,eager=false){return `<img src="${esc(safeUrl(item.coverUrl))}" alt="${esc(item.title)}" width="400" height="600" loading="${eager?'eager':'lazy'}" decoding="async"${eager?' fetchpriority="high"':''}>`;}
export function mediaCard(item,index){const rated=Number(item.rating)>0?`<span class="card-rating">★ ${Number(item.rating).toFixed(1)}</span>`:'';return `<a class="media-card${Number.isInteger(index)?' ranked':''}" href="${titleLink(item.id)}" aria-label="${esc(item.title)}"><div class="poster-wrap">${poster(item)}${rated}<span class="card-kind">${kindNames[item.kind]||'Mangá'}</span><span class="card-open">${icon('book')}</span>${Number.isInteger(index)?`<span class="rank-number">${String(index+1).padStart(2,'0')}</span>`:''}</div><h3>${esc(item.title)}</h3><p>${esc(item.year||statusName(item.status))}${item.chapterCount?` <span>·</span> ${Number(item.chapterCount)} cap.`:''}</p></a>`;}
export const skeleton=()=>`<div class="catalog-grid" aria-label="Carregando catálogo" aria-busy="true">${Array.from({length:8},()=>'<div class="skeleton-card"><div></div><span></span><small></small></div>').join('')}</div>`;
export const heading=(title,subtitle='')=>`<div class="page-heading"><span class="eyebrow">MAHUWA DRAGON</span><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>`;
export const empty=(title,text='',actions='')=>`<div class="empty"><span class="empty-icon">${icon('book')}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>${actions}</div>`;
