// Only the provider ID and framing are persisted. GIPHY media URLs stay ephemeral
// and are resolved in the browser through the official Web API.
const marker = /^giphy:([a-zA-Z0-9]{1,80})(?:\?x=(\d+(?:\.\d+)?)&y=(\d+(?:\.\d+)?)&zoom=(\d+(?:\.\d+)?))?$/;
export function giphyAvatar(value) {
  const match = marker.exec(value || ''); if (!match) return null;
  const frame = { x: Number(match[2] ?? 50), y: Number(match[3] ?? 50), zoom: Number(match[4] ?? 100) };
  if (![frame.x, frame.y, frame.zoom].every(Number.isFinite) || frame.x < 0 || frame.x > 100 || frame.y < 0 || frame.y > 100 || frame.zoom < 100 || frame.zoom > 300) return null;
  return { id: match[1], frame };
}
export function giphyMarker(id, frame = { x: 50, y: 50, zoom: 100 }) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9]{1,80}$/.test(id)) return null;
  const value = `giphy:${id}?x=${frame.x}&y=${frame.y}&zoom=${frame.zoom}`;
  return giphyAvatar(value) ? value : null;
}
export function storedAvatarFrame(user) { return giphyAvatar(user.avatar_url)?.frame || { x: user.avatar_x ?? 50, y: user.avatar_y ?? 50, zoom: user.avatar_zoom ?? 100 }; }
export function giphyConfig(env) {
  const key = String(env.GIPHY_API_KEY || '').trim();
  return { ok: true, configured: Boolean(key), proxy: true, rating: 'pg-13', language: 'pt' };
}
