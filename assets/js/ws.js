/**
 * MÓDULO WEBSOCKET (assets/js/ws.js)
 * Mantiene una sesión WSS real con:
 * wss://api-iot-sergio.duckdns.org/ws/vehiculo/1
 */

import {
  updateServiceStatus,
  updateDemoStatusBadge,
  updateJoystickTelemetry,
} from "./ui.js?v=4";
import { COMMAND_IDS, getCommandNameById } from "./joystick.js?v=4";

export const WS_CONFIG = {
  BASE_WSS_URL: "wss://api-iot-sergio.duckdns.org/ws/vehiculo/1",
  VEHICULO_ID: 1,
  RECONNECT_BASE_MS: 2000,
  RECONNECT_MAX_MS: 15000,
  HEARTBEAT_INTERVAL_MS: 25000,
};

export class VehicleWebSocketClient {
  constructor(options = {}) {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.intentionallyClosed = false;
    this.onMessageCallback = options.onMessageCallback || null;
  }

  connect() {
    this.intentionallyClosed = false;
    this.clearTimers();

    const wsUrl = WS_CONFIG.BASE_WSS_URL;
    updateServiceStatus("ws", "connecting", "Conectando");

    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      updateServiceStatus("ws", "disconnected", "Desconectado");
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      updateServiceStatus("ws", "connected", "En línea");
      this.startHeartbeat();
    });

    this.socket.addEventListener("message", (event) => {
      this.handleIncomingMessage(event.data);
    });

    this.socket.addEventListener("error", () => {
      // Manejado al cerrarse la sesión
    });

    this.socket.addEventListener("close", () => {
      this.stopHeartbeat();
      updateServiceStatus("ws", "disconnected", "Desconectado");

      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    });
  }

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
      case "NUEVO_MOVIMIENTO": {
        const cmdId = Number(payload.comando_id);
        const cmdName = getCommandNameById(cmdId);
        const isStopped = cmdId === COMMAND_IDS.DETENER;

        updateJoystickTelemetry({
          angle: 0,
          force: isStopped ? 0 : 100,
          direction: cmdName,
          commandLabel: cmdName,
        });
        break;
      }

      case "INICIO_DEMO":
        updateDemoStatusBadge("running", "En ejecución");
        break;

      case "MOVIMIENTO_DEMO": {
        const cmdId = Number(payload.comando_id);
        const cmdName = getCommandNameById(cmdId);
        updateJoystickTelemetry({
          angle: 0,
          force: 100,
          direction: cmdName,
          commandLabel: `Demo: ${cmdName}`,
        });
        break;
      }

      case "FIN_DEMO":
        updateDemoStatusBadge("idle", "Finalizada");
        updateJoystickTelemetry({
          angle: 0,
          force: 0,
          direction: "Detener",
          commandLabel: "Detener",
        });
        break;

      default:
        break;
    }

    if (typeof this.onMessageCallback === "function") {
      this.onMessageCallback(payload);
    }
  }

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

    updateServiceStatus("ws", "connecting", "Reconectando");

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
      this.socket.close(1000, "Cierre solicitado");
      this.socket = null;
    }
    updateServiceStatus("ws", "disconnected", "Desconectado");
  }
}
