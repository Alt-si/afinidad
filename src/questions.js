// Preguntas del cuestionario. Para agregar o cambiar preguntas, editá esta lista:
// el formulario de la app y el cálculo de coincidencia se arman a partir de acá.
const QUESTIONS = [
  { id: 'fuma',     t: '¿Fumás?',                          o: ['No', 'A veces', 'Sí'] },
  { id: 'alcohol',  t: '¿Tomás alcohol?',                  o: ['No', 'Socialmente', 'Seguido'] },
  { id: 'mascotas', t: 'Mascotas',                         o: ['Tengo', 'No tengo, pero me gustan', 'No me gustan'] },
  { id: 'plan',     t: 'Un viernes a la noche preferís…',  o: ['Cine', 'Película en casa', 'Salir a comer', 'Bailar'] },
  { id: 'hijos',    t: 'Hijos',                            o: ['Quiero tener', 'No quiero', 'Ya tengo', 'No sé'] },
  { id: 'ritmo',    t: 'Tu ritmo diario',                  o: ['Madrugador/a', 'Nocturno/a', 'Depende'] },
  { id: 'orden',    t: 'Orden en casa',                    o: ['Muy ordenado/a', 'Normal', 'Relajado/a'] },
  { id: 'deporte',  t: 'Actividad física',                 o: ['Todos los días', 'Algunas veces', 'Casi nunca'] },
  { id: 'viaje',    t: 'Vacaciones ideales',               o: ['Playa', 'Montaña', 'Ciudad', 'Quedarme en casa'] },
  { id: 'convivir', t: 'Convivencia',                      o: ['Me gustaría pronto', 'Con tiempo', 'No quiero convivir'] },
];

const GENEROS = ['Mujer', 'Hombre', 'No binario'];

// Porcentaje mínimo para que una persona le aparezca a otra
const UMBRAL = Number(process.env.MATCH_THRESHOLD || 70);

module.exports = { QUESTIONS, GENEROS, UMBRAL };
