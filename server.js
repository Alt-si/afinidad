require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { q, migrate } = require('./src/db');
const { QUESTIONS, GENEROS, UMBRAL } = require('./src/questions');
const { edad, compatibles, puntaje, detalle } = require('./src/match');
const notify = require('./src/notify');

const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('Falta JWT_SECRET (mínimo 32 caracteres).');
  process.exit(1);
}
if (PROD && (!notify.emailEnabled || !notify.smsViaTwilio)) {
  console.warn('ATENCIÓN: en producción faltan claves de Brevo o Twilio. Los códigos solo se van a ver en el log.');
}

const app = express();
app.set('trust proxy', 1); // Render está detrás de un proxy

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// Protección CSRF simple: los cambios solo se aceptan como JSON y desde el mismo origen
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Formato no permitido.' });
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origen no permitido.' });
  next();
});

/* ---------- utilidades ---------- */

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+[1-9]\d{7,14}$/; // formato internacional, ej. +5492215551234
const normPhone = t => String(t || '').replace(/[\s()-]/g, '');

function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, SECRET, { expiresIn: '30d' });
  res.cookie('sid', token, { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: 30 * 864e5 });
}

const hashCode = code => crypto.createHmac('sha256', SECRET).update(code).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');

async function loadUser(id) {
  const { rows } = await q('SELECT id,email,telefono,email_verified,phone_verified FROM users WHERE id=$1', [id]);
  return rows[0];
}
async function loadProfile(id) {
  const { rows } = await q('SELECT * FROM profiles WHERE user_id=$1', [id]);
  return rows[0];
}

// Perfil tal como lo ve otra persona: sin email ni teléfono
function publicProfile(p) {
  return { id: p.user_id, nombre: p.nombre, edad: edad(p.nac), ciudad: p.ciudad, genero: p.genero, bio: p.bio, ans: p.ans };
}

/* ---------- middlewares de sesión ---------- */

const auth = wrap(async (req, res, next) => {
  try {
    const { uid } = jwt.verify(req.cookies.sid || '', SECRET);
    const user = await loadUser(uid);
    if (!user) throw new Error();
    req.user = user;
    next();
  } catch {
    fail(res, 401, 'Tenés que iniciar sesión.');
  }
});
const verified = (req, res, next) =>
  req.user.email_verified && req.user.phone_verified ? next() : fail(res, 403, 'Primero verificá tu correo y tu celular.');
const withProfile = wrap(async (req, res, next) => {
  req.profile = await loadProfile(req.user.id);
  if (!req.profile) return fail(res, 403, 'Primero completá tu perfil.');
  next();
});
const member = [auth, verified, withProfile];

/* ---------- límites de uso ---------- */

const authLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, message: { error: 'Demasiados intentos. Esperá unos minutos.' } });
const codeLimiter = rateLimit({ windowMs: 60 * 60e3, limit: 8, message: { error: 'Pediste demasiados códigos. Probá de nuevo en una hora.' } });

/* ---------- configuración pública ---------- */

app.get('/api/config', (req, res) => {
  res.json({ questions: QUESTIONS, generos: GENEROS, umbral: UMBRAL, devCodes: !notify.emailEnabled || !notify.smsViaTwilio });
});

/* ---------- cuenta y verificación ---------- */

async function issueOwnCode(userId, tipo, destino) {
  const { rows } = await q(
    `SELECT created_at FROM verif_codes WHERE user_id=$1 AND tipo=$2 ORDER BY id DESC LIMIT 1`, [userId, tipo]);
  if (rows[0] && Date.now() - new Date(rows[0].created_at).getTime() < 60e3) {
    const e = new Error('Esperá un minuto antes de pedir otro código.'); e.status = 429; throw e;
  }
  const code = newCode();
  await q(`UPDATE verif_codes SET used=TRUE WHERE user_id=$1 AND tipo=$2 AND NOT used`, [userId, tipo]);
  await q(`INSERT INTO verif_codes (user_id,tipo,destino,code_hash,expires_at) VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`,
    [userId, tipo, destino, hashCode(code)]);
  return code;
}

async function checkOwnCode(userId, tipo, destino, code) {
  const { rows } = await q(
    `SELECT * FROM verif_codes WHERE user_id=$1 AND tipo=$2 AND destino=$3 AND NOT used ORDER BY id DESC LIMIT 1`,
    [userId, tipo, destino]);
  const c = rows[0];
  if (!c || new Date(c.expires_at) < new Date()) return 'El código venció. Pedí uno nuevo.';
  if (c.attempts >= 5) return 'Superaste los intentos para este código. Pedí uno nuevo.';
  const ok = crypto.timingSafeEqual(Buffer.from(c.code_hash), Buffer.from(hashCode(String(code))));
  if (!ok) {
    await q('UPDATE verif_codes SET attempts=attempts+1 WHERE id=$1', [c.id]);
    return 'El código no es correcto.';
  }
  await q('UPDATE verif_codes SET used=TRUE WHERE id=$1', [c.id]);
  return null;
}

app.post('/api/auth/signup', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const telefono = normPhone(req.body.telefono);
  const errors = {};
  if (!EMAIL_RE.test(email)) errors.email = 'Revisá el correo: debe tener el formato nombre@dominio.com.';
  if (password.length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
  if (!PHONE_RE.test(telefono)) errors.telefono = 'Escribí el celular con código de país, por ejemplo +54 9 221 555 1234.';
  if (Object.keys(errors).length) return fail(res, 400, 'Revisá los datos.', { errors });

  const existing = (await q('SELECT id,email_verified FROM users WHERE email=$1', [email])).rows[0];
  if (existing && existing.email_verified) return fail(res, 409, 'Ya hay una cuenta con ese correo. Iniciá sesión.', { errors: { email: 'Ya hay una cuenta con ese correo.' } });
  if (existing) await q('DELETE FROM users WHERE id=$1', [existing.id]); // registro anterior sin terminar

  const taken = (await q('SELECT 1 FROM users WHERE telefono=$1 AND phone_verified', [telefono])).rows[0];
  if (taken) return fail(res, 409, 'Ese celular ya está en uso.', { errors: { telefono: 'Ese celular ya está verificado en otra cuenta.' } });

  const hash = await bcrypt.hash(password, 11);
  const { rows } = await q('INSERT INTO users (email,password_hash,telefono) VALUES ($1,$2,$3) RETURNING id', [email, hash, telefono]);
  const code = await issueOwnCode(rows[0].id, 'email', email);
  await notify.sendEmailCode(email, code);
  setSession(res, rows[0].id);
  res.json({ ok: true });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await q('SELECT id,password_hash FROM users WHERE email=$1', [email]);
  const ok = rows[0] && await bcrypt.compare(String(req.body.password || ''), rows[0].password_hash);
  if (!ok) return fail(res, 401, 'El correo o la contraseña no son correctos.');
  setSession(res, rows[0].id);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sid', { httpOnly: true, secure: PROD, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/auth/email/resend', codeLimiter, auth, wrap(async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true });
  const code = await issueOwnCode(req.user.id, 'email', req.user.email);
  await notify.sendEmailCode(req.user.email, code);
  res.json({ ok: true });
}));

app.post('/api/auth/email/verify', authLimiter, auth, wrap(async (req, res) => {
  const err = await checkOwnCode(req.user.id, 'email', req.user.email, String(req.body.code || '').trim());
  if (err) return fail(res, 400, err);
  await q('UPDATE users SET email_verified=TRUE WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// Cambiar el celular antes de verificarlo
app.post('/api/auth/phone', auth, wrap(async (req, res) => {
  if (req.user.phone_verified) return fail(res, 400, 'Tu celular ya está verificado.');
  const telefono = normPhone(req.body.telefono);
  if (!PHONE_RE.test(telefono)) return fail(res, 400, 'Escribí el celular con código de país, por ejemplo +54 9 221 555 1234.');
  await q('UPDATE users SET telefono=$1 WHERE id=$2', [telefono, req.user.id]);
  res.json({ ok: true });
}));

app.post('/api/auth/sms/send', codeLimiter, auth, wrap(async (req, res) => {
  if (!req.user.email_verified) return fail(res, 403, 'Primero verificá tu correo.');
  if (req.user.phone_verified) return res.json({ ok: true });
  const tel = req.user.telefono;
  const taken = (await q('SELECT 1 FROM users WHERE telefono=$1 AND phone_verified AND id<>$2', [tel, req.user.id])).rows[0];
  if (taken) return fail(res, 409, 'Ese celular ya está verificado en otra cuenta.');
  if (notify.smsViaTwilio) await notify.twilioStart(tel);
  else notify.logSmsCode(tel, await issueOwnCode(req.user.id, 'sms', tel));
  res.json({ ok: true });
}));

app.post('/api/auth/sms/verify', authLimiter, auth, wrap(async (req, res) => {
  const tel = req.user.telefono, code = String(req.body.code || '').trim();
  if (!/^\d{4,8}$/.test(code)) return fail(res, 400, 'El código tiene que ser numérico.');
  if (notify.smsViaTwilio) {
    if (!(await notify.twilioCheck(tel, code))) return fail(res, 400, 'El código no es correcto o venció.');
  } else {
    const err = await checkOwnCode(req.user.id, 'sms', tel, code);
    if (err) return fail(res, 400, err);
  }
  try {
    await q('UPDATE users SET phone_verified=TRUE WHERE id=$1', [req.user.id]);
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Ese celular ya está verificado en otra cuenta.');
    throw e;
  }
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const p = await loadProfile(req.user.id);
  const t = req.user.telefono || '';
  res.json({
    email: req.user.email,
    telefono: t ? t.slice(0, -4).replace(/\d/g, '•') + t.slice(-4) : '',
    email_verified: req.user.email_verified,
    phone_verified: req.user.phone_verified,
    profile: p ? { nombre: p.nombre, nac: p.nac.toISOString().slice(0, 10), ciudad: p.ciudad, genero: p.genero, interes: p.interes,
      edadMin: p.edad_min, edadMax: p.edad_max, bio: p.bio, ans: p.ans, acc: p.acc } : null,
  });
}));

app.delete('/api/me', auth, wrap(async (req, res) => {
  await q('DELETE FROM users WHERE id=$1', [req.user.id]); // borra todo en cascada
  res.clearCookie('sid');
  res.json({ ok: true });
}));

/* ---------- perfil ---------- */

function validateProfile(b) {
  const E = {};
  const s = v => String(v ?? '').trim();
  const d = {
    nombre: s(b.nombre), nac: s(b.nac), ciudad: s(b.ciudad), genero: s(b.genero),
    interes: Array.isArray(b.interes) ? b.interes.map(String) : [],
    edadMin: Number(b.edadMin), edadMax: Number(b.edadMax), bio: s(b.bio).slice(0, 300), ans: {}, acc: {},
  };
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,40}$/.test(d.nombre)) E.nombre = 'Escribí tu nombre (solo letras, 2 a 40 caracteres).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.nac) || isNaN(new Date(d.nac))) E.nac = 'Indicá tu fecha de nacimiento.';
  else { const e = edad(d.nac); if (e < 18) E.nac = 'Tenés que ser mayor de 18 años para usar la app.'; else if (e > 99) E.nac = 'Revisá la fecha de nacimiento.'; }
  if (d.ciudad.length < 2 || d.ciudad.length > 60) E.ciudad = 'Indicá tu ciudad.';
  if (!GENEROS.includes(d.genero)) E.genero = 'Elegí una opción.';
  d.interes = [...new Set(d.interes.filter(g => GENEROS.includes(g)))];
  if (!d.interes.length) E.interes = 'Elegí al menos una opción.';
  if (!(Number.isInteger(d.edadMin) && Number.isInteger(d.edadMax) && d.edadMin >= 18 && d.edadMax <= 99 && d.edadMin <= d.edadMax))
    E.edad = 'El rango debe ir de 18 a 99 y la mínima no puede superar a la máxima.';
  for (const qq of QUESTIONS) {
    const a = s(b.ans?.[qq.id]);
    const acc = Array.isArray(b.acc?.[qq.id]) ? [...new Set(b.acc[qq.id].map(String).filter(v => qq.o.includes(v)))] : [];
    if (!qq.o.includes(a)) E['q-' + qq.id] = 'Marcá tu respuesta.';
    else if (!acc.length) E['q-' + qq.id] = 'Marcá al menos una opción que aceptes.';
    d.ans[qq.id] = a; d.acc[qq.id] = acc;
  }
  return { d, E };
}

app.put('/api/profile', auth, verified, wrap(async (req, res) => {
  const { d, E } = validateProfile(req.body);
  if (Object.keys(E).length) return fail(res, 400, 'Revisá los datos.', { errors: E });
  await q(`INSERT INTO profiles (user_id,nombre,nac,ciudad,genero,interes,edad_min,edad_max,bio,ans,acc,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
           ON CONFLICT (user_id) DO UPDATE SET nombre=$2,nac=$3,ciudad=$4,genero=$5,interes=$6,edad_min=$7,edad_max=$8,bio=$9,ans=$10,acc=$11,updated_at=now()`,
    [req.user.id, d.nombre, d.nac, d.ciudad, d.genero, d.interes, d.edadMin, d.edadMax, d.bio, d.ans, d.acc]);
  res.json({ ok: true });
}));

/* ---------- coincidencias ---------- */

// Candidatos que pasan los filtros de base de datos (verificados, orientación, sin bloqueos)
async function candidates(me) {
  const { rows } = await q(
    `SELECT p.* FROM profiles p JOIN users u ON u.id=p.user_id
     WHERE u.email_verified AND u.phone_verified AND p.user_id<>$1
       AND p.genero = ANY($2) AND $3 = ANY(p.interes)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=$1))`,
    [me.user_id, me.interes, me.genero]);
  return rows.filter(o => compatibles(me, o));
}

app.get('/api/matches', member, wrap(async (req, res) => {
  const me = req.profile;
  const cands = await candidates(me);
  const inv = (await q('SELECT * FROM invites WHERE from_id=$1 OR to_id=$1', [me.user_id])).rows;
  const invBy = new Map(inv.map(i => [i.from_id === me.user_id ? i.to_id : i.from_id, i]));
  const scored = cands.map(o => ({ o, p: puntaje(me, o) }));
  const visibles = scored
    .filter(x => x.p >= UMBRAL && invBy.get(x.o.user_id)?.estado !== 'rechazada')
    .sort((a, b) => b.p - a.p)
    .map(({ o, p }) => {
      const i = invBy.get(o.user_id);
      let estado = 'nueva';
      if (i?.estado === 'pendiente') estado = i.from_id === me.user_id ? 'enviada' : 'recibida';
      if (i?.estado === 'aceptada') estado = 'chat';
      return { ...publicProfile(o), puntaje: p, detalle: detalle(me, o), estado, inviteId: i?.id ?? null };
    });
  res.json({ matches: visibles, debajo: scored.filter(x => x.p < UMBRAL).length });
}));

/* ---------- invitaciones ---------- */

app.get('/api/invites', member, wrap(async (req, res) => {
  const me = req.profile;
  const { rows } = await q(
    `SELECT i.*, p.* , i.id AS invite_id FROM invites i JOIN profiles p ON p.user_id = CASE WHEN i.from_id=$1 THEN i.to_id ELSE i.from_id END
     WHERE (i.from_id=$1 OR i.to_id=$1) AND i.estado='pendiente'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=$1))
     ORDER BY i.created_at DESC`, [me.user_id]);
  const out = r => ({ id: r.invite_id, msg: r.msg, fecha: r.created_at, persona: { ...publicProfile(r), puntaje: puntaje(me, r), detalle: detalle(me, r) } });
  res.json({
    recibidas: rows.filter(r => r.to_id === me.user_id).map(out),
    enviadas: rows.filter(r => r.from_id === me.user_id).map(out),
  });
}));

app.post('/api/invites', member, wrap(async (req, res) => {
  const me = req.profile;
  const toId = Number(req.body.to);
  const msg = String(req.body.msg || '').trim().slice(0, 200);
  const today = (await q(`SELECT count(*)::int n FROM invites WHERE from_id=$1 AND created_at > now() - interval '1 day'`, [me.user_id])).rows[0].n;
  if (today >= 30) return fail(res, 429, 'Llegaste al máximo de 30 invitaciones por día.');
  const other = (await candidates(me)).find(o => o.user_id === toId);
  if (!other || puntaje(me, other) < UMBRAL) return fail(res, 400, 'No podés invitar a esta persona.');
  try {
    const { rows } = await q('INSERT INTO invites (from_id,to_id,msg) VALUES ($1,$2,$3) RETURNING id', [me.user_id, toId, msg]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Ya hay una invitación entre ustedes.');
    throw e;
  }
}));

app.post('/api/invites/:id/:accion(aceptar|rechazar)', member, wrap(async (req, res) => {
  const estado = req.params.accion === 'aceptar' ? 'aceptada' : 'rechazada';
  const { rowCount } = await q(
    `UPDATE invites SET estado=$1, answered_at=now() WHERE id=$2 AND to_id=$3 AND estado='pendiente'`,
    [estado, Number(req.params.id), req.user.id]);
  if (!rowCount) return fail(res, 404, 'La invitación ya no está disponible.');
  res.json({ ok: true });
}));

/* ---------- chats ---------- */

async function chatFor(userId, inviteId) {
  const { rows } = await q(
    `SELECT i.* FROM invites i WHERE i.id=$1 AND i.estado='aceptada' AND (i.from_id=$2 OR i.to_id=$2)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=i.from_id AND b.blocked_id=i.to_id) OR (b.blocker_id=i.to_id AND b.blocked_id=i.from_id))`,
    [inviteId, userId]);
  return rows[0];
}

app.get('/api/chats', member, wrap(async (req, res) => {
  const me = req.profile;
  const { rows } = await q(
    `SELECT i.id, i.from_id, i.msg, p.*,
            (SELECT text FROM messages m WHERE m.invite_id=i.id ORDER BY m.id DESC LIMIT 1) AS ultimo,
            COALESCE((SELECT max(created_at) FROM messages m WHERE m.invite_id=i.id), i.answered_at) AS actividad
     FROM invites i JOIN profiles p ON p.user_id = CASE WHEN i.from_id=$1 THEN i.to_id ELSE i.from_id END
     WHERE i.estado='aceptada' AND (i.from_id=$1 OR i.to_id=$1)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=$1))
     ORDER BY actividad DESC`, [me.user_id]);
  res.json({ chats: rows.map(r => ({ id: r.id, ultimo: r.ultimo || r.msg || '', invitoYo: r.from_id === me.user_id, msgInvitacion: r.msg,
    persona: { ...publicProfile(r), puntaje: puntaje(me, r) } })) });
}));

app.get('/api/chats/:id/messages', member, wrap(async (req, res) => {
  const chat = await chatFor(req.user.id, Number(req.params.id));
  if (!chat) return fail(res, 404, 'Este chat ya no está disponible.');
  const after = Number(req.query.after) || 0;
  const { rows } = await q(
    'SELECT id, from_id, text, created_at FROM messages WHERE invite_id=$1 AND id>$2 ORDER BY id LIMIT 200', [chat.id, after]);
  res.json({ messages: rows.map(m => ({ id: m.id, mio: m.from_id === req.user.id, text: m.text, fecha: m.created_at })) });
}));

app.post('/api/chats/:id/messages', member, wrap(async (req, res) => {
  const chat = await chatFor(req.user.id, Number(req.params.id));
  if (!chat) return fail(res, 404, 'Este chat ya no está disponible.');
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return fail(res, 400, 'El mensaje debe tener entre 1 y 1000 caracteres.');
  const { rows } = await q('INSERT INTO messages (invite_id,from_id,text) VALUES ($1,$2,$3) RETURNING id, created_at', [chat.id, req.user.id, text]);
  res.json({ message: { id: rows[0].id, mio: true, text, fecha: rows[0].created_at } });
}));

/* ---------- seguridad: bloquear y denunciar ---------- */

app.post('/api/users/:id/bloquear', member, wrap(async (req, res) => {
  const other = Number(req.params.id);
  if (other === req.user.id) return fail(res, 400, 'No podés bloquearte.');
  await q('INSERT INTO blocks (blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, other]);
  res.json({ ok: true });
}));

app.post('/api/users/:id/denunciar', member, wrap(async (req, res) => {
  const other = Number(req.params.id);
  const motivo = String(req.body.motivo || '').trim().slice(0, 500);
  if (!motivo) return fail(res, 400, 'Contanos el motivo de la denuncia.');
  await q('INSERT INTO reports (reporter_id,reported_id,motivo) VALUES ($1,$2,$3)', [req.user.id, other, motivo]);
  await q('INSERT INTO blocks (blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, other]);
  res.json({ ok: true });
}));

/* ---------- frontend y errores ---------- */

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => (req.path.startsWith('/api') ? next() : res.sendFile(path.join(__dirname, 'public', 'index.html'))));
app.use('/api', (req, res) => fail(res, 404, 'No encontrado.'));
app.use((err, req, res, _next) => {
  if (err.status && err.status < 500) return fail(res, err.status, err.message);
  console.error(err);
  fail(res, 500, 'Hubo un error en el servidor. Probá de nuevo.');
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(PORT, () => console.log(`Afinidad escuchando en el puerto ${PORT}`)))
  .catch(e => { console.error('No se pudo preparar la base de datos:', e); process.exit(1); });
