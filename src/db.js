const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y completalo.');
  process.exit(1);
}

// Render usa SSL para conexiones externas; la URL interna no lo necesita.
const needsSSL = process.env.DATABASE_SSL === 'true';
const pool = new Pool({
  connectionString: url,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 10,
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

const q = (text, params) => pool.query(text, params);

module.exports = { pool, q, migrate };
