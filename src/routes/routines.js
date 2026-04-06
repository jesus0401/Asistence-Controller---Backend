// src/routes/routines.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

// GET /api/routines/:memberId — rutina completa del miembro
router.get("/:memberId", auth, async (req, res) => {
  const routines = await prisma.routine.findMany({
    where: { memberId: +req.params.memberId },
    include: {
      items: {
        include: { exercise: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  // Agrupar por día para el frontend
  const grouped = {};
  for (const r of routines) {
    grouped[r.dayOfWeek] = r.items.map(item => ({
      uid:       item.id,
      id:        item.exerciseId,
      name:      item.exercise.name,
      muscle:    item.exercise.muscleGroup,
      type:      item.exercise.exerciseType,
      sets:      item.sets,
      reps:      item.reps,
      rest:      item.restSecs,
    }));
  }
  res.json(grouped);
});

// POST /api/routines/:memberId/day/:day — guardar/actualizar un día completo
router.post("/:memberId/day/:day", auth, async (req, res) => {
  const { memberId, day } = req.params;
  const { exercises } = req.body;   // array de { exerciseId, sets, reps, restSecs }

  try {
    // Upsert rutina del día
    const routine = await prisma.routine.upsert({
      where:  { memberId_dayOfWeek: { memberId: +memberId, dayOfWeek: day } },
      create: { memberId: +memberId, dayOfWeek: day },
      update: {},
    });

    // Borrar items anteriores y crear los nuevos
    await prisma.routineItem.deleteMany({ where: { routineId: routine.id } });
    if (exercises?.length) {
      await prisma.routineItem.createMany({
        data: exercises.map((ex, i) => ({
          routineId: routine.id, exerciseId: +ex.exerciseId,
          sets: +ex.sets, reps: +ex.reps, restSecs: +ex.restSecs, orderIndex: i,
        })),
      });
    }

    res.json({ message: "Rutina guardada", day, count: exercises?.length ?? 0 });
  } catch (e) {
    res.status(500).json({ error: "Error al guardar rutina" });
  }
});

// GET /api/routines/public/:memberId — para página QR (sin auth)
router.get("/public/:memberId", async (req, res) => {
  const routines = await prisma.routine.findMany({
    where: { memberId: +req.params.memberId },
    include: { items: { include: { exercise: true }, orderBy: { orderIndex: "asc" } } },
  });
  const grouped = {};
  for (const r of routines) {
    grouped[r.dayOfWeek] = r.items.map(item => ({
      uid: item.id, id: item.exerciseId,
      name: item.exercise.name, muscle: item.exercise.muscleGroup,
      type: item.exercise.exerciseType,
      sets: item.sets, reps: item.reps, rest: item.restSecs,
    }));
  }
  res.json(grouped);
});

module.exports = router;
