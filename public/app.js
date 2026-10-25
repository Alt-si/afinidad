'use strict';
/* ===== Estado ===== */
let CFG = null;          // preguntas, géneros, umbral
let ME = null;           // cuenta actual (null = sin sesión)
let tab = 'descubrir';
let authMode = 'login';
let inviting = null;     // id de persona con el formulario de invitación abierto
let reporting = null;    // id de persona con el formulario de denuncia abierto
let openChat = null;
let lastMsgId = 0;
let pollTimer = null;
let pendingCount = 0;

const main = document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Qt = id => CFG.questions.find(q => q.id === id)?.t || id;

/* ===== API ===== */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error(data.error || 'No se pudo completar la acción.');
    e.status = res.status; e.errors = data.errors || {};
    throw e;
  }
  return data;
}

function toast(t, bad) {
  const el = document.getElementById('toast');
  el.textContent = t; el.classList.toggle('bad', !!bad); el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3000);
}
function showErrors(form, e) {
  form.querySelectorAll('[data-e]').forEach(s => (s.textContent = e.errors?.[s.dataset.e] || ''));
  const gen = form.querySelector('[data-e="general"]');
  if (gen) gen.textContent = e.message;
  const first = form.querySelector('.err:not(:empty)');
  first && first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

/* ===== Arranque y enrutado ===== */
async function boot() {
  CFG = await api('/config');
  await refreshMe();
  route();
}
async function refreshMe() {
  try { ME = await api('/me'); } catch (e) { if (e.status === 401) ME = null; else throw e; }
}
function step() {
  if (!ME) return 'auth';
  if (!ME.email_verified && !ME.phone_verified) return 'verify';
  if (!ME.profile) return 'profile';
  return 'app';
}
function route() {
  stopPoll();
  const s = step();
  renderHeader(s);
  if (s === 'auth') return vAuth();
  if (s === 'verify') return vVerify();
  if (s === 'profile') return vProfileForm(true);
  if (tab === 'descubrir') vDescubrir();
  else if (tab === 'invitaciones') vInvitaciones();
  else if (tab === 'chats') vChats();
  else vProfileForm(false);
  refreshBadge();
}

function renderHeader(s) {
  document.getElementById('who').innerHTML = ME
    ? `<span>${esc(ME.profile?.nombre || ME.email)}</span><button class="btn small ghost" data-act="logout">Salir</button>` : '';
  const nav = document.getElementById('nav');
  if (s !== 'app') { nav.innerHTML = ''; return; }
  const tabs = [['descubrir', 'Coincidencias'], ['invitaciones', 'Invitaciones', pendingCount], ['chats', 'Chats'], ['perfil', 'Mi perfil']];
  nav.innerHTML = tabs.map(([k, l, b]) =>
    `<button type="button" data-tab="${k}" aria-current="${tab === k}">${l}${b ? `<span class="badge">${b}</span>` : ''}</button>`).join('');
}
async function refreshBadge() {
  try {
    const d = await api('/invites');
    const n = d.recibidas.length;
    if (n !== pendingCount) { pendingCount = n; renderHeader(step()); }
  } catch {}
}

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) { tab = b.dataset.tab; inviting = reporting = null; route(); }
});
document.getElementById('who').addEventListener('click', async e => {
  if (e.target.closest('[data-act="logout"]')) {
    await api('/auth/logout', { method: 'POST', body: {} });
    ME = null; tab = 'descubrir'; authMode = 'login'; route();
  }
});

/* ===== Acceso ===== */
function steps(on) {
  const L = [['verify', 'Verificación'], ['profile', 'Perfil']];
  const idx = L.findIndex(x => x[0] === on);
  return `<div class="steps" aria-label="Pasos del registro">${L.map(([k, l], i) =>
    `<span class="${i < idx ? 'done' : i === idx ? 'on' : ''}">${i + 1}. ${l}</span>`).join('')}</div>`;
}

function vAuth() {
  const login = authMode === 'login';
  main.innerHTML = `<section class="auth">
    <div><h1>Conocé gente que vive como vos</h1>
    <p class="sub">Respondé preguntas de la vida cotidiana y te presentamos solo a quienes coinciden con vos en un ${CFG.umbral}% o más.</p></div>
    <div class="panel">
      <div class="seg" role="group" aria-label="Elegí una opción">
        <button type="button" data-mode="login" aria-pressed="${login}">Iniciar sesión</button>
        <button type="button" data-mode="signup" aria-pressed="${!login}">Crear cuenta</button>
      </div>
      <form id="authForm" class="stack" style="gap:14px" novalidate>
        <label class="f">Correo<input id="a-email" name="email" type="email" autocomplete="email" required><span class="err" data-e="email"></span></label>
        <label class="f">Contraseña${login ? '' : ' <span class="hint">mínimo 8 caracteres</span>'}<span class="pw"><input id="a-pass" name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" required><button type="button" data-act="toggle-pw" aria-pressed="false" aria-label="Mostrar contraseña">Mostrar</button></span><span class="err" data-e="password"></span></label>
        ${login ? '' : `<label class="f">Celular <span class="hint">con código de país</span><input id="a-tel" name="telefono" type="tel" autocomplete="tel" placeholder="+54 9 221 555 1234" required><span class="err" data-e="telefono"></span></label>`}
        <button class="btn primary" type="submit">${login ? 'Entrar' : 'Crear cuenta'}</button>
        <span class="err" data-e="general"></span>
      </form>
    </div>
    ${login ? '' : '<p class="note">Para activar la cuenta te mandamos un código al correo o por SMS al celular, como prefieras. No pedimos documento.</p>'}
  </section>`;
}

let vChannel = 'email';   // dónde recibir el código: 'email' o 'sms'
let codeSent = false;
function vVerify() {
  const email = vChannel === 'email';
  const dest = email ? ME.email : ME.telefono;
  main.innerHTML = `<section class="auth">
    ${steps('verify')}
    <div><h2>Verificá tu cuenta</h2><p class="sub">Elegí dónde querés recibir un código de 6 números. Vence en 10 minutos.</p></div>
    <div class="panel">
      <div class="seg" role="group" aria-label="Dónde recibir el código">
        <button type="button" data-channel="email" aria-pressed="${email}">Correo</button>
        <button type="button" data-channel="sms" aria-pressed="${!email}">SMS al celular</button>
      </div>
      <p class="sub" style="margin:0">${codeSent ? 'Lo mandamos a' : 'Lo vamos a mandar a'} <b>${esc(dest)}</b>.</p>
      ${codeSent ? `
      <form id="codeForm" class="stack" style="gap:14px" novalidate>
        <label class="f">Código<input id="v-code" name="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></label>
        <button class="btn primary" type="submit">Verificar</button>
        <span class="err" data-e="general"></span>
      </form>
      <p class="note">¿No llegó? ${email ? 'Mirá en la carpeta de spam, ' : ''}<button class="link" data-act="send-code">mandalo de nuevo</button> o <button class="link" data-channel="${email ? 'sms' : 'email'}">probá ${email ? 'por SMS' : 'por correo'}</button>.</p>`
      : `<button class="btn primary" data-act="send-code">Enviarme el código</button><span class="err" id="sendErr"></span>`}
      ${email ? '' : `<details><summary>Cambiar el número</summary>
        <form id="phoneForm" class="inline-form" style="margin-top:10px" novalidate>
          <label for="p-tel" hidden>Nuevo celular</label>
          <input id="p-tel" type="tel" autocomplete="tel" placeholder="+54 9 221 555 1234">
          <button class="btn" type="submit">Guardar número</button>
        </form>
      </details>`}
    </div>
    ${CFG.devCodes ? '<p class="notice">Modo prueba: el servidor todavía no tiene configurado el envío real de correos o SMS. El código aparece en los Logs del servicio en Render.</p>' : ''}
  </section>`;
}

/* ===== Perfil ===== */
function vProfileForm(nuevo) {
  const u = ME.profile || { nombre: '', nac: '', ciudad: '', genero: '', interes: [], edadMin: 25, edadMax: 45, bio: '', ans: {}, acc: {} };
  const chk = (name, val, on, cls, type) =>
    `<label class="chip ${cls || ''}"><input type="${type || 'checkbox'}" name="${name}" value="${esc(val)}" ${on ? 'checked' : ''}><span>${esc(val)}</span></label>`;
  main.innerHTML = `${nuevo ? `<section class="auth" style="max-width:none;gap:0">${steps('profile')}</section>` : ''}
  <div><h2>${nuevo ? 'Armá tu perfil' : 'Mi perfil'}</h2>
  <p class="sub">${nuevo ? 'Completá tus datos y respondé las preguntas de convivencia. Con eso calculamos con quién coincidís.' : 'Si cambiás tus respuestas, tus coincidencias se recalculan al guardar.'}</p></div>
  <form id="pf" class="stack" novalidate>
   <fieldset><legend>Tus datos</legend>
    <div class="grid2">
     <label class="f">Nombre<input id="f-nombre" name="nombre" value="${esc(u.nombre)}" autocomplete="given-name"><span class="err" data-e="nombre"></span></label>
     <label class="f">Fecha de nacimiento<input id="f-nac" name="nac" type="date" value="${esc(u.nac)}"><span class="err" data-e="nac"></span></label>
     <label class="f">Ciudad<input id="f-ciudad" name="ciudad" value="${esc(u.ciudad)}" autocomplete="address-level2"><span class="err" data-e="ciudad"></span></label>
    </div>
    <div class="q"><span class="lbl">Soy</span><div class="chips">${CFG.generos.map(g => chk('genero', g, u.genero === g, '', 'radio')).join('')}</div><span class="err" data-e="genero"></span></div>
    <div class="q"><span class="lbl">Me interesa conocer</span><div class="chips">${CFG.generos.map(g => chk('interes', g, u.interes.includes(g), 'acc')).join('')}</div><span class="err" data-e="interes"></span></div>
    <div class="grid2">
     <label class="f">Edad mínima de la pareja<input id="f-emin" name="edadMin" type="number" min="18" max="99" value="${u.edadMin}"></label>
     <label class="f">Edad máxima de la pareja<input id="f-emax" name="edadMax" type="number" min="18" max="99" value="${u.edadMax}"><span class="err" data-e="edad"></span></label>
    </div>
    <label class="f">Sobre vos <span class="hint">opcional, hasta 300 caracteres</span><textarea id="f-bio" name="bio" rows="2" maxlength="300">${esc(u.bio)}</textarea></label>
   </fieldset>
   <fieldset><legend>Vida cotidiana y convivencia</legend>
    <p class="sub" style="margin:0">En cada pregunta marcá tu respuesta y qué aceptás de tu pareja. Si algo te da igual, dejá todas las opciones marcadas.</p>
    ${CFG.questions.map((q, i) => `<div class="q ${i === 0 ? 'first' : ''}"><h4>${esc(q.t)}</h4>
      <span class="lbl">Yo</span><div class="chips">${q.o.map(v => chk('a-' + q.id, v, u.ans[q.id] === v, '', 'radio')).join('')}</div>
      <span class="lbl">Acepto en mi pareja</span><div class="chips">${q.o.map(v => chk('c-' + q.id, v, nuevo ? true : (u.acc[q.id] || []).includes(v), 'acc')).join('')}</div>
      <span class="err" data-e="q-${q.id}"></span></div>`).join('')}
   </fieldset>
   <div class="formfoot"><button class="btn primary" type="submit">${nuevo ? 'Guardar y ver coincidencias' : 'Guardar cambios'}</button><span class="err" data-e="general"></span></div>
  </form>
  ${nuevo ? '' : `<fieldset class="danger-zone"><legend>Cuenta</legend>
    <p class="sub" style="margin:0">Correo: ${esc(ME.email)} · Celular: ${esc(ME.telefono)}</p>
    <div id="delZone"><button class="btn danger" data-act="ask-delete">Borrar mi cuenta</button></div>
  </fieldset>`}`;
}
function readProfile(f) {
  const fd = new FormData(f), v = n => (fd.get(n) || '').toString().trim();
  const d = { nombre: v('nombre'), nac: v('nac'), ciudad: v('ciudad'), genero: v('genero'), interes: fd.getAll('interes'),
    edadMin: Number(v('edadMin')), edadMax: Number(v('edadMax')), bio: v('bio'), ans: {}, acc: {} };
  CFG.questions.forEach(q => { d.ans[q.id] = v('a-' + q.id); d.acc[q.id] = fd.getAll('c-' + q.id); });
  return d;
}

/* ===== Tarjetas ===== */
function ring(p) {
  return `<div class="ring" style="background:conic-gradient(var(--match) ${p}%, var(--line) 0)" aria-label="${p}% de coincidencia"><span>${p}%</span></div>`;
}
function tablaCmp(o) {
  return `<details><summary>Ver respuestas de ${esc(o.nombre)} comparadas con las tuyas</summary><div class="cmp"><table>
   <thead><tr><th>Pregunta</th><th>${esc(o.nombre)}</th><th>Vos</th><th>¿Te sirve?</th><th>¿Le servís?</th></tr></thead><tbody>
   ${o.detalle.map(d => `<tr><td>${esc(Qt(d.id))}</td><td>${esc(d.el)}</td><td>${esc(d.yo)}</td>
   <td class="mk ${d.meSirve ? 'y' : 'n'}">${d.meSirve ? 'Sí' : 'No'}</td><td class="mk ${d.leSirvo ? 'y' : 'n'}">${d.leSirvo ? 'Sí' : 'No'}</td></tr>`).join('')}
   </tbody></table></div></details>`;
}
function reportForm(o) {
  return reporting === o.id ? `<form class="inline-form" data-report="${o.id}" novalidate>
    <label for="r-${o.id}" hidden>Motivo</label><input id="r-${o.id}" maxlength="500" placeholder="¿Qué pasó? Al denunciar también la bloqueás.">
    <button class="btn danger" type="submit">Enviar denuncia</button><button type="button" class="btn ghost" data-act="cancel">Cancelar</button></form>` : '';
}
function cardHTML(o, extra) {
  const corto = id => Qt(id).replace(/[¿?…]/g, '').replace(/^Un viernes a la noche preferís$/, 'Viernes');
  const comunes = o.detalle.filter(x => x.yo === x.el).map(x => `${corto(x.id)}: ${x.el}`).slice(0, 4);
  const choques = o.detalle.filter(x => !x.meSirve).map(x => Qt(x.id)).slice(0, 2);
  return `<article class="card">
    ${ring(o.puntaje)}
    <div class="body">
      <div><h3>${esc(o.nombre)}, ${o.edad}</h3><div class="meta">${esc(o.ciudad)} · ${esc(o.genero)}</div></div>
      ${o.bio ? `<div>${esc(o.bio)}</div>` : ''}
      <div class="tags">${comunes.map(c => `<span class="tag">${esc(c)}</span>`).join('')}${choques.map(c => `<span class="tag no">Difieren: ${esc(c)}</span>`).join('')}</div>
    </div>
    ${o.detalle ? tablaCmp(o) : ''}
    ${extra}
    ${reportForm(o)}
  </article>`;
}

/* ===== Coincidencias ===== */
let cache = { matches: [], invites: { recibidas: [], enviadas: [] }, chats: [] };

async function vDescubrir() {
  main.innerHTML = `<p class="sub">Buscando coincidencias…</p>`;
  try { const d = await api('/matches'); cache.matches = d.matches; cache.debajo = d.debajo; } catch (e) { return errorView(e); }
  drawDescubrir();
}
function drawDescubrir() {
  const U = CFG.umbral, ok = cache.matches;
  let h = `<div><h2>Personas para conocer</h2><p class="sub">Te mostramos perfiles con ${U}% o más de coincidencia en las dos direcciones: lo que vos aceptás de la otra persona y lo que ella acepta de vos.</p></div>`;
  if (!ok.length) h += `<div class="empty"><h3>Todavía no hay coincidencias del ${U}%</h3>Cuando se registre alguien compatible con tus respuestas, va a aparecer acá. Mientras tanto podés revisar tus respuestas en Mi perfil.</div>`;
  h += `<div class="list">` + ok.map(o => {
    let act;
    if (o.estado === 'nueva') {
      act = inviting === o.id
        ? `<form class="inline-form" data-send="${o.id}" novalidate><label for="im-${o.id}" hidden>Mensaje</label><input id="im-${o.id}" maxlength="200" placeholder="Escribí un saludo (opcional)"><button class="btn primary" type="submit">Enviar invitación</button><button type="button" class="btn ghost" data-act="cancel">Cancelar</button></form>`
        : `<div class="actions"><button class="btn primary" data-invite="${o.id}">Invitar a chatear</button><button class="btn small ghost" data-block="${o.id}">No me interesa</button></div>`;
    } else if (o.estado === 'enviada') act = `<div class="actions"><span class="state">Invitación enviada · esperando respuesta</span></div>`;
    else if (o.estado === 'recibida') act = `<div class="actions"><span class="state ok">Te invitó a chatear</span><button class="btn" data-go="invitaciones">Ver invitación</button></div>`;
    else act = `<div class="actions"><span class="state ok">Chat abierto</span><button class="btn" data-chat="${o.inviteId}">Ir al chat</button></div>`;
    return cardHTML(o, act);
  }).join('') + `</div>`;
  if (cache.debajo) h += `<p class="note">${cache.debajo} perfil${cache.debajo > 1 ? 'es' : ''} compatible${cache.debajo > 1 ? 's' : ''} por orientación y edad quedaron debajo del ${U}% y no se muestran.</p>`;
  main.innerHTML = h;
}

/* ===== Invitaciones ===== */
async function vInvitaciones() {
  main.innerHTML = `<p class="sub">Cargando invitaciones…</p>`;
  try { cache.invites = await api('/invites'); } catch (e) { return errorView(e); }
  pendingCount = cache.invites.recibidas.length; renderHeader('app');
  drawInvitaciones();
}
function drawInvitaciones() {
  const { recibidas, enviadas } = cache.invites;
  let h = `<div><h2>Invitaciones</h2><p class="sub">Mirá las características de quien te invita y decidí si querés conversar. Si rechazás, no se le avisa y deja de aparecerte.</p></div>`;
  h += `<div class="eyebrow">Recibidas (${recibidas.length})</div>`;
  h += recibidas.length ? `<div class="list">` + recibidas.map(i => cardHTML(i.persona,
    `${i.msg ? `<div class="inv-msg"><b>Mensaje de ${esc(i.persona.nombre)}</b>${esc(i.msg)}</div>` : ''}
     <div class="actions"><button class="btn ok" data-accept="${i.id}">Aceptar y chatear</button><button class="btn" data-reject="${i.id}">Rechazar</button>
     <button class="btn small ghost danger" data-reportopen="${i.persona.id}">Denunciar</button></div>`)).join('') + `</div>`
    : `<div class="empty"><h3>No tenés invitaciones pendientes</h3>Cuando alguien con quien coincidís te invite, la vas a ver acá.</div>`;
  if (enviadas.length) h += `<div class="eyebrow">Enviadas, esperando respuesta (${enviadas.length})</div><div class="list">` +
    enviadas.map(i => `<div class="notice">${esc(i.persona.nombre)}, ${i.persona.edad} · ${i.persona.puntaje}% de coincidencia</div>`).join('') + `</div>`;
  main.innerHTML = h;
}

/* ===== Chats ===== */
async function vChats() {
  main.innerHTML = `<p class="sub">Cargando chats…</p>`;
  try { cache.chats = (await api('/chats')).chats; } catch (e) { return errorView(e); }
  if (!cache.chats.length) {
    main.innerHTML = `<div><h2>Chats</h2></div><div class="empty"><h3>Todavía no tenés conversaciones</h3>Se abre un chat cuando alguien acepta tu invitación o vos aceptás una.</div>`;
    return;
  }
  if (!openChat || !cache.chats.find(c => c.id === openChat)) openChat = cache.chats[0].id;
  const c = cache.chats.find(x => x.id === openChat), o = c.persona;
  main.innerHTML = `<div><h2>Chats</h2></div><div class="chatwrap">
   <div class="threads">${cache.chats.map(t => `<button data-chat="${t.id}" aria-current="${t.id === openChat}"><b>${esc(t.persona.nombre)}</b><small>${esc(t.ultimo) || 'Chat nuevo'}</small></button>`).join('')}</div>
   <section class="thread">
     <div class="th"><div><b>${esc(o.nombre)}, ${o.edad}</b><div class="meta">${esc(o.ciudad)} · ${o.puntaje}% de coincidencia</div></div>
       <div class="actions" style="grid-column:auto"><button class="btn small ghost" data-block="${o.id}">Bloquear</button><button class="btn small ghost danger" data-reportopen="${o.id}">Denunciar</button></div></div>
     ${reporting === o.id ? `<div style="padding:12px 14px;border-bottom:1px solid var(--line)">${reportForm(o)}</div>` : ''}
     <div class="msgs" id="msgs" aria-live="polite">
       <div class="sys">Chat abierto. Cuidate: no compartas datos bancarios ni tu dirección hasta conocer bien a la otra persona.</div>
       ${c.msgInvitacion ? `<div class="m ${c.invitoYo ? 'me' : ''}">${esc(c.msgInvitacion)}<small>Mensaje de la invitación</small></div>` : ''}
     </div>
     <form class="compose" id="compose" novalidate><label for="msgIn" hidden>Mensaje</label><input id="msgIn" maxlength="1000" placeholder="Escribí un mensaje…" autocomplete="off"><button class="btn primary" type="submit">Enviar</button></form>
   </section></div>`;
  lastMsgId = 0;
  await pullMessages();
  pollTimer = setInterval(pullMessages, 4000);
}
async function pullMessages() {
  const box = document.getElementById('msgs');
  if (!box || !openChat) return stopPoll();
  try {
    const { messages } = await api(`/chats/${openChat}/messages?after=${lastMsgId}`);
    appendMessages(messages);
  } catch (e) { if (e.status === 404) { stopPoll(); toast('Este chat ya no está disponible.', true); route(); } }
}
function appendMessages(list) {
  const box = document.getElementById('msgs');
  if (!box || !list.length) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  for (const m of list) {
    if (m.id <= lastMsgId) continue;
    lastMsgId = m.id;
    box.insertAdjacentHTML('beforeend', `<div class="m ${m.mio ? 'me' : ''}">${esc(m.text)}<small>${new Date(m.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>`);
  }
  if (nearBottom || list.some(m => m.mio)) box.scrollTop = box.scrollHeight;
}
function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

function errorView(e) {
  if (e.status === 401) { ME = null; return route(); }
  main.innerHTML = `<div class="empty"><h3>No pudimos cargar esta sección</h3>${esc(e.message)}<p><button class="btn" data-act="retry">Reintentar</button></p></div>`;
}

/* ===== Eventos ===== */
main.addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t) return;
  const act = t.dataset.act;
  try {
    if (t.dataset.mode) { authMode = t.dataset.mode; return vAuth(); }
    if (act === 'retry') return route();
    if (act === 'cancel') { inviting = reporting = null; return tab === 'descubrir' ? drawDescubrir() : tab === 'invitaciones' ? drawInvitaciones() : route(); }
    if (act === 'toggle-pw') {
      const inp = t.parentElement.querySelector('input'), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      t.textContent = show ? 'Ocultar' : 'Mostrar';
      t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      inp.focus();
      return;
    }
    if (t.dataset.channel) { vChannel = t.dataset.channel; codeSent = false; return vVerify(); }
    if (act === 'send-code') {
      return busy(t, async () => {
        try {
          await api(vChannel === 'email' ? '/auth/email/send' : '/auth/sms/send', { method: 'POST', body: {} });
          codeSent = true; vVerify();
          toast(vChannel === 'email' ? 'Te mandamos el código por correo.' : 'Te mandamos el código por SMS.');
          document.getElementById('v-code')?.focus();
        } catch (err) { const s = document.getElementById('sendErr'); if (s) s.textContent = err.message; else toast(err.message, true); }
      });
    }
    if (act === 'ask-delete') {
      document.getElementById('delZone').innerHTML = `<p class="sub" style="margin:0 0 8px">Se borran tu perfil, tus invitaciones y tus chats. No se puede deshacer.</p>
        <button class="btn danger" data-act="confirm-delete">Sí, borrar mi cuenta</button> <button class="btn ghost" data-act="cancel">Cancelar</button>`;
      return;
    }
    if (act === 'confirm-delete') { await api('/me', { method: 'DELETE', body: {} }); ME = null; toast('Tu cuenta fue borrada.'); return route(); }
    if (t.dataset.invite) { inviting = Number(t.dataset.invite); drawDescubrir(); document.getElementById('im-' + inviting)?.focus(); return; }
    if (t.dataset.go) { tab = t.dataset.go; return route(); }
    if (t.dataset.chat) { tab = 'chats'; openChat = Number(t.dataset.chat); reporting = null; return route(); }
    if (t.dataset.accept) {
      return busy(t, async () => { await api(`/invites/${t.dataset.accept}/aceptar`, { method: 'POST', body: {} });
        toast('Invitación aceptada. Ya pueden chatear.'); tab = 'chats'; openChat = Number(t.dataset.accept); route(); });
    }
    if (t.dataset.reject) {
      return busy(t, async () => { await api(`/invites/${t.dataset.reject}/rechazar`, { method: 'POST', body: {} }); toast('Invitación rechazada.'); vInvitaciones(); });
    }
    if (t.dataset.block) {
      return busy(t, async () => { await api(`/users/${t.dataset.block}/bloquear`, { method: 'POST', body: {} });
        toast(tab === 'chats' ? 'Bloqueaste a esta persona.' : 'No te la vamos a mostrar más.'); openChat = null; route(); });
    }
    if (t.dataset.reportopen) {
      reporting = Number(t.dataset.reportopen);
      tab === 'chats' ? route() : drawInvitaciones();
      document.getElementById('r-' + reporting)?.focus();
      return;
    }
  } catch (err) { toast(err.message, true); }
});

main.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('[type="submit"]');
  await busy(btn, async () => {
    try {
      if (f.id === 'authForm') {
        const body = { email: f.email.value, password: f.password.value };
        if (authMode === 'signup') body.telefono = f.telefono.value;
        await api(authMode === 'signup' ? '/auth/signup' : '/auth/login', { method: 'POST', body });
        await refreshMe(); tab = 'descubrir'; codeSent = false; vChannel = 'email'; return route();
      }
      if (f.id === 'codeForm') {
        await api(vChannel === 'email' ? '/auth/email/verify' : '/auth/sms/verify', { method: 'POST', body: { code: f.code.value } });
        await refreshMe(); codeSent = false; toast('Cuenta verificada.'); return route();
      }
      if (f.id === 'phoneForm') {
        await api('/auth/phone', { method: 'POST', body: { telefono: document.getElementById('p-tel').value } });
        await refreshMe(); codeSent = false; toast('Número actualizado.'); return vVerify();
      }
      if (f.id === 'pf') {
        const nuevo = !ME.profile;
        await api('/profile', { method: 'PUT', body: readProfile(f) });
        await refreshMe(); toast(nuevo ? '¡Listo! Estas son tus coincidencias.' : 'Perfil guardado.');
        tab = 'descubrir'; window.scrollTo(0, 0); return route();
      }
      if (f.dataset.send) {
        const to = Number(f.dataset.send);
        await api('/invites', { method: 'POST', body: { to, msg: f.querySelector('input').value } });
        inviting = null; toast('Invitación enviada.'); return vDescubrir();
      }
      if (f.dataset.report) {
        const motivo = f.querySelector('input').value.trim();
        if (!motivo) { toast('Contanos el motivo de la denuncia.', true); return; }
        await api(`/users/${f.dataset.report}/denunciar`, { method: 'POST', body: { motivo } });
        reporting = null; openChat = null; toast('Gracias. Recibimos la denuncia y bloqueamos a esta persona.'); return route();
      }
      if (f.id === 'compose') {
        const inp = document.getElementById('msgIn'), text = inp.value.trim();
        if (!text) return;
        const { message } = await api(`/chats/${openChat}/messages`, { method: 'POST', body: { text } });
        inp.value = ''; appendMessages([message]); inp.focus();
      }
    } catch (err) {
      if (err.status === 401 && f.id !== 'authForm') { ME = null; return route(); }
      showErrors(f, err);
      if (!f.querySelector('[data-e="general"]')) toast(err.message, true);
    }
  });
});

setInterval(() => { if (step() === 'app' && tab !== 'invitaciones') refreshBadge(); }, 30000);
boot().catch(() => { main.innerHTML = `<div class="empty"><h3>No pudimos conectar con el servidor</h3>Revisá tu conexión y recargá la página.</div>`; });
