// src/routes/exercises.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

router.get("/", auth, async (req, res) => {
  const { muscle } = req.query;
  const exercises = await prisma.exercise.findMany({
    where: { active: true, ...(muscle ? { muscleGroup: muscle } : {}) },
    orderBy: [{ muscleGroup: "asc" }, { name: "asc" }],
  });
  res.json(exercises);
});

router.post("/", auth, async (req, res) => {
  const { name, muscleGroup, exerciseType, description } = req.body;
  const ex = await prisma.exercise.create({ data: { name, muscleGroup, exerciseType, description } });
  res.status(201).json(ex);
});

router.delete("/:id", auth, async (req, res) => {
  await prisma.exercise.update({ where: { id: +req.params.id }, data: { active: false } });
  res.json({ message: "Ejercicio eliminado" });
});

module.exports = router;
