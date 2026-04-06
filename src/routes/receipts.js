// src/routes/receipts.js
const router = require("express").Router();
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const prisma = new PrismaClient();

// GET /api/receipts
router.get("/", auth, async (req, res) => {
  const { status, search } = req.query;
  const receipts = await prisma.receipt.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(search ? { clientName: { contains: search } } : {}),
    },
    include: { issuedBy: { select: { name: true } } },
    orderBy: { issuedAt: "desc" },
  });
  res.json(receipts);
});

// POST /api/receipts — emitir boleta
router.post("/", auth, async (req, res) => {
  const { memberId, clientName, concept, amount, paymentMethod, notes } = req.body;
  if (!clientName || !concept || !amount)
    return res.status(400).json({ error: "Cliente, concepto y monto son requeridos" });

  try {
    const count  = await prisma.receipt.count();
    const number = `B001-${String(count + 1).padStart(3, "0")}`;
    const amountNum  = +amount;
    const igv        = +(amountNum * 0.18).toFixed(2);
    const subtotal   = +(amountNum - igv).toFixed(2);

    const receipt = await prisma.receipt.create({
      data: {
        number, clientName, concept,
        amount: amountNum, igv, subtotal,
        paymentMethod: paymentMethod ?? "EFECTIVO",
        notes, issuedById: req.user.id,
        ...(memberId ? { memberId: +memberId } : {}),
      },
    });
    res.status(201).json(receipt);
  } catch { res.status(500).json({ error: "Error al emitir boleta" }); }
});

// PUT /api/receipts/:id/annul — anular boleta
router.put("/:id/annul", auth, async (req, res) => {
  const receipt = await prisma.receipt.update({
    where: { id: +req.params.id },
    data: { status: "ANULADA" },
  });
  res.json(receipt);
});

// GET /api/receipts/stats — resumen para dashboard
router.get("/stats", auth, async (req, res) => {
  const [total, count, annulled] = await Promise.all([
    prisma.receipt.aggregate({ where: { status: "EMITIDA" }, _sum: { amount: true } }),
    prisma.receipt.count({ where: { status: "EMITIDA" } }),
    prisma.receipt.count({ where: { status: "ANULADA" } }),
  ]);
  res.json({ totalAmount: total._sum.amount ?? 0, totalIssued: count, totalAnnulled: annulled });
});

module.exports = router;
