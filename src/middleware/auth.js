// src/middleware/auth.js
// Dos tipos de sesión conviven en la API:
//   • Staff  (system_users)  → tokens sin "type", rutas /api/* existentes
//   • Miembro (members)      → tokens con type:"member" y aud:"solgym-member", rutas /api/portal/*
// Un token de miembro NUNCA debe pasar por el middleware de staff, y viceversa.
const jwt = require("jsonwebtoken");

const MEMBER_AUDIENCE = "solgym-member";

function readBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.split(" ")[1];
}

// ── Staff (admins, entrenadores, recepción) ─────────────
module.exports = (req, res, next) => {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: "Token requerido" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === "member" || payload.aud === MEMBER_AUDIENCE)
      return res.status(403).json({ error: "Acceso solo para personal del gimnasio" });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
};

// Middleware de roles: allowRoles("SUPERADMIN", "ADMIN")
module.exports.allowRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res.status(403).json({ error: "Sin permisos para esta acción" });
  next();
};

// ── Miembros del gym (portal) ───────────────────────────
module.exports.memberAuth = (req, res, next) => {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: "Inicia sesión para continuar" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { audience: MEMBER_AUDIENCE });
    if (payload.type !== "member") throw new Error("not a member token");
    req.member = { id: +payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: "Tu sesión expiró, vuelve a iniciar sesión" });
  }
};

module.exports.signMemberToken = (member) =>
  jwt.sign(
    { type: "member", email: member.email, name: member.name },
    process.env.JWT_SECRET,
    {
      subject:   String(member.id),
      audience:  MEMBER_AUDIENCE,
      expiresIn: process.env.MEMBER_JWT_EXPIRES_IN || "7d",
    }
  );
