// src/routes/members.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const { sendVerificationCode } = require("../utils/email");

const prisma = new PrismaClient();
const verificationCodes = new Map();

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
    res.json({ message: "Código enviado", code });
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
        ...(search ? { name: { contains: search } } : {}),        
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
          phone:           m.phone,
          birthDate:       m.birthDate,
          status:          m.status,
          plan:            membership?.plan?.name  ?? null,
          planPrice:       membership?.plan?.price ?? null,
          startDate:       membership?.startDate   ?? null,
          endDate:         membership?.endDate     ?? null,
          daysLeft,
          membershipStatus: membership?.status ?? null,
        };
      });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Error al obtener miembros" });
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
    res.json(member);
  } catch {
    res.status(500).json({ error: "Error al obtener miembro" });
  }
});

// POST /api/members — crear miembro + membresía
router.post("/", auth, async (req, res) => {
  const { name, email, phone, birthDate, planId, startDate, endDate } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Nombre y correo requeridos" });
  try {
    const member = await prisma.member.create({
      data: {
        name, email, phone,
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
    res.status(201).json(member);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "El correo ya está registrado" });
    res.status(500).json({ error: "Error al crear miembro" });
  }
});

// PUT /api/members/:id
router.put("/:id", auth, async (req, res) => {
  const { name, email, phone, birthDate, status } = req.body;
  try {
    const member = await prisma.member.update({
      where: { id: +req.params.id },
      data: { name, email, phone, status, birthDate: birthDate ? new Date(birthDate) : undefined },
    });
    res.json(member);
  } catch {
    res.status(500).json({ error: "Error al actualizar miembro" });
  }
});

// POST /api/members/:id/membership — crear o renovar membresía
router.post("/:id/membership", auth, async (req, res) => {
  const { planId, startDate, endDate } = req.body;
  const memberId = +req.params.id;
  try {
    // Cancelar membresía activa anterior
    await prisma.membership.updateMany({
      where: { memberId, status: "ACTIVA" },
      data:  { status: "CANCELADA" },
    });
    // Crear nueva membresía
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

// DELETE /api/members/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    await prisma.member.update({ where: { id: +req.params.id }, data: { status: "INACTIVO" } });
    res.json({ message: "Miembro desactivado" });
  } catch {
    res.status(500).json({ error: "Error al eliminar miembro" });
  }
});

module.exports = router;
