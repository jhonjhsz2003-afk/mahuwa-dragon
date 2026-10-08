import { DatabaseSync } from 'node:sqlite';
import { reply } from '../server/auth.js';
export function createDB() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  const db = { sqlite, before: null, prepare(sql) {
    const build = args => ({ sql, args, bind(...values) { return build(values.map(value => (value instanceof ArrayBuffer || Object.prototype.toString.call(value)==='[object ArrayBuffer]') ? (value.byteLength ? new Uint8Array(value) : new Uint8Array(0)) : value)); }, async first() { db.before?.(sql); return sqlite.prepare(sql).get(...args) || null; }, async all() { db.before?.(sql); return { results: sqlite.prepare(sql).all(...args), success: true }; }, async run() { db.before?.(sql); const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; } });
    return build([]);
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(item => { db.before?.(item.sql); const statement = sqlite.prepare(item.sql); const rows = statement.all(...item.args); return { results: rows, success: true, meta: { changes: Number(sqlite.prepare('SELECT changes() changes').get().changes) } }; }); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}
export function request(path, { method = 'GET', data, cookie, origin = 'https://mahuwa.test', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.Cookie = cookie;
  if (method !== 'GET') init.headers.Origin = origin;
  if (data !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data); }
  else if (body !== undefined) init.body = body;
  return new Request('https://mahuwa.test' + path, init);
}
export async function call(handler, req, env, validate) { try { return await handler(req, env, validate); } catch (error) { return reply({ ok: false, error: error.message }, error.status || 500); } }
export const cookieOf = response => response.headers.get('Set-Cookie')?.split(';')[0];
export async function register(auth, env, name, email) {
  const response = await call(auth, request('/api/auth/register', { method: 'POST', data: { name, email, password: 'A-real-password-123!' } }), env);
  if (response.status !== 200) throw new Error(`Registration failed: ${await response.text()}`);
  return { cookie: cookieOf(response), user: (await response.json()).user };
}
