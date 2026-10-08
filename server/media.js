import { database } from './database.js';
import { getUser, throttle, fail, reply, assertOrigin, readJSON } from './auth.js';
import { giphyAvatar, giphyMarker } from './giphy-avatar.js';
import { validateGiphyId } from './giphy.js';

export const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
export const AVATAR_CHUNK_BYTES = 1024 * 1024;
export const MAX_TOTAL_AVATAR_BYTES = 256 * 1024 * 1024;
export const AVATAR_RESERVE_SQL = 'INSERT INTO profile_media(user_id,mime,data,x,y,zoom,byte_length,chunk_count,version) SELECT ?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT SUM(length(data)) FROM profile_media_chunks WHERE user_id<>?),0)+COALESCE((SELECT SUM(length(data)) FROM profile_media WHERE user_id<>?),0)+?<=? ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,x=excluded.x,y=excluded.y,zoom=excluded.zoom,byte_length=excluded.byte_length,chunk_count=excluded.chunk_count,version=excluded.version RETURNING user_id';

export function avatarBytes(data) { return typeof data === 'string' ? Uint8Array.from(atob(data), character => character.charCodeAt(0)) : new Uint8Array(data); }
export function imageType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 24) return null;
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6)) && bytes.at(-1) === 0x3b) return 'image/gif';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 && ascii(12, 16) === 'IHDR') return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
export function imageDimensions(bytes, mime = imageType(bytes)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  if (mime === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === 'image/gif' && bytes.length >= 13) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (mime === 'image/webp') {
    if (bytes.length < 30 || view.getUint32(4, true) + 8 > bytes.length) return null;
    const type = ascii(12, 16);
    if (type === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (type === 'VP8L' && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
    return null;
  }
  if (mime === 'image/jpeg') {
    let offset = 2, segments = 0;
    while (offset + 4 < bytes.length && segments++ < 256) {
      if (bytes[offset++] !== 0xff) return null;
      let padding = 0; while (bytes[offset] === 0xff && padding++ < 4096) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 8 ? { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) } : null;
      offset += length;
    }
  }
  return null;
}

const extensionFor = mime => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[mime] || 'bin';
const bucketFor = env => env?.AVATARS?.put && env.AVATARS?.get && env.AVATARS?.delete ? env.AVATARS : null;
async function removeR2(env, row) { const bucket = bucketFor(env); if (bucket && row?.storage === 'r2' && row.object_key) try { await bucket.delete(row.object_key); } catch {} }
export async function deleteStoredAvatarObject(env, user) { if (user?.avatar_storage === 'r2' && user.avatar_object_key) await removeR2(env, { storage: 'r2', object_key: user.avatar_object_key }); }

function avatarHeaders(row, versioned) {
  const headers = {
    'Content-Type': row.mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'private, max-age=60',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'ETag': `"${row.version || 'avatar'}"`
  };
  if (row.byte_length) headers['Content-Length'] = String(row.byte_length);
  return headers;
}

async function readAvatar(request, env, id) {
  const row = await env.DB.prepare('SELECT mime,data,byte_length,chunk_count,version,storage,object_key FROM profile_media WHERE user_id=?').bind(id).first();
  if (!row) throw fail(404, 'Foto não encontrada.');
  const requestedVersion = new URL(request.url).searchParams.get('v');
  if (requestedVersion && row.version && requestedVersion !== row.version) throw fail(404, 'Esta versão da foto não está mais disponível.');
  const versioned = Boolean(requestedVersion && row.version && requestedVersion === row.version), headers = avatarHeaders(row, versioned);
  if (request.headers.get('If-None-Match') === headers.ETag) return new Response(null, { status: 304, headers });
  if (row.storage === 'r2') {
    const bucket = bucketFor(env); if (!bucket || !row.object_key) throw fail(503, 'A foto está armazenada no R2, mas o bucket não está conectado.');
    const object = await bucket.get(row.object_key); if (!object?.body) throw fail(404, 'Foto não encontrada no armazenamento.');
    return new Response(object.body, { headers });
  }
  if (!row.chunk_count) {
    const bytes = avatarBytes(row.data); headers['Content-Length'] = String(bytes.byteLength); return new Response(bytes, { headers });
  }
  if (row.chunk_count > 20 || row.byte_length > MAX_AVATAR_BYTES || row.byte_length < 1) throw fail(503, 'Foto indisponível.');
  let seq = 0, delivered = 0;
  const stream = new ReadableStream({ async pull(controller) {
    try {
      const chunk = await env.DB.prepare('SELECT c.data FROM profile_media_chunks c JOIN profile_media p ON p.user_id=c.user_id WHERE c.user_id=? AND c.seq=? AND p.version=?').bind(id, seq, row.version).first();
      if (!chunk) throw new Error('A foto mudou durante a leitura.');
      const bytes = avatarBytes(chunk.data); delivered += bytes.byteLength;
      if (delivered > row.byte_length) throw new Error('Foto incompleta.');
      controller.enqueue(bytes); seq++;
      if (seq === row.chunk_count) { if (delivered !== row.byte_length) throw new Error('Foto incompleta.'); controller.close(); }
    } catch (error) { controller.error(error); }
  } });
  return new Response(stream, { headers });
}

async function replaceWithR2(bytes, mime, frame, user, env, oldRow) {
  const bucket = bucketFor(env), version = crypto.randomUUID(), key = `avatars/${user.id}/${version}.${extensionFor(mime)}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { userId: String(user.id), version } });
  const avatar = `/api/avatar/${user.id}?v=${version}`;
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM profile_media_chunks WHERE user_id=?').bind(user.id),
      env.DB.prepare("INSERT INTO profile_media(user_id,mime,data,x,y,zoom,byte_length,chunk_count,version,storage,object_key) VALUES(?,?,?,?,?,?,?,?,?,'r2',?) ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,x=excluded.x,y=excluded.y,zoom=excluded.zoom,byte_length=excluded.byte_length,chunk_count=0,version=excluded.version,storage='r2',object_key=excluded.object_key").bind(user.id, mime, new Uint8Array(0), frame.x, frame.y, frame.zoom, bytes.byteLength, 0, version, key),
      env.DB.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=?').bind(avatar, new Date().toISOString(), user.id)
    ]);
  } catch (error) { try { await bucket.delete(key); } catch {} throw error; }
  await removeR2(env, oldRow);
  return { ok: true, avatar, avatarFrame: frame, bytes: bytes.byteLength, animated: mime === 'image/gif', storage: 'r2' };
}

async function replaceWithD1(bytes, mime, frame, user, env, oldRow) {
  const version = crypto.randomUUID(), avatar = `/api/avatar/${user.id}?v=${version}`, count = Math.ceil(bytes.byteLength / AVATAR_CHUNK_BYTES);
  const statements = [
    env.DB.prepare(AVATAR_RESERVE_SQL).bind(user.id, mime, new Uint8Array(0), frame.x, frame.y, frame.zoom, bytes.byteLength, count, version, user.id, user.id, bytes.byteLength, MAX_TOTAL_AVATAR_BYTES),
    env.DB.prepare('DELETE FROM profile_media_chunks WHERE user_id=? AND EXISTS(SELECT 1 FROM profile_media WHERE user_id=? AND version=?)').bind(user.id, user.id, version)
  ];
  for (let seq = 0; seq < count; seq++) {
    const part = bytes.buffer.slice(bytes.byteOffset + seq * AVATAR_CHUNK_BYTES, bytes.byteOffset + Math.min(bytes.byteLength, (seq + 1) * AVATAR_CHUNK_BYTES));
    statements.push(env.DB.prepare('INSERT INTO profile_media_chunks(user_id,seq,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM profile_media WHERE user_id=? AND version=?)').bind(user.id, seq, part, user.id, version));
  }
  statements.push(
    env.DB.prepare("UPDATE profile_media SET storage='d1',object_key='' WHERE user_id=? AND version=?").bind(user.id, version),
    env.DB.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM profile_media WHERE user_id=? AND version=?)').bind(avatar, new Date().toISOString(), user.id, user.id, version)
  );
  const result = await env.DB.batch(statements);
  if (!result[0].results?.length && !(result[0].meta?.changes ?? result[0].changes)) throw fail(507, 'O limite gratuito para fotos foi atingido. Conecte um bucket R2 ou use um GIF do GIPHY.');
  await removeR2(env, oldRow);
  return { ok: true, avatar, avatarFrame: frame, bytes: bytes.byteLength, animated: mime === 'image/gif', storage: 'd1' };
}

export async function media(request, env) {
  env = await database(env); const url = new URL(request.url), read = url.pathname.match(/^\/api\/avatar\/([a-zA-Z0-9-]{1,80})$/);
  if (read) {
    if (!['GET', 'HEAD'].includes(request.method)) throw fail(405, 'Método não permitido.');
    const response = await readAvatar(request, env, read[1]);
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
  if (!['/api/profile/avatar', '/api/profile/avatar/crop', '/api/profile/avatar/reset', '/api/profile/avatar/giphy'].includes(url.pathname)) throw fail(404, 'Rota não encontrada.');
  if (request.method !== 'POST') throw fail(405, 'Método não permitido.');
  assertOrigin(request); const user = await getUser(request, env); if (!user) throw fail(401, 'Entre para alterar sua foto.');
  await throttle(env, `avatar:${user.id}`, 30);
  const oldRow = await env.DB.prepare('SELECT storage,object_key FROM profile_media WHERE user_id=?').bind(user.id).first();
  if (url.pathname.endsWith('/reset')) {
    await env.DB.batch([env.DB.prepare('DELETE FROM profile_media_chunks WHERE user_id=?').bind(user.id), env.DB.prepare('DELETE FROM profile_media WHERE user_id=?').bind(user.id), env.DB.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=?').bind('/assets/avatar-default.svg', new Date().toISOString(), user.id)]);
    await removeR2(env, oldRow);
    return reply({ ok: true, avatar: '/assets/avatar-default.svg', avatarFrame: { x: 50, y: 50, zoom: 100 } });
  }
  let options = Object.fromEntries(url.searchParams);
  if (url.pathname.endsWith('/crop') && request.headers.get('Content-Type')?.includes('application/json')) options = { ...options, ...await readJSON(request, 1024) };
  const x = Number(options.x ?? 50), y = Number(options.y ?? 50), zoom = Number(options.zoom ?? 100), frame = { x, y, zoom };
  if (![x, y, zoom].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100 || zoom < 100 || zoom > 300) throw fail(400, 'Ajuste de imagem inválido.');
  if (url.pathname.endsWith('/giphy')) {
    if (!String(env.GIPHY_API_KEY || '').trim()) throw fail(503, 'A galeria de GIFs ainda não foi ativada.');
    const data = await readJSON(request, 512), avatar = giphyMarker(data.id, frame); if (!avatar) throw fail(400, 'GIF inválido.');
    if (!await validateGiphyId(data.id, env)) throw fail(400, 'Este GIF não foi confirmado pelo GIPHY. Escolha outro.');
    await env.DB.batch([env.DB.prepare('DELETE FROM profile_media_chunks WHERE user_id=?').bind(user.id), env.DB.prepare('DELETE FROM profile_media WHERE user_id=?').bind(user.id), env.DB.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=?').bind(avatar, new Date().toISOString(), user.id)]);
    await removeR2(env, oldRow);
    return reply({ ok: true, avatar, avatarFrame: frame, provider: 'giphy' });
  }
  if (url.pathname.endsWith('/crop')) {
    const selected = giphyAvatar(user.avatar_url);
    if (selected) {
      const avatar = giphyMarker(selected.id, frame); await env.DB.prepare('UPDATE users SET avatar_url=?,updated_at=? WHERE id=?').bind(avatar, new Date().toISOString(), user.id).run();
      return reply({ ok: true, avatar, avatarFrame: frame });
    }
    const row = await env.DB.prepare('SELECT user_id FROM profile_media WHERE user_id=?').bind(user.id).first(); if (!row) throw fail(404, 'Envie uma foto antes de ajustar.');
    await env.DB.prepare('UPDATE profile_media SET x=?,y=?,zoom=? WHERE user_id=?').bind(x, y, zoom, user.id).run();
    return reply({ ok: true, avatar: user.avatar_url, avatarFrame: frame });
  }
  if (Number(request.headers.get('Content-Length')) > MAX_AVATAR_BYTES) throw fail(413, 'Escolha uma imagem ou GIF de até 20 MiB.');
  const reader = request.body?.getReader(); if (!reader) throw fail(400, 'Escolha uma imagem.');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_AVATAR_BYTES) { await reader.cancel(); throw fail(413, 'Escolha uma imagem ou GIF de até 20 MiB.'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const mime = imageType(bytes); if (!mime) throw fail(415, 'Envie uma imagem JPG, PNG, WebP ou GIF válida.');
  const dimensions = imageDimensions(bytes, mime);
  if (!dimensions || !dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 67108864) throw fail(415, 'A imagem precisa ter dimensões válidas de até 8.192 × 8.192 pixels.');
  const result = bucketFor(env) ? await replaceWithR2(bytes, mime, frame, user, env, oldRow) : await replaceWithD1(bytes, mime, frame, user, env, oldRow);
  return reply(result);
}
