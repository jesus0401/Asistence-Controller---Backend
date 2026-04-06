// src/routes/nutrition.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

const MEAL_MAP = { desayuno: "DESAYUNO", media: "MEDIA_MANANA", almuerzo: "ALMUERZO", merienda: "MERIENDA", cena: "CENA" };
const MEAL_MAP_INV = Object.fromEntries(Object.entries(MEAL_MAP).map(([k, v]) => [v, k]));

// GET /api/nutrition/:memberId
router.get("/:memberId", auth, async (req, res) => {
  const days = await prisma.nutritionDay.findMany({
    where: { memberId: +req.params.memberId },
    include: { meals: true },
  });

  // Agrupar igual que el frontend
  const grouped = {};
  for (const day of days) {
    grouped[day.dayOfWeek] = {};
    for (const meal of day.meals) {
      grouped[day.dayOfWeek][MEAL_MAP_INV[meal.mealType]] = {
        food:      meal.food,
        notes:     meal.notes,
        calorias:  meal.calories?.toString(),
        proteinas: meal.proteinG?.toString(),
        carbos:    meal.carbsG?.toString(),
        grasas:    meal.fatsG?.toString(),
      };
    }
  }
  res.json(grouped);
});

// POST /api/nutrition/:memberId/day/:day/meal/:mealId — guardar una comida
router.post("/:memberId/day/:day/meal/:mealId", auth, async (req, res) => {
  const { memberId, day, mealId } = req.params;
  const { food, notes, calorias, proteinas, carbos, grasas } = req.body;
  const mealType = MEAL_MAP[mealId];
  if (!mealType) return res.status(400).json({ error: "Tipo de comida inválido" });

  try {
    // Upsert día
    const nutritionDay = await prisma.nutritionDay.upsert({
      where:  { memberId_dayOfWeek: { memberId: +memberId, dayOfWeek: day } },
      create: { memberId: +memberId, dayOfWeek: day },
      update: {},
    });

    // Upsert comida
    const meal = await prisma.meal.upsert({
      where:  { nutritionDayId_mealType: { nutritionDayId: nutritionDay.id, mealType } },
      create: { nutritionDayId: nutritionDay.id, mealType, food, notes, calories: calorias ? +calorias : null, proteinG: proteinas ? +proteinas : null, carbsG: carbos ? +carbos : null, fatsG: grasas ? +grasas : null },
      update: { food, notes, calories: calorias ? +calorias : null, proteinG: proteinas ? +proteinas : null, carbsG: carbos ? +carbos : null, fatsG: grasas ? +grasas : null },
    });
    res.json(meal);
  } catch (e) {
    res.status(500).json({ error: "Error al guardar comida" });
  }
});

// GET /api/nutrition/public/:memberId — para QR (sin auth)
router.get("/public/:memberId", async (req, res) => {
  const days = await prisma.nutritionDay.findMany({
    where: { memberId: +req.params.memberId },
    include: { meals: true },
  });
  const grouped = {};
  for (const day of days) {
    grouped[day.dayOfWeek] = {};
    for (const meal of day.meals) {
      grouped[day.dayOfWeek][MEAL_MAP_INV[meal.mealType]] = {
        food: meal.food, notes: meal.notes,
        calorias: meal.calories?.toString(), proteinas: meal.proteinG?.toString(),
        carbos: meal.carbsG?.toString(), grasas: meal.fatsG?.toString(),
      };
    }
  }
  res.json(grouped);
});

module.exports = router;
