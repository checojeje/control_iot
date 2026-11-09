/**
 * MÓDULO WEBSOCKET (js/ws.js)
 * Mantiene una sesión WSS real con:
 * wss://api-iot-sergio.duckdns.org/ws/vehiculo/1
 * Actualiza el indicador "WebSocket WSS" a partir de apertura ("En línea"),
 * cierre ("Desconectado"), error y reconexión ("Conectando-Reconectando").
 */

import {
  updateServiceStatus,
  appendEventLog,
  updateDemoStatusBadge,
  updateJoystickTelemetry,
} from "./ui.js?v=2";
import { COMMAND_IDS, getCommandNameById } from "./joystick.js?v=2";

export const WS_CONFIG = {
  BASE_WSS_URL: "wss://api-iot-sergio.duckdns.org/ws/vehiculo/1",
  VEHICULO_ID: 1,
  RECONNECT_BASE_MS: 2000,
  RECONNECT_MAX_MS: 15000,
  HEARTBEAT_INTERVAL_MS: 25000,
};

export class VehicleWebSocketClient {
  /**
   * @param {object} [options]
   * @param {function(object): void} [options.onMessageCallback]
   */
  constructor(options = {}) {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.intentionallyClosed = false;
    this.onMessageCallback = options.onMessageCallback || null;
  }

  /**
   * Inicia la conexión WSS hacia wss://api-iot-sergio.duckdns.org/ws/vehiculo/1.
   */
  connect() {
    this.intentionallyClosed = false;
    this.clearTimers();

    const wsUrl = WS_CONFIG.BASE_WSS_URL;
    updateServiceStatus("ws", "connecting", "Conectando-Reconectando");

    try {
      this.socket = new WebSocket(wsUrl);
    } catch (error) {
      updateServiceStatus("ws", "disconnected", "Desconectado");
      appendEventLog("WSS", `Error al instanciar WebSocket: ${error.message}`, "danger");
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      updateServiceStatus("ws", "connected", "En línea");
      appendEventLog("WSS", `Sesión WSS activa con ${wsUrl}`, "success");
      this.startHeartbeat();
    });

    this.socket.addEventListener("message", (event) => {
      this.handleIncomingMessage(event.data);
    });

    this.socket.addEventListener("error", () => {
      appendEventLog("WSS", "Error detectado en la sesión WebSocket WSS.", "warning");
    });

    this.socket.addEventListener("close", (event) => {
      this.stopHeartbeat();
      updateServiceStatus("ws", "disconnected", "Desconectado");

      if (!this.intentionallyClosed) {
        appendEventLog(
          "WSS",
          `Sesión cerrada (código ${event.code}). Reconectando...`,
          "warning"
        );
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Procesa de forma segura los mensajes JSON recibidos del servidor WSS.
   * @param {string} rawData
   */
  handleIncomingMessage(rawData) {
    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return;
    }

    if (!payload || typeof payload !== "object") return;
    const evento = String(payload.evento || "EVENTO");

    switch (evento) {
      case "CONEXION_ESTABLECIDA":
        appendEventLog(
          "WSS",
          `CONEXION_ESTABLECIDA (vehiculo_id: ${payload.vehiculo_id})`,
          "success"
        );
        break;

      case "NUEVO_MOVIMIENTO": {
        const cmdId = Number(payload.comando_id);
        const cmdName = getCommandNameById(cmdId);
        const isStopped = cmdId === COMMAND_IDS.DETENER;

        updateJoystickTelemetry({
          angle: 0,
          force: isStopped ? 0 : 100,
          direction: isStopped ? `Neutral (${cmdName})` : cmdName,
          commandLabel: `${cmdName} (ID: ${cmdId})`,
        });

        appendEventLog(
          "WSS",
          `Evento confirmado -> NUEVO_MOVIMIENTO | vehiculo_id: ${payload.vehiculo_id} | ${cmdName} (comando_id: ${cmdId})`,
          isStopped ? "warning" : "info"
        );
        break;
      }

      case "INICIO_DEMO":
        updateDemoStatusBadge(
          "running",
          `DEMO #${payload.demo_id} (${payload.total_movimientos} pasos)`
        );
        appendEventLog(
          "DEMO",
          `INICIO_DEMO #${payload.demo_id} (${payload.total_movimientos} movimientos temporizados por backend).`,
          "success"
        );
        break;

      case "MOVIMIENTO_DEMO": {
        const cmdId = Number(payload.comando_id);
        const cmdName = getCommandNameById(cmdId);
        updateJoystickTelemetry({
          angle: 0,
          force: 100,
          direction: cmdName,
          commandLabel: `DEMO Paso #${payload.orden}: ${cmdName} (ID: ${cmdId})`,
        });
        appendEventLog(
          "DEMO",
          `MOVIMIENTO_DEMO Paso #${payload.orden} -> ${cmdName} (comando_id: ${cmdId}, duracion_ms: ${payload.duracion_ms})`,
          "info"
        );
        break;
      }

      case "FIN_DEMO":
        updateDemoStatusBadge("idle", "Finalizada");
        updateJoystickTelemetry({
          angle: 0,
          force: 0,
          direction: "Neutral (Detener)",
          commandLabel: `Detener (ID: ${COMMAND_IDS.DETENER})`,
        });
        appendEventLog(
          "DEMO",
          `FIN_DEMO: Secuencia DEMO #${payload.demo_id} finalizada por el servidor.`,
          "success"
        );
        break;

      default:
        break;
    }

    if (typeof this.onMessageCallback === "function") {
      this.onMessageCallback(payload);
    }
  }

  /**
   * Envía texto al bucle `while True: data = await websocket.receive_text()` de FastAPI.
   * @param {string|object} data
   */
  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const text = typeof data === "string" ? data : JSON.stringify(data);
      this.socket.send(text);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send("PING");
    }, WS_CONFIG.HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.intentionallyClosed) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(
      WS_CONFIG.RECONNECT_BASE_MS * Math.pow(1.5, this.reconnectAttempts - 1),
      WS_CONFIG.RECONNECT_MAX_MS
    );

    updateServiceStatus("ws", "connecting", "Conectando-Reconectando");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect() {
    this.intentionallyClosed = true;
    this.clearTimers();
    if (this.socket) {
      this.socket.close(1000, "Cierre solicitado por el usuario");
      this.socket = null;
    }
    updateServiceStatus("ws", "disconnected", "Desconectado");
  }
}
