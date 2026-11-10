/**
 * @file ws.js
 * @description Cliente WebSocket nativo con heartbeat y reconexión segura hacia AWS
 */

import { CONFIG } from "./api.js?v=7";
import { setIndicatorState } from "./ui.js?v=7";

export class VehicleWebSocket {
  constructor({ onEventCallback, onOpenCallback }) {
    this.socket = null;
    this.onEventCallback = onEventCallback;
    this.onOpenCallback = onOpenCallback;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 8000;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.isManualClose = false;
  }

  connect() {
    this.isManualClose = false;
    this.clearReconnectTimer();

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      if (this.socket.readyState === WebSocket.OPEN) {
        setIndicatorState("ws", "online", "En línea");
      }
      return;
    }

    const statusText = this.reconnectAttempts > 0 ? "Reconectando" : "Conectando";
    setIndicatorState("ws", "checking", statusText);

    let currentSocket;
    try {
      currentSocket = new WebSocket(CONFIG.WS_URL);
      this.socket = currentSocket;
    } catch (_) {
      setIndicatorState("ws", "offline", "Desconectado");
      this.scheduleReconnect();
      return;
    }

    currentSocket.addEventListener("open", () => {
      if (this.socket !== currentSocket) return;
      this.reconnectAttempts = 0;
      setIndicatorState("ws", "online", "En línea");
      this.startHeartbeat();
      if (typeof this.onOpenCallback === "function") {
        this.onOpenCallback();
      }
    });

    currentSocket.addEventListener("message", (event) => {
      if (this.socket !== currentSocket) return;
      // Cualquier trama recibida confirma que el canal WSS está en línea
      setIndicatorState("ws", "online", "En línea");
      try {
        const payload = JSON.parse(event.data);
        this.handleIncomingPayload(payload);
      } catch (_) {
        // Ignorar tramas de texto no JSON
      }
    });

    currentSocket.addEventListener("close", () => {
      // Ignorar eventos tardíos de un socket anterior ya reemplazado
      if (this.socket !== currentSocket) return;
      this.stopHeartbeat();
      this.socket = null;
      setIndicatorState("ws", "offline", "Desconectado");
      if (!this.isManualClose) {
        this.scheduleReconnect();
      }
    });

    currentSocket.addEventListener("error", () => {
      if (this.socket !== currentSocket) return;
      // El evento close posterior gestionará la reconexión
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send("PING");
        } catch (_) {
          // Ignorar
        }
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  handleIncomingPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    if (typeof this.onEventCallback === "function") {
      this.onEventCallback(payload);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.isManualClose) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      1800 * Math.pow(1.4, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    setIndicatorState("ws", "checking", "Reconectando");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  reconnectNow() {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const oldSocket = this.socket;
    this.socket = null;
    if (oldSocket) {
      try {
        oldSocket.close(1000, "Reconexión manual");
      } catch (_) {
        // Ignorar
      }
    }
    this.reconnectAttempts = 0;
    this.connect();
  }
}
