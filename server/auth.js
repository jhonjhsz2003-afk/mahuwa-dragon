import { database } from './database.js';
import { identityColumns, identityJoin, profileIdentity, validateIdentity, validateDisplayName } from './profile-identity.js';
import { giphyAvatar, storedAvatarFrame } from './giphy-avatar.js';

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const random = length => hex(crypto.getRandomValues(new Uint8Array(length)));
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
export const validAvatar = value => giphyAvatar(value) || /^\/api\/avatar\/[a-zA-Z0-9-]{1,80}\?v=[a-zA-Z0-9-]+$/.test(value || '') ? value : '/assets/avatar-default.svg';
export function publicUser(user, includeEmail = true) {
  const value = { id: String(user.id), name: user.username, bio: user.bio || '', avatar: validAvatar(user.avatar_url), visibility: user.visibility || 'private', nameColor: user.name_color || 'ice', identity: profileIdentity(user), avatarFrame: storedAvatarFrame(user) };
  if (includeEmail) value.email = user.email;
  return value;
}
export async function hmac(text, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
export async function passwordHash(password, salt, secret) {
  const peppered = await hmac(password, secret);
  const key = await crypto.subtle.importKey('raw', encoder.encode(peppered), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-512' }, key, 256);
  return 'v1$' + hex(bits);
}
export function equal(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index); return difference === 0; }
export async function throttle(env, key, limit) {
  env = await database(env);
  const bucket = Math.floor(Date.now() / 900000), id = await hmac(`${key}:${bucket}`, env.AUTH_SECRET);
  const result = await env.DB.prepare('INSERT INTO auth_limits(id,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(id, Date.now() + 1800000).first();
  if (result.attempts > limit) throw fail(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
}
export function assertOrigin(request) { if (request.headers.get('Origin') !== new URL(request.url).origin) throw fail(403, 'Origem da solicitação inválida.'); }
export async function readJSON(request, maximum = 4096, optional = false) {
  if (optional && !request.body) return {};
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) throw fail(415, 'Envie dados JSON.');
  if (Number(request.headers.get('Content-Length')) > maximum) throw fail(413, 'Solicitação muito grande.');
  const reader = request.body?.getReader(); if (!reader) { if (optional) return {}; throw fail(400, 'Dados ausentes.'); }
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); throw fail(413, 'Solicitação muito grande.'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail(400, 'Dados JSON inválidos.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Dados inválidos.');
  return data;
}
const tokenFrom = request => request.headers.get('Cookie')?.match(/(?:^|;\s*)md_session=([a-f0-9]{64})(?:;|$)/)?.[1];
export const SESSION_MAX_AGE = 30 * 86400;
const SESSION_RENEW_WINDOW = 7 * 86400;
const userColumns = `users.*,COALESCE(profile_privacy.visibility,'private') visibility,COALESCE(user_appearance.name_color,'ice') name_color,${identityColumns},pm.x avatar_x,pm.y avatar_y,pm.zoom avatar_zoom,pm.storage avatar_storage,pm.object_key avatar_object_key`;
const userJoins = `LEFT JOIN profile_privacy ON profile_privacy.user_id=users.id LEFT JOIN user_appearance ON user_appearance.user_id=users.id ${identityJoin} LEFT JOIN profile_media pm ON pm.user_id=users.id`;
export async function getUser(request, env) {
  const token = tokenFrom(request); if (!token) return null;
  env = await database(env?.prepare ? { DB: env } : env);
  const user = await env.DB.prepare(`SELECT ${userColumns},sessions.expires_at session_expires_at FROM sessions JOIN users ON users.id=sessions.user_id ${userJoins} WHERE sessions.token_hash=? AND sessions.expires_at>?`).bind(await digest(token), new Date().toISOString()).first();
  return user && !user.blocked ? { ...user, id: String(user.id) } : null;
}
const cookie = (request, token, age) => `md_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}; Expires=${new Date(age ? Date.now() + age * 1000 : 0).toUTCString()}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
async function restoreSession(request, env) {
  const user = await getUser(request, env); if (!user) return reply({ ok: true, user: null, session: null }, 200, { Vary: 'Cookie' });
  const now = new Date(), renewBefore = new Date(now.getTime() + SESSION_RENEW_WINDOW * 1000);
  let expiresAt = user.session_expires_at; const headers = { Vary: 'Cookie' };
  if (new Date(expiresAt).getTime() <= renewBefore.getTime()) {
    const token = tokenFrom(request), nextExpiry = new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString();
    const renewed = await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at>? AND expires_at<=? RETURNING expires_at').bind(nextExpiry, await digest(token), now.toISOString(), renewBefore.toISOString()).first();
    if (renewed) { expiresAt = renewed.expires_at; headers['Set-Cookie'] = cookie(request, token, SESSION_MAX_AGE); }
  }
  return reply({ ok: true, user: publicUser(user), session: { expiresAt } }, 200, headers);
}
async function createSession(request, env, user) {
  const token = random(32), now = new Date(), expiresAt = new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString();
  const statements = [env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await digest(token), user.id, expiresAt, now.toISOString())];
  const old = tokenFrom(request); if (old) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(old)));
  await env.DB.batch(statements);
  return reply({ ok: true, user: publicUser(user), session: { expiresAt } }, 200, { 'Set-Cookie': cookie(request, token, SESSION_MAX_AGE), Vary: 'Cookie' });
}
export async function auth(request, env) {
  env = await database(env); const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/api/auth/me') return restoreSession(request, env);
  if (request.method !== 'POST') throw fail(405, 'Método não permitido.');
  assertOrigin(request); const data = await readJSON(request);
  if (path === '/api/auth/logout') {
    const token = tokenFrom(request); if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
    return reply({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (['/api/auth/profile', '/api/auth/privacy', '/api/auth/delete'].includes(path)) {
    const user = await getUser(request, env); if (!user) throw fail(401, 'Entre na sua conta para continuar.');
    await throttle(env, `profile:${user.id}`, 60);
    if (path.endsWith('/privacy')) {
      if (!['private', 'public'].includes(data.visibility)) throw fail(400, 'Escolha público ou privado.');
      await env.DB.prepare('INSERT INTO profile_privacy(user_id,visibility) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET visibility=excluded.visibility').bind(user.id, data.visibility).run();
      return reply({ ok: true, user: publicUser({ ...user, visibility: data.visibility }) });
    }
    if (path.endsWith('/delete')) {
      if (typeof data.password !== 'string' || data.password.length > 128 || !equal(await passwordHash(data.password, user.password_salt, env.AUTH_SECRET), user.password_hash)) throw fail(401, 'Confirme a senha da sua conta para excluir.');
      await env.DB.batch(['sessions', 'profile_media_chunks', 'profile_media', 'profile_identity', 'profile_privacy', 'user_appearance', 'manga_library', 'reading_progress', 'user_settings', 'comment_likes', 'comment_reports'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.id)).concat([
        env.DB.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM manga_comments WHERE user_id=?)').bind(user.id),
        env.DB.prepare('DELETE FROM comment_reports WHERE comment_id IN (SELECT id FROM manga_comments WHERE user_id=?)').bind(user.id),
        env.DB.prepare('DELETE FROM manga_comments WHERE user_id=?').bind(user.id),
        env.DB.prepare('DELETE FROM translation_usage WHERE user_id=?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id)
      ]));
      if (user.avatar_storage === 'r2' && user.avatar_object_key && env.AVATARS?.delete) try { await env.AVATARS.delete(user.avatar_object_key); } catch {}
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    }
    const name = data.name === undefined ? user.username : validateDisplayName(data.name);
    const bio = typeof data.bio === 'string' ? data.bio.trim() : user.bio;
    if (bio.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(bio)) throw fail(400, 'Use uma bio de até 300 caracteres.');
    const nameColor = data.nameColor ?? user.name_color ?? 'ice', identity = validateIdentity(data.identity, user);
    if (!['ice', 'blue', 'cyan', 'green', 'gold', 'orange', 'pink', 'violet'].includes(nameColor)) throw fail(400, 'Escolha uma das cores disponíveis.');
    let avatar = validAvatar(user.avatar_url);
    if (data.avatar !== undefined) {
      if (data.avatar !== '/assets/avatar-default.svg' && data.avatar !== user.avatar_url) throw fail(400, 'Use o GIPHY ou envie sua própria imagem para alterar o avatar.');
      avatar = validAvatar(data.avatar);
    }
    const statements = [env.DB.prepare('UPDATE users SET username=?,bio=?,avatar_url=?,updated_at=? WHERE id=?').bind(name, bio, avatar, new Date().toISOString(), user.id),
      env.DB.prepare('INSERT INTO user_appearance(user_id,name_color) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET name_color=excluded.name_color').bind(user.id, nameColor),
      env.DB.prepare('INSERT INTO profile_identity(user_id,cover,frame,title) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET cover=excluded.cover,frame=excluded.frame,title=excluded.title').bind(user.id, identity.cover, identity.frame, identity.title)];
    if (avatar === '/assets/avatar-default.svg') statements.push(env.DB.prepare('DELETE FROM profile_media_chunks WHERE user_id=?').bind(user.id), env.DB.prepare('DELETE FROM profile_media WHERE user_id=?').bind(user.id));
    try { await env.DB.batch(statements); } catch (error) { if (/UNIQUE/i.test(error.message)) throw fail(409, 'Esse nome já está em uso.'); throw error; }
    if (avatar === '/assets/avatar-default.svg' && user.avatar_storage === 'r2' && user.avatar_object_key && env.AVATARS?.delete) try { await env.AVATARS.delete(user.avatar_object_key); } catch {}
    return reply({ ok: true, user: publicUser({ ...user, username: name, bio, avatar_url: avatar, name_color: nameColor, profile_cover: identity.cover, profile_frame: identity.frame, profile_title: identity.title, ...(avatar === '/assets/avatar-default.svg' ? { avatar_x: 50, avatar_y: 50, avatar_zoom: 100, avatar_storage: null, avatar_object_key: null } : {}) }) });
  }
  if (!['/api/auth/register', '/api/auth/login'].includes(path)) throw fail(404, 'Rota não encontrada.');
  await throttle(env, `ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 20);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '', password = typeof data.password === 'string' ? data.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length > 128 || !password) throw fail(400, 'Confira seu e-mail e sua senha.');
  await throttle(env, `email:${email}`, 10);
  if (path.endsWith('/login')) {
    const user = await env.DB.prepare(`SELECT ${userColumns} FROM users ${userJoins} WHERE email=?`).bind(email).first();
    const hash = await passwordHash(password, user?.password_salt || 'unknown-account-salt', env.AUTH_SECRET);
    if (!user || !equal(hash, user.password_hash)) throw fail(401, 'E-mail ou senha incorretos.');
    if (user.blocked) throw fail(403, 'Esta conta está bloqueada.');
    return createSession(request, env, user);
  }
  const name = validateDisplayName(data.name);
  if (password.length < 12) throw fail(400, 'Sua senha precisa ter pelo menos 12 caracteres.');
  const salt = random(16), now = new Date().toISOString();
  const user = { id: crypto.randomUUID(), username: name, email, avatar_url: validAvatar(data.avatar), bio: '' };
  // A registration cannot claim another person's uploaded image.
  if (user.avatar_url.startsWith('/api/') || giphyAvatar(user.avatar_url)) user.avatar_url = '/assets/avatar-default.svg';
  const hash = await passwordHash(password, salt, env.AUTH_SECRET);
  try { await env.DB.prepare('INSERT INTO users(id,username,email,password_hash,password_salt,avatar_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(user.id, name, email, hash, salt, user.avatar_url, now, now).run(); }
  catch (error) { if (/UNIQUE/i.test(error.message)) throw fail(409, 'Nome ou e-mail já cadastrado.'); throw error; }
  return createSession(request, env, user);
}
export async function cleanupSessions(env) {
  env = await database(env);
  return env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(new Date().toISOString()), env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(Date.now()), env.DB.prepare('DELETE FROM translation_usage WHERE day<?').bind(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))]);
}
