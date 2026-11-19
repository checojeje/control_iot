/**
 * @file api.js
 * @description Cliente REST con Fetch y async/await para CONTROL (4.1), MONITOREO (4.2) y ADMINISTRACIÓN (4.3).
 * Por defecto inicia sin privilegios (rol INVITADO); para acceder como USUARIO o ADMIN requiere Login real.
 */

const isLocalHost =
  typeof window !== "undefined" &&
  (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

export const CONFIG = {
  API_BASE_URL: "https://api-iot-sergio.duckdns.org",
  LOCAL_FALLBACK_URL: "http://127.0.0.1:8000",
  WS_BASE_URL: "wss://api-iot-sergio.duckdns.org/ws/vehiculo",
  LOCAL_WS_BASE_URL: "ws://127.0.0.1:8000/ws/vehiculo",
  VEHICULO_ID: 2, // Por defecto apunta a unidad de exhibición hasta que un comprador o admin inicie sesión
  MAX_HISTORY_ROWS: 10,
  TIMEOUT_MS: 10000,
  AUTH_TOKEN: null,
  CURRENT_ROLE: "INVITADO", // INVITADO por defecto al entrar al enlace público
  CURRENT_USER: {
    id_usuario: null,
    nombre: "Visitante (Invitado)",
    email: "",
    rol: "INVITADO",
  },
  GUEST_SESSION: null,
  USE_LOCAL_BACKEND: false,
};

let movementQueuePromise = Promise.resolve();

export function setActiveVehicleId(newId) {
  const num = Number(newId);
  if (Number.isInteger(num) && num > 0) {
    CONFIG.VEHICULO_ID = num;
  }
}

export function getActiveWsUrl() {
  const base = CONFIG.USE_LOCAL_BACKEND ? CONFIG.LOCAL_WS_BASE_URL : CONFIG.WS_BASE_URL;
  return `${base}/${CONFIG.VEHICULO_ID}`;
}

export function setAuthSession({ token = null, user = null, role = "INVITADO", guestSession = null }) {
  CONFIG.AUTH_TOKEN = token;
  CONFIG.CURRENT_ROLE = role;
  CONFIG.CURRENT_USER = user || {
    id_usuario: null,
    nombre: "Visitante (Invitado)",
    email: "",
    rol: "INVITADO",
  };
  CONFIG.GUEST_SESSION = guestSession;

  try {
    if (token && role !== "INVITADO") {
      sessionStorage.setItem(
        "iot_auth_session",
        JSON.stringify({ token, user: CONFIG.CURRENT_USER, role })
      );
    } else {
      sessionStorage.removeItem("iot_auth_session");
    }
  } catch (_) {
    // Ignorar errores de storage
  }
}

export function restoreSavedSession() {
  try {
    const raw = sessionStorage.getItem("iot_auth_session");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.role) {
      CONFIG.AUTH_TOKEN = parsed.token;
      CONFIG.CURRENT_ROLE = parsed.role;
      CONFIG.CURRENT_USER = parsed.user;
      return true;
    }
  } catch (_) {
    // Ignorar
  }
  return false;
}

async function fetchWithTimeout(endpoint, options = {}, customSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  if (customSignal) {
    customSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const method = (options.method || "GET").toUpperCase();
  const authHeaders = {};
  if (CONFIG.AUTH_TOKEN) {
    authHeaders["Authorization"] = `Bearer ${CONFIG.AUTH_TOKEN}`;
  }
  if (CONFIG.CURRENT_ROLE) {
    authHeaders["X-Session-Role"] = CONFIG.CURRENT_ROLE;
  }

  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...authHeaders,
    ...(options.headers || {}),
  };

  const primaryBase = CONFIG.USE_LOCAL_BACKEND ? CONFIG.LOCAL_FALLBACK_URL : CONFIG.API_BASE_URL;

  try {
    let response;
    try {
      response = await fetch(`${primaryBase}${endpoint}`, {
        ...options,
        method,
        mode: "cors",
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
    } catch (networkErr) {
      if (isLocalHost && !CONFIG.USE_LOCAL_BACKEND) {
        response = await fetch(`${CONFIG.LOCAL_FALLBACK_URL}${endpoint}`, {
          ...options,
          method,
          mode: "cors",
          cache: "no-store",
          signal: controller.signal,
          headers,
        });
        CONFIG.USE_LOCAL_BACKEND = true;
      } else {
        throw networkErr;
      }
    }

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

export async function checkApiHealth() {
  try {
    const data = await fetchWithTimeout(`/openapi.json`);
    const ok = Boolean(data && typeof data === "object" && (data.openapi || data.paths));
    return { ok, data };
  } catch (err) {
    return { ok: false, error: err?.message || "No disponible" };
  }
}

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
    if (err?.status === 403 || err?.status === 401) {
      return { ok: true, restricted: true };
    }
    return { ok: false, error: err?.message || "Sin verificar", status: err?.status };
  }
}

export async function fetchVehicleInfo(vehiculoId = CONFIG.VEHICULO_ID) {
  return await fetchWithTimeout(`/api/vehiculos/${vehiculoId}`);
}

export async function fetchVehicleLastState(customSignal = null, vehiculoId = CONFIG.VEHICULO_ID) {
  return await fetchWithTimeout(
    `/api/vehiculos/${vehiculoId}/estado`,
    { method: "GET" },
    customSignal
  );
}

export async function fetchVehicleHistory(customSignal = null, vehiculoId = CONFIG.VEHICULO_ID) {
  const data = await fetchWithTimeout(
    `/api/vehiculos/${vehiculoId}/historial`,
    { method: "GET" },
    customSignal
  );
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.historial)
      ? data.historial
      : [];
}

export async function fetchVehicleCommands(vehiculoId = CONFIG.VEHICULO_ID) {
  const data = await fetchWithTimeout(`/api/vehiculos/${vehiculoId}/comandos`);
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

export async function fetchDemos(vehiculoId = CONFIG.VEHICULO_ID) {
  const data = await fetchWithTimeout(`/api/vehiculos/${vehiculoId}/demos`);
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
    tipo_demo: demo.tipo_demo || "EMPRESA",
  }));
}

export async function fetchDemoMovements(demoId) {
  const data = await fetchWithTimeout(`/api/demos/${demoId}/movimientos`);
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.movimientos)
      ? data.movimientos
      : [];
}

export async function sendMovement(comandoId, origen = "WEB_CONTROL", vehiculoId = CONFIG.VEHICULO_ID) {
  const payload = {
    vehiculo_id: Number(vehiculoId),
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

export async function startDemoOnBackend(demoId, vehiculoId = CONFIG.VEHICULO_ID) {
  return await fetchWithTimeout(`/api/vehiculos/demo`, {
    method: "POST",
    body: JSON.stringify({
      vehiculo_id: Number(vehiculoId),
      demo_id: Number(demoId),
    }),
  });
}

export async function loginUser(email, password) {
  return await fetchWithTimeout(`/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchCurrentProfile() {
  return await fetchWithTimeout(`/api/auth/me`, { method: "GET" });
}

export async function requestGuestSession(idVehiculo, nombreInvitado = "Prospecto Comercial", duracionSegundos = 180) {
  return await fetchWithTimeout(`/api/auth/sesion-invitado`, {
    method: "POST",
    body: JSON.stringify({
      id_vehiculo: Number(idVehiculo),
      nombre_invitado: nombreInvitado,
      duracion_segundos: Number(duracionSegundos),
    }),
  });
}

export async function releaseGuestSession() {
  return await fetchWithTimeout(`/api/auth/sesion-invitado/liberar`, {
    method: "POST",
  });
}

export async function fetchAdminDashboard() {
  return await fetchWithTimeout(`/api/admin/dashboard`, { method: "GET" });
}

export async function fetchCommercialModels() {
  const data = await fetchWithTimeout(`/api/admin/modelos`, { method: "GET" });
  return Array.isArray(data?.modelos) ? data.modelos : [];
}

export async function createCommercialModel(payload) {
  return await fetchWithTimeout(`/api/admin/modelos`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchAuthorizedUnits() {
  const data = await fetchWithTimeout(`/api/admin/unidades`, { method: "GET" });
  return Array.isArray(data?.unidades) ? data.unidades : [];
}

export async function createPhysicalUnit(payload) {
  return await fetchWithTimeout(`/api/admin/unidades`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePhysicalUnit(idVehiculo, payload) {
  return await fetchWithTimeout(`/api/admin/unidades/${idVehiculo}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function assignUnitOwner(idVehiculo, idPropietario, estadoComercial = "VENDIDO") {
  return await fetchWithTimeout(`/api/admin/unidades/${idVehiculo}/asignar`, {
    method: "POST",
    body: JSON.stringify({
      id_propietario: idPropietario ? Number(idPropietario) : null,
      estado_comercial: estadoComercial,
    }),
  });
}

export async function toggleUnitSupportConsent(idVehiculo, soporteAutorizado) {
  return await fetchWithTimeout(`/api/unidades/${idVehiculo}/soporte`, {
    method: "POST",
    body: JSON.stringify({ soporte_autorizado: Boolean(soporteAutorizado) }),
  });
}

export async function fetchClients() {
  const data = await fetchWithTimeout(`/api/admin/clientes`, { method: "GET" });
  return Array.isArray(data?.clientes) ? data.clientes : [];
}

export async function createClient(payload) {
  return await fetchWithTimeout(`/api/admin/clientes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchAuditLog() {
  const data = await fetchWithTimeout(`/api/admin/auditoria`, { method: "GET" });
  return Array.isArray(data?.auditoria) ? data.auditoria : [];
}

export async function fetchAuthorizedDemosWithSteps(idVehiculo = CONFIG.VEHICULO_ID) {
  const data = await fetchWithTimeout(`/api/vehiculos/${idVehiculo}/demos-autorizadas`, {
    method: "GET",
  });
  return Array.isArray(data?.demos) ? data.demos : [];
}

export async function saveCompleteDemo(payload) {
  return await fetchWithTimeout(`/api/demos/guardar-completa`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function testCrossVehicleAccess(targetVehiculoId) {
  return await fetchWithTimeout(`/api/vehiculos/${targetVehiculoId}/estado`, {
    method: "GET",
  });
}
