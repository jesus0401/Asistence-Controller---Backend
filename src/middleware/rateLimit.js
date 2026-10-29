// src/middleware/rateLimit.js
// Limitador simple en memoria (suficiente con una sola instancia en PM2).
// rateLimit({ windowMs, max, key }) → bloquea con 429 al superar `max` intentos en la ventana.
const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 60 * 1000).unref();

module.exports = ({ windowMs, max, key = req => req.ip, message }) => (req, res, next) => {
  const k = `${req.baseUrl}${req.path}:${key(req)}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || b.resetAt < now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(k, b); }
  b.count++;
  if (b.count > max) {
    res.set("Retry-After", Math.ceil((b.resetAt - now) / 1000));
    return res.status(429).json({ error: message || "Demasiados intentos, espera unos minutos" });
  }
  next();
};
