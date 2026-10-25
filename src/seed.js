// Cuentas para probar la app. Se crean al arrancar el servidor según estas variables de entorno:
//   OWNER_EMAIL + OWNER_PASSWORD  → tu cuenta, ya verificada (completás el perfil vos)
//   DEMO_PASSWORD                 → 10 perfiles de prueba, todos con esa contraseña
//   DEMO_REMOVE=true              → borra los perfiles de prueba y todo lo relacionado
// Las contraseñas nunca quedan en el código: se cargan en Render, en Environment.
const bcrypt = require('bcryptjs');
const { q } = require('./db');
const { QUESTIONS } = require('./questions');

const todo = id => QUESTIONS.find(x => x.id === id).o;

// acepta: solo las preguntas donde la persona pone condiciones; en el resto acepta todo
function P(n, nombre, genero, interes, nac, ciudad, edadMin, edadMax, bio, ans, acepta = {}) {
  const acc = {};
  for (const qq of QUESTIONS) acc[qq.id] = acepta[qq.id] || todo(qq.id);
  return { email: `prueba${String(n).padStart(2, '0')}@afinidad.test`, nombre, genero, interes, nac, ciudad, edadMin, edadMax, bio, ans, acc };
}

const DEMO = [
  P(1, 'Lucía', 'Mujer', ['Hombre'], '1992-03-14', 'La Plata', 28, 50,
    'Profe de historia. Me gusta cocinar para amigos y caminar sin rumbo.',
    { fuma: 'No', alcohol: 'Socialmente', mascotas: 'Tengo', plan: 'Película en casa', hijos: 'Quiero tener', ritmo: 'Madrugador/a', orden: 'Normal', deporte: 'Algunas veces', viaje: 'Montaña', convivir: 'Con tiempo' },
    { fuma: ['No'], hijos: ['Quiero tener', 'No sé', 'Ya tengo'] }),
  P(2, 'Carolina', 'Mujer', ['Hombre'], '1988-08-02', 'Buenos Aires', 30, 55,
    'Contadora de día, cantante de karaoke de noche.',
    { fuma: 'A veces', alcohol: 'Socialmente', mascotas: 'No tengo, pero me gustan', plan: 'Salir a comer', hijos: 'No sé', ritmo: 'Nocturno/a', orden: 'Normal', deporte: 'Algunas veces', viaje: 'Ciudad', convivir: 'Con tiempo' }),
  P(3, 'Valeria', 'Mujer', ['Hombre'], '1995-11-21', 'Quilmes', 25, 45,
    'Me encanta bailar y viajar con la mochila.',
    { fuma: 'Sí', alcohol: 'Seguido', mascotas: 'No me gustan', plan: 'Bailar', hijos: 'No quiero', ritmo: 'Nocturno/a', orden: 'Relajado/a', deporte: 'Casi nunca', viaje: 'Playa', convivir: 'No quiero convivir' },
    { fuma: ['Sí', 'A veces'], alcohol: ['Seguido'], mascotas: ['No me gustan', 'No tengo, pero me gustan'], plan: ['Bailar', 'Salir a comer'],
      hijos: ['No quiero', 'No sé'], ritmo: ['Nocturno/a', 'Depende'], viaje: ['Playa', 'Ciudad'], convivir: ['No quiero convivir', 'Con tiempo'] }),
  P(4, 'Mariana', 'Mujer', ['Hombre', 'Mujer'], '1990-06-09', 'La Plata', 28, 50,
    'Veterinaria. Tengo dos gatos y una huerta en el balcón.',
    { fuma: 'No', alcohol: 'No', mascotas: 'Tengo', plan: 'Película en casa', hijos: 'Quiero tener', ritmo: 'Madrugador/a', orden: 'Muy ordenado/a', deporte: 'Todos los días', viaje: 'Montaña', convivir: 'Me gustaría pronto' },
    { fuma: ['No'], mascotas: ['Tengo', 'No tengo, pero me gustan'] }),
  P(5, 'Florencia', 'Mujer', ['Hombre'], '1985-01-30', 'Buenos Aires', 35, 55,
    'Mamá de Tomi (8). Busco algo tranquilo y con charla.',
    { fuma: 'No', alcohol: 'Socialmente', mascotas: 'Tengo', plan: 'Cine', hijos: 'Ya tengo', ritmo: 'Madrugador/a', orden: 'Normal', deporte: 'Algunas veces', viaje: 'Playa', convivir: 'Con tiempo' },
    { fuma: ['No', 'A veces'] }),
  P(6, 'Martín', 'Hombre', ['Mujer'], '1990-07-02', 'Buenos Aires', 25, 50,
    'Ingeniero, ciclista de fin de semana. Hago un buen asado.',
    { fuma: 'No', alcohol: 'Socialmente', mascotas: 'No tengo, pero me gustan', plan: 'Película en casa', hijos: 'Quiero tener', ritmo: 'Madrugador/a', orden: 'Muy ordenado/a', deporte: 'Todos los días', viaje: 'Montaña', convivir: 'Con tiempo' },
    { fuma: ['No', 'A veces'], orden: ['Muy ordenado/a', 'Normal'] }),
  P(7, 'Pablo', 'Hombre', ['Mujer'], '1987-11-20', 'La Plata', 28, 50,
    'Músico y docente. Cine de los jueves, sí o sí.',
    { fuma: 'No', alcohol: 'Socialmente', mascotas: 'Tengo', plan: 'Cine', hijos: 'No sé', ritmo: 'Nocturno/a', orden: 'Relajado/a', deporte: 'Casi nunca', viaje: 'Ciudad', convivir: 'Con tiempo' }),
  P(8, 'Diego', 'Hombre', ['Mujer'], '1994-01-09', 'Quilmes', 25, 45,
    'Fotógrafo freelance. Viajo cuando puedo.',
    { fuma: 'Sí', alcohol: 'Seguido', mascotas: 'No me gustan', plan: 'Bailar', hijos: 'No quiero', ritmo: 'Nocturno/a', orden: 'Relajado/a', deporte: 'Casi nunca', viaje: 'Playa', convivir: 'No quiero convivir' },
    { fuma: ['Sí', 'A veces'], alcohol: ['Seguido', 'Socialmente'], mascotas: ['No me gustan', 'No tengo, pero me gustan'], plan: ['Bailar', 'Salir a comer'],
      hijos: ['No quiero', 'No sé'], ritmo: ['Nocturno/a', 'Depende'], orden: ['Relajado/a', 'Normal'], viaje: ['Playa', 'Ciudad'], convivir: ['No quiero convivir'] }),
  P(9, 'Andrés', 'Hombre', ['Hombre'], '1989-09-12', 'La Plata', 28, 50,
    'Abogado y corredor de 10K. Domingos de feria.',
    { fuma: 'No', alcohol: 'Socialmente', mascotas: 'Tengo', plan: 'Salir a comer', hijos: 'No sé', ritmo: 'Madrugador/a', orden: 'Normal', deporte: 'Todos los días', viaje: 'Montaña', convivir: 'Con tiempo' },
    { fuma: ['No'] }),
  P(10, 'Sol', 'No binario', ['Mujer', 'Hombre', 'No binario'], '1993-04-18', 'Buenos Aires', 25, 50,
    'Ilustradora. Plantas, café y museos.',
    { fuma: 'A veces', alcohol: 'Socialmente', mascotas: 'Tengo', plan: 'Cine', hijos: 'No sé', ritmo: 'Depende', orden: 'Normal', deporte: 'Algunas veces', viaje: 'Ciudad', convivir: 'Con tiempo' }),
];

async function seed() {
  const { OWNER_EMAIL, OWNER_PASSWORD, DEMO_PASSWORD, DEMO_REMOVE } = process.env;

  if (OWNER_EMAIL && OWNER_PASSWORD) {
    const email = OWNER_EMAIL.trim().toLowerCase();
    const hash = await bcrypt.hash(OWNER_PASSWORD, 11);
    await q(`INSERT INTO users (email,password_hash,email_verified) VALUES ($1,$2,TRUE)
             ON CONFLICT (email) DO UPDATE SET password_hash=$2, email_verified=TRUE`, [email, hash]);
    console.log(`Cuenta principal lista: ${email}`);
  }

  if (DEMO_REMOVE === 'true') {
    const { rowCount } = await q(`DELETE FROM users WHERE id IN (SELECT user_id FROM profiles WHERE es_prueba)`);
    console.log(`Perfiles de prueba borrados: ${rowCount}`);
    return;
  }

  if (DEMO_PASSWORD) {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 11);
    for (const d of DEMO) {
      const { rows } = await q(`INSERT INTO users (email,password_hash,email_verified) VALUES ($1,$2,TRUE)
               ON CONFLICT (email) DO UPDATE SET password_hash=$2, email_verified=TRUE RETURNING id`, [d.email, hash]);
      // Si ya existe el perfil no se pisa, así se conservan los cambios que hagas al probar
      await q(`INSERT INTO profiles (user_id,nombre,nac,ciudad,genero,interes,edad_min,edad_max,bio,ans,acc,es_prueba)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE) ON CONFLICT (user_id) DO NOTHING`,
        [rows[0].id, d.nombre, d.nac, d.ciudad, d.genero, d.interes, d.edadMin, d.edadMax, d.bio, d.ans, d.acc]);
    }
    console.log(`Perfiles de prueba listos: ${DEMO.length}`);
  }
}

module.exports = { seed, DEMO };
