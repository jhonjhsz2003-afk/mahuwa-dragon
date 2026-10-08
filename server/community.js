import { database } from './database.js';
import { getUser, throttle, fail, reply, assertOrigin, readJSON, digest, publicUser } from './auth.js';
import { identityColumns, identityJoin } from './profile-identity.js';

const uuid = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
const mediaPattern = new RegExp(`^(?:md:${uuid}|jk:[1-9][0-9]{0,9}|local:[a-zA-Z0-9][a-zA-Z0-9_-]{0,79})$`);
export function validMediaId(value) { if (typeof value !== 'string' || !mediaPattern.test(value)) throw fail(400, 'Identificador de obra inválido.'); return value; }
export function validChapterId(value) { if (typeof value !== 'string' || !new RegExp(`^(?:md:${uuid}|jk:[1-9][0-9]{0,9}(?::[a-zA-Z0-9._-]{1,70})?|local:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149})$`).test(value)) throw fail(400, 'Identificador de capítulo inválido.'); return value; }
const cleanText = (value, maximum) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
function safeURL(value, origin, cover = true) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u0020]/.test(value)) throw fail(400, 'Endereço de imagem inválido.');
  let url; try { url = new URL(value, origin); } catch { throw fail(400, 'Endereço inválido.'); }
  if (url.username || url.password) throw fail(400, 'Endereço inválido.');
  if (url.origin === origin && (/^\/assets\/[a-zA-Z0-9/_.,%-]+$/.test(url.pathname) || /^\/api\/cover\/md\//.test(url.pathname) || !cover && /^\/\??/.test(url.pathname))) return url.pathname + url.search + (cover ? '' : url.hash);
  const approved = cover ? ['uploads.mangadex.org', 'cdn.myanimelist.net'] : ['mangadex.org', 'myanimelist.net'];
  if (url.protocol === 'https:' && approved.includes(url.hostname)) return url.href;
  throw fail(400, 'Use uma capa do catálogo ou um arquivo local do site.');
}
export function validateMetadata(value, mediaId, origin) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Metadados da obra inválidos.');
  if (value.id !== undefined && value.id !== mediaId) throw fail(400, 'A obra não corresponde ao identificador informado.');
  const title = cleanText(value.title, 180); if (!title) throw fail(400, 'A obra precisa de um título.');
  const kind = ['manga', 'manhwa', 'manhua', 'novel'].includes(value.kind) ? value.kind : 'manga';
  const item = { id: mediaId, title, kind, coverUrl: safeURL(value.coverUrl, origin), originLanguage: cleanText(value.originLanguage, 15), provider: cleanText(value.provider, 30), status: cleanText(value.status, 30) };
  if (value.url) item.url = safeURL(value.url, origin, false);
  if (Number.isFinite(value.rating)) item.rating = Math.max(0, Math.min(10, value.rating));
  if (Number.isInteger(value.year) && value.year >= 1800 && value.year <= 2200) item.year = value.year;
  if (Number.isInteger(value.chapterCount) && value.chapterCount >= 0 && value.chapterCount <= 100000) item.chapterCount = value.chapterCount;
  if (Array.isArray(value.tags)) item.tags = value.tags.slice(0, 10).map(tag => cleanText(tag, 32)).filter(Boolean);
  if (JSON.stringify(item).length > 3072) throw fail(413, 'Metadados muito grandes.');
  return item;
}
function parseMetadata(value) { try { const item = JSON.parse(value); return item && typeof item === 'object' && !Array.isArray(item) ? item : null; } catch { return null; } }
const libraryItem = row => ({ mediaId: row.media_id, kind: row.kind, item: parseMetadata(row.metadata), updatedAt: row.updated_at });
const progressItem = row => ({ mediaId: row.media_id, chapterId: row.chapter_id, page: row.page, totalPages: row.total_pages, percent: row.percent, item: parseMetadata(row.metadata), updatedAt: row.updated_at });
const progressRows = (env, id) => env.DB.prepare('SELECT * FROM reading_progress WHERE user_id=? ORDER BY updated_at DESC LIMIT 200').bind(id).all();
const libraryRows = (env, id) => env.DB.prepare('SELECT media_id,kind,metadata,updated_at FROM manga_library WHERE user_id=? ORDER BY updated_at DESC LIMIT 500').bind(id).all();
export const DEFAULT_SETTINGS = Object.freeze({ motion: true, economy: false, autoReadSpeed: 24, readerMode: 'webtoon', readerDirection: 'ltr', readerZoom: 100, readerWidth: 1200, readerFontSize: 18, quality: 'original', autoTranslate: true, targetLanguage: 'pt', engine: 'gemini', translator: 'gemini', sourceLanguage: 'auto', translateSfx: false, fontFamily: 'comic', fontScale: 1, cleanup: 'smart', minConfidence: 82, glossary: '', rememberCache: true });
export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Preferências inválidas.');
  const result = {}, choices = { readerMode: ['webtoon', 'paged'], readerDirection: ['ltr', 'rtl'], quality: ['original', 'lite'], engine: ['local', 'gemini'], translator: ['google', 'gemini'], sourceLanguage: ['auto', 'en', 'ja', 'ja-vert', 'ko', 'zh-CN', 'zh-TW', 'pt', 'es', 'fr', 'de', 'it', 'ru', 'ar'], fontFamily: ['comic', 'sans', 'serif'], cleanup: ['smart', 'solid'] };
  const ranges = { autoReadSpeed: [8, 70], readerZoom: [50, 180], readerWidth: [480, 1600], readerFontSize: [14, 28], fontScale: [0.6, 1.8], minConfidence: [0, 95] };
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw fail(400, `Preferência não permitida: ${cleanText(key, 40)}.`);
    if (choices[key]) { if (!choices[key].includes(entry)) throw fail(400, `Valor inválido para ${key}.`); result[key] = entry; }
    else if (ranges[key]) { if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < ranges[key][0] || entry > ranges[key][1]) throw fail(400, `Valor inválido para ${key}.`); result[key] = entry; }
    else if (['motion', 'economy', 'autoTranslate', 'translateSfx', 'rememberCache'].includes(key)) { if (typeof entry !== 'boolean') throw fail(400, `Valor inválido para ${key}.`); result[key] = entry; }
    else if (key === 'targetLanguage') { if (typeof entry !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(entry)) throw fail(400, 'Idioma inválido.'); result[key] = entry; }
    else if (key === 'glossary') { if (typeof entry !== 'string' || entry.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(entry)) throw fail(400, 'Use um glossário de até 5.000 caracteres.'); result[key] = entry; }
  }
  return result;
}
async function metadataFor(data, user, env, origin, validateMedia) {
  const mediaId = validMediaId(data.mediaId);
  if (data.item !== undefined) return validateMetadata(data.item, mediaId, origin);
  const existing = await env.DB.prepare('SELECT metadata FROM manga_library WHERE user_id=? AND media_id=? UNION ALL SELECT metadata FROM reading_progress WHERE user_id=? AND media_id=? LIMIT 1').bind(user.id, mediaId, user.id, mediaId).first();
  const stored = parseMetadata(existing?.metadata); if (stored?.title) return stored;
  if (validateMedia) {
    const response = await validateMedia(mediaId, env), item = response?.item || response;
    if (item && typeof item === 'object' && item.title) return validateMetadata(item, mediaId, origin);
  }
  throw fail(400, 'Envie os metadados básicos da obra do catálogo.');
}
async function checkedMedia(mediaId, env, validateMedia) { validMediaId(mediaId); if (validateMedia) { const result = await validateMedia(mediaId, env); if (result === false || result === null) throw fail(404, 'Obra não encontrada.'); } }
const profileColumns = `users.id,users.username,users.avatar_url,users.bio,COALESCE(user_appearance.name_color,'ice') name_color,COALESCE(profile_privacy.visibility,'private') visibility,${identityColumns},pm.x avatar_x,pm.y avatar_y,pm.zoom avatar_zoom`;
const profileJoins = `LEFT JOIN profile_privacy ON profile_privacy.user_id=users.id LEFT JOIN user_appearance ON user_appearance.user_id=users.id ${identityJoin} LEFT JOIN profile_media pm ON pm.user_id=users.id`;
const commentSelect = `SELECT c.*,u.username,u.avatar_url,COALESCE(ua.name_color,'ice') name_color,COALESCE(pi.cover,'aurora') profile_cover,COALESCE(pi.frame,'flame') profile_frame,COALESCE(pi.title,'Explorador de histórias') profile_title,pm.x avatar_x,pm.y avatar_y,pm.zoom avatar_zoom,(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) likes,EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) liked_by_me FROM manga_comments c JOIN users u ON u.id=c.user_id LEFT JOIN user_appearance ua ON ua.user_id=u.id LEFT JOIN profile_identity pi ON pi.user_id=u.id LEFT JOIN profile_media pm ON pm.user_id=u.id`;
function commentItem(row, user) {
  const author = publicUser({ ...row, id: row.user_id }, false);
  delete author.bio; delete author.visibility;
  return { id: row.id, mediaId: row.media_id, chapterId: row.chapter_id, body: row.body, spoiler: !!row.spoiler, user: author, createdAt: row.created_at, updatedAt: row.updated_at, likes: row.likes || 0, likedByMe: !!row.liked_by_me, mine: String(row.user_id) === user?.id };
}
export async function community(request, env, validateMedia) {
  env = await database(env); const url = new URL(request.url), path = url.pathname, user = await getUser(request, env);
  const profileMatch = path.match(/^\/api\/profiles\/([a-zA-Z0-9-]{1,80})$/);
  if (profileMatch) {
    if (request.method !== 'GET') throw fail(405, 'Método não permitido.');
    const target = await env.DB.prepare(`SELECT ${profileColumns} FROM users ${profileJoins} WHERE users.id=? AND users.blocked=0`).bind(profileMatch[1]).first();
    if (!target) throw fail(404, 'Perfil não encontrado.');
    const owner = user?.id === String(target.id), hidden = !owner && target.visibility !== 'public', profile = publicUser(target, false);
    if (hidden) { delete profile.bio; return reply({ ok: true, user: profile, private: true, owner: false, stats: null, library: [] }); }
    const [library, progress] = await Promise.all([libraryRows(env, target.id), progressRows(env, target.id)]);
    const items = library.results.map(libraryItem), progressValues = progress.results.map(progressItem);
    const stats = { favorites: items.filter(item => item.kind === 'favorite').length, later: items.filter(item => item.kind === 'later').length, reading: items.filter(item => item.kind === 'reading').length, completed: items.filter(item => item.kind === 'completed').length, chaptersRead: progressValues.filter(item => item.percent >= 95).length };
    return reply({ ok: true, user: profile, private: false, owner, stats, library: items, ...(owner ? { progress: progressValues } : {}) });
  }
  if (['/api/library', '/api/progress', '/api/settings'].includes(path)) {
    if (!user) throw fail(401, 'Entre na sua conta para sincronizar.');
    if (request.method === 'GET') {
      if (path === '/api/library') { const [library, progress] = await Promise.all([libraryRows(env, user.id), progressRows(env, user.id)]); return reply({ ok: true, items: library.results.map(libraryItem), progress: progress.results.map(progressItem) }); }
      if (path === '/api/progress') return reply({ ok: true, items: (await progressRows(env, user.id)).results.map(progressItem) });
      const row = await env.DB.prepare('SELECT payload FROM user_settings WHERE user_id=?').bind(user.id).first();
      return reply({ ok: true, settings: { ...DEFAULT_SETTINGS, ...parseMetadata(row?.payload) } });
    }
    if (request.method !== 'POST') throw fail(405, 'Método não permitido.');
    assertOrigin(request); const data = await readJSON(request, 20000); await throttle(env, `library:${user.id}`, 300);
    const now = new Date().toISOString();
    if (path === '/api/settings') {
      const patch = validateSettings(data.settings), row = await env.DB.prepare('SELECT payload FROM user_settings WHERE user_id=?').bind(user.id).first();
      const settings = { ...DEFAULT_SETTINGS, ...parseMetadata(row?.payload), ...patch };
      await env.DB.prepare('INSERT INTO user_settings(user_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(user.id, JSON.stringify(settings), now).run();
      return reply({ ok: true, settings });
    }
    const mediaId = validMediaId(data.mediaId);
    if (path === '/api/library') {
      if (!['favorite', 'later', 'reading', 'completed', 'paused', 'dropped'].includes(data.kind) || data.remove !== undefined && typeof data.remove !== 'boolean') throw fail(400, 'Estado da biblioteca inválido.');
      if (data.remove) { await env.DB.prepare('DELETE FROM manga_library WHERE user_id=? AND media_id=? AND kind=?').bind(user.id, mediaId, data.kind).run(); return reply({ ok: true }); }
      const item = await metadataFor(data, user, env, url.origin, validateMedia);
      const count = await env.DB.prepare('SELECT COUNT(*) total FROM manga_library WHERE user_id=?').bind(user.id).first();
      const status = ['reading', 'completed', 'paused', 'dropped'].includes(data.kind);
      const previous = status ? await env.DB.prepare("SELECT 1 found FROM manga_library WHERE user_id=? AND media_id=? AND kind IN ('reading','completed','paused','dropped')").bind(user.id, mediaId).first() : await env.DB.prepare('SELECT 1 found FROM manga_library WHERE user_id=? AND media_id=? AND kind=?').bind(user.id, mediaId, data.kind).first();
      if (count.total >= 500 && !previous) throw fail(413, 'Sua biblioteca atingiu 500 entradas. Remova uma antes de adicionar.');
      const statements = [];
      if (status) statements.push(env.DB.prepare("DELETE FROM manga_library WHERE user_id=? AND media_id=? AND kind IN ('reading','completed','paused','dropped')").bind(user.id, mediaId));
      statements.push(env.DB.prepare('INSERT INTO manga_library(user_id,media_id,kind,metadata,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM manga_library WHERE user_id=? AND media_id=? AND kind=?) OR (SELECT COUNT(*) FROM manga_library WHERE user_id=?)<500 ON CONFLICT(user_id,media_id,kind) DO UPDATE SET metadata=excluded.metadata,updated_at=excluded.updated_at RETURNING media_id').bind(user.id, mediaId, data.kind, JSON.stringify(item), now, user.id, mediaId, data.kind, user.id));
      const results = await env.DB.batch(statements), inserted = results.at(-1);
      if (!inserted.results?.length && !(inserted.meta?.changes ?? inserted.changes)) throw fail(413, 'Sua biblioteca atingiu 500 entradas. Remova uma antes de adicionar.');
      return reply({ ok: true });
    }
    const chapterId = validChapterId(data.chapterId);
    if (!Number.isInteger(data.page) || !Number.isInteger(data.totalPages) || data.totalPages < 1 || data.totalPages > 20000 || data.page < 0 || data.page > data.totalPages || typeof data.percent !== 'number' || !Number.isFinite(data.percent) || data.percent < 0 || data.percent > 100) throw fail(400, 'Progresso de leitura inválido.');
    if (mediaId.split(':')[0] !== chapterId.split(':')[0]) throw fail(400, 'O capítulo pertence a outro catálogo.');
    const item = await metadataFor(data, user, env, url.origin, validateMedia);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reading_progress WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM reading_progress WHERE user_id=? AND media_id=?) AND (SELECT COUNT(*) FROM reading_progress WHERE user_id=?)>=200 AND media_id=(SELECT media_id FROM reading_progress WHERE user_id=? ORDER BY updated_at ASC,media_id ASC LIMIT 1)').bind(user.id, user.id, mediaId, user.id, user.id),
      env.DB.prepare('INSERT INTO reading_progress(user_id,media_id,chapter_id,page,total_pages,percent,metadata,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET chapter_id=excluded.chapter_id,page=excluded.page,total_pages=excluded.total_pages,percent=excluded.percent,metadata=excluded.metadata,updated_at=excluded.updated_at').bind(user.id, mediaId, chapterId, data.page, data.totalPages, data.percent, JSON.stringify(item), now)
    ]);
    return reply({ ok: true });
  }
  if (path === '/api/comments') {
    if (request.method === 'GET') {
      const mediaId = validMediaId(url.searchParams.get('mediaId'));
      const offset = Math.max(0, Math.min(10000, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0)), limit = 20;
      const order = url.searchParams.get('sort') === 'popular' ? 'likes DESC,c.created_at DESC,c.id DESC' : 'c.created_at DESC,c.id DESC';
      const rows = await env.DB.prepare(`${commentSelect} WHERE c.media_id=? AND u.blocked=0 ORDER BY ${order} LIMIT ? OFFSET ?`).bind(user?.id || '', mediaId, limit + 1, offset).all();
      return reply({ ok: true, items: rows.results.slice(0, limit).map(row => commentItem(row, user)), hasMore: rows.results.length > limit, offset, nextOffset: rows.results.length > limit ? offset + limit : null });
    }
    if (request.method !== 'POST') throw fail(405, 'Método não permitido.');
    assertOrigin(request); if (!user) throw fail(401, 'Entre na sua conta para comentar.');
    const data = await readJSON(request, 12000), mediaId = validMediaId(data.mediaId), body = typeof data.body === 'string' ? data.body.trim() : '';
    if (body.length < 2 || body.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) throw fail(400, 'Escreva entre 2 e 2.000 caracteres.');
    if (data.spoiler !== undefined && typeof data.spoiler !== 'boolean') throw fail(400, 'Marcação de spoiler inválida.');
    const chapterId = data.chapterId ? validChapterId(data.chapterId) : null;
    if (chapterId && mediaId.split(':')[0] !== chapterId.split(':')[0]) throw fail(400, 'Capítulo inválido para esta obra.');
    await throttle(env, `comments:${user.id}`, 12); await checkedMedia(mediaId, env, validateMedia);
    const id = crypto.randomUUID(), now = new Date().toISOString(), fingerprint = await digest(body.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '));
    try { await env.DB.prepare('INSERT INTO manga_comments(id,user_id,media_id,chapter_id,body,spoiler,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, user.id, mediaId, chapterId, body, data.spoiler ? 1 : 0, fingerprint, now, now).run(); }
    catch (error) { if (/UNIQUE/i.test(error.message)) throw fail(409, 'Você já publicou esse comentário nesta obra.'); throw error; }
    const row = await env.DB.prepare(`${commentSelect} WHERE c.id=?`).bind(user.id, id).first();
    return reply({ ok: true, item: commentItem(row, user) }, 201);
  }
  const commentMatch = path.match(/^\/api\/comments\/([a-fA-F0-9-]{36})(?:\/(like|report))?$/);
  if (!commentMatch) throw fail(404, 'Rota não encontrada.');
  if (!user) throw fail(401, 'Entre na sua conta para continuar.');
  assertOrigin(request); const id = commentMatch[1], action = commentMatch[2];
  const row = await env.DB.prepare('SELECT user_id FROM manga_comments WHERE id=?').bind(id).first(); if (!row) throw fail(404, 'Comentário não encontrado.');
  if (!action && request.method === 'DELETE') {
    if (row.user_id !== user.id) throw fail(403, 'Você só pode excluir seus comentários.');
    await env.DB.batch([env.DB.prepare('DELETE FROM comment_likes WHERE comment_id=?').bind(id), env.DB.prepare('DELETE FROM comment_reports WHERE comment_id=?').bind(id), env.DB.prepare('DELETE FROM manga_comments WHERE id=? AND user_id=?').bind(id, user.id)]);
    return reply({ ok: true });
  }
  if (request.method !== 'POST' || !action) throw fail(405, 'Método não permitido.');
  await throttle(env, `comment-actions:${user.id}`, 100);
  if (action === 'report') { await env.DB.prepare('INSERT OR IGNORE INTO comment_reports(user_id,comment_id,created_at) VALUES(?,?,?)').bind(user.id, id, new Date().toISOString()).run(); return reply({ ok: true, reported: true }); }
  const data = await readJSON(request, 1024, true), requested = data.liked ?? data.enabled;
  if (requested !== undefined && typeof requested !== 'boolean') throw fail(400, 'Reação inválida.');
  const existing = await env.DB.prepare('SELECT 1 found FROM comment_likes WHERE user_id=? AND comment_id=?').bind(user.id, id).first(), liked = requested ?? !existing;
  if (liked) await env.DB.prepare('INSERT OR IGNORE INTO comment_likes(user_id,comment_id,created_at) VALUES(?,?,?)').bind(user.id, id, new Date().toISOString()).run();
  else await env.DB.prepare('DELETE FROM comment_likes WHERE user_id=? AND comment_id=?').bind(user.id, id).run();
  return reply({ ok: true, liked });
}
