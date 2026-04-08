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
  // Peru = UTC-5: medianoche Peru = 5am UTC
  const now = new Date();
  const startOfPeruDay = new Date(now);
  // Si son menos de las 5am UTC, retroceder un día
  if (now.getUTCHours() < 5) {
    startOfPeruDay.setUTCDate(startOfPeruDay.getUTCDate() - 1);
  }
  startOfPeruDay.setUTCHours(5, 0, 0, 0); // medianoche Peru
  const endOfPeruDay = new Date(startOfPeruDay.getTime() + 24 * 60 * 60 * 1000);

  try {
    const records = await prisma.attendance.findMany({
      where: {
        entryTime: { gte: startOfPeruDay, lt: endOfPeruDay }
      },
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
    const now = new Date();
const peruOffset = -5 * 60;
const peruTime = new Date(now.getTime() + (peruOffset - now.getTimezoneOffset()) * 60000);
const today = new Date(peruTime.getFullYear(), peruTime.getMonth(), peruTime.getDate());
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
      const now = new Date();
      const start = new Date(now);
      if (now.getUTCHours() < 5) {
        start.setUTCDate(start.getUTCDate() - 1);
      }
      start.setUTCHours(5, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - i);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

      const count = await prisma.attendance.count({
        where: { entryTime: { gte: start, lt: end } }
      });
      days.push({
        date: start.toLocaleDateString("es-PE", { weekday: "short", timeZone: "America/Lima" }),
        count
      });
    }
    res.json(days);
  } catch { res.status(500).json({ error: "Error al obtener estadísticas" }); }
});

module.exports = router;
