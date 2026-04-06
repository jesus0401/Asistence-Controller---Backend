const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendVerificationCode(toEmail, memberName, code) {
  await resend.emails.send({
    from: "Solgym2829@gmail.com",
    to: toEmail,
    subject: "🏋️ SOLGYM — Código de verificación",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: #F5B800; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: #000; font-size: 28px; letter-spacing: 4px;">SOLGYM</h1>
          <p style="margin: 4px 0 0; color: #000; font-size: 13px;">Sistema de Gestión</p>
        </div>
        <div style="padding: 32px 24px; text-align: center;">
          <p style="color: #aaa; font-size: 14px; margin: 0 0 8px;">Hola, <strong style="color: #fff;">${memberName}</strong></p>
          <p style="color: #aaa; font-size: 14px; margin: 0 0 24px;">Tu código de verificación para registrar asistencia es:</p>
          <div style="background: #222; border: 2px solid #F5B800; border-radius: 12px; padding: 20px; margin: 0 auto 24px; display: inline-block;">
            <span style="color: #F5B800; font-size: 42px; font-weight: 800; letter-spacing: 8px;">${code}</span>
          </div>
          <p style="color: #666; font-size: 12px; margin: 0;">Este código expira en 10 minutos.</p>
          <p style="color: #666; font-size: 12px; margin: 4px 0 0;">Si no solicitaste este código, ignora este mensaje.</p>
        </div>
        <div style="background: #1a1a1a; padding: 16px; text-align: center;">
          <p style="color: #444; font-size: 11px; margin: 0;">SOLGYM 2829 · Sistema de Gestión de Gimnasio</p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendVerificationCode };