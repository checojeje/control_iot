/**
 * MÓDULO CLIENTE API REST (js/api.js)
 * Centraliza las peticiones HTTP (GET / POST) hacia el backend FastAPI en AWS:
 * https://api-iot-sergio.duckdns.org
 * Incluye AbortController para evitar respuestas tardías y dar prioridad absoluta a DETENER.
 */

export const API_CONFIG = {
  BASE_URL: "https://api-iot-sergio.duckdns.org",
  VEHICULO_ID: 1, // Vehículo #1: "Excavadora IoT"

  // Rutas reales documentadas en https://api-iot-sergio.duckdns.org/openapi.json
  ROUTES: {
    VEHICULOS: "/api/vehiculos",
    COMANDOS: "/api/vehiculos/1/comandos",                // GET  -> sp_obtener_comandos_vehiculo(1)
    MOVIMIENTO: "/api/vehiculos/movimiento",              // POST -> { vehiculo_id: 1, comando_id: <1..13>, origen }
    ESTADO: "/api/vehiculos/1/estado",                    // GET  -> sp_obtener_estado(1)
    ACTUALIZAR_ESTADO: "/api/vehiculos/estado/actualizar",// POST -> { id_vehiculo: 1, id_comando: 13, conectado: true }
    HISTORIAL: "/api/vehiculos/1/historial",              // GET  -> sp_obtener_historial(1)
    DEMOS: "/api/vehiculos/1/demos",                      // GET  -> sp_obtener_demos(1)
    INICIAR_DEMO: "/api/vehiculos/demo",                  // POST -> { vehiculo_id: 1, demo_id: 1 }
    CANCELAR_DEMO: "/api/vehiculos/estado/actualizar",    // POST -> Restablece estado a Detener (id_comando: 13)
    HEALTH: "/openapi.json",                              // GET  -> Salud del servidor AWS de 21 APIs
    DB_READY: "/api/vehiculos/1/estado",                  // GET  -> Comprobación segura de Amazon RDS vía SP
  },

  TIMEOUT_MS: 8000,
};

// Controlador de solicitud de movimiento en vuelo para cancelar peticiones previas
// cuando cambia la dirección rápidamente o se dispara DETENER con prioridad absoluta.
let currentMovementAbortController = null;
let currentDemoAbortController = null;

/**
 * Construye la URL absoluta hacia https://api-iot-sergio.duckdns.org.
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  const base = API_CONFIG.BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Cliente Fetch con async/await, soporte CORS, timeout con AbortController y validación JSON.
 * @param {string} path - Ruta del endpoint.
 * @param {RequestInit} [options={}] - Opciones de configuración Fetch.
 * @param {number} [customTimeoutMs] - Timeout personalizado.
 * @param {AbortController} [externalController] - Controlador externo opcional.
 * @returns {Promise<any>}
 */
async function httpRequest(
  path,
  options = {},
  customTimeoutMs = API_CONFIG.TIMEOUT_MS,
  externalController = null
) {
  const controller = externalController || new AbortController();
  const timer = setTimeout(() => controller.abort("TIMEOUT"), customTimeoutMs);
  const url = buildUrl(path);

  const config = {
    method: options.method || "GET",
    mode: "cors",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: controller.signal,
    ...options,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timer);

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { message: text };
    }

    if (!response.ok) {
      const errorDetail =
        (data && (data.detail || data.message || data.error)) ||
        `Error HTTP ${response.status} (${response.statusText})`;
      throw new Error(String(errorDetail));
    }

    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      if (controller.signal.reason === "SUPERSEDED") {
        const supersededErr = new Error("Solicitud reemplazada por un comando más reciente.");
        supersededErr.isSuperseded = true;
        throw supersededErr;
      }
      throw new Error("Tiempo de espera agotado al contactar el servidor AWS.");
    }
    throw error;
  }
}

/**
 * 1. Salud del Servidor AWS de 21 APIs: GET https://api-iot-sergio.duckdns.org/openapi.json
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
export async function checkApiHealth() {
  try {
    const data = await httpRequest(API_CONFIG.ROUTES.HEALTH, { method: "GET" });
    const isValidOpenApi = Boolean(data && typeof data === "object" && data.paths);
    return { ok: isValidOpenApi, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 2. Diagnóstico seguro de Amazon RDS mediante la API:
 * GET https://api-iot-sergio.duckdns.org/api/vehiculos/1/estado
 * Ejecuta `sp_obtener_estado(1)` en el backend y comprueba que RDS responde con datos válidos.
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
export async function checkRdsHealth() {
  try {
    const data = await httpRequest(API_CONFIG.ROUTES.DB_READY, { method: "GET" });
    const isValidState = Boolean(data && typeof data === "object" && data.id_vehiculo);
    return { ok: isValidState, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 3. Obtener catálogo de comandos: GET https://api-iot-sergio.duckdns.org/api/vehiculos/1/comandos
 * @param {number} [vehiculoId=API_CONFIG.VEHICULO_ID]
 * @returns {Promise<Array<object>>}
 */
export async function fetchCommands(vehiculoId = API_CONFIG.VEHICULO_ID) {
  const data = await httpRequest(`/api/vehiculos/${vehiculoId}/comandos`, {
    method: "GET",
  });
  return Array.isArray(data?.comandos) ? data.comandos : [];
}

/**
 * 4. Enviar movimiento individual: POST https://api-iot-sergio.duckdns.org/api/vehiculos/movimiento
 * Cancela cualquier petición de movimiento anterior aún pendiente para evitar condiciones de carrera
 * y garantizar prioridad absoluta al comando Detener (ID: 13).
 * @param {number} comandoId - ID numérico del comando (1 al 13).
 * @param {string} [origen='WEB_JOYSTICK'] - Origen de la petición.
 * @param {number} [vehiculoId=API_CONFIG.VEHICULO_ID]
 * @returns {Promise<any>}
 */
export async function sendMovement(
  comandoId,
  origen = "WEB_JOYSTICK",
  vehiculoId = API_CONFIG.VEHICULO_ID
) {
  const numericCmd = Number(comandoId);
  if (!Number.isInteger(numericCmd) || numericCmd <= 0) {
    throw new Error(`ID de comando inválido: ${comandoId}`);
  }

  // Si hay una solicitud anterior en vuelo, la abortamos para priorizar el nuevo comando
  if (currentMovementAbortController) {
    currentMovementAbortController.abort("SUPERSEDED");
  }

  currentMovementAbortController = new AbortController();

  const payload = {
    vehiculo_id: Number(vehiculoId),
    comando_id: numericCmd,
    origen: String(origen).slice(0, 50),
  };

  try {
    return await httpRequest(
      API_CONFIG.ROUTES.MOVIMIENTO,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      API_CONFIG.TIMEOUT_MS,
      currentMovementAbortController
    );
  } finally {
    currentMovementAbortController = null;
  }
}

/**
 * 5. Obtener secuencias DEMO: GET https://api-iot-sergio.duckdns.org/api/vehiculos/1/demos
 * @param {number} [vehiculoId=API_CONFIG.VEHICULO_ID]
 * @returns {Promise<Array<object>>}
 */
export async function fetchDemos(vehiculoId = API_CONFIG.VEHICULO_ID) {
  const data = await httpRequest(`/api/vehiculos/${vehiculoId}/demos`, {
    method: "GET",
  });
  return Array.isArray(data?.demos) ? data.demos : [];
}

/**
 * 6. Iniciar una secuencia DEMO: POST https://api-iot-sergio.duckdns.org/api/vehiculos/demo
 * @param {number} demoId
 * @param {number} [vehiculoId=API_CONFIG.VEHICULO_ID]
 * @returns {Promise<any>}
 */
export async function startDemo(demoId, vehiculoId = API_CONFIG.VEHICULO_ID) {
  const numericDemoId = Number(demoId);
  if (!Number.isInteger(numericDemoId) || numericDemoId <= 0) {
    throw new Error("ID de secuencia DEMO inválido.");
  }

  currentDemoAbortController = new AbortController();

  const payload = {
    vehiculo_id: Number(vehiculoId),
    demo_id: numericDemoId,
  };

  try {
    return await httpRequest(
      API_CONFIG.ROUTES.INICIAR_DEMO,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      60000,
      currentDemoAbortController
    );
  } finally {
    currentDemoAbortController = null;
  }
}

/**
 * 7. Cancelar DEMO / Restablecer estado a Detener (ID: 13):
 * POST https://api-iot-sergio.duckdns.org/api/vehiculos/estado/actualizar
 * @param {number} [stopCommandId=13] - ID 13 ("Detener").
 * @param {number} [vehiculoId=API_CONFIG.VEHICULO_ID]
 * @returns {Promise<any>}
 */
export async function cancelDemo(
  stopCommandId = 13,
  vehiculoId = API_CONFIG.VEHICULO_ID
) {
  if (currentDemoAbortController) {
    currentDemoAbortController.abort("SUPERSEDED");
    currentDemoAbortController = null;
  }

  const payload = {
    id_vehiculo: Number(vehiculoId),
    id_comando: Number(stopCommandId),
    conectado: true,
  };

  return await httpRequest(API_CONFIG.ROUTES.CANCELAR_DEMO, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
