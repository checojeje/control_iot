/**
 * @file ws.js
 * @description Cliente WebSocket nativo con reconexión automática para recibir eventos de AWS
 */

import { CONFIG } from "./api.js?v=5";
import { setIndicatorState } from "./ui.js?v=5";

export class VehicleWebSocket {
  constructor({ onEventCallback, onOpenCallback }) {
    this.socket = null;
    this.onEventCallback = onEventCallback;
    this.onOpenCallback = onOpenCallback;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 8000;
    this.reconnectTimer = null;
    this.isManualClose = false;
  }

  connect() {
    this.isManualClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const statusText = this.reconnectAttempts > 0 ? "Reconectando" : "Conectando";
    setIndicatorState("ws", "checking", statusText);

    try {
      this.socket = new WebSocket(CONFIG.WS_URL);
    } catch (_) {
      setIndicatorState("ws", "offline", "Desconectado");
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      setIndicatorState("ws", "online", "En línea");
      if (typeof this.onOpenCallback === "function") {
        this.onOpenCallback();
      }
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleIncomingPayload(payload);
      } catch (_) {
        // Ignorar tramas no JSON
      }
    });

    this.socket.addEventListener("close", () => {
      setIndicatorState("ws", "offline", "Desconectado");
      if (!this.isManualClose) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", () => {
      setIndicatorState("ws", "offline", "Desconectado");
    });
  }

  handleIncomingPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    if (typeof this.onEventCallback === "function") {
      this.onEventCallback(payload);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts += 1;
    const delay = Math.min(1500 * Math.pow(1.4, this.reconnectAttempts - 1), this.maxReconnectDelay);

    this.reconnectTimer = setTimeout(() => {
      setIndicatorState("ws", "checking", "Reconectando");
      this.connect();
    }, delay);
  }

  reconnectNow() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.isManualClose = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_) {
        // Ignorar
      }
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }
}
