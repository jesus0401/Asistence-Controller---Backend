// src/routes/portal.js
// ═══════════════════════════════════════════════════════
//  PORTAL DEL MIEMBRO — /api/portal
//  Registro, inicio de sesión y consulta de datos propios.
//  Regla de oro: el miembro SOLO ve sus datos → el id sale del token (req.member.id),
//  nunca de la URL ni del body.
// ═══════════════════════════════════════════════════════
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { memberAuth, signMemberToken } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const { sendPortalCode, isEmailConfigured } = require("../utils/email");

const prisma = new PrismaClient();

const CODE_TTL_MS      = 10 * 60 * 1000;   // 10 minutos
const CODE_COOLDOWN_MS = 60 * 1000;        // 1 código por minuto por correo
const CODE_MAX_TRIES   = 5;

const DAYS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
const MEAL_MAP_INV = { DESAYUNO: "desayuno", MEDIA_MANANA: "media", ALMUERZO: "almuerzo", MERIENDA: "merienda", CENA: "cena" };

// ── Helpers ─────────────────────────────────────────────
const normEmail = e => String(e || "").trim().toLowerCase();
const isEmail   = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const num       = v => (v === null || v === undefined ? null : Number(v));
const limaDay   = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Lima" }); // YYYY-MM-DD

function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "La contraseña debe tener al menos 8 caracteres";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "La contraseña debe tener letras y números";
  if (pw.length > 72) return "La contraseña es demasiado larga";
  return null;
}

async function findMemberByEmail(email) {
  // MySQL compara sin distinguir mayúsculas con la collation por defecto
  return prisma.member.findFirst({ where: { email } });
}

function daysLeftFrom(endDate) {
  const today = new Date(limaDay(new Date()) + "T00:00:00Z");
  const end   = new Date(new Date(endDate).toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((end - today) / 86400000);
}

function shapeMembership(m) {
  if (!m) return null;
  const daysLeft = daysLeftFrom(m.endDate);
  return {
    id: m.id,
    plan: m.plan ? { id: m.plan.id, name: m.plan.name, durationDays: m.plan.durationDays, price: num(m.plan.price) } : null,
    startDate: m.startDate,
    endDate: m.endDate,
    status: m.status === "CANCELADA" ? "CANCELADA" : daysLeft >= 0 ? "ACTIVA" : "VENCIDA",
    daysLeft,
  };
}

function shapeMember(m) {
  return {
    id: m.id, name: m.name, email: m.email, phone: m.phone,
    birthDate: m.birthDate, status: m.status,
    registeredAt: m.registeredAt, memberSince: m.createdAt,
  };
}

async function currentMembership(memberId) {
  const m = await prisma.membership.findFirst({
    where:   { memberId, status: { not: "CANCELADA" } },
    include: { plan: true },
    orderBy: { endDate: "desc" },
  });
  return shapeMembership(m);
}

async function issueCode(email, memberId, purpose) {
  const code = crypto.randomInt(100000, 1000000).toString();
  await prisma.memberAuthCode.updateMany({
    where: { email, purpose, usedAt: null },
    data:  { usedAt: new Date() },           // invalida códigos anteriores
  });
  await prisma.memberAuthCode.create({
    data: { email, memberId, purpose, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

// Devuelve el registro del código si es válido, o lanza un Error con mensaje para el usuario
async function consumeCode(email, purpose, code) {
  const rec = await prisma.memberAuthCode.findFirst({
    where:   { email, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec || rec.expiresAt < new Date()) throw new Error("El código expiró, pide uno nuevo");
  if (rec.attempts >= CODE_MAX_TRIES)     throw new Error("Demasiados intentos, pide un código nuevo");

  const ok = await bcrypt.compare(String(code || "").trim(), rec.codeHash);
  if (!ok) {
    await prisma.memberAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } });
    throw new Error("Código incorrecto");
  }
  await prisma.memberAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return rec;
}

// Solo para pruebas: si no hay SMTP y PORTAL_SHOW_CODES=true, el código vuelve en la respuesta.
// NUNCA activarlo en producción: cualquiera podría tomar la cuenta de otro miembro.
const showCodeOnScreen = () => !isEmailConfigured() && process.env.PORTAL_SHOW_CODES === "true";

async function sessionPayload(member) {
  return {
    token: signMemberToken(member),
    member: shapeMember(member),
    membership: await currentMembership(member.id),
  };
}

// ── Limitadores ─────────────────────────────────────────
const codeLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 8,  message: "Pediste demasiados códigos, intenta en 15 minutos" });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: req => `${req.ip}:${normEmail(req.body?.email)}`, message: "Demasiados intentos de inicio de sesión, espera 15 minutos" });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });

/* ══════════════════════════════════════
   AUTENTICACIÓN (públicas)
══════════════════════════════════════ */

// POST /api/portal/auth/request-code  { email, purpose: "REGISTER" | "RESET" }
router.post("/auth/request-code", codeLimiter, async (req, res) => {
  const email   = normEmail(req.body.email);
  const purpose = req.body.purpose === "RESET" ? "RESET" : "REGISTER";
  if (!isEmail(email)) return res.status(400).json({ error: "Ingresa un correo válido" });

  try {
    const recent = await prisma.memberAuthCode.findFirst({
      where: { email, purpose, createdAt: { gt: new Date(Date.now() - CODE_COOLDOWN_MS) } },
    });
    if (recent) return res.status(429).json({ error: "Espera un minuto antes de pedir otro código" });

    const member = await findMemberByEmail(email);

    if (purpose === "REGISTER") {
      if (member?.password)
        return res.json({ status: "already_registered", message: "Este correo ya tiene cuenta, inicia sesión" });
      if (member && member.status !== "ACTIVO")
        return res.status(403).json({ error: "Tu ficha está inactiva, acércate a recepción" });

      const code = await issueCode(email, member?.id ?? null, purpose);
      await sendPortalCode(email, member?.name, code, purpose);
      return res.json({
        status: "code_sent",
        existingMember: !!member,                 // true → solo pedir contraseña; false → pedir datos
        firstName: member ? member.name.split(" ")[0] : null,
        ...(showCodeOnScreen() ? { devCode: code } : {}),
      });
    }

    // RESET: respuesta genérica para no revelar qué correos tienen cuenta
    let devCode;
    if (member?.password && member.status === "ACTIVO") {
      const code = await issueCode(email, member.id, purpose);
      await sendPortalCode(email, member.name, code, purpose);
      if (showCodeOnScreen()) devCode = code;
    }
    res.json({ status: "code_sent", message: "Si el correo tiene cuenta, te enviamos un código", ...(devCode ? { devCode } : {}) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo enviar el código" });
  }
});

// POST /api/portal/auth/register  { email, code, password, name?, phone?, birthDate? }
router.post("/auth/register", verifyLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  const { code, password } = req.body;
  const pwErr = passwordProblem(password);
  if (!isEmail(email)) return res.status(400).json({ error: "Correo inválido" });
  if (pwErr)           return res.status(400).json({ error: pwErr });

  try {
    let member = await findMemberByEmail(email);
    if (member?.password) return res.status(409).json({ error: "Este correo ya tiene cuenta, inicia sesión" });

    const name = String(req.body.name || "").trim();
    if (!member && name.length < 3) return res.status(400).json({ error: "Ingresa tu nombre completo" });

    await consumeCode(email, "REGISTER", code);
    const hash = await bcrypt.hash(password, 10);
    const now  = new Date();

    if (member) {
      member = await prisma.member.update({
        where: { id: member.id },
        data:  { password: hash, registeredAt: now, lastLoginAt: now },
      });
    } else {
      member = await prisma.member.create({
        data: {
          name, email, password: hash, registeredAt: now, lastLoginAt: now, selfRegistered: true,
          phone:     req.body.phone ? String(req.body.phone).trim().slice(0, 20) : null,
          birthDate: req.body.birthDate ? new Date(req.body.birthDate) : null,
        },
      });
    }
    res.status(201).json(await sessionPayload(member));
  } catch (e) {
    if (e.message && !e.code) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "No se pudo crear la cuenta" });
  }
});

// POST /api/portal/auth/login  { email, password }
router.post("/auth/login", loginLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Correo y contraseña requeridos" });

  try {
    const member = await findMemberByEmail(email);
    if (member && !member.password)
      return res.status(409).json({ error: "Aún no activas tu cuenta. Usa \"Crear cuenta\" con este correo", code: "NOT_ACTIVATED" });
    if (!member || !(await bcrypt.compare(password, member.password)))
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    if (member.status !== "ACTIVO")
      return res.status(403).json({ error: "Tu cuenta está inactiva, acércate a recepción" });

    const updated = await prisma.member.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
    res.json(await sessionPayload(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// POST /api/portal/auth/reset-password  { email, code, newPassword }
router.post("/auth/reset-password", verifyLimiter, async (req, res) => {
  const email = normEmail(req.body.email);
  const pwErr = passwordProblem(req.body.newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const member = await findMemberByEmail(email);
    if (!member?.password) return res.status(400).json({ error: "El código expiró, pide uno nuevo" });
    await consumeCode(email, "RESET", req.body.code);
    const updated = await prisma.member.update({
      where: { id: member.id },
      data:  { password: await bcrypt.hash(req.body.newPassword, 10), lastLoginAt: new Date() },
    });
    res.json(await sessionPayload(updated));
  } catch (e) {
    if (e.message && !e.code) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "No se pudo cambiar la contraseña" });
  }
});

/* ══════════════════════════════════════
   DATOS DEL MIEMBRO (requieren sesión de miembro)
══════════════════════════════════════ */
router.use(memberAuth);

// Verifica en cada request que la cuenta siga activa
router.use(async (req, res, next) => {
  try {
    const m = await prisma.member.findUnique({ where: { id: req.member.id } });
    if (!m || !m.password) return res.status(401).json({ error: "Tu sesión expiró, vuelve a iniciar sesión" });
    if (m.status !== "ACTIVO") return res.status(403).json({ error: "Tu cuenta está inactiva, acércate a recepción" });
    req.memberRecord = m;
    next();
  } catch (e) { next(e); }
});

// GET /api/portal/me — resumen para la pantalla de inicio
router.get("/me", async (req, res) => {
  const id = req.member.id;
  try {
    const [membership, lastMetric, monthVisits, nextRoutineDays] = await Promise.all([
      currentMembership(id),
      prisma.bodyMetric.findFirst({ where: { memberId: id }, orderBy: { recordedAt: "desc" } }),
      prisma.attendance.count({
        where: { memberId: id, entryTime: { gte: new Date(limaDay(new Date()).slice(0, 8) + "01T05:00:00Z") } },
      }),
      prisma.routine.findMany({ where: { memberId: id }, select: { dayOfWeek: true, _count: { select: { items: true } } } }),
    ]);
    res.json({
      member: shapeMember(req.memberRecord),
      membership,
      lastMetric: lastMetric ? { recordedAt: lastMetric.recordedAt, weightKg: num(lastMetric.weightKg), imc: num(lastMetric.imc) } : null,
      monthVisits,
      routineDays: nextRoutineDays.filter(r => r._count.items > 0).map(r => r.dayOfWeek),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al cargar tu información" });
  }
});

// PUT /api/portal/me — el miembro actualiza sus datos de contacto
router.put("/me", async (req, res) => {
  const data = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (name.length < 3) return res.status(400).json({ error: "Ingresa tu nombre completo" });
    data.name = name.slice(0, 100);
  }
  if (req.body.phone !== undefined)     data.phone = req.body.phone ? String(req.body.phone).trim().slice(0, 20) : null;
  if (req.body.birthDate !== undefined) data.birthDate = req.body.birthDate ? new Date(req.body.birthDate) : null;
  try {
    const m = await prisma.member.update({ where: { id: req.member.id }, data });
    res.json(shapeMember(m));
  } catch {
    res.status(500).json({ error: "No se pudo actualizar tu perfil" });
  }
});

// PUT /api/portal/me/password  { currentPassword, newPassword }
router.put("/me/password", async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const pwErr = passwordProblem(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!(await bcrypt.compare(String(currentPassword || ""), req.memberRecord.password)))
    return res.status(400).json({ error: "La contraseña actual no es correcta" });
  await prisma.member.update({ where: { id: req.member.id }, data: { password: await bcrypt.hash(newPassword, 10) } });
  res.json({ message: "Contraseña actualizada" });
});

// GET /api/portal/memberships — historial de planes
router.get("/memberships", async (req, res) => {
  const list = await prisma.membership.findMany({
    where: { memberId: req.member.id }, include: { plan: true }, orderBy: { startDate: "desc" },
  });
  res.json(list.map(shapeMembership));
});

// GET /api/portal/metrics — evolución corporal
router.get("/metrics", async (req, res) => {
  const list = await prisma.bodyMetric.findMany({ where: { memberId: req.member.id }, orderBy: { recordedAt: "asc" } });
  res.json(list.map(m => ({
    id: m.id, recordedAt: m.recordedAt, notes: m.notes,
    weightKg: num(m.weightKg), heightCm: num(m.heightCm), imc: num(m.imc),
    neck: num(m.neck), shoulders: num(m.shoulders), chest: num(m.chest), waist: num(m.waist), hips: num(m.hips),
    bicepRight: num(m.bicepRight), bicepLeft: num(m.bicepLeft), forearm: num(m.forearm),
    thighRight: num(m.thighRight), thighLeft: num(m.thighLeft), calf: num(m.calf),
  })));
});

// GET /api/portal/routines — rutina por día
router.get("/routines", async (req, res) => {
  const routines = await prisma.routine.findMany({
    where:   { memberId: req.member.id },
    include: { items: { include: { exercise: true }, orderBy: { orderIndex: "asc" } } },
  });
  const grouped = Object.fromEntries(DAYS.map(d => [d, []]));
  for (const r of routines) {
    grouped[r.dayOfWeek] = r.items.map(i => ({
      id: i.id, name: i.exercise.name, muscle: i.exercise.muscleGroup, type: i.exercise.exerciseType,
      description: i.exercise.description, sets: i.sets, reps: i.reps, rest: i.restSecs,
    }));
  }
  res.json(grouped);
});

// GET /api/portal/nutrition — plan de alimentación por día
router.get("/nutrition", async (req, res) => {
  const days = await prisma.nutritionDay.findMany({ where: { memberId: req.member.id }, include: { meals: true } });
  const grouped = Object.fromEntries(DAYS.map(d => [d, {}]));
  for (const day of days) {
    for (const meal of day.meals) {
      grouped[day.dayOfWeek][MEAL_MAP_INV[meal.mealType]] = {
        food: meal.food, notes: meal.notes, calories: meal.calories,
        protein: num(meal.proteinG), carbs: num(meal.carbsG), fats: num(meal.fatsG),
      };
    }
  }
  res.json(grouped);
});

// GET /api/portal/attendance — historial y estadísticas de asistencia
router.get("/attendance", async (req, res) => {
  const since = new Date(Date.now() - 180 * 86400000);
  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where: { memberId: req.member.id, entryTime: { gte: since } },
      orderBy: { entryTime: "desc" },
      select: { id: true, entryTime: true, verifiedBy: true },
    }),
    prisma.attendance.count({ where: { memberId: req.member.id } }),
  ]);

  const days     = new Set(records.map(r => limaDay(r.entryTime)));
  const todayStr = limaDay(new Date());
  const monthKey = todayStr.slice(0, 7);
  const weekAgo  = limaDay(Date.now() - 6 * 86400000);

  // Racha: días consecutivos con asistencia (cuenta desde hoy, o desde ayer si hoy aún no vino)
  let streak = 0;
  let cursor = new Date(todayStr + "T12:00:00Z");
  if (!days.has(todayStr)) cursor = new Date(cursor.getTime() - 86400000);
  while (days.has(cursor.toISOString().slice(0, 10))) { streak++; cursor = new Date(cursor.getTime() - 86400000); }

  res.json({
    total,
    thisMonth: [...days].filter(d => d.startsWith(monthKey)).length,
    thisWeek:  [...days].filter(d => d >= weekAgo).length,
    streak,
    days: [...days],                     // para el calendario (últimos 6 meses)
    recent: records.slice(0, 30),
  });
});

// GET /api/portal/receipts — boletas del miembro
router.get("/receipts", async (req, res) => {
  const list = await prisma.receipt.findMany({
    where: { memberId: req.member.id, status: "EMITIDA" },
    orderBy: { issuedAt: "desc" },
    select: { id: true, number: true, concept: true, amount: true, paymentMethod: true, issuedAt: true },
  });
  res.json(list.map(r => ({ ...r, amount: num(r.amount) })));
});

module.exports = router;
module.exports.portalSession = sessionPayload;
module.exports.passwordProblem = passwordProblem;
