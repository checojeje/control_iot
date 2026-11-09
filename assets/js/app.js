/**
 * ORQUESTADOR PRINCIPAL DE LA APLICACIÓN (assets/js/app.js)
 * Centraliza la validación y el despacho único de comandos para Joystick, Botones y DETENER,
 * gestiona los estados visuales, evita DEMO simultáneas y actualiza los 3 indicadores de conectividad.
 */

import {
  updateServiceStatus,
  setDispatchStateBadge,
  setActionButtonState,
  setAllActionButtonsDisabled,
  showAlert,
  updateJoystickTelemetry,
  updateDemoStatusBadge,
  renderDemoOptions,
  renderActionButtons,
} from "./ui.js?v=4";

import {
  checkApiHealth,
  checkRdsHealth,
  fetchCommands,
  sendMovement,
  fetchDemos,
  startDemo,
  cancelDemo,
} from "./api.js?v=4";

import { VehicleWebSocketClient } from "./ws.js?v=4";
import {
  CircularJoystick,
  COMMAND_IDS,
  isValidCommandId,
  getCommandNameById,
  syncCommandIdsFromCatalog,
} from "./joystick.js?v=4";

let wsClient = null;
let joystickController = null;
let isDemoRunning = false;
let isSendingCommand = false;
const HEALTH_POLL_INTERVAL_MS = 20000;

async function verifyBackendAndDatabaseHealth() {
  updateServiceStatus("api", "connecting", "Comprobando");
  updateServiceStatus("rds", "connecting", "Sin verificar");

  const apiResult = await checkApiHealth();

  if (apiResult.ok) {
    updateServiceStatus("api", "connected", "Disponible");
  } else {
    updateServiceStatus("api", "disconnected", "No disponible");
    updateServiceStatus("rds", "connecting", "Sin verificar");
    return false;
  }

  const rdsResult = await checkRdsHealth();

  if (rdsResult.ok) {
    updateServiceStatus("rds", "connected", "Disponible");
    const estado = rdsResult.data;
    if (estado) {
      if (estado.vehiculo) {
        const titleEl = document.getElementById("vehicle-title");
        if (titleEl) titleEl.textContent = String(estado.vehiculo);
      }
      if (
        estado.id_comando &&
        !isDemoRunning &&
        (!joystickController || !joystickController.isDragging)
      ) {
        const cmdId = Number(estado.id_comando);
        const cmdName = String(estado.comando || getCommandNameById(cmdId));
        const isStopped = cmdId === COMMAND_IDS.DETENER;
        updateJoystickTelemetry({
          angle: 0,
          force: isStopped ? 0 : 100,
          direction: cmdName,
          commandLabel: cmdName,
        });
      }
    }
  } else {
    updateServiceStatus("rds", "disconnected", "No disponible");
  }

  return apiResult.ok && rdsResult.ok;
}

async function loadInitialCatalogs() {
  try {
    const commands = await fetchCommands();
    if (commands.length > 0) {
      syncCommandIdsFromCatalog(commands);
      renderActionButtons(commands, (cmdId, cmdName) => {
        executeMovementCommand(cmdId, cmdName, "WEB_BOTON");
      });
    }
  } catch {
    // Mantiene los botones iniciales en caso de fallo de red
  }

  try {
    const demos = await fetchDemos();
    if (demos.length > 0) {
      renderDemoOptions(demos);
    }
  } catch {
    // Mantiene la opción inicial en caso de fallo de red
  }
}

async function executeMovementCommand(
  comandoId,
  commandName,
  origen = "WEB_JOYSTICK"
) {
  const numericId = Number(comandoId);
  const isPriorityStop = numericId === COMMAND_IDS.DETENER;

  if (!isValidCommandId(numericId)) {
    return;
  }

  if (isDemoRunning && !isPriorityStop) {
    showAlert("Cancela primero el modo DEMO para usar los controles manuales.", "warning");
    return;
  }

  if (isSendingCommand && !isPriorityStop && origen === "WEB_BOTON") {
    return;
  }

  isSendingCommand = true;
  setDispatchStateBadge("sending", "Enviando...");
  setActionButtonState(numericId, "pressed");
  setActionButtonState(numericId, "sending");

  updateJoystickTelemetry({
    angle: 0,
    force: isPriorityStop ? 0 : 100,
    direction: commandName,
    commandLabel: commandName,
  });

  try {
    await sendMovement(numericId, origen);
    setDispatchStateBadge("accepted", commandName);
    setActionButtonState(numericId, "accepted");

    setTimeout(() => {
      setActionButtonState(numericId, isDemoRunning ? "disabled" : "normal");
      setDispatchStateBadge("normal", "Listo");
    }, 800);
  } catch (error) {
    if (
      !error ||
      error === "SUPERSEDED" ||
      error.isSuperseded ||
      error.name === "AbortError" ||
      !error.message
    ) {
      setActionButtonState(numericId, "normal");
      return;
    }

    setDispatchStateBadge("error", "Error");
    setActionButtonState(numericId, "error");
    showAlert(`No se pudo enviar «${commandName}»`, "danger");

    setTimeout(() => {
      setActionButtonState(numericId, isDemoRunning ? "disabled" : "normal");
    }, 1500);
  } finally {
    isSendingCommand = false;
  }
}

function setDemoLockState(running) {
  isDemoRunning = Boolean(running);
  const startDemoBtn = document.getElementById("btn-start-demo");
  const selectDemoEl = document.getElementById("select-demo");

  if (startDemoBtn) startDemoBtn.disabled = isDemoRunning;
  if (selectDemoEl) selectDemoEl.disabled = isDemoRunning;

  setAllActionButtonsDisabled(isDemoRunning);
  if (joystickController) {
    joystickController.setDisabled(isDemoRunning);
  }
}

function bindUiEvents() {
  const stopBtn = document.getElementById("btn-emergency-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      if (joystickController) {
        joystickController.resetToCenter(false);
      }
      if (isDemoRunning) {
        setDemoLockState(false);
        updateDemoStatusBadge("cancelled", "Detenida");
        try {
          await cancelDemo(COMMAND_IDS.DETENER);
        } catch {
          // Continúa con el envío prioritario de Detener
        }
      }
      await executeMovementCommand(COMMAND_IDS.DETENER, "Detener", "PARO_PRIORITARIO");
      showAlert("Vehículo detenido.", "warning", 1800);
    });
  }

  const staticActionButtons = document.querySelectorAll(".btn-action-cmd");
  staticActionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmdId = Number(btn.dataset.cmdId) || COMMAND_IDS.DETENER;
      const cmdName = btn.dataset.cmdName || getCommandNameById(cmdId);
      executeMovementCommand(cmdId, cmdName, "WEB_BOTON");
    });
  });

  const startDemoBtn = document.getElementById("btn-start-demo");
  const selectDemoEl = document.getElementById("select-demo");

  if (startDemoBtn && selectDemoEl) {
    startDemoBtn.addEventListener("click", async () => {
      if (isDemoRunning) return;

      const demoId = Number(selectDemoEl.value);
      if (!demoId) return;

      try {
        setDemoLockState(true);
        updateDemoStatusBadge("running", "En ejecución");
        await startDemo(demoId);
        updateDemoStatusBadge("idle", "Finalizada");
        showAlert("Demostración completada.", "success", 2200);
      } catch (error) {
        if (!error || !error.isSuperseded) {
          updateDemoStatusBadge("idle", "Inactivo");
          showAlert("No se pudo iniciar la demostración.", "danger");
        }
      } finally {
        setDemoLockState(false);
      }
    });
  }

  const cancelDemoBtn = document.getElementById("btn-cancel-demo");
  if (cancelDemoBtn) {
    cancelDemoBtn.addEventListener("click", async () => {
      setDemoLockState(false);
      updateDemoStatusBadge("cancelled", "Cancelada");

      try {
        await cancelDemo(COMMAND_IDS.DETENER);
      } catch {
        // Continúa con el paro prioritario
      } finally {
        await executeMovementCommand(COMMAND_IDS.DETENER, "Detener", "CANCELAR_DEMO");
        showAlert("Demostración cancelada.", "warning", 2000);
      }
    });
  }

  const refreshHealthBtn = document.getElementById("btn-refresh-health");
  if (refreshHealthBtn) {
    refreshHealthBtn.addEventListener("click", async () => {
      await verifyBackendAndDatabaseHealth();
      await loadInitialCatalogs();
      if (wsClient && (!wsClient.socket || wsClient.socket.readyState !== WebSocket.OPEN)) {
        wsClient.connect();
      }
    });
  }
}

async function initApp() {
  const baseElement = document.getElementById("joystick-zone");
  const knobElement = document.getElementById("joystick-knob");

  joystickController = new CircularJoystick({
    baseElement,
    knobElement,
    rateLimitMs: 180,
    deadzoneRatio: 0.22,
    onCommand: (comandoId, commandLabel) => {
      executeMovementCommand(comandoId, commandLabel, "WEB_JOYSTICK");
    },
  });

  bindUiEvents();

  wsClient = new VehicleWebSocketClient({
    onMessageCallback: (payload) => {
      if (payload.evento === "INICIO_DEMO") {
        setDemoLockState(true);
      } else if (payload.evento === "FIN_DEMO") {
        setDemoLockState(false);
      }
    },
  });
  wsClient.connect();

  await verifyBackendAndDatabaseHealth();
  await loadInitialCatalogs();

  setInterval(() => {
    verifyBackendAndDatabaseHealth();
  }, HEALTH_POLL_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", initApp);
