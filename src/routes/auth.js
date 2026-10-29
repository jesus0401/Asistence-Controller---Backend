// src/routes/auth.js
const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const auth    = require("../middleware/auth");
const { portalSession } = require("./portal");

const prisma  = new PrismaClient();

// POST /api/auth/login — unificado para staff y miembros
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Correo y contraseña requeridos" });

  try {
    // 1. Buscar primero en usuarios del sistema (staff)
    const systemUser = await prisma.systemUser.findUnique({ where: { email } });
    if (systemUser) {
      if (!(await bcrypt.compare(password, systemUser.password)))
        return res.status(401).json({ error: "Credenciales incorrectas" });
      if (systemUser.status !== "ACTIVO")
        return res.status(403).json({ error: "Cuenta inactiva" });

      const token = jwt.sign(
        { id: systemUser.id, name: systemUser.name, email: systemUser.email, role: systemUser.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );
      return res.json({
        token,
        user: { id: systemUser.id, name: systemUser.name, email: systemUser.email, role: systemUser.role },
      });
    }

    // 2. Si no es staff, buscar en miembros → sesión del PORTAL (token aislado, no sirve en rutas de staff)
    const member = await prisma.member.findFirst({ where: { email: String(email).trim() } });
    if (!member)
      return res.status(401).json({ error: "Credenciales incorrectas" });
    if (!member.password)
      return res.status(409).json({ error: "Aún no activas tu cuenta. Entra a Mi SOLGYM y usa \"Crear cuenta\"", code: "NOT_ACTIVATED" });
    if (!(await bcrypt.compare(password, member.password)))
      return res.status(401).json({ error: "Credenciales incorrectas" });
    if (member.status !== "ACTIVO")
      return res.status(403).json({ error: "Cuenta inactiva" });

    const updated = await prisma.member.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
    return res.json({ portal: true, ...(await portalSession(updated)) });

  } catch (e) {
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// GET /api/auth/me
router.get("/me", auth, async (req, res) => {
  try {
    const user = await prisma.systemUser.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });
    res.json(user);
  } catch {
    res.status(500).json({ error: "Error al obtener perfil" });
  }
});

// PUT /api/auth/change-password
router.put("/change-password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await prisma.systemUser.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(currentPassword, user.password)))
      return res.status(400).json({ error: "Contraseña actual incorrecta" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.systemUser.update({ where: { id: req.user.id }, data: { password: hashed } });
    res.json({ message: "Contraseña actualizada" });
  } catch {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});


module.exports = router;