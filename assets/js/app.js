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
  registerDemoExecution,
} from "./api.js?v=6";

import {
  setIndicatorState,
  showErrorBanner,
  hideErrorBanner,
  updateActiveCommandBadge,
  renderActionButtons,
  populateDemoSelect,
  setDemoProgressUI,
  setControlsDisabled,
  highlightActiveButton,
} from "./ui.js?v=6";

import { VirtualJoystick, JOYSTICK_DIRECTIONS } from "./joystick.js?v=6";
import { VehicleWebSocket } from "./ws.js?v=6";

const state = {
  commands: [],
  stopCommandId: 13,
  isDemoRunning: false,
  demoCancelRequested: false,
  demoSleepTimer: null,
  joystick: null,
  wsClient: null,
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
 * Inicialización al cargar el DOM
 */
document.addEventListener("DOMContentLoaded", async () => {
  initUIEventListeners();
  initJoystickControl();
  initWebSocketChannel();
  initMobileLifecycleListeners();

  // Renderizar catálogo base inmediatamente para respuesta instantánea
  applyCommandCatalog(FALLBACK_CATALOG);

  await verifyBackendAndDatabaseHealth();
  await loadCatalogAndDemos();
});

/**
 * Reconecta automáticamente en teléfonos móviles al volver a abrir la pestaña o recuperar red
 */
function initMobileLifecycleListeners() {
  window.addEventListener("online", () => {
    hideErrorBanner();
    state.wsClient?.reconnectNow();
    verifyBackendAndDatabaseHealth();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!state.wsClient?.socket || state.wsClient.socket.readyState !== WebSocket.OPEN) {
        state.wsClient?.connect();
      }
      verifyBackendAndDatabaseHealth();
    }
  });
}

/**
 * Registra eventos de botones fijos (DETENER, DEMO, Reintentar)
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
      state.wsClient?.reconnectNow();
      await verifyBackendAndDatabaseHealth();
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
      const demoId = selectEl ? Number(selectEl.value) : 0;
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
 * Inicia el canal WebSocket hacia AWS
 */
function initWebSocketChannel() {
  state.wsClient = new VehicleWebSocket({
    onOpenCallback: () => {
      // Si el WebSocket abre en móvil, re-verificar indicadores si estaban pendientes
      const apiText = document.getElementById("status-api-text")?.textContent;
      if (apiText !== "Disponible") {
        verifyBackendAndDatabaseHealth();
      }
    },
    onEventCallback: (payload) => {
      if (payload.evento === "NUEVO_MOVIMIENTO" && payload.datos) {
        const nombreCmd = payload.datos.comando || `Comando`;
        updateActiveCommandBadge(nombreCmd, payload.datos.comando_id === state.stopCommandId);
        highlightActiveButton(payload.datos.comando_id);
      }
    },
  });

  state.wsClient.connect();
}

/**
 * Comprueba en paralelo el estado de los indicadores: API AWS (21 servicios) y Amazon RDS
 */
async function verifyBackendAndDatabaseHealth() {
  setIndicatorState("api", "checking", "Comprobando");
  setIndicatorState("rds", "checking", "Sin verificar");

  const [apiResult, rdsResult] = await Promise.all([checkApiHealth(), checkRdsHealth()]);

  if (rdsResult.ok) {
    // Si Amazon RDS respondió desde FastAPI, tanto la API como RDS están 100% disponibles
    setIndicatorState("api", "online", "Disponible");
    setIndicatorState("rds", "online", "Disponible");
    if (rdsResult.data?.ultimo_comando) {
      updateActiveCommandBadge(
        rdsResult.data.ultimo_comando,
        rdsResult.data.ultimo_comando.toLowerCase().includes("detener")
      );
    }
    return;
  }

  if (apiResult.ok) {
    setIndicatorState("api", "online", "Disponible");
    setIndicatorState("rds", "offline", "No disponible");
  } else {
    setIndicatorState("api", "offline", "No disponible");
    setIndicatorState("rds", "offline", "No disponible");
  }
}

/**
 * Carga información del vehículo, su catálogo de comandos y las DEMO disponibles
 */
async function loadCatalogAndDemos() {
  try {
    const vehicle = await fetchVehicleInfo();
    if (vehicle && vehicle.nombre) {
      const titleEl = document.getElementById("vehicle-title");
      if (titleEl) titleEl.textContent = vehicle.nombre.toUpperCase();
    }
  } catch (_) {
    // Mantener título por defecto
  }

  try {
    const commands = await fetchVehicleCommands();
    if (Array.isArray(commands) && commands.length > 0) {
      applyCommandCatalog(commands);
    }
  } catch (_) {
    // Mantener catálogo base ya renderizado
  }

  try {
    const demos = await fetchDemos();
    populateDemoSelect(demos);
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
          (c.codigo && c.codigo.toLowerCase().includes(kw))
      )
    ) || state.commands.find((c) => c.id === fallbackId);

  const cmdUp = findCmd(["avanzar", "adelante"], 1);
  const cmdDown = findCmd(["retroceder", "atras"], 2);
  const cmdRight = findCmd(["girar derecha"], 5);
  const cmdLeft = findCmd(["girar izquierda"], 6);
  const cmdStop = findCmd(["detener", "stop", "paro"], 13);
  const cmdDemo = findCmd(["demo"], 12);

  if (cmdStop) state.stopCommandId = cmdStop.id;

  state.joystick?.setCommandMapping({
    UP: cmdUp,
    DOWN: cmdDown,
    LEFT: cmdLeft,
    RIGHT: cmdRight,
    NEUTRAL: cmdStop,
  });

  const excludedIds = new Set(
    [cmdUp?.id, cmdDown?.id, cmdLeft?.id, cmdRight?.id, cmdStop?.id, cmdDemo?.id].filter(Boolean)
  );

  const secondaryCommands = state.commands.filter((c) => !excludedIds.has(c.id));

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
  const isStop = comandoId === state.stopCommandId;

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
 * Ejecuta una secuencia DEMO consultando sus N pasos desde el backend y respetando duración y pausa
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
    stepText: "Preparando secuencia...",
    percent: 5,
  });

  try {
    await registerDemoExecution(demoId);
    const steps = await fetchDemoMovements(demoId);

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("La DEMO seleccionada no tiene movimientos configurados.");
    }

    const sortedSteps = [...steps].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const total = sortedSteps.length;

    for (let i = 0; i < total; i++) {
      if (state.demoCancelRequested) break;

      const step = sortedSteps[i];
      const stepNum = i + 1;
      const pct = Math.round((stepNum / total) * 100);
      const durationSec = Number(step.duracion_segundos) || 2;
      const pauseSec = Number(step.pausa_segundos) || 0;

      setDemoProgressUI({
        active: true,
        stepText: `Paso ${stepNum}/${total}: ${step.comando} (${durationSec}s)`,
        percent: pct,
      });

      updateActiveCommandBadge(`DEMO · ${step.comando}`, false);

      await waitInterruptible(durationSec * 1000);
      if (state.demoCancelRequested) break;

      if (pauseSec > 0) {
        setDemoProgressUI({
          active: true,
          stepText: `Pausa (${pauseSec}s)...`,
          percent: pct,
        });
        await waitInterruptible(pauseSec * 1000);
      }
    }

    if (!state.demoCancelRequested) {
      await sendMovement(state.stopCommandId, "FIN_DEMO");
      updateActiveCommandBadge("Detener", true);
    }
  } catch (err) {
    showErrorBanner(`Error durante la DEMO: ${err?.message || "Error de conexión"}`);
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
