/**
 * ORQUESTADOR PRINCIPAL DE LA APLICACIÓN (js/app.js)
 * Centraliza la validación y el despacho único de comandos para Joystick, Botones y DETENER,
 * gestiona los estados visuales (normal, presionado, enviando, aceptado, error, deshabilitado),
 * evita DEMO simultáneas y actualiza los 3 indicadores reales de conectividad:
 * - WebSocket WSS (En línea / Conectando-Reconectando / Desconectado)
 * - Servidor AWS de 21 APIs (Disponible / Comprobando / No disponible)
 * - Amazon RDS (Disponible / No disponible / Sin verificar)
 */

import {
  updateServiceStatus,
  setDispatchStateBadge,
  setActionButtonState,
  setAllActionButtonsDisabled,
  showAlert,
  appendEventLog,
  clearEventLog,
  updateJoystickTelemetry,
  updateDemoStatusBadge,
  renderDemoOptions,
  renderActionButtons,
} from "./ui.js?v=2";

import {
  checkApiHealth,
  checkRdsHealth,
  fetchCommands,
  sendMovement,
  fetchDemos,
  startDemo,
  cancelDemo,
} from "./api.js?v=2";

import { VehicleWebSocketClient } from "./ws.js?v=2";
import {
  CircularJoystick,
  COMMAND_IDS,
  isValidCommandId,
  getCommandNameById,
  syncCommandIdsFromCatalog,
} from "./joystick.js?v=2";

let wsClient = null;
let joystickController = null;
let isDemoRunning = false;
let isSendingCommand = false;
const HEALTH_POLL_INTERVAL_MS = 20000;

/**
 * 1. Verifica la disponibilidad real del Servidor AWS (21 APIs) y el diagnóstico seguro de Amazon RDS.
 */
async function verifyBackendAndDatabaseHealth() {
  updateServiceStatus("api", "connecting", "Comprobando");
  updateServiceStatus("rds", "connecting", "Sin verificar");

  const apiResult = await checkApiHealth();

  if (apiResult.ok) {
    updateServiceStatus("api", "connected", "Disponible");
  } else {
    updateServiceStatus("api", "disconnected", "No disponible");
    updateServiceStatus("rds", "connecting", "Sin verificar");
    appendEventLog(
      "API",
      `Servidor AWS no disponible (${apiResult.error}). RDS queda Sin verificar.`,
      "danger"
    );
    return false;
  }

  // Solo comprobamos RDS mediante el diagnóstico seguro del backend si la API respondió
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
          direction: isStopped ? `Neutral (${cmdName})` : cmdName,
          commandLabel: `${cmdName} (ID: ${cmdId})`,
        });
      }
    }
  } else {
    updateServiceStatus("rds", "disconnected", "No disponible");
    appendEventLog(
      "RDS",
      `Amazon RDS no disponible al consultar estado: ${rdsResult.error}`,
      "danger"
    );
  }

  return apiResult.ok && rdsResult.ok;
}

/**
 * 2. Carga el catálogo real de 13 comandos (`GET /api/vehiculos/1/comandos`)
 * y las secuencias DEMO (`GET /api/vehiculos/1/demos`).
 */
async function loadInitialCatalogs() {
  try {
    const commands = await fetchCommands();
    if (commands.length > 0) {
      syncCommandIdsFromCatalog(commands);
      renderActionButtons(commands, (cmdId, cmdName) => {
        executeMovementCommand(cmdId, cmdName, "WEB_BOTON");
      });
      appendEventLog(
        "API",
        `Catálogo validado: ${commands.length} comandos cargados desde AWS.`,
        "success"
      );
    }
  } catch (error) {
    appendEventLog(
      "API",
      `Usando catálogo base validado (13 comandos): ${error.message}`,
      "warning"
    );
  }

  try {
    const demos = await fetchDemos();
    if (demos.length > 0) {
      renderDemoOptions(demos);
      appendEventLog(
        "API",
        `Secuencias DEMO disponibles: ${demos.length}.`,
        "success"
      );
    }
  } catch (error) {
    appendEventLog(
      "API",
      `No se pudieron consultar las DEMOs: ${error.message}`,
      "warning"
    );
  }
}

/**
 * 3. Servicio único y centralizado de validación y envío de comandos (Joystick, Botones y DETENER).
 * Evita comandos incompatibles simultáneos, aplica los estados visuales (presionado, enviando,
 * aceptado, error) y otorga prioridad absoluta a `Detener` (ID: 13).
 * @param {number} comandoId - ID numérico del comando (1 al 13).
 * @param {string} commandName - Nombre del comando.
 * @param {string} [origen='WEB_JOYSTICK'] - Origen reportado en el payload.
 */
async function executeMovementCommand(
  comandoId,
  commandName,
  origen = "WEB_JOYSTICK"
) {
  const numericId = Number(comandoId);
  const isPriorityStop = numericId === COMMAND_IDS.DETENER;

  // Validación estricta del dominio de comandos
  if (!isValidCommandId(numericId)) {
    showAlert(`Comando rechazado por validación: ID ${comandoId} no pertenece al catálogo.`, "danger");
    return;
  }

  // Si hay una DEMO en ejecución y el comando NO es DETENER, bloqueamos comandos incompatibles
  if (isDemoRunning && !isPriorityStop) {
    showAlert("Hay una DEMO en ejecución. Cancélala o presiona DETENER antes de enviar otro comando.", "warning");
    return;
  }

  // Si ya se está enviando otro comando de botón secundario y NO es un paro prioritario ni transición de joystick
  if (isSendingCommand && !isPriorityStop && origen === "WEB_BOTON") {
    return;
  }

  isSendingCommand = true;
  setDispatchStateBadge("sending", `Enviando ${commandName}...`);
  setActionButtonState(numericId, "pressed");
  setActionButtonState(numericId, "sending");

  updateJoystickTelemetry({
    angle: 0,
    force: isPriorityStop ? 0 : 100,
    direction: isPriorityStop ? `Neutral (${commandName})` : commandName,
    commandLabel: `${commandName} (ID: ${numericId})`,
  });

  try {
    await sendMovement(numericId, origen);
    setDispatchStateBadge("accepted", `Aceptado: ${commandName}`);
    setActionButtonState(numericId, "accepted");

    appendEventLog(
      "CONTROL",
      `POST /api/vehiculos/movimiento -> Aceptado: ${commandName} (comando_id: ${numericId}, origen: ${origen})`,
      isPriorityStop ? "warning" : "success"
    );

    setTimeout(() => {
      setActionButtonState(numericId, isDemoRunning ? "disabled" : "normal");
      setDispatchStateBadge("normal", "Listo");
    }, 900);
  } catch (error) {
    // Si la petición fue reemplazada por un comando más reciente o DETENER, no es un error de red
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

    setDispatchStateBadge("error", "Error de envío");
    setActionButtonState(numericId, "error");
    appendEventLog(
      "CONTROL",
      `Error enviando ${commandName} (ID: ${numericId}): ${error.message}`,
      "danger"
    );
    showAlert(`Error al enviar «${commandName}»: ${error.message}`, "danger");

    setTimeout(() => {
      setActionButtonState(numericId, isDemoRunning ? "disabled" : "normal");
    }, 1500);
  } finally {
    isSendingCommand = false;
  }
}

/**
 * 4. Activa o desactiva el modo de bloqueo de controles durante una DEMO para evitar
 * ejecuciones simultáneas incompatibles (manteniendo DETENER y Cancelar siempre activos).
 * @param {boolean} running
 */
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

/**
 * 5. Enlaza los eventos de todos los controles de la interfaz.
 */
function bindUiEvents() {
  // Botón prioritario DETENER (id_comando = 13) — Prioridad absoluta
  const stopBtn = document.getElementById("btn-emergency-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      if (joystickController) {
        joystickController.resetToCenter(false);
      }
      if (isDemoRunning) {
        setDemoLockState(false);
        updateDemoStatusBadge("cancelled", "Interrumpida por DETENER");
        try {
          await cancelDemo(COMMAND_IDS.DETENER);
        } catch {
          // Continúa con el envío prioritario de DETENER
        }
      }
      await executeMovementCommand(COMMAND_IDS.DETENER, "Detener", "PARO_PRIORITARIO");
      showAlert("Prioridad absoluta: Comando DETENER (ID: 13) enviado.", "warning", 2500);
    });
  }

  // Botones secundarios del catálogo (IDs 3, 4, 7, 8, 9, 10, 11)
  const staticActionButtons = document.querySelectorAll(".btn-action-cmd");
  staticActionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmdId = Number(btn.dataset.cmdId) || COMMAND_IDS.DETENER;
      const cmdName = btn.dataset.cmdName || getCommandNameById(cmdId);
      executeMovementCommand(cmdId, cmdName, "WEB_BOTON");
    });
  });

  // Botón Iniciar DEMO (POST /api/vehiculos/demo)
  const startDemoBtn = document.getElementById("btn-start-demo");
  const selectDemoEl = document.getElementById("select-demo");

  if (startDemoBtn && selectDemoEl) {
    startDemoBtn.addEventListener("click", async () => {
      if (isDemoRunning) {
        showAlert("Ya existe una secuencia DEMO en ejecución.", "warning");
        return;
      }

      const demoId = Number(selectDemoEl.value);
      if (!demoId) {
        showAlert("Selecciona primero una secuencia DEMO válida.", "warning");
        return;
      }

      try {
        setDemoLockState(true);
        updateDemoStatusBadge("running", `Ejecutando DEMO #${demoId}...`);
        appendEventLog(
          "DEMO",
          `POST /api/vehiculos/demo -> Iniciando DEMO #${demoId} en el servidor AWS...`,
          "info"
        );
        await startDemo(demoId);
        updateDemoStatusBadge("idle", "Finalizada");
        showAlert(`Secuencia DEMO #${demoId} finalizada por el servidor.`, "success");
      } catch (error) {
        if (!error.isSuperseded) {
          updateDemoStatusBadge("idle", "Error");
          appendEventLog("DEMO", `Error en DEMO #${demoId}: ${error.message}`, "danger");
          showAlert(`No se pudo completar la DEMO #${demoId}: ${error.message}`, "danger");
        }
      } finally {
        setDemoLockState(false);
      }
    });
  }

  // Botón Cancelar DEMO / Detener (ID: 13)
  const cancelDemoBtn = document.getElementById("btn-cancel-demo");
  if (cancelDemoBtn) {
    cancelDemoBtn.addEventListener("click", async () => {
      setDemoLockState(false);
      updateDemoStatusBadge("cancelled", "Cancelada");

      try {
        await cancelDemo(COMMAND_IDS.DETENER);
        appendEventLog(
          "DEMO",
          `POST /api/vehiculos/estado/actualizar -> DEMO cancelada y estado restablecido a Detener (ID: ${COMMAND_IDS.DETENER}).`,
          "warning"
        );
      } catch (error) {
        appendEventLog("DEMO", `Aviso al cancelar DEMO: ${error.message}`, "warning");
      } finally {
        await executeMovementCommand(COMMAND_IDS.DETENER, "Detener", "CANCELAR_DEMO");
        showAlert("Secuencia cancelada. Se envió DETENER (ID: 13).", "warning", 3000);
      }
    });
  }

  // Botón Verificar Servicios manualmente
  const refreshHealthBtn = document.getElementById("btn-refresh-health");
  if (refreshHealthBtn) {
    refreshHealthBtn.addEventListener("click", async () => {
      appendEventLog("CONTROL", "Comprobando conectividad con AWS, RDS y WSS...", "info");
      await verifyBackendAndDatabaseHealth();
      await loadInitialCatalogs();
      if (wsClient && (!wsClient.socket || wsClient.socket.readyState !== WebSocket.OPEN)) {
        wsClient.connect();
      }
    });
  }

  // Botón Limpiar Bitácora
  const clearLogBtn = document.getElementById("btn-clear-log");
  if (clearLogBtn) {
    clearLogBtn.addEventListener("click", () => {
      clearEventLog();
    });
  }
}

/**
 * 6. Inicialización general al cargar el DOM.
 */
async function initApp() {
  appendEventLog("CONTROL", "Inicializando aplicación de control IoT...", "info");

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

  // Sesión WSS real hacia wss://api-iot-sergio.duckdns.org/ws/vehiculo/1
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
