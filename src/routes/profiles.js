// src/routes/profiles.js
const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const auth    = require("../middleware/auth");
const { allowRoles } = require("../middleware/auth");
const prisma  = new PrismaClient();

// GET /api/profiles — solo SUPERADMIN y ADMIN
router.get("/", auth, allowRoles("SUPERADMIN", "ADMIN"), async (_, res) => {
  const users = await prisma.systemUser.findMany({
    select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

// POST /api/profiles — crear usuario del sistema
router.post("/", auth, allowRoles("SUPERADMIN", "ADMIN"), async (req, res) => {
  const { name, email, phone, role, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Nombre, correo y contraseña requeridos" });
  // Solo SUPERADMIN puede crear otro SUPERADMIN
  if (role === "SUPERADMIN" && req.user.role !== "SUPERADMIN")
    return res.status(403).json({ error: "Sin permisos para crear superadmin" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.systemUser.create({
      data: { name, email, phone, role: role ?? "ENTRENADOR", password: hashed },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });
    res.status(201).json(user);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "El correo ya está registrado" });
    res.status(500).json({ error: "Error al crear perfil" });
  }
});

// PUT /api/profiles/:id
router.put("/:id", auth, allowRoles("SUPERADMIN", "ADMIN"), async (req, res) => {
  const { name, email, phone, role, status } = req.body;
  // Proteger el SUPERADMIN de ser degradado por un ADMIN
  if (role && role !== "SUPERADMIN" && req.user.role !== "SUPERADMIN") {
    const target = await prisma.systemUser.findUnique({ where: { id: +req.params.id } });
    if (target?.role === "SUPERADMIN")
      return res.status(403).json({ error: "No puedes modificar al Super Admin" });
  }
  const user = await prisma.systemUser.update({
    where: { id: +req.params.id },
    data: { name, email, phone, role, status },
    select: { id: true, name: true, email: true, phone: true, role: true, status: true },
  });
  res.json(user);
});

// DELETE /api/profiles/:id — solo SUPERADMIN
router.delete("/:id", auth, allowRoles("SUPERADMIN"), async (req, res) => {
  if (+req.params.id === req.user.id)
    return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  await prisma.systemUser.update({ where: { id: +req.params.id }, data: { status: "INACTIVO" } });
  res.json({ message: "Perfil desactivado" });
});

module.exports = router;
