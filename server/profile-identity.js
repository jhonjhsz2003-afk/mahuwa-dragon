const covers = new Set(['aurora', 'inferno', 'nebula', 'moon']);
const frames = new Set(['flame', 'crystal', 'halo', 'plain']);
const nameSegments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }) : null;

export function validateDisplayName(value) {
  const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (typeof value !== 'string') bad('Digite o nome que você quer usar no perfil.');
  if (value.length > 1024) bad('Seu nome pode ter até 80 caracteres visíveis.');
  const name = value.trim();
  if (!/[\p{L}\p{N}\p{P}\p{S}]/u.test(name)) bad('Digite pelo menos um caractere visível no seu nome.');
  if (/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(name)) bad('Use um nome em uma única linha, sem caracteres de controle.');
  let count = 0;
  for (const _ of nameSegments ? nameSegments.segment(name) : Array.from(name)) if (++count > 80) bad('Seu nome pode ter até 80 caracteres visíveis.');
  return name;
}

export const identityColumns = "COALESCE(pi.cover,'aurora') profile_cover,COALESCE(pi.frame,'flame') profile_frame,COALESCE(pi.title,'Explorador de histórias') profile_title";
export const identityJoin = 'LEFT JOIN profile_identity pi ON pi.user_id=users.id';
export const profileIdentity = user => ({ cover: covers.has(user.profile_cover) ? user.profile_cover : 'aurora', frame: frames.has(user.profile_frame) ? user.profile_frame : 'flame', title: String(user.profile_title || 'Explorador de histórias').slice(0, 40) });
export function validateIdentity(value, current) {
  if (value === undefined) return profileIdentity(current);
  const bad = () => { throw Object.assign(new Error('Escolha uma capa, uma moldura e um título de 2 a 40 caracteres.'), { status: 400 }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
  const prior = profileIdentity(current), cover = value.cover ?? prior.cover, frame = value.frame ?? prior.frame;
  const title = typeof (value.title ?? prior.title) === 'string' ? (value.title ?? prior.title).trim() : '';
  if (!covers.has(cover) || !frames.has(frame) || title.length < 2 || title.length > 40 || /[<>\u0000-\u001f]/u.test(title)) bad();
  return { cover, frame, title };
}
