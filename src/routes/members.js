// src/routes/members.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth   = require("../middleware/auth");

const prisma = new PrismaClient();

// GET /api/members — listar todos con su membresía activa
router.get("/", auth, async (req, res) => {
  try {
    const { search, plan } = req.query;
    const members = await prisma.member.findMany({
      where: {
        ...(search ? { name: { contains: search } } : {}),
        status: "ACTIVO",
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

    // Calcular días restantes y formatear
    const today = new Date();
    const result = members
      .filter(m => !plan || m.memberships[0]?.plan?.name === plan)
      .map(m => {
        const membership = m.memberships[0];
        const daysLeft   = membership
          ? Math.ceil((new Date(membership.endDate) - today) / (1000 * 60 * 60 * 24))
          : null;
        return {
          id:         m.id,
          name:       m.name,
          email:      m.email,
          phone:      m.phone,
          birthDate:  m.birthDate,
          status:     m.status,
          plan:       membership?.plan?.name ?? null,
          planPrice:  membership?.plan?.price ?? null,
          startDate:  membership?.startDate ?? null,
          endDate:    membership?.endDate ?? null,
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
            create: { planId: +planId, startDate: new Date(startDate), endDate: new Date(endDate) },
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
