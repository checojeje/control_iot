/**
 * @file api.js
 * @description Cliente REST con Fetch y async/await para consumir los servicios de AWS
 */

export const CONFIG = {
  API_BASE_URL: "https://api-iot-sergio.duckdns.org",
  WS_URL: "wss://api-iot-sergio.duckdns.org/ws/vehiculo/1",
  VEHICULO_ID: 1,
  TIMEOUT_MS: 12000,
};

// Cola secuencial para garantizar orden sin abortar peticiones en vuelo
let movementQueuePromise = Promise.resolve();

/**
 * Realiza una petición HTTP con timeout controlado y sin caché obsoleta en móviles
 */
async function fetchWithTimeout(endpoint, options = {}, customSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  if (customSignal) {
    customSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {}),
      },
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
        data && typeof data === "object" && data.detail
          ? typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail)
          : `HTTP ${response.status}: ${response.statusText}`;
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al conectar con el servidor.");
    }
    if (typeof err === "string") {
      throw new Error(err);
    }
    throw err instanceof Error ? err : new Error("Error de comunicación con el servidor.");
  }
}

/**
 * 1. Verifica disponibilidad del servidor AWS (21 APIs) con respuesta ultraligera
 */
export async function checkApiHealth() {
  try {
    const data = await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}`);
    return { ok: Boolean(data && data.id), data };
  } catch (err) {
    return { ok: false, error: err?.message || "No disponible" };
  }
}

/**
 * 2. Verifica disponibilidad de Amazon RDS consultando el estado real del vehículo
 */
export async function checkRdsHealth() {
  try {
    const data = await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}/estado`);
    return { ok: Boolean(data && data.vehiculo_id), data };
  } catch (err) {
    return { ok: false, error: err?.message || "Sin verificar", status: err?.status };
  }
}

/**
 * 3. Obtiene información del vehículo
 */
export async function fetchVehicleInfo() {
  return await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}`);
}

/**
 * 4. Obtiene el catálogo real de comandos del vehículo
 */
export async function fetchVehicleCommands() {
  return await fetchWithTimeout(`/api/vehiculos/${CONFIG.VEHICULO_ID}/comandos`);
}

/**
 * 5. Obtiene las secuencias DEMO disponibles
 */
export async function fetchDemos() {
  return await fetchWithTimeout(`/api/demos`);
}

/**
 * 6.Obtiene los movimientos de una DEMO específica
 */
export async function fetchDemoMovements(demoId) {
  return await fetchWithTimeout(`/api/demos/${demoId}/movimientos`);
}

/**
 * 7. Envía un movimiento individual al vehículo en orden secuencial
 */
export async function sendMovement(comandoId, origen = "WEB_CONTROL") {
  const payload = {
    vehiculo_id: CONFIG.VEHICULO_ID,
    comando_id: Number(comandoId),
    origen,
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
 * 8. Registra la ejecución de una DEMO en el backend
 */
export async function registerDemoExecution(demoId) {
  return await fetchWithTimeout(`/api/demos/ejecutar`, {
    method: "POST",
    body: JSON.stringify({
      vehiculo_id: CONFIG.VEHICULO_ID,
      demo_id: Number(demoId),
    }),
  });
}
