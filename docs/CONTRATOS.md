# Contratos internos do Mahuwa Dragon

Projeto baseado na estrutura do ZIP Anime_Dragon-main, adaptado para Cloudflare Worker + assets estáticos + D1. Contas/perfis serão preservados conceitualmente; não copiar identidades do banco ou contas Cloudflare do pacote de referência.

## Catálogo

Media: `{id:'md:uuid'|'jk:123'|'local:dragon', title, originalTitle, description, coverUrl, backdropUrl, kind:'manga'|'manhwa'|'manhua'|'novel', originLanguage, rating, status, year, tags:[], authors:[], provider, chapterCount, url, available}`.

- `GET /api/catalog/home` → `{ok,featured,trending,popular,recent,updates,top,manhwa,manhua,novels,providers:[],partial,warnings:[]}`. Todos são arrays de Media. Não apresentar metadados como se fossem capítulos.
- `GET /api/catalog/discover?q=&kind=&sort=popular|rating|updated|new&page=1&tag=&language=` → `{ok,items,page,totalPages,total,hasMore}`.
- `GET /api/catalog/:id` (id URL-encoded) → `{ok,item,recommendations:[]}`.
- `GET /api/catalog/:id/chapters?language=pt-br|all&page=1&order=asc|desc` → `{ok,chapters:[{id,mediaId,number,title,language,pages,publishedAt,group,externalUrl,volume}],page,totalPages,hasMore,total}`.
- `GET /api/chapters/:id?quality=original|lite` → `{ok,chapter,media,pages:[{url,index,filename}],previousId,nextId}`. `url` será same-origin proxy ou asset local para OCR/canvas.
- `GET /api/page/md/:chapterUuid/:pageIndex?quality=original|lite` → imagem, sem URL arbitrária aceita.
- `GET /api/cover/md/:mangaUuid/:coverFilename` → capa, valida UUID e arquivo permitido. Arquivo `.jpg/.png/.webp` opcional `.256.jpg/.512.jpg`.
- `GET /api/config` → `{ok,translation:{defaultEngine:'local',google:true,gemini:boolean,geminiRequiresLogin:true},providers:[],registrationAvailable:boolean}`.

## Tradução no site

`web/js/translator.js` exporta `translateImage(dataUrl,settings,{onProgress,signal})`, `renderImage(dataUrl,blocks,settings)` e cache local IndexedDB. Resultado `{dataUrl,width,height,blocks:[{id,text,translated,box:{x,y,w,h},confidence}],sourceLanguage,warnings}`. Não usar chrome.* nem chave administrativa no navegador.

`POST /api/translate/text` recebe `{texts:[],sourceLanguage:'auto',targetLanguage:'pt',provider:'google'|'gemini',glossary:''}` → `{ok,translations:[{text,sourceLanguage}],sourceLanguage,warnings}`. Google básico limitado por usuário/IP e cache, melhor esforço. Gemini exige login/cota.

`POST /api/translate/vision` recebe `{dataUrl,targetLanguage:'pt',translateSfx:false,glossary:''}` → resposta JSON do Gemini em forma compatível com SDProviders. Segredo `GEMINI_API_KEY` no Worker. Capturar request real via bridge `FETCH_JSON` e adaptar contrato sem proxy arbitrário. `GET /api/config` expõe disponibilidade, nunca segredo.

`web/js/reader.js` exporta `mountReader(container,{media,chapter,pages,previousId,nextId,onNavigate,onProgress,onClose,api})` → `{destroy()}`. `api(path,options)` retorna JSON com ok verificado; onNavigate(chapterId) abre outro capítulo; onProgress({mediaId,chapterId,page,totalPages,percent}) salva progresso. Leitura vertical/página/RTL, auto tradução para pt se chapter.language não começa pt, manual revisão/original. Autorizar preferências locais com processamento sequencial; adiar tradução até página visível.

## Contas/biblioteca/comunidade

Manter `/api/auth/me`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/profile`, `/api/auth/privacy`, `/api/profile/avatar` e avatar/crop/reset do exemplo, perfis com `{id,name,email,bio,avatar,avatarFrame,visibility,nameColor,identity:{cover,frame,title}}`.

- `GET /api/library` → `{ok,items:[{mediaId,kind,item,updatedAt}],progress:[]}`.
- `POST /api/library` `{mediaId,kind:'favorite'|'later'|'reading'|'completed'|'paused'|'dropped',remove:false,item?}` → `{ok}`. metadata item validada/limitada.
- `GET /api/progress` → `{ok,items:[{mediaId,chapterId,page,totalPages,percent,updatedAt,item?}]}`.
- `POST /api/progress` recebe essas propriedades e `item?` → `{ok}`.
- `GET /api/settings` → `{ok,settings}`; `POST /api/settings` recebe `{settings}`.
- `GET /api/profiles/:userId` → `{ok,user,stats,library}` respeita privacidade e não expõe email.
- `GET /api/comments?mediaId=...` → `{ok,items:[{id,body,spoiler,user:{id,name,avatar,nameColor,identity},createdAt,likes,likedByMe}],hasMore}`.
- `POST /api/comments` `{mediaId,body,spoiler,chapterId?}` → `{ok,item}`.
- `POST /api/comments/:id/like` → `{ok}`; `DELETE /api/comments/:id` autor apenas.

Conta e banco reais, sem salvar senhas no localStorage. Leitor/biblioteca de visitante podem funcionar localmente com rótulo; não fingir conta autenticada quando DB/config falham.
