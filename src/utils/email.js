// src/utils/email.js
// Envío de correos.
//  • Si hay SMTP configurado (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM) se envía de verdad.
//    Sirve con AWS SES por SMTP: host email-smtp.us-east-1.amazonaws.com, puerto 587.
//  • Si no hay SMTP, el correo solo se registra en los logs de PM2.
const nodemailer = require("nodemailer");

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   +(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

const isEmailConfigured = () => !!getTransporter();

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`📧 [SOLGYM] (sin SMTP) Para ${to} — ${subject}\n${text}`);
    return { success: true, delivered: false };
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, text });
  return { success: true, delivered: true };
}

function codeTemplate(name, code, intro) {
  const text = `Hola ${name},\n\n${intro}\n\nTu código es: ${code}\n\nVence en 10 minutos. Si no fuiste tú, ignora este correo.\n\nSOLGYM`;
  const html = `
  <div style="font-family:Arial,sans-serif;background:#0A0A0A;padding:32px;color:#fff">
    <div style="max-width:440px;margin:0 auto;background:#181818;border:1px solid #2E2E2E;border-radius:12px;padding:28px">
      <h1 style="color:#F5B800;letter-spacing:3px;margin:0 0 20px;font-size:26px">SOLGYM</h1>
      <p style="color:#ddd;margin:0 0 6px">Hola ${name},</p>
      <p style="color:#aaa;margin:0 0 22px">${intro}</p>
      <div style="background:#222;border-radius:8px;padding:18px;text-align:center;font-size:32px;letter-spacing:10px;color:#F5B800;font-weight:bold">${code}</div>
      <p style="color:#666;font-size:12px;margin:22px 0 0">Vence en 10 minutos. Si no fuiste tú, ignora este correo.</p>
    </div>
  </div>`;
  return { text, html };
}

// Usado por el QR de asistencia (se mantiene igual que antes)
async function sendVerificationCode(toEmail, memberName, code) {
  const { text, html } = codeTemplate(memberName, code, "Usa este código para registrar tu asistencia.");
  return sendMail({ to: toEmail, subject: "SOLGYM — Código de asistencia", text, html });
}

// Usado por el portal del miembro (registro y recuperación de contraseña)
async function sendPortalCode(toEmail, memberName, code, purpose) {
  const intro = purpose === "RESET"
    ? "Recibimos una solicitud para cambiar tu contraseña del portal SOLGYM."
    : "Estás creando tu cuenta en el portal SOLGYM.";
  const subject = purpose === "RESET" ? "SOLGYM — Cambia tu contraseña" : "SOLGYM — Activa tu cuenta";
  const { text, html } = codeTemplate(memberName || "", code, intro);
  return sendMail({ to: toEmail, subject, text, html });
}

module.exports = { sendVerificationCode, sendPortalCode, isEmailConfigured };
