# Afinidad

App para conocer gente por afinidad en la vida cotidiana y la convivencia. Cada persona responde un cuestionario marcando **su respuesta** y **qué acepta de su pareja**. El sistema muestra solo a quienes coinciden en un 70 % o más, en las dos direcciones, y permite invitarlas a chatear.

## Qué incluye

- Registro con correo, contraseña y celular.
- Verificación con un código: cada persona elige recibirlo por correo (Brevo) o por SMS al celular (Twilio Verify). Alcanza con uno de los dos. Sin documento.
- Un celular verificado sirve para una sola cuenta.
- Botón para mostrar u ocultar la contraseña.
- Perfil con datos básicos, orientación, rango de edad buscado y 10 preguntas de convivencia.
- Coincidencias desde el 70 %, con tabla comparativa de respuestas.
- Invitaciones a chatear: quien recibe ve el perfil y acepta o rechaza. El rechazo no se avisa.
- Chat entre personas que aceptaron (se actualiza cada 4 segundos).
- Bloquear, denunciar y borrar la cuenta.

## Publicarla en Render (paso a paso)

### 1. Subir el código a GitHub
Creá un repositorio en GitHub y subí esta carpeta tal cual (el `.gitignore` ya deja afuera `node_modules` y `.env`).

### 2. Crear la app con el blueprint
En Render: **New → Blueprint** y elegí el repositorio. Render lee `render.yaml` y crea:
- la base de datos PostgreSQL `afinidad-db`,
- el servicio web `afinidad`, ya conectado a la base y con una clave `JWT_SECRET` generada.

Las tablas se crean solas la primera vez que arranca el servidor.

### 3. Configurar el correo (Brevo)
1. Creá una cuenta gratis en brevo.com (permite 300 correos por día).
2. En **Senders, Domains & Dedicated IPs → Senders**, agregá y verificá el correo que va a figurar como remitente.
3. En **SMTP & API → API Keys**, generá una clave.
4. En Render, en el servicio `afinidad` → **Environment**, completá `BREVO_API_KEY` y `MAIL_FROM` (el remitente verificado).

Se usa la API de Brevo y no SMTP porque Render bloquea los puertos de correo en el plan gratis.

### 4. Configurar el SMS (Twilio Verify)
1. Creá una cuenta en twilio.com.
2. En **Verify → Services**, creá un servicio (por ejemplo "Afinidad") y copiá su **Service SID** (empieza con `VA`).
3. Copiá el **Account SID** y el **Auth Token** de la consola.
4. En Render completá `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_VERIFY_SERVICE_SID`.

Con la cuenta de prueba de Twilio solo podés mandar SMS a números que verificaste en su consola. Para usuarios reales tenés que cargar saldo. Cada verificación tiene costo; revisá el precio para Argentina en twilio.com/verify/pricing.

### 5. Listo
Guardá las variables; Render reinicia el servicio. Abrí la URL `https://afinidad-xxxx.onrender.com`.

## Cosas a tener en cuenta del plan gratis de Render

- **La base de datos gratis vence a los 30 días.** Después hay 14 días para pasarla a un plan pago o se borra con todos los datos. Para usuarios reales usá un plan pago de base de datos.
- **El servicio gratis se duerme** después de 15 minutos sin visitas y tarda cerca de un minuto en despertar.

## Probarla en tu compu

Necesitás Node 20 o más y PostgreSQL.

```bash
npm install
cp .env.example .env      # completá DATABASE_URL y JWT_SECRET
npm run dev
```

Abrí http://localhost:3000. Si no completás Brevo y Twilio, los códigos aparecen en la consola donde corre el servidor (`[DEV] Código ...`), así podés probar el registro completo sin gastar.

## Cambiar las preguntas o el porcentaje

- Las preguntas están en `src/questions.js`. El formulario y el cálculo se arman solos a partir de esa lista. Si cambiás opciones de una pregunta existente, quienes ya respondieron van a tener que actualizar su perfil.
- El porcentaje mínimo es la variable `MATCH_THRESHOLD` (70 por defecto).

## Cómo se calcula la coincidencia

1. Filtros que tienen que cumplirse sí o sí: que cada persona busque el género de la otra y que la edad de cada una esté en el rango que busca la otra.
2. Para cada pregunta se mira si la respuesta de B está entre lo que A acepta, y al revés.
3. El porcentaje es el promedio de las dos direcciones. Ejemplo: si a A le sirven 9 de 10 respuestas de B y a B le sirven 7 de 10 de A, la coincidencia es 80 %.

## Estructura

```
server.js            API y servidor web
src/schema.sql       tablas de la base de datos
src/questions.js     preguntas, géneros y porcentaje mínimo
src/match.js         cálculo de coincidencia
src/notify.js        envío de códigos por correo y SMS
src/db.js            conexión a PostgreSQL
public/              la app (HTML, CSS y JavaScript)
render.yaml          configuración para Render
```

## Para más adelante

- Fotos de perfil (con un servicio de almacenamiento, porque el disco de Render se borra en cada despliegue).
- Notificaciones por correo cuando llega una invitación.
- Un panel para revisar las denuncias (hoy quedan guardadas en la tabla `reports`).
- Recuperar la contraseña por correo.
