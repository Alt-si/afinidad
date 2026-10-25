-- Se ejecuta en cada arranque; todas las sentencias son idempotentes.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  telefono        TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un celular verificado pertenece a una sola cuenta
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_verified_idx ON users (telefono) WHERE phone_verified;

CREATE TABLE IF NOT EXISTS profiles (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  nac        DATE NOT NULL,
  ciudad     TEXT NOT NULL,
  genero     TEXT NOT NULL,
  interes    TEXT[] NOT NULL,
  edad_min   INTEGER NOT NULL,
  edad_max   INTEGER NOT NULL,
  bio        TEXT NOT NULL DEFAULT '',
  ans        JSONB NOT NULL,   -- { preguntaId: "mi respuesta" }
  acc        JSONB NOT NULL,   -- { preguntaId: ["lo que acepto", ...] }
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_genero_idx ON profiles (genero);

-- Códigos de verificación propios (correo, y SMS cuando no se usa Twilio Verify)
CREATE TABLE IF NOT EXISTS verif_codes (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('email','sms')),
  destino     TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verif_user_idx ON verif_codes (user_id, tipo);

CREATE TABLE IF NOT EXISTS invites (
  id          SERIAL PRIMARY KEY,
  from_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptada','rechazada')),
  msg         TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
-- Una sola invitación por pareja de personas, sin importar quién invitó
CREATE UNIQUE INDEX IF NOT EXISTS invites_pair_idx ON invites (LEAST(from_id,to_id), GREATEST(from_id,to_id));

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  invite_id   INTEGER NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  from_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_invite_idx ON messages (invite_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marca los perfiles de prueba (se crean con DEMO_PASSWORD y se borran con DEMO_REMOVE)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;
