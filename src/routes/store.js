// src/routes/store.js
// ═══════════════════════════════════════════════════════
//  TIENDA — /api/store
//  Catálogo, imágenes, código de barras, stock, ventas y exportación a Excel.
//  Solo personal del gym (los tokens de miembro no pasan por `auth`).
// ═══════════════════════════════════════════════════════
const router  = require("express").Router();
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const multer  = require("multer");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const auth = require("../middleware/auth");
const { allowRoles } = auth;

const prisma = new PrismaClient();

const CATALOG = allowRoles("SUPERADMIN", "ADMIN", "RECEPCION");   // crear/editar productos y stock
const MANAGER = allowRoles("SUPERADMIN", "ADMIN");                // anular ventas, exportar, desactivar
const PAYMENT_METHODS = ["EFECTIVO", "YAPE", "PLIN", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO"];

const UPLOAD_DIR = path.join(__dirname, "../../uploads/products");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────
const num   = v => (v === null || v === undefined ? null : Number(v));
const money = v => Math.round(Number(v) * 100) / 100;
const str   = (v, max) => (v === undefined ? undefined : v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

function shapeProduct(p) {
  return {
    ...p, price: num(p.price), cost: num(p.cost),
    stockStatus: p.stock <= 0 ? "AGOTADO" : p.stock <= p.minStock ? "BAJO" : "OK",
  };
}

// Rango de fechas en hora de Lima. from/to = "YYYY-MM-DD" (to incluido)
function limaRange(from, to) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : today.slice(0, 8) + "01";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : today;
  const start = new Date(`${f}T05:00:00Z`);
  const end   = new Date(new Date(`${t}T05:00:00Z`).getTime() + 86400000);
  return { from: f, to: t, start, end };
}
const limaDateTime = d => new Date(d).toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function validateProduct(body, partial = false) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = str(body.name, 150);
    if (!name || name.length < 2) return { error: "El nombre es obligatorio" };
    data.name = name;
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return { error: "Precio inválido" };
    data.price = money(price);
  }
  if (body.cost !== undefined) {
    if (body.cost === null || body.cost === "") data.cost = null;
    else { const c = Number(body.cost); if (!Number.isFinite(c) || c < 0) return { error: "Costo inválido" }; data.cost = money(c); }
  }
  if (body.barcode !== undefined) {
    const b = str(body.barcode, 50);
    if (b && !/^[0-9A-Za-z\-.]{4,50}$/.test(b)) return { error: "Código de barras inválido" };
    data.barcode = b;
  }
  if (body.category !== undefined)    data.category = str(body.category, 60) || "General";
  if (body.brand !== undefined)       data.brand = str(body.brand, 80);
  if (body.description !== undefined) data.description = str(body.description, 500);
  if (body.minStock !== undefined) {
    const m = parseInt(body.minStock, 10);
    if (!Number.isInteger(m) || m < 0) return { error: "Stock mínimo inválido" };
    data.minStock = m;
  }
  if (body.imageUrl !== undefined) {
    const u = str(body.imageUrl, 500);
    if (u && !/^https:\/\/\S+$/i.test(u) && !u.startsWith("/uploads/")) return { error: "La imagen debe ser un enlace https" };
    data.imageUrl = u;
  }
  if (body.active !== undefined) data.active = !!body.active;
  return { data };
}

const productConflict = (e, res) => {
  if (e.code !== "P2002") return false;
  res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  return true;
};

/* ══════════════════════════════════════
   PRODUCTOS
══════════════════════════════════════ */

// GET /api/store/products?search=&category=&stock=low|out&inactive=1
router.get("/products", auth, async (req, res) => {
  const { search, category, stock, inactive } = req.query;
  try {
    const list = await prisma.product.findMany({
      where: {
        ...(inactive === "1" ? {} : { active: true }),
        ...(category ? { category } : {}),
        ...(search ? { OR: [{ name: { contains: search } }, { brand: { contains: search } }, { barcode: { contains: search } }] } : {}),
      },
      orderBy: { name: "asc" },
    });
    let out = list.map(shapeProduct);
    if (stock === "low") out = out.filter(p => p.stockStatus !== "OK");
    if (stock === "out") out = out.filter(p => p.stockStatus === "AGOTADO");
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al obtener productos" }); }
});

// GET /api/store/categories
router.get("/categories", auth, async (_, res) => {
  const list = await prisma.product.findMany({ where: { active: true }, select: { category: true } });
  res.json([...new Set(list.map(p => p.category))].sort());
});

// GET /api/store/products/barcode/:code — primero en el catálogo; si no está, sugerencia de Open Food Facts
router.get("/products/barcode/:code", auth, async (req, res) => {
  const code = String(req.params.code).trim();
  if (!/^[0-9A-Za-z\-.]{4,50}$/.test(code)) return res.status(400).json({ error: "Código inválido" });
  try {
    const product = await prisma.product.findUnique({ where: { barcode: code } });
    if (product) return res.json({ found: true, product: shapeProduct(product) });
    const suggestion = /^\d{8,14}$/.test(code) ? await openFoodFacts(code) : null;
    res.status(404).json({ found: false, barcode: code, suggestion });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al buscar el código" }); }
});

async function openFoodFacts(code) {
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_es,generic_name_es,brands,image_front_url,image_url,categories_tags,quantity`,
      { headers: { "User-Agent": "SOLGYM/1.0 (gestion de gimnasio)" }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = [p.product_name_es || p.product_name || p.generic_name_es, p.quantity].filter(Boolean).join(" ").trim();
    if (!name) return null;
    return {
      name: name.slice(0, 150),
      brand: (p.brands || "").split(",")[0].trim() || null,
      imageUrl: p.image_front_url || p.image_url || null,
      source: "Open Food Facts",
    };
  } catch { return null; }
}

// GET /api/store/products/:id
router.get("/products/:id", auth, async (req, res) => {
  const p = await prisma.product.findUnique({ where: { id: +req.params.id } });
  if (!p) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(shapeProduct(p));
});

// POST /api/store/products  (stock inicial opcional → movimiento ENTRADA)
router.post("/products", auth, CATALOG, async (req, res) => {
  const { data, error } = validateProduct(req.body);
  if (error) return res.status(400).json({ error });
  const initial = parseInt(req.body.stock ?? 0, 10);
  if (!Number.isInteger(initial) || initial < 0) return res.status(400).json({ error: "Stock inicial inválido" });
  try {
    const product = await prisma.$transaction(async tx => {
      const p = await tx.product.create({ data: { ...data, stock: initial } });
      if (initial > 0) await tx.stockMovement.create({ data: { productId: p.id, type: "ENTRADA", quantity: initial, stockAfter: initial, note: "Stock inicial", userId: req.user.id } });
      return p;
    });
    res.status(201).json(shapeProduct(product));
  } catch (e) {
    if (productConflict(e, res)) return;
    console.error(e); res.status(500).json({ error: "Error al crear producto" });
  }
});

// PUT /api/store/products/:id  (el stock NO se edita aquí: usa /stock para dejar registro)
router.put("/products/:id", auth, CATALOG, async (req, res) => {
  const { data, error } = validateProduct(req.body, true);
  if (error) return res.status(400).json({ error });
  if (data.active === false && !["SUPERADMIN", "ADMIN"].includes(req.user.role))
    return res.status(403).json({ error: "Solo un administrador puede desactivar productos" });
  try {
    const p = await prisma.product.update({ where: { id: +req.params.id }, data });
    res.json(shapeProduct(p));
  } catch (e) {
    if (productConflict(e, res)) return;
    if (e.code === "P2025") return res.status(404).json({ error: "Producto no encontrado" });
    console.error(e); res.status(500).json({ error: "Error al actualizar producto" });
  }
});

// DELETE /api/store/products/:id — desactivar (se conserva para el historial de ventas)
router.delete("/products/:id", auth, MANAGER, async (req, res) => {
  try {
    await prisma.product.update({ where: { id: +req.params.id }, data: { active: false } });
    res.json({ message: "Producto desactivado" });
  } catch { res.status(404).json({ error: "Producto no encontrado" }); }
});

// POST /api/store/products/:id/image — subir foto (jpg, png, webp; máx. 5 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
function imageExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}
router.post("/products/:id/image", auth, CATALOG, (req, res, next) => {
  upload.single("image")(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "La imagen supera 5 MB" : "No se pudo leer la imagen" });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Adjunta una imagen" });
  const ext = imageExt(req.file.buffer);       // se valida el contenido real, no solo la extensión
  if (!ext) return res.status(400).json({ error: "Formato no permitido (usa JPG, PNG o WEBP)" });
  try {
    const product = await prisma.product.findUnique({ where: { id: +req.params.id } });
    if (!product) return res.status(404).json({ error: "Producto no encontrado" });
    const file = `${product.id}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, file), req.file.buffer);
    // borrar la foto anterior si era nuestra
    if (product.imageUrl?.startsWith("/uploads/products/"))
      fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(product.imageUrl))).catch(() => {});
    const p = await prisma.product.update({ where: { id: product.id }, data: { imageUrl: `/uploads/products/${file}` } });
    res.json(shapeProduct(p));
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al guardar la imagen" }); }
});

/* ══════════════════════════════════════
   STOCK
══════════════════════════════════════ */

// POST /api/store/products/:id/stock  { type: "ENTRADA" | "AJUSTE", quantity, note }
//   ENTRADA: quantity > 0 se suma.   AJUSTE: quantity = stock real contado (fija el valor).
router.post("/products/:id/stock", auth, CATALOG, async (req, res) => {
  const type = req.body.type === "AJUSTE" ? "AJUSTE" : "ENTRADA";
  const qty  = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(qty) || qty < 0 || (type === "ENTRADA" && qty === 0))
    return res.status(400).json({ error: type === "ENTRADA" ? "Ingresa una cantidad mayor a 0" : "Ingresa el stock contado" });
  const note = str(req.body.note, 255) ?? null;
  if (type === "AJUSTE" && !note) return res.status(400).json({ error: "Indica el motivo del ajuste (merma, conteo, vencido...)" });

  try {
    const p = await prisma.$transaction(async tx => {
      const cur = await tx.product.findUnique({ where: { id: +req.params.id } });
      if (!cur) throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
      const after = type === "ENTRADA" ? cur.stock + qty : qty;
      const updated = await tx.product.update({ where: { id: cur.id }, data: { stock: after } });
      await tx.stockMovement.create({ data: { productId: cur.id, type, quantity: after - cur.stock, stockAfter: after, note, userId: req.user.id } });
      return updated;
    });
    res.json(shapeProduct(p));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e); res.status(500).json({ error: "Error al actualizar stock" });
  }
});

// GET /api/store/products/:id/movements
router.get("/products/:id/movements", auth, async (req, res) => {
  const list = await prisma.stockMovement.findMany({
    where: { productId: +req.params.id }, orderBy: { createdAt: "desc" }, take: 100,
    include: { user: { select: { name: true } }, sale: { select: { number: true } } },
  });
  res.json(list);
});

/* ══════════════════════════════════════
   VENTAS
══════════════════════════════════════ */

// POST /api/store/sales
// { items: [{ productId, quantity }], paymentMethod, memberId?, clientName?, notes?, emitReceipt? }
// El precio SIEMPRE sale de la base de datos, nunca del navegador.
router.post("/sales", auth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const merged = new Map();
  for (const it of items) {
    const id = parseInt(it.productId, 10), q = parseInt(it.quantity, 10);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q <= 0 || q > 999) return res.status(400).json({ error: "Cantidad inválida en el carrito" });
    merged.set(id, (merged.get(id) || 0) + q);
  }
  if (!merged.size) return res.status(400).json({ error: "El carrito está vacío" });
  const paymentMethod = PAYMENT_METHODS.includes(req.body.paymentMethod) ? req.body.paymentMethod : "EFECTIVO";
  const memberId = req.body.memberId ? parseInt(req.body.memberId, 10) : null;

  try {
    const sale = await prisma.$transaction(async tx => {
      let clientName = str(req.body.clientName, 100) || "Cliente";
      if (memberId) {
        const m = await tx.member.findUnique({ where: { id: memberId }, select: { name: true } });
        if (!m) throw Object.assign(new Error("Miembro no encontrado"), { status: 400 });
        clientName = m.name;
      }

      const lines = [];
      for (const [productId, quantity] of merged) {
        const p = await tx.product.findUnique({ where: { id: productId } });
        if (!p || !p.active) throw Object.assign(new Error("Uno de los productos ya no está disponible"), { status: 400 });
        // descuento atómico: solo si alcanza el stock (evita vender lo que no hay si dos cajas venden a la vez)
        const dec = await tx.product.updateMany({ where: { id: productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (dec.count === 0) throw Object.assign(new Error(`Stock insuficiente de "${p.name}" (quedan ${p.stock})`), { status: 409 });
        lines.push({ p, quantity, unitPrice: money(p.price), subtotal: money(Number(p.price) * quantity), stockAfter: p.stock - quantity });
      }
      const total = money(lines.reduce((a, l) => a + l.subtotal, 0));

      const created = await tx.sale.create({
        data: {
          number: `TMP-${crypto.randomUUID()}`.slice(0, 20), memberId, clientName, total, paymentMethod,
          notes: str(req.body.notes, 300) ?? null, soldById: req.user.id,
          items: { create: lines.map(l => ({ productId: l.p.id, productName: l.p.name, unitPrice: l.unitPrice, quantity: l.quantity, subtotal: l.subtotal })) },
        },
      });
      const number = `V-${String(created.id).padStart(6, "0")}`;

      for (const l of lines)
        await tx.stockMovement.create({ data: { productId: l.p.id, type: "VENTA", quantity: -l.quantity, stockAfter: l.stockAfter, saleId: created.id, userId: req.user.id, note: number } });

      // Boleta opcional (mismo esquema de numeración e IGV que el módulo de Boletas)
      let receiptId = null;
      if (req.body.emitReceipt) {
        const count = await tx.receipt.count();
        const igv = money(total * 0.18);
        const receipt = await tx.receipt.create({
          data: {
            number: `B001-${String(count + 1).padStart(3, "0")}`, clientName,
            concept: `Tienda ${number}: ${lines.map(l => `${l.quantity}× ${l.p.name}`).join(", ")}`.slice(0, 200),
            amount: total, igv, subtotal: money(total - igv), paymentMethod,
            issuedById: req.user.id, ...(memberId ? { memberId } : {}),
          },
        });
        receiptId = receipt.id;
      }

      return tx.sale.update({
        where: { id: created.id }, data: { number, receiptId },
        include: { items: true, receipt: { select: { number: true } } },
      });
    });
    res.status(201).json(shapeSale(sale));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e); res.status(500).json({ error: "No se pudo registrar la venta" });
  }
});

function shapeSale(s) {
  return {
    ...s, total: num(s.total),
    items: (s.items || []).map(i => ({ ...i, unitPrice: num(i.unitPrice), subtotal: num(i.subtotal) })),
  };
}

// GET /api/store/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&status=
router.get("/sales", auth, async (req, res) => {
  const { start, end, from, to } = limaRange(req.query.from, req.query.to);
  try {
    const list = await prisma.sale.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(req.query.status ? { status: req.query.status } : {}) },
      include: { items: true, soldBy: { select: { name: true } }, receipt: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ from, to, sales: list.map(shapeSale) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error al obtener ventas" }); }
});

// PUT /api/store/sales/:id/annul — devuelve el stock y anula la boleta si la hubo
router.put("/sales/:id/annul", auth, MANAGER, async (req, res) => {
  try {
    const sale = await prisma.$transaction(async tx => {
      const s = await tx.sale.findUnique({ where: { id: +req.params.id }, include: { items: true } });
      if (!s) throw Object.assign(new Error("Venta no encontrada"), { status: 404 });
      if (s.status === "ANULADA") throw Object.assign(new Error("La venta ya está anulada"), { status: 409 });
      for (const it of s.items) {
        const p = await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
        await tx.stockMovement.create({ data: { productId: it.productId, type: "ANULACION", quantity: it.quantity, stockAfter: p.stock, saleId: s.id, userId: req.user.id, note: `Anulación ${s.number}` } });
      }
      if (s.receiptId) await tx.receipt.update({ where: { id: s.receiptId }, data: { status: "ANULADA" } });
      return tx.sale.update({ where: { id: s.id }, data: { status: "ANULADA", annulledAt: new Date() }, include: { items: true } });
    });
    res.json(shapeSale(sale));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e); res.status(500).json({ error: "No se pudo anular la venta" });
  }
});

/* ══════════════════════════════════════
   RESUMEN Y EXCEL
══════════════════════════════════════ */

async function periodData(start, end) {
  const [sales, products] = await Promise.all([
    prisma.sale.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { items: true, soldBy: { select: { name: true } }, receipt: { select: { number: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const done = sales.filter(s => s.status === "COMPLETADA");
  const byMethod = {}, byProduct = {};
  for (const s of done) {
    byMethod[s.paymentMethod] = money((byMethod[s.paymentMethod] || 0) + Number(s.total));
    for (const i of s.items) {
      const k = i.productId;
      byProduct[k] ??= { productId: k, name: i.productName, quantity: 0, total: 0 };
      byProduct[k].quantity += i.quantity;
      byProduct[k].total = money(byProduct[k].total + Number(i.subtotal));
    }
  }
  const salesTotal = money(done.reduce((a, s) => a + Number(s.total), 0));
  return {
    sales, products, done,
    summary: {
      salesTotal, salesCount: done.length, annulledCount: sales.length - done.length,
      avgTicket: done.length ? money(salesTotal / done.length) : 0,
      byMethod,
      topProducts: Object.values(byProduct).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
      lowStock: products.filter(p => p.stock <= p.minStock).length,
      inventoryValue: money(products.reduce((a, p) => a + p.stock * Number(p.cost ?? p.price), 0)),
    },
  };
}

// GET /api/store/summary?from=&to=
router.get("/summary", auth, async (req, res) => {
  const r = limaRange(req.query.from, req.query.to);
  try { res.json({ from: r.from, to: r.to, ...(await periodData(r.start, r.end)).summary }); }
  catch (e) { console.error(e); res.status(500).json({ error: "Error al calcular el resumen" }); }
});

// GET /api/store/export?from=&to= → archivo .xlsx
router.get("/export", auth, MANAGER, async (req, res) => {
  const r = limaRange(req.query.from, req.query.to);
  try {
    const { sales, products, summary } = await periodData(r.start, r.end);
    const movements = await prisma.stockMovement.findMany({
      where: { createdAt: { gte: r.start, lt: r.end } }, orderBy: { createdAt: "asc" },
      include: { product: { select: { name: true } }, user: { select: { name: true } } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "SOLGYM"; wb.created = new Date();
    const MONEY = '"S/ "#,##0.00';
    const style = ws => {
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: "FF000000" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5B800" } };
      h.alignment = { vertical: "middle" };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      if (ws.columnCount) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };

    // 1. Resumen
    const rs = wb.addWorksheet("Resumen");
    rs.columns = [{ header: "Concepto", key: "k", width: 34 }, { header: "Valor", key: "v", width: 20 }];
    const resumen = [
      ["Periodo", `${r.from} al ${r.to}`],
      ["Total vendido", summary.salesTotal, true],
      ["N.º de ventas", summary.salesCount],
      ["Ticket promedio", summary.avgTicket, true],
      ["Ventas anuladas", summary.annulledCount],
      ["Productos con stock bajo", summary.lowStock],
      ["Valor del inventario (a costo)", summary.inventoryValue, true],
      [],
      ["Por método de pago"],
      ...Object.entries(summary.byMethod).map(([m, v]) => [`   ${m}`, v, true]),
      [],
      ["Más vendidos (unidades)"],
      ...summary.topProducts.map(p => [`   ${p.name}`, p.quantity]),
    ];
    for (const [k, v, isMoney] of resumen) {
      const row = rs.addRow({ k, v });
      if (isMoney) row.getCell(2).numFmt = MONEY;
      if (k && v === undefined) row.font = { bold: true };
    }
    style(rs); rs.autoFilter = undefined;

    // 2. Ventas
    const ws = wb.addWorksheet("Ventas");
    ws.columns = [
      { header: "N.º venta", key: "number", width: 12 }, { header: "Fecha", key: "date", width: 18 },
      { header: "Cliente", key: "client", width: 28 }, { header: "Método de pago", key: "method", width: 16 },
      { header: "Total", key: "total", width: 12, style: { numFmt: MONEY } }, { header: "Estado", key: "status", width: 12 },
      { header: "Boleta", key: "receipt", width: 14 }, { header: "Vendido por", key: "seller", width: 18 },
      { header: "Productos", key: "items", width: 50 },
    ];
    for (const s of sales) ws.addRow({
      number: s.number, date: limaDateTime(s.createdAt), client: s.clientName, method: s.paymentMethod,
      total: Number(s.total), status: s.status, receipt: s.receipt?.number ?? "", seller: s.soldBy?.name ?? "",
      items: s.items.map(i => `${i.quantity}× ${i.productName}`).join(", "),
    });
    ws.eachRow((row, i) => { if (i > 1 && row.getCell("status").value === "ANULADA") row.font = { color: { argb: "FF999999" }, strike: true }; });
    style(ws);

    // 3. Detalle por producto vendido
    const wd = wb.addWorksheet("Detalle");
    wd.columns = [
      { header: "N.º venta", key: "number", width: 12 }, { header: "Fecha", key: "date", width: 18 },
      { header: "Producto", key: "product", width: 34 }, { header: "Cantidad", key: "qty", width: 10 },
      { header: "Precio unit.", key: "price", width: 13, style: { numFmt: MONEY } },
      { header: "Subtotal", key: "subtotal", width: 13, style: { numFmt: MONEY } }, { header: "Estado venta", key: "status", width: 13 },
    ];
    for (const s of sales) for (const i of s.items) wd.addRow({
      number: s.number, date: limaDateTime(s.createdAt), product: i.productName, qty: i.quantity,
      price: Number(i.unitPrice), subtotal: Number(i.subtotal), status: s.status,
    });
    style(wd);

    // 4. Inventario actual
    const wi = wb.addWorksheet("Inventario");
    wi.columns = [
      { header: "Producto", key: "name", width: 34 }, { header: "Código de barras", key: "barcode", width: 18 },
      { header: "Categoría", key: "category", width: 16 }, { header: "Marca", key: "brand", width: 16 },
      { header: "Precio", key: "price", width: 12, style: { numFmt: MONEY } }, { header: "Costo", key: "cost", width: 12, style: { numFmt: MONEY } },
      { header: "Stock", key: "stock", width: 9 }, { header: "Mínimo", key: "min", width: 9 },
      { header: "Valor stock", key: "value", width: 13, style: { numFmt: MONEY } }, { header: "Estado", key: "status", width: 11 },
    ];
    for (const p of products) {
      const st = shapeProduct(p).stockStatus;
      const row = wi.addRow({
        name: p.name, barcode: p.barcode ?? "", category: p.category, brand: p.brand ?? "",
        price: Number(p.price), cost: p.cost != null ? Number(p.cost) : null, stock: p.stock, min: p.minStock,
        value: p.stock * Number(p.cost ?? p.price), status: st,
      });
      if (st !== "OK") row.getCell("status").font = { bold: true, color: { argb: st === "AGOTADO" ? "FFC0392B" : "FFB7791F" } };
    }
    style(wi);

    // 5. Movimientos de stock del periodo
    const wm = wb.addWorksheet("Movimientos");
    wm.columns = [
      { header: "Fecha", key: "date", width: 18 }, { header: "Producto", key: "product", width: 34 },
      { header: "Tipo", key: "type", width: 12 }, { header: "Cantidad", key: "qty", width: 10 },
      { header: "Stock después", key: "after", width: 14 }, { header: "Nota", key: "note", width: 30 }, { header: "Usuario", key: "user", width: 18 },
    ];
    for (const m of movements) wm.addRow({
      date: limaDateTime(m.createdAt), product: m.product?.name ?? "", type: m.type, qty: m.quantity,
      after: m.stockAfter, note: m.note ?? "", user: m.user?.name ?? "",
    });
    style(wm);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="solgym-tienda-${r.from}_${r.to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: "No se pudo generar el Excel" }); }
});

module.exports = router;
