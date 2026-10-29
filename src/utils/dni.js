// src/utils/dni.js
// Consulta de nombres por DNI a través de un proveedor externo configurable.
//
//   DNI_API_URL    = URL del proveedor. Si lleva {dni}, ahí se pone el número (para GET).
//   DNI_API_METHOD = GET (por defecto) o POST. Con POST se envía el JSON {"dni": "12345678"}.
//   DNI_API_TOKEN  = token del proveedor. Se envía como "Authorization: Bearer <token>"
//                    y también reemplaza {token} si la URL lo pide.
//
// Ejemplos:
//   API Perú (apiperu.pe):  DNI_API_URL=https://api.apiperu.pe/dni   DNI_API_METHOD=POST
//   apis.net.pe:            DNI_API_URL=https://api.apis.net.pe/v2/reniec/dni?numero={dni}
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
  if (!raw || raw.success === false) return null;
  const d = raw?.data && typeof raw.data === "object" ? raw.data : raw?.result && typeof raw.result === "object" ? raw.result : raw;
  const nombres  = pick(d, ["nombres", "nombre", "first_name", "names", "prenombres"]);
  const paterno  = pick(d, ["apellidoPaterno", "apellido_paterno", "first_last_name", "paternal_surname", "apePaterno", "ap_paterno"]);
  const materno  = pick(d, ["apellidoMaterno", "apellido_materno", "second_last_name", "maternal_surname", "apeMaterno", "ap_materno"]);
  let full       = pick(d, ["nombreCompleto", "nombre_completo", "full_name", "fullName"]);
  if (!nombres && !full) return null;
  if (nombres) full = [nombres, paterno, materno].filter(Boolean).join(" ");
  else full = full.replace(/,\s*/, " ");   // "APELLIDOS, NOMBRES" → texto plano
  return {
    nombres: title(nombres), apellidoPaterno: title(paterno), apellidoMaterno: title(materno),
    fullName: title(full),
  };
}

async function lookupDni(dni) {
  const hit = cache.get(dni);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const token  = process.env.DNI_API_TOKEN || "";
  const method = (process.env.DNI_API_METHOD || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const url = process.env.DNI_API_URL.replace("{dni}", encodeURIComponent(dni)).replace("{token}", encodeURIComponent(token));

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify({ dni }) } : {}),
    signal: AbortSignal.timeout(7000),
  });
  const body = await res.json().catch(() => null);

  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("El token del servicio de DNI no es válido o se agotó el plan"), { status: 502 });
  if (res.status === 429) throw Object.assign(new Error("Se alcanzó el límite de consultas de DNI, intenta más tarde"), { status: 429 });
  if (res.status === 404 || res.status === 422) {
    // Algunos proveedores devuelven 404 también por token inválido: dejarlo en el log
    if (body?.message) console.warn(`DNI ${dni}: ${body.message}`);
    cache.set(dni, { value: null, at: Date.now() });
    return null;
  }
  if (!res.ok) throw Object.assign(new Error("El servicio de DNI no respondió"), { status: 502 });

  const value = normalize(body);
  cache.set(dni, { value, at: Date.now() });
  return value;
}

module.exports = { lookupDni, isConfigured, normalize };
