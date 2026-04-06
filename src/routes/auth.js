// src/routes/auth.js
const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const auth    = require("../middleware/auth");

const prisma  = new PrismaClient();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Correo y contraseña requeridos" });

  try {
    const user = await prisma.systemUser.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Credenciales incorrectas" });

    if (user.status !== "ACTIVO")
      return res.status(403).json({ error: "Cuenta inactiva" });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
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