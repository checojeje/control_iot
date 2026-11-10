/**
 * @file datetime.js
 * @description Utilidades para parsear, validar y formatear fechas y horas reales del backend.
 * Convierte las marcas temporales UTC de Amazon RDS a la hora local real del usuario
 * sin fabricar fechas cuando el dato no exista.
 */

/**
 * Parsea una cadena ISO o SQL proveniente de FastAPI / Amazon RDS (almacenada en UTC).
 * Ejemplo real del backend: "2026-11-10T06:27:46" (UTC) -> Hora local México (UTC-6): "12:27:46 a. m."
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

  // Detectar si el timestamp viene sin zona horaria explícita (formato DATETIME de MySQL en Amazon RDS UTC)
  const hasExplicitTimezone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  let normalizedIso = trimmed.replace(" ", "T");
  if (!hasExplicitTimezone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(normalizedIso)) {
    normalizedIso += "Z";
  }

  const dateObj = new Date(normalizedIso);
  if (Number.isNaN(dateObj.getTime())) {
    return {
      valid: false,
      dateText: "Sin fecha",
      timeText: "Sin hora",
      isoText: trimmed,
      epochMs: 0,
    };
  }

  const pad = (n) => String(n).padStart(2, "0");
  const day = pad(dateObj.getDate());
  const month = pad(dateObj.getMonth() + 1);
  const year = dateObj.getFullYear();
  const dateText = `${day}/${month}/${year}`;

  // Formato de 12 horas con segundos (ej. 12:27:46 a. m.) acorde al reloj local del sistema
  let Hours = dateObj.getHours();
  const minutes = pad(dateObj.getMinutes());
  const seconds = pad(dateObj.getSeconds());
  const ampm = Hours >= 12 ? "p. m." : "a. m.";
  Hours = Hours % 12;
  if (Hours === 0) Hours = 12;
  const timeText = `${pad(Hours)}:${minutes}:${seconds} ${ampm}`;

  return {
    valid: true,
    dateText,
    timeText,
    isoText: `${year}-${month}-${day} ${pad(dateObj.getHours())}:${minutes}:${seconds}`,
    epochMs: dateObj.getTime(),
  };
}
