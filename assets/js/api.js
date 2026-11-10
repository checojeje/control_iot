/**
 * @file api.js
 * @description Cliente REST con Fetch y async/await para consumir los 21 servicios en AWS
 */

export const CONFIG = {
  API_BASE_URL: "https://api-iot-sergio.duckdns.org",
  WS_URL: "wss://api-iot-sergio.duckdns.org/ws/vehiculo/1",
  VEHICULO_ID: 1,
  TIMEOUT_MS: 10000,
};

// Cola secuencial para garantizar orden de movimientos sin abortar peticiones en vuelo
let movementQueuePromise = Promise.resolve();

/**
 * Realiza una petición HTTP con timeout controlado.
 * No envía Content-Type en peticiones GET para evitar preflights CORS innecesarios.
 */
async function fetchWithTimeout(endpoint, options = {}, customSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  if (customSignal) {
    customSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const method = (options.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
      ...options,
      method,
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const detail =
        data && typeof data === "object" && (data.detail || data.message || data.error)
          ? typeof (data.detail || data.message || data.error) === "string"
            ? data.detail || data.message || data.error
            : JSON.stringify(data.detail || data.message || data.error)
          : `HTTP ${response.status}: ${response.statusText}`;
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al conectar con el servidor AWS.");
    }
    if (typeof err === "string") {
      throw new Error(err);
    }
    throw err instanceof Error ? err : new Error("Error de comunicación con el servidor.");
  }
}

/**
 * 1. Verifica disponibilidad del servidor AWS (21 APIs)
 * Comprueba /openapi.json o /api/vehiculos/1 (que devuelve id_vehiculo)
 */
export async function checkApiHealth() {
  try {
    const data = await fetchWithTimeout(`/openapi.json`);
    const ok = Boolean(data && typeof data === "object" && (data.openapi || data.paths));
    return { ok, data };
  } catch (err) {
    return { ok: false, error: err?.message || "No disponible" };
  }
}

/**
 * 2. Verifica disponibilidad de Amazon RDS consultando el estado real del vehículo
 * GET /api/vehiculos/1/estado -> devuelve { id_vehiculo: 1, vehiculo: "Excavadora IoT", id_comando: 13, comando: "Detener", ... }
 */
export async function checkRdsHealth() {
  try {
    const data = await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}/estado`);
    const ok = Boolean(
      data &&
        typeof data === "object" &&
        (data.id_vehiculo !== undefined || data.vehiculo_id !== undefined || data.comando !== undefined)
    );
    return { ok, data };
  } catch (err) {
    return { ok: false, error: err?.message || "Sin verificar", status: err?.status };
  }
}

/**
 * 3. Obtiene información del vehículo
 * GET /api/vehiculos/1 -> { id_vehiculo: 1, nombre: "Excavadora IoT", ... }
 */
export async function fetchVehicleInfo() {
  return await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}`);
}

/**
 * 4. Obtiene el catálogo real de comandos del vehículo y normaliza id_comando -> id
 * GET /api/vehiculos/1/comandos -> { vehiculo_id: 1, total: 13, comandos: [...] }
 */
export async function fetchVehicleCommands() {
  const data = await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}/comandos`);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.comandos)
      ? data.comandos
      : [];

  return list.map((cmd) => ({
    ...cmd,
    id: Number(cmd.id_comando ?? cmd.id),
    nombre: String(cmd.nombre || "Comando"),
    codigo: String(cmd.codigo ?? ""),
    activo: cmd.activo !== false && cmd.activo !== 0,
  }));
}

/**
 * 5. Obtiene las secuencias DEMO disponibles del vehículo y normaliza id_demo -> id
 * GET /api/vehiculos/1/demos -> { vehiculo_id: 1, total: 1, demos: [...] }
 */
export async function fetchDemos() {
  const data = await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}/demos`);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.demos)
      ? data.demos
      : [];

  return list.map((demo) => ({
    ...demo,
    id: Number(demo.id_demo ?? demo.id),
    nombre: String(demo.nombre || "Demo principal"),
    descripcion: demo.descripcion ? String(demo.descripcion) : "",
  }));
}

/**
 * 6. Obtiene los movimientos de una DEMO específica
 * GET /api/demos/{demoId}/movimientos -> { demo_id: 1, total: N, movimientos: [...] }
 */
export async function fetchDemoMovements(demoId) {
  const data = await fetchWithTimeout(`/api/demos/${demoId}/movimientos`);
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.movimientos)
      ? data.movimientos
      : [];
}

/**
 * 7. Envía un movimiento individual al vehículo en orden secuencial
 * POST /api/vehiculos/movimiento -> { vehiculo_id: 1, comando_id: 1..13, origen }
 */
export async function sendMovement(comandoId, origen = "WEB_CONTROL") {
  const payload = {
    vehiculo_id: CONFIG.VEHICULO_ID,
    comando_id: Number(comandoId),
    origen: String(origen).slice(0, 50),
  };

  const runRequest = () =>
    fetchWithTimeout(`/api/vehiculos/movimiento`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

  const task = movementQueuePromise.then(runRequest, runRequest);
  movementQueuePromise = task.catch(() => {});
  return await task;
}

/**
 * 8. Inicia la ejecución de una secuencia DEMO en el backend (que transmite por WebSocket)
 * POST /api/vehiculos/demo -> { vehiculo_id: 1, demo_id: 1 }
 */
export async function startDemoOnBackend(demoId) {
  return await fetchWithTimeout(`/api/vehiculos/demo`, {
    method: "POST",
    body: JSON.stringify({
      vehiculo_id: CONFIG.VEHICULO_ID,
      demo_id: Number(demoId),
    }),
  });
}
