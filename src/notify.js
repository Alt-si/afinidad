// Envío de códigos por correo (Brevo, API HTTP) y por SMS (Twilio Verify).
// Si faltan las claves, el código se escribe en el log del servidor: sirve para
// probar en tu compu, pero en producción tenés que configurar los dos servicios.
//
// Se usa la API HTTP de Brevo y no SMTP porque Render bloquea los puertos SMTP
// en los servicios gratuitos.

const BREVO_KEY = process.env.BREVO_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;             // un remitente verificado en Brevo
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Afinidad';

const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_VERIFY = process.env.TWILIO_VERIFY_SERVICE_SID;

const emailEnabled = Boolean(BREVO_KEY && MAIL_FROM);
const smsViaTwilio = Boolean(TW_SID && TW_TOKEN && TW_VERIFY);

async function sendEmailCode(to, code) {
  if (!emailEnabled) {
    console.log(`[DEV] Código de correo para ${to}: ${code}`);
    return;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: MAIL_FROM_NAME, email: MAIL_FROM },
      to: [{ email: to }],
      subject: `Tu código de Afinidad: ${code}`,
      htmlContent: `<p>Hola,</p><p>Tu código para verificar el correo en Afinidad es:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
        <p>Vence en 10 minutos. Si no creaste una cuenta, ignorá este mensaje.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${await res.text()}`);
}

function twilioAuth() {
  return 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');
}

// Con Twilio Verify, Twilio genera y controla el código: no guardamos nada.
async function twilioStart(phone) {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${TW_VERIFY}/Verifications`, {
    method: 'POST',
    headers: { authorization: twilioAuth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Channel: 'sms', Locale: 'es' }),
  });
  if (!res.ok) throw new Error(`Twilio respondió ${res.status}: ${await res.text()}`);
}

async function twilioCheck(phone, code) {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${TW_VERIFY}/VerificationCheck`, {
    method: 'POST',
    headers: { authorization: twilioAuth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, Code: code }),
  });
  if (res.status === 404) return false; // código vencido o ya usado
  if (!res.ok) throw new Error(`Twilio respondió ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.status === 'approved';
}

function logSmsCode(phone, code) {
  console.log(`[DEV] Código SMS para ${phone}: ${code}`);
}

module.exports = { sendEmailCode, twilioStart, twilioCheck, logSmsCode, emailEnabled, smsViaTwilio };
