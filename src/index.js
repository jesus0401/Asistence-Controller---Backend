// src/index.js — Servidor principal SOLGYM API
require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

// ── Rutas ──────────────────────────────────────────────
app.use("/api/auth",       require("./routes/auth"));
app.use("/api/members",    require("./routes/members"));
app.use("/api/plans",      require("./routes/plans"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/metrics",    require("./routes/metrics"));
app.use("/api/exercises",  require("./routes/exercises"));
app.use("/api/routines",   require("./routes/routines"));
app.use("/api/nutrition",  require("./routes/nutrition"));
app.use("/api/receipts",   require("./routes/receipts"));
app.use("/api/profiles",   require("./routes/profiles"));

// ── Health check ────────────────────────────────────────
app.get("/", (_, res) => res.json({ status: "ok", app: "SOLGYM API", version: "1.0.0" }));

// ── Error global ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`🏋️  SOLGYM API corriendo en http://localhost:${PORT}`);
});
