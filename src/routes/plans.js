// src/routes/plans.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

router.get("/", auth, async (_, res) => {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { price: "asc" } });
  res.json(plans);
});
router.post("/", auth, async (req, res) => {
  const { name, price, durationDays, description } = req.body;
  const plan = await prisma.plan.create({ data: { name, price: +price, durationDays: +durationDays, description } });
  res.status(201).json(plan);
});
router.put("/:id", auth, async (req, res) => {
  const plan = await prisma.plan.update({ where: { id: +req.params.id }, data: req.body });
  res.json(plan);
});
module.exports = router;
