// src/routes/members.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const { allowRoles } = auth;
const bcrypt  = require("bcryptjs");
const { sendVerificationCode } = require("../utils/email");
const { passwordProblem } = require("./portal");
const { lookupDni, isConfigured: dniConfigured } = require("../utils/dni");
const rateLimit = require("../middleware/rateLimit");

// DNI peruano: 8 dígitos. Cadena vacía → null (campo opcional)
const cleanDni = v => (v === undefined ? undefined : v ? String(v).replace(/\D/g, "") : null);
const dniProblem = d => (d && !/^\d{8}$/.test(d) ? "El DNI debe tener 8 dígitos" : null);
const uniqueError = (e, res) => {
  if (e.code !== "P2002") return false;
  const field = String(e.meta?.target || "");
  res.status(409).json({ error: field.includes("dni") ? "Ese DNI ya está registrado en otro miembro" : "El correo ya está registrado" });
  return true;
};

const prisma = new PrismaClient();
const verificationCodes = new Map();

// Nunca devolver el hash de la contraseña del portal; solo si el miembro ya activó su cuenta
const safeMember = ({ password, ...m }) => ({ ...m, hasPortalAccount: !!password });

/* ══════════════════════════════════════
   RUTAS PÚBLICAS (sin JWT) — van primero
══════════════════════════════════════ */

// GET /api/members/public/search
router.get("/public/search", async (req, res) => {
  const { search } = req.query;
  if (!search || search.trim().length < 2) return res.json([]);
  try {
    const members = await prisma.member.findMany({
      where: { status: "ACTIVO", name: { contains: search } },
      include: {
        memberships: {
          where: { status: "ACTIVA" },
          include: { plan: true },
          orderBy: { endDate: "desc" },
          take: 1,
        },
      },
      take: 10,
    });
    const today = new Date();
    const result = members.map(m => {
      const membership = m.memberships[0];
      const daysLeft = membership
        ? Math.ceil((new Date(membership.endDate) - today) / (1000 * 60 * 60 * 24))
        : null;
      return {
        id: m.id, name: m.name, email: m.email,
        plan: membership?.plan?.name ?? null,
        endDate: membership?.endDate ?? null,
        daysLeft,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Error al buscar miembros" });
  }
});

// POST /api/members/public/send-code
router.post("/public/send-code", async (req, res) => {
  const { memberId, email } = req.body;
  if (!memberId || !email)
    return res.status(400).json({ error: "memberId y email requeridos" });
  try {
    const member = await prisma.member.findUnique({ where: { id: +memberId } });
    if (!member) return res.status(404).json({ error: "Miembro no encontrado" });
    if (member.email.toLowerCase() !== email.toLowerCase())
      return res.status(400).json({ error: "El correo no coincide" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes.set(memberId.toString(), {
      code,
      expires: Date.now() + 10 * 60 * 1000,
    });

    await sendVerificationCode(email, member.name, code);
    res.json({ message: "Código enviado al correo", code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al enviar código" });
  }
});

// POST /api/members/public/verify-code
router.post("/public/verify-code", async (req, res) => {
  const { memberId, code } = req.body;
  if (!memberId || !code)
    return res.status(400).json({ error: "memberId y código requeridos" });

  const stored = verificationCodes.get(memberId.toString());
  if (!stored) return res.status(400).json({ error: "Código no encontrado o expirado" });
  if (Date.now() > stored.expires) {
    verificationCodes.delete(memberId.toString());
    return res.status(400).json({ error: "Código expirado" });
  }
  if (stored.code !== code) return res.status(400).json({ error: "Código incorrecto" });

  verificationCodes.delete(memberId.toString());
  res.json({ verified: true });
});

/* ══════════════════════════════════════
   RUTAS PROTEGIDAS (requieren JWT)
══════════════════════════════════════ */

// GET /api/members
router.get("/", auth, async (req, res) => {
  try {
    const { search, plan } = req.query;
    const members = await prisma.member.findMany({
      where: {
        ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { dni: { contains: search } }] } : {}),
      },
      include: {
        memberships: {
          where: { status: "ACTIVA" },
          include: { plan: true },
          orderBy: { endDate: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });

    const today = new Date();
    const result = members
      .filter(m => !plan || m.memberships[0]?.plan?.name === plan)
      .map(m => {
        const membership = m.memberships[0];
        const daysLeft = membership
          ? Math.ceil((new Date(membership.endDate) - today) / (1000 * 60 * 60 * 24))
          : null;
        return {
          id:              m.id,
          name:            m.name,
          email:           m.email,
          dni:             m.dni,
          phone:           m.phone,
          birthDate:       m.birthDate,
          status:          m.status,
          plan:            membership?.plan?.name  ?? null,
          planPrice:       membership?.plan?.price ?? null,
          startDate:       membership?.startDate   ?? null,
          endDate:         membership?.endDate     ?? null,
          daysLeft,
          membershipStatus: membership?.status ?? null,
          hasPortalAccount: !!m.password,
          lastLoginAt:      m.lastLoginAt ?? null,
        };
      });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener miembros" });
  }
});

// GET /api/members/dni/:dni — autocompletar nombre por DNI (solo staff)
router.get("/dni/:dni", auth, rateLimit({ windowMs: 60 * 1000, max: 20, key: req => req.user.id }), async (req, res) => {
  const dni = String(req.params.dni).replace(/\D/g, "");
  if (!/^\d{8}$/.test(dni)) return res.status(400).json({ error: "El DNI debe tener 8 dígitos" });
  try {
    const existing = await prisma.member.findUnique({ where: { dni }, select: { id: true, name: true } });
    if (!dniConfigured()) return res.status(503).json({ error: "La consulta de DNI no está configurada", existing });
    const person = await lookupDni(dni);
    if (!person) return res.status(404).json({ error: "No se encontró ese DNI", existing });
    res.json({ dni, ...person, existing });
  } catch (e) {
    console.error("DNI:", e.message);
    res.status(e.status || 502).json({ error: e.status ? e.message : "No se pudo consultar el DNI, ingresa el nombre a mano" });
  }
});

// GET /api/members/:id
router.get("/:id", auth, async (req, res) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: +req.params.id },
      include: {
        memberships: { include: { plan: true }, orderBy: { startDate: "desc" } },
        attendances: { orderBy: { entryTime: "desc" }, take: 10 },
        bodyMetrics: { orderBy: { recordedAt: "desc" } },
      },
    });
    if (!member) return res.status(404).json({ error: "Miembro no encontrado" });
    res.json(safeMember(member));
  } catch {
    res.status(500).json({ error: "Error al obtener miembro" });
  }
});

// POST /api/members
router.post("/", auth, async (req, res) => {
  const { name, email, phone, birthDate, planId, startDate, endDate } = req.body;
  const dni = cleanDni(req.body.dni);
  if (!name || !email) return res.status(400).json({ error: "Nombre y correo requeridos" });
  if (dniProblem(dni)) return res.status(400).json({ error: dniProblem(dni) });
  try {
    const member = await prisma.member.create({
      data: {
        name, email, phone, dni: dni || null,
        birthDate: birthDate ? new Date(birthDate) : null,
        ...(planId && startDate && endDate ? {
          memberships: {
            create: {
              planId:    +planId,
              startDate: new Date(startDate),
              endDate:   new Date(endDate),
              status:    new Date(endDate) >= new Date() ? "ACTIVA" : "VENCIDA",
            },
          },
        } : {}),
      },
      include: { memberships: { include: { plan: true } } },
    });
    res.status(201).json(safeMember(member));
  } catch (e) {
    if (uniqueError(e, res)) return;
    res.status(500).json({ error: "Error al crear miembro" });
  }
});

// PUT /api/members/:id
router.put("/:id", auth, async (req, res) => {
  const { name, email, phone, birthDate, status } = req.body;
  const dni = cleanDni(req.body.dni);
  if (dniProblem(dni)) return res.status(400).json({ error: dniProblem(dni) });
  try {
    const member = await prisma.member.update({
      where: { id: +req.params.id },
      data: { name, email, phone, status, dni, birthDate: birthDate ? new Date(birthDate) : undefined },
    });
    res.json(safeMember(member));
  } catch (e) {
    if (uniqueError(e, res)) return;
    res.status(500).json({ error: "Error al actualizar miembro" });
  }
});

// POST /api/members/:id/membership — crear o renovar membresía
router.post("/:id/membership", auth, async (req, res) => {
  const { planId, startDate, endDate } = req.body;
  const memberId = +req.params.id;
  try {
    await prisma.membership.updateMany({
      where: { memberId, status: "ACTIVA" },
      data:  { status: "CANCELADA" },
    });
    const membership = await prisma.membership.create({
      data: {
        memberId,
        planId:    +planId,
        startDate: new Date(startDate),
        endDate:   new Date(endDate),
        status:    new Date(endDate) >= new Date() ? "ACTIVA" : "VENCIDA",
      },
      include: { plan: true },
    });
    res.status(201).json(membership);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al actualizar membresía" });
  }
});

// DELETE /api/members/:id — desactivar (soft delete)
router.delete("/:id", auth, async (req, res) => {
  try {
    await prisma.member.update({ where: { id: +req.params.id }, data: { status: "INACTIVO" } });
    res.json({ message: "Miembro desactivado" });
  } catch {
    res.status(500).json({ error: "Error al desactivar miembro" });
  }
});

// DELETE /api/members/:id/permanent — eliminar físicamente
router.delete("/:id/permanent", auth, async (req, res) => {
  try {
    const id = +req.params.id;
    await prisma.attendance.deleteMany({ where: { memberId: id } });
    await prisma.membership.deleteMany({ where: { memberId: id } });
    await prisma.bodyMetric.deleteMany({ where: { memberId: id } });
    await prisma.routineItem.deleteMany({ where: { routine: { memberId: id } } });
    await prisma.routine.deleteMany({ where: { memberId: id } });
    await prisma.meal.deleteMany({ where: { nutritionDay: { memberId: id } } });
    await prisma.nutritionDay.deleteMany({ where: { memberId: id } });
    await prisma.member.delete({ where: { id } });
    res.json({ message: "Miembro eliminado permanentemente" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al eliminar miembro" });
  }
});

// POST /api/members/:id/set-password — el staff le asigna contraseña del portal
// (útil para miembros que no usan correo). Solo SUPERADMIN, ADMIN y RECEPCION.
router.post("/:id/set-password", auth, allowRoles("SUPERADMIN", "ADMIN", "RECEPCION"), async (req, res) => {
  const { password } = req.body;
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const m = await prisma.member.findUnique({ where: { id: +req.params.id } });
    if (!m) return res.status(404).json({ error: "Miembro no encontrado" });
    await prisma.member.update({
      where: { id: m.id },
      data: { password: hashed, registeredAt: m.registeredAt ?? new Date() },
    });
    res.json({ message: "Contraseña establecida" });
  } catch {
    res.status(500).json({ error: "Error al establecer contraseña" });
  }
});

module.exports = router;