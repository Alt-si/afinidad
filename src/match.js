const { QUESTIONS } = require('./questions');

function edad(nac) {
  const d = new Date(nac), h = new Date();
  let e = h.getUTCFullYear() - d.getUTCFullYear();
  const m = h.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && h.getUTCDate() < d.getUTCDate())) e--;
  return e;
}

// Fracción de preguntas en las que lo que es "b" entra en lo que acepta "a"
function encaja(a, b) {
  const ok = QUESTIONS.filter(q => (a.acc[q.id] || []).includes(b.ans[q.id])).length;
  return ok / QUESTIONS.length;
}

// Requisitos excluyentes: orientación y rango de edad, en las dos direcciones
function compatibles(a, b) {
  if (!a.interes.includes(b.genero) || !b.interes.includes(a.genero)) return false;
  const ea = edad(a.nac), eb = edad(b.nac);
  return eb >= a.edad_min && eb <= a.edad_max && ea >= b.edad_min && ea <= b.edad_max;
}

// Promedio de las dos direcciones, de 0 a 100
function puntaje(a, b) {
  return Math.round(((encaja(a, b) + encaja(b, a)) / 2) * 100);
}

function detalle(a, b) {
  return QUESTIONS.map(q => ({
    id: q.id,
    yo: a.ans[q.id],
    el: b.ans[q.id],
    meSirve: (a.acc[q.id] || []).includes(b.ans[q.id]),
    leSirvo: (b.acc[q.id] || []).includes(a.ans[q.id]),
  }));
}

module.exports = { edad, encaja, compatibles, puntaje, detalle };
