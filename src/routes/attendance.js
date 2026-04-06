// src/routes/attendance.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

// GET /api/attendance — historial (con filtro de fecha)
router.get("/", auth, async (req, res) => {
  const { date, memberId } = req.query;
  try {
    const records = await prisma.attendance.findMany({
      where: {
        ...(memberId ? { memberId: +memberId } : {}),
        ...(date ? { date: new Date(date) } : {}),
      },
      include: { member: { select: { id: true, name: true, email: true } } },
      orderBy: { entryTime: "desc" },
      take: 100,
    });
    res.json(records);
  } catch { res.status(500).json({ error: "Error al obtener asistencias" }); }
});

// GET /api/attendance/today — asistencias de hoy
router.get("/today", auth, async (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  try {
    const records = await prisma.attendance.findMany({
      where: { date: today },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { entryTime: "desc" },
    });
    res.json({ count: records.length, records });
  } catch { res.status(500).json({ error: "Error al obtener asistencias de hoy" }); }
});

// POST /api/attendance — registrar asistencia
router.post("/", async (req, res) => {
  // No requiere auth para que el QR público pueda llamarlo
  const { memberId, verifiedBy = "qr" } = req.body;
  if (!memberId) return res.status(400).json({ error: "memberId requerido" });
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const record = await prisma.attendance.create({
      data: { memberId: +memberId, date: today, verifiedBy },
      include: { member: { select: { id: true, name: true } } },
    });
    res.status(201).json(record);
  } catch { res.status(500).json({ error: "Error al registrar asistencia" }); }
});

// GET /api/attendance/stats — datos para gráfico del dashboard
router.get("/stats", auth, async (req, res) => {
  try {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const count = await prisma.attendance.count({ where: { date: d } });
      days.push({ date: d.toLocaleDateString("es-PE", { weekday: "short" }), count });
    }
    res.json(days);
  } catch { res.status(500).json({ error: "Error al obtener estadísticas" }); }
});

module.exports = router;
