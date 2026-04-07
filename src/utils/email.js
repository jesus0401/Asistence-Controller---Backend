// src/utils/email.js
// Email desactivado temporalmente — Render bloquea SMTP
// El código se muestra en pantalla para el piloto

async function sendVerificationCode(toEmail, memberName, code) {
  console.log(`📧 [SOLGYM] Código para ${memberName} (${toEmail}): ${code}`);
  return { success: true };
}

module.exports = { sendVerificationCode };
