/**
 * @file datetime.js
 * @description Utilidades para parsear, validar y formatear fechas y horas reales del backend
 * sin fabricar marcas temporales cuando el dato no exista.
 */

/**
 * Parsea una cadena ISO o SQL proveniente de FastAPI / Amazon RDS.
 * Ejemplo real del backend: "2026-11-10T06:11:40" o "2026-11-10 06:11:40"
 * @param {string|null|undefined} rawTimestamp
 * @returns {{ valid: boolean, dateText: string, timeText: string, isoText: string, epochMs: number }}
 */
export function parseBackendTimestamp(rawTimestamp) {
  if (!rawTimestamp || typeof rawTimestamp !== "string") {
    return {
      valid: false,
      dateText: "Sin fecha",
      timeText: "Sin hora",
      isoText: "",
      epochMs: 0,
    };
  }

  const trimmed = rawTimestamp.trim();
  // Extraer partes directamente si viene en formato ISO/SQL YYYY-MM-DD[T ]HH:MM:SS
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/
  );

  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const dateText = `${day}/${month}/${year}`;
    const timeText = `${hour}:${minute}:${second}`;
    const parsedMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}`);

    return {
      valid: true,
      dateText,
      timeText,
      isoText: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      epochMs: Number.isNaN(parsedMs) ? 0 : parsedMs,
    };
  }

  const fallbackDate = new Date(trimmed);
  if (Number.isNaN(fallbackDate.getTime())) {
    return {
      valid: false,
      dateText: "Sin fecha",
      timeText: "Sin hora",
      isoText: trimmed,
      epochMs: 0,
    };
  }

  const pad = (n) => String(n).padStart(2, "0");
  const day = pad(fallbackDate.getDate());
  const month = pad(fallbackDate.getMonth() + 1);
  const year = fallbackDate.getFullYear();
  const hour = pad(fallbackDate.getHours());
  const minute = pad(fallbackDate.getMinutes());
  const second = pad(fallbackDate.getSeconds());

  return {
    valid: true,
    dateText: `${day}/${month}/${year}`,
    timeText: `${hour}:${minute}:${second}`,
    isoText: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    epochMs: fallbackDate.getTime(),
  };
}
