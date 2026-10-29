// src/utils/dni.js
// Consulta de nombres por DNI a través de un proveedor externo configurable.
//
//   DNI_API_URL   = URL con {dni} donde va el número. Ej.:
//                   https://api.apis.net.pe/v2/reniec/dni?numero={dni}
//                   https://dniruc.apisperu.com/api/v1/dni/{dni}?token={token}
//   DNI_API_TOKEN = token del proveedor. Se envía como "Authorization: Bearer <token>"
//                   y también reemplaza {token} si la URL lo pide.
//
// Cada proveedor nombra los campos distinto; aquí se aceptan los formatos más comunes.
// Solo se devuelve el nombre: no guardamos dirección ni otros datos que el proveedor envíe.

const cache = new Map();                 // dni → { value, at }
const CACHE_MS = 24 * 60 * 60 * 1000;    // ahorra consultas del plan gratuito

const isConfigured = () => !!process.env.DNI_API_URL;

const pick = (o, keys) => {
  for (const k of keys) if (o && o[k] != null && String(o[k]).trim()) return String(o[k]).trim();
  return "";
};

const title = s => s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());

function normalize(raw) {
  const d = raw?.data && typeof raw.data === "object" ? raw.data : raw?.result && typeof raw.result === "object" ? raw.result : raw;
  const nombres  = pick(d, ["nombres", "nombre", "first_name", "names", "prenombres"]);
  const paterno  = pick(d, ["apellidoPaterno", "apellido_paterno", "first_last_name", "paternal_surname", "apePaterno", "ap_paterno"]);
  const materno  = pick(d, ["apellidoMaterno", "apellido_materno", "second_last_name", "maternal_surname", "apeMaterno", "ap_materno"]);
  let full       = pick(d, ["nombreCompleto", "nombre_completo", "full_name", "fullName"]);
  if (!nombres && !full) return null;
  if (nombres) full = [nombres, paterno, materno].filter(Boolean).join(" ");
  return {
    nombres: title(nombres), apellidoPaterno: title(paterno), apellidoMaterno: title(materno),
    fullName: title(full),
  };
}

async function lookupDni(dni) {
  const hit = cache.get(dni);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const token = process.env.DNI_API_TOKEN || "";
  const url = process.env.DNI_API_URL.replace("{dni}", encodeURIComponent(dni)).replace("{token}", encodeURIComponent(token));
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(7000),
  });

  if (res.status === 404 || res.status === 422) { cache.set(dni, { value: null, at: Date.now() }); return null; }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("El token del servicio de DNI no es válido o se agotó el plan"), { status: 502 });
  if (res.status === 429) throw Object.assign(new Error("Se alcanzó el límite de consultas de DNI, intenta más tarde"), { status: 429 });
  if (!res.ok) throw Object.assign(new Error("El servicio de DNI no respondió"), { status: 502 });

  const value = normalize(await res.json().catch(() => null));
  cache.set(dni, { value, at: Date.now() });
  return value;
}

module.exports = { lookupDni, isConfigured, normalize };
