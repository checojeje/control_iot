/**
 * @file app.js
 * @description Orquestador principal de la aplicación integrada CONTROL (4.1) + MONITOREO (4.2).
 * Comparte una única conexión WebSocket (WSS) y el cliente REST hacia AWS y Amazon RDS.
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
} from "./api.js?v=2";

import {
  switchActiveView,
  notifyUnreadMonitoringEvent,
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
} from "./ui.js?v=2";

import { VirtualJoystick } from "./joystick.js?v=2";
import { VehicleWebSocket } from "./ws.js?v=2";
import { MonitoringManager } from "./monitoring.js?v=2";

const state = {
  activeView: "control",
  commands: [],
  stopCommandId: 13,
  isDemoRunning: false,
  demoCancelRequested: false,
  demoSleepTimer: null,
  joystick: null,
  wsClient: null,
  monitoring: null,
  hasVerifiedOnce: false,
};

const FALLBACK_CATALOG = [
  { id: 1, codigo: "1", nombre: "Avanzar", activo: true },
  { id: 2, codigo: "2", nombre: "Retroceder", activo: true },
  { id: 3, codigo: "3", nombre: "Cabina Izquierda", activo: true },
  { id: 4, codigo: "4", nombre: "Cabina Derecha", activo: true },
  { id: 5, codigo: "5", nombre: "Girar Derecha", activo: true },
  { id: 6, codigo: "6", nombre: "Girar Izquierda", activo: true },
  { id: 7, codigo: "7", nombre: "Bajar Garra", activo: true },
  { id: 8, codigo: "8", nombre: "Subir Garra", activo: true },
  { id: 9, codigo: "9", nombre: "Luz", activo: true },
  { id: 10, codigo: "10", nombre: "Sonido", activo: true },
  { id: 11, codigo: "11", nombre: "Velocidad", activo: true },
  { id: 12, codigo: "12", nombre: "Demo", activo: true },
  { id: 13, codigo: "13", nombre: "Detener", activo: true },
];

/**
 * Inicialización al cargar el DOM
 */
document.addEventListener("DOMContentLoaded", async () => {
  initNavigationAndButtons();
  initJoystickControl();
  applyCommandCatalog(FALLBACK_CATALOG);

  // Inicializar módulo de MONITOREO (4.2)
  state.monitoring = new MonitoringManager({
    getCommandNameById: (id) => getCommandNameById(id),
    onSyncStatusChange: ({ ok }) => {
      if (ok) {
        setIndicatorState("api", "online", "Disponible");
        setIndicatorState("rds", "online", "Disponible");
      }
    },
  });

  // Iniciar conexión WSS única compartida entre CONTROL y MONITOREO
  initSharedWebSocketChannel();
  initLifecycleListeners();

  // Carga inicial paralela: Salud AWS/RDS + Catálogo CONTROL + Estado e Historial MONITOREO
  await Promise.all([
    verifyBackendAndDatabaseHealth(false),
    loadCatalogAndDemos(),
    state.monitoring.syncFromBackend({ reason: "CARGA_INICIAL", silent: false }),
  ]);

  // Verificación periódica moderada de disponibilidad API/RDS (sin reemplazar WSS para el historial)
  setInterval(() => {
    verifyBackendAndDatabaseHealth(true);
  }, 25000);
});

/**
 * Reconexión y resincronización al recuperar red o volver a la pestaña
 */
function initLifecycleListeners() {
  window.addEventListener("online", () => {
    hideErrorBanner();
    if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
      state.wsClient?.connect();
    }
    verifyBackendAndDatabaseHealth(true);
    state.monitoring?.syncFromBackend({ reason: "RECUPERACION_RED", silent: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
        state.wsClient?.connect();
      }
      verifyBackendAndDatabaseHealth(true);
      state.monitoring?.syncFromBackend({ reason: "CAMBIO_VISIBILIDAD", silent: true });
    }
  });
}

/**
 * Configura las pestañas CONTROL / MONITOREO y los botones principales
 */
function initNavigationAndButtons() {
  const tabControl = document.getElementById("tab-btn-control");
  const tabMonitoreo = document.getElementById("tab-btn-monitoreo");

  if (tabControl) {
    tabControl.addEventListener("click", () => {
      state.activeView = "control";
      switchActiveView("control");
    });
  }

  if (tabMonitoreo) {
    tabMonitoreo.addEventListener("click", () => {
      state.activeView = "monitoreo";
      switchActiveView("monitoreo");
      // Resincronizar estado e historial al entrar en MONITOREO para garantizar consistencia
      state.monitoring?.syncFromBackend({ reason: "ABRIR_MONITOREO", silent: true });
    });
  }

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
      await Promise.all([
        verifyBackendAndDatabaseHealth(false),
        loadCatalogAndDemos(),
        state.monitoring?.syncFromBackend({ reason: "BOTON_SINCRONIZAR", silent: false }),
      ]);
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

function getCommandNameById(comandoId) {
  const numericId = Number(comandoId);
  const found =
    state.commands.find((c) => Number(c.id) === numericId) ||
    FALLBACK_CATALOG.find((c) => Number(c.id) === numericId);
  return found ? found.nombre : "En espera";
}

/**
 * Inicia el canal WebSocket único compartido entre CONTROL y MONITOREO
 */
function initSharedWebSocketChannel() {
  state.wsClient = new VehicleWebSocket({
    onOpenCallback: () => {
      setIndicatorState("ws", "online", "En línea");
    },
    onReconnectCallback: () => {
      // Regla 7.4: Al recuperar conexión WSS, volver a consultar estado y los 10 movimientos desde la API
      state.monitoring?.syncFromBackend({ reason: "RECONEXION_WSS", silent: true });
    },
    onEventCallback: (payload) => {
      const evento = String(payload.evento || "");

      if (evento === "CONEXION_ESTABLECIDA") {
        setIndicatorState("ws", "online", "En línea");
        return;
      }

      // Actualizar vista MONITOREO en tiempo real ante cualquier evento del vehículo
      state.monitoring?.handleRealtimeWsEvent(payload);

      if (state.activeView !== "monitoreo") {
        notifyUnreadMonitoringEvent();
      }

      // Actualizar indicadores de la vista CONTROL
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
 * Comprueba de forma independiente la salud de API AWS (21 servicios) y el diagnóstico de Amazon RDS
 */
async function verifyBackendAndDatabaseHealth(silent = false) {
  if (!silent && !state.hasVerifiedOnce) {
    setIndicatorState("api", "checking", "Comprobando");
    setIndicatorState("rds", "checking", "Sin verificar");
  }

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
    // Mantener catálogo base
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
 * Envía un comando de movimiento individual al backend y dispara reconciliación en MONITOREO
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
    // Reconciliar estado e historial confirmado en RDS
    state.monitoring?.scheduleRestReconciliation("COMANDO_LOCAL_CONFIRMADO");
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
 * Ejecuta una secuencia DEMO en el backend (/api/vehiculos/demo) sin contaminar el historial individual
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
      state.monitoring?.scheduleRestReconciliation("FIN_DEMO_CONFIRMADO");
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

function waitInterruptible(ms) {
  return new Promise((resolve) => {
    state.demoSleepTimer = setTimeout(() => {
      state.demoSleepTimer = null;
      resolve();
    }, ms);
  });
}
