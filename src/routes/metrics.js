// src/routes/metrics.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

// GET /api/metrics/:memberId
router.get("/:memberId", auth, async (req, res) => {
  const metrics = await prisma.bodyMetric.findMany({
    where: { memberId: +req.params.memberId },
    orderBy: { recordedAt: "desc" },
  });
  res.json(metrics);
});

// POST /api/metrics
router.post("/", auth, async (req, res) => {
  const { memberId, weightKg, heightCm, neck, shoulders, chest, waist, hips,
    bicepRight, bicepLeft, forearm, thighRight, thighLeft, calf, notes } = req.body;

  // Calcular IMC automáticamente
  let imc = null;
  if (weightKg && heightCm) {
    const m = heightCm / 100;
    imc = +(weightKg / (m * m)).toFixed(2);
  }

  const metric = await prisma.bodyMetric.create({
    data: {
      memberId: +memberId, weightKg: weightKg ? +weightKg : null,
      heightCm: heightCm ? +heightCm : null, imc,
      neck: neck ? +neck : null, shoulders: shoulders ? +shoulders : null,
      chest: chest ? +chest : null, waist: waist ? +waist : null,
      hips: hips ? +hips : null, bicepRight: bicepRight ? +bicepRight : null,
      bicepLeft: bicepLeft ? +bicepLeft : null, forearm: forearm ? +forearm : null,
      thighRight: thighRight ? +thighRight : null, thighLeft: thighLeft ? +thighLeft : null,
      calf: calf ? +calf : null, notes,
    },
  });
  res.status(201).json(metric);
});

module.exports = router;
