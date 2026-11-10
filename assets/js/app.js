/**
 * @file app.js
 * @description Orquestador principal de la aplicación de Control IoT (Joystick, Botones, DEMO, REST y WSS)
 */

import {
  checkApiHealth,
  checkRdsHealth,
  fetchVehicleInfo,
  fetchVehicleCommands,
  fetchDemos,
  fetchDemoMovements,
  sendMovement,
  startDemoOnBackend,
} from "./api.js?v=7";

import {
  setIndicatorState,
  showErrorBanner,
  hideErrorBanner,
  updateActiveCommandBadge,
   updateJoystickTelemetry,
  renderActionButtons,
  populateDemoSelect,
  setDemoProgressUI,
  setControlsDisabled,
  highlightActiveButton,
} from "./ui.js?v=7";

import { VirtualJoystick } from "./joystick.js?v=7";
import { VehicleWebSocket } from "./ws.js?v=7";

const state = {
  commands: [],
  stopCommandId: 13,
  isDemoRunning: false,
  demoCancelRequested: false,
  demoSleepTimer: null,
  joystick: null,
  wsClient: null,
  hasVerifiedOnce: false,
};

const FALLBACK_CATALOG = [
  { id: 1, codigo: "AVANZAR", nombre: "Avanzar", activo: true },
  { id: 2, codigo: "RETROCEDER", nombre: "Retroceder", activo: true },
  { id: 3, codigo: "CABINA_IZQ", nombre: "Cabina Izquierda", activo: true },
  { id: 4, codigo: "CABINA_DER", nombre: "Cabina Derecha", activo: true },
  { id: 5, codigo: "GIRAR_DER", nombre: "Girar Derecha", activo: true },
  { id: 6, codigo: "GIRAR_IZQ", nombre: "Girar Izquierda", activo: true },
  { id: 7, codigo: "BAJAR_GARRA", nombre: "Bajar Garra", activo: true },
  { id: 8, codigo: "SUBIR_GARRA", nombre: "Subir Garra", activo: true },
  { id: 9, codigo: "LUZ", nombre: "Luz", activo: true },
  { id: 10, codigo: "SONIDO", nombre: "Sonido", activo: true },
  { id: 11, codigo: "VELOCIDAD", nombre: "Velocidad", activo: true },
  { id: 12, codigo: "DEMO", nombre: "Demo", activo: true },
  { id: 13, codigo: "DETENER", nombre: "Detener", activo: true },
];

/**
 * Inicialización inmediata al cargar el DOM
 */
document.addEventListener("DOMContentLoaded", async () => {
  initUIEventListeners();
  initJoystickControl();
  applyCommandCatalog(FALLBACK_CATALOG);

  // Conectar WebSocket y verificar API + RDS de inmediato en paralelo
  initWebSocketChannel();
  initMobileLifecycleListeners();

  await Promise.all([
    verifyBackendAndDatabaseHealth(false),
    loadCatalogAndDemos(),
  ]);

  // Verificación periódica silenciosa cada 20 segundos
  setInterval(() => {
    verifyBackendAndDatabaseHealth(true);
  }, 20000);
});

/**
 * Reconecta automáticamente en teléfonos móviles o al volver a la pestaña
 */
function initMobileLifecycleListeners() {
  window.addEventListener("online", () => {
    hideErrorBanner();
    if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
      state.wsClient?.connect();
    }
    verifyBackendAndDatabaseHealth(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
        state.wsClient?.connect();
      }
      verifyBackendAndDatabaseHealth(true);
    }
  });
}

/**
 * Registra eventos de botones fijos (DETENER, DEMO, Sincronizar)
 */
function initUIEventListeners() {
  const btnCloseError = document.getElementById("btn-close-error");
  if (btnCloseError) {
    btnCloseError.addEventListener("click", () => hideErrorBanner());
  }

  const btnRefresh = document.getElementById("btn-refresh-health");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", async () => {
      hideErrorBanner();
      if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
        state.wsClient?.reconnectNow();
      } else {
        setIndicatorState("ws", "online", "En línea");
      }
      await verifyBackendAndDatabaseHealth(false);
      await loadCatalogAndDemos();
    });
  }

  const btnPriorityStop = document.getElementById("btn-priority-stop");
  if (btnPriorityStop) {
    btnPriorityStop.addEventListener("click", () => {
      executePriorityStop("BOTÓN DETENER");
    });
  }

  const btnStartDemo = document.getElementById("btn-start-demo");
  if (btnStartDemo) {
    btnStartDemo.addEventListener("click", () => {
      const selectEl = document.getElementById("select-demo");
      const demoId = selectEl ? Number(selectEl.value) : 1;
      if (!demoId) {
        showErrorBanner("Selecciona una DEMO válida antes de iniciar.");
        return;
      }
      runDemoSequence(demoId);
    });
  }

  const btnCancelDemo = document.getElementById("btn-cancel-demo");
  if (btnCancelDemo) {
    btnCancelDemo.addEventListener("click", () => {
      executePriorityStop("CANCELAR DEMO");
    });
  }
}

/**
 * Configura el joystick virtual
 */
function initJoystickControl() {
  const baseEl = document.getElementById("joystick-base");
  const handleEl = document.getElementById("joystick-handle");

  state.joystick = new VirtualJoystick({
    baseEl,
    handleEl,
    onDirectionChange: async (direction) => {
      if (state.isDemoRunning && direction.key !== "NEUTRAL") {
        showErrorBanner("Hay una DEMO en curso. Cancélala o presiona DETENER primero.");
        return;
      }
      await dispatchVehicleCommand(direction.id, direction.label, "WEB_JOYSTICK");
    },
  });
}

/**
 * Obtiene el nombre legible de un comando a partir de su ID
 */
function getCommandNameById(comandoId) {
  const numericId = Number(comandoId);
  const found =
    state.commands.find((c) => Number(c.id) === numericId) ||
    FALLBACK_CATALOG.find((c) => Number(c.id) === numericId);
  return found ? found.nombre : "En espera";
}

/**
 * Inicia el canal WebSocket hacia AWS
 */
function initWebSocketChannel() {
  state.wsClient = new VehicleWebSocket({
    onOpenCallback: () => {
      setIndicatorState("ws", "online", "En línea");
    },
    onEventCallback: (payload) => {
      const evento = String(payload.evento || "");

      if (evento === "CONEXION_ESTABLECIDA") {
        setIndicatorState("ws", "online", "En línea");
        return;
      }

      if (evento === "NUEVO_MOVIMIENTO") {
        const cmdId = Number(payload.comando_id ?? payload.datos?.comando_id);
        const nombreCmd = payload.datos?.comando || getCommandNameById(cmdId);
        const isStop = cmdId === state.stopCommandId;
        updateActiveCommandBadge(nombreCmd, isStop);
        highlightActiveButton(cmdId);
        if (!state.joystick?.isDragging) {
          updateJoystickTelemetry({
            angle: 0,
            distancePercent: isStop ? 0 : 100,
            directionLabel: nombreCmd,
          });
        }
        return;
      }

      if (evento === "MOVIMIENTO_DEMO") {
        const cmdId = Number(payload.comando_id);
        const nombreCmd = getCommandNameById(cmdId);
        updateActiveCommandBadge(`DEMO · ${nombreCmd}`, false);
        highlightActiveButton(cmdId);
        updateJoystickTelemetry({
          angle: 0,
          distancePercent: 100,
          directionLabel: `DEMO: ${nombreCmd}`,
        });
        return;
      }

      if (evento === "FIN_DEMO") {
        updateActiveCommandBadge("Detener", true);
        updateJoystickTelemetry({
          angle: 0,
          distancePercent: 0,
          directionLabel: "En espera",
        });
      }
    },
  });

  state.wsClient.connect();
}

/**
 * Comprueba en paralelo el estado de los indicadores: API AWS (21 servicios) y Amazon RDS
 */
async function verifyBackendAndDatabaseHealth(silent = false) {
  if (!silent && !state.hasVerifiedOnce) {
    setIndicatorState("api", "checking", "Comprobando");
    setIndicatorState("rds", "checking", "Sin verificar");
  }

  // Consultar el estado en RDS primero o en paralelo: si /api/vehiculos/1/estado responde,
  // confirma tanto que el servidor FastAPI en AWS como Amazon RDS están en línea.
  const [rdsResult, apiResult] = await Promise.all([
    checkRdsHealth(),
    checkApiHealth(),
  ]);

  state.hasVerifiedOnce = true;

  if (rdsResult.ok) {
    setIndicatorState("api", "online", "Disponible");
    setIndicatorState("rds", "online", "Disponible");

    const estado = rdsResult.data;
    if (estado?.vehiculo) {
      const titleEl = document.getElementById("vehicle-title");
      if (titleEl) titleEl.textContent = String(estado.vehiculo).toUpperCase();
    }
    if (estado?.comando && !state.isDemoRunning && !state.joystick?.isDragging) {
      const cmdName = String(estado.comando);
      const isStop =
        Number(estado.id_comando) === state.stopCommandId ||
        cmdName.toLowerCase().includes("detener");
      updateActiveCommandBadge(cmdName, isStop);
    }
    return true;
  }

  if (apiResult.ok) {
    setIndicatorState("api", "online", "Disponible");
    setIndicatorState("rds", "offline", "No disponible");
    return false;
  }

  setIndicatorState("api", "offline", "No disponible");
  setIndicatorState("rds", "offline", "No disponible");
  return false;
}

/**
 * Carga información del vehículo, su catálogo de comandos y las DEMO disponibles
 */
async function loadCatalogAndDemos() {
  try {
    const vehicle = await fetchVehicleInfo();
    if (vehicle && vehicle.nombre) {
      const titleEl = document.getElementById("vehicle-title");
      if (titleEl) titleEl.textContent = String(vehicle.nombre).toUpperCase();
    }
  } catch (_) {
    // Mantener título por defecto
  }

  try {
    const commands = await fetchVehicleCommands();
    if (Array.isArray(commands) && commands.length > 0) {
      applyCommandCatalog(commands);
      setIndicatorState("api", "online", "Disponible");
      setIndicatorState("rds", "online", "Disponible");
    }
  } catch (_) {
    // Mantener catálogo base ya renderizado
  }

  try {
    const demos = await fetchDemos();
    if (Array.isArray(demos) && demos.length > 0) {
      populateDemoSelect(demos);
    } else {
      populateDemoSelect([{ id: 1, nombre: "Demo principal" }]);
    }
  } catch (_) {
    populateDemoSelect([{ id: 1, nombre: "Demo principal" }]);
  }
}

/**
 * Aplica el catálogo de comandos separando los 5 del joystick de los controles secundarios
 */
function applyCommandCatalog(commands) {
  state.commands = commands.filter((c) => c.activo !== false);

  const findCmd = (keywords, fallbackId) =>
    state.commands.find((c) =>
      keywords.some(
        (kw) =>
          c.nombre.toLowerCase().includes(kw) ||
          (c.codigo && String(c.codigo).toLowerCase().includes(kw))
      )
    ) || state.commands.find((c) => Number(c.id) === fallbackId);

  const cmdUp = findCmd(["avanzar", "adelante"], 1);
  const cmdDown = findCmd(["retroceder", "atras"], 2);
  const cmdRight = findCmd(["girar derecha"], 5);
  const cmdLeft = findCmd(["girar izquierda"], 6);
  const cmdStop = findCmd(["detener", "stop", "paro"], 13);
  const cmdDemo = findCmd(["demo"], 12);

  if (cmdStop) state.stopCommandId = Number(cmdStop.id);

  state.joystick?.setCommandMapping({
    UP: cmdUp,
    DOWN: cmdDown,
    LEFT: cmdLeft,
    RIGHT: cmdRight,
    NEUTRAL: cmdStop,
  });

  const excludedIds = new Set(
    [cmdUp?.id, cmdDown?.id, cmdLeft?.id, cmdRight?.id, cmdStop?.id, cmdDemo?.id]
      .filter(Boolean)
      .map(Number)
  );

  const secondaryCommands = state.commands.filter((c) => !excludedIds.has(Number(c.id)));

  renderActionButtons(secondaryCommands, async (cmd) => {
    if (state.isDemoRunning) {
      showErrorBanner("No puedes enviar comandos manuales mientras se ejecuta una DEMO.");
      return;
    }
    await dispatchVehicleCommand(cmd.id, cmd.nombre, "WEB_BOTON");
  });
}

/**
 * Envía un comando de movimiento individual al backend
 */
async function dispatchVehicleCommand(comandoId, nombreComando, origen = "WEB_CONTROL") {
  hideErrorBanner();
  const isStop = Number(comandoId) === state.stopCommandId;

  updateActiveCommandBadge(nombreComando, isStop);
  highlightActiveButton(comandoId);

  try {
    await sendMovement(comandoId, origen);
    setIndicatorState("api", "online", "Disponible");
    setIndicatorState("rds", "online", "Disponible");
  } catch (err) {
    const msg = err?.message || "";
    if (!msg || msg === "SUPERSEDED" || msg === "undefined") {
      return;
    }
    showErrorBanner(`No se pudo enviar «${nombreComando}»: ${msg}`);
  }
}

/**
 * DETENCIÓN PRIORITARIA: Cancela cualquier DEMO en curso, centra el joystick y envía DETENER
 */
async function executePriorityStop(motivo = "DETENCIÓN PRIORITARIA") {
  hideErrorBanner();

  if (state.isDemoRunning) {
    state.demoCancelRequested = true;
    if (state.demoSleepTimer) {
      clearTimeout(state.demoSleepTimer);
      state.demoSleepTimer = null;
    }
    state.isDemoRunning = false;
    state.joystick?.setDisabled(false);
    setControlsDisabled(false);
    setDemoProgressUI({
      active: false,
      stepText: "Secuencia cancelada",
      percent: 0,
    });
  }

  state.joystick?.resetToCenter(false);
  await dispatchVehicleCommand(state.stopCommandId, "Detener", `PRIORIDAD_${motivo}`);
}

/**
 * Ejecuta una secuencia DEMO en el backend (/api/vehiculos/demo) y muestra progreso visual
 */
async function runDemoSequence(demoId) {
  if (state.isDemoRunning) {
    showErrorBanner("Ya hay una secuencia DEMO en ejecución.");
    return;
  }

  hideErrorBanner();
  state.isDemoRunning = true;
  state.demoCancelRequested = false;
  state.joystick?.setDisabled(true);
  setControlsDisabled(true);

  setDemoProgressUI({
    active: true,
    stepText: "Ejecutando secuencia DEMO...",
    percent: 15,
  });

  try {
    // Dispara la ejecución real en el backend (/api/vehiculos/demo) en paralelo con el progreso visual
    const backendDemoPromise = startDemoOnBackend(demoId);
    const steps = await fetchDemoMovements(demoId).catch(() => []);

    if (Array.isArray(steps) && steps.length > 0) {
      const sortedSteps = [...steps].sort((a, b) => (a.orden || 0) - (b.orden || 0));
      const total = sortedSteps.length;

      for (let i = 0; i < total; i++) {
        if (state.demoCancelRequested) break;

        const step = sortedSteps[i];
        const stepNum = i + 1;
        const pct = Math.round((stepNum / total) * 100);
        const cmdName = step.comando || getCommandNameById(step.id_comando);
        const durationMs = Number(step.duracion_ms) || (Number(step.duracion_segundos) || 1) * 1000;
        const pauseMs = Number(step.pausa_ms) || (Number(step.pausa_segundos) || 0) * 1000;

        if (pauseMs > 0) {
          await waitInterruptible(pauseMs);
          if (state.demoCancelRequested) break;
        }

        setDemoProgressUI({
          active: true,
          stepText: `Paso ${stepNum}/${total}: ${cmdName}`,
          percent: pct,
        });
        updateActiveCommandBadge(`DEMO · ${cmdName}`, false);

        await waitInterruptible(durationMs);
      }
    } else {
      await backendDemoPromise;
    }

    await backendDemoPromise.catch(() => {});

    if (!state.demoCancelRequested) {
      updateActiveCommandBadge("Detener", true);
    }
  } catch (err) {
    if (!state.demoCancelRequested) {
      showErrorBanner(`Error durante la DEMO: ${err?.message || "Error de conexión"}`);
    }
  } finally {
    state.isDemoRunning = false;
    state.demoCancelRequested = false;
    state.joystick?.setDisabled(false);
    setControlsDisabled(false);
    setDemoProgressUI({ active: false });
  }
}

/**
 * Promesa de espera cancelable inmediatamente por executePriorityStop
 */
function waitInterruptible(ms) {
  return new Promise((resolve) => {
    state.demoSleepTimer = setTimeout(() => {
      state.demoSleepTimer = null;
      resolve();
    }, ms);
  });
}
