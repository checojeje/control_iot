/**
 * MÓDULO DE CONTROL JOYSTICK (assets/js/joystick.js)
 * Interacciones reales con Pointer Events (touch y mouse) + soporte accesible por teclado.
 * Mapea direcciones a los comandos válidos, con zona neutral y retorno automático al centro
 * disparando Detener.
 */

import { updateJoystickTelemetry } from "./ui.js?v=4";

export const COMMAND_IDS = {
  AVANZAR: 1,
  RETROCEDER: 2,
  CABINA_IZQUIERDA: 3,
  CABINA_DERECHA: 4,
  GIRAR_DERECHA: 5,
  GIRAR_IZQUIERDA: 6,
  BAJAR_GARRA: 7,
  SUBIR_GARRA: 8,
  LUZ: 9,
  SONIDO: 10,
  VELOCIDAD: 11,
  DEMO: 12,
  DETENER: 13,
};

export const COMMAND_LABELS = {
  1: "Avanzar",
  2: "Retroceder",
  3: "Cabina Izquierda",
  4: "Cabina Derecha",
  5: "Girar Derecha",
  6: "Girar Izquierda",
  7: "Bajar Garra",
  8: "Subir Garra",
  9: "Luz",
  10: "Sonido",
  11: "Velocidad",
  12: "Demo",
  13: "Detener",
};

/**
 * Valida si un ID de comando existe dentro del catálogo activo del vehículo.
 * @param {number} comandoId
 * @returns {boolean}
 */
export function isValidCommandId(comandoId) {
  const numId = Number(comandoId);
  return Number.isInteger(numId) && Object.values(COMMAND_IDS).includes(numId);
}

/**
 * Devuelve el nombre legible del comando a partir de su `id_comando` numérico.
 * @param {number} comandoId
 * @returns {string}
 */
export function getCommandNameById(comandoId) {
  const numId = Number(comandoId);
  if (COMMAND_LABELS[numId]) {
    return COMMAND_LABELS[numId];
  }
  for (const [key, id] of Object.entries(COMMAND_IDS)) {
    if (id === numId) return key;
  }
  return "Movimiento";
}

/**
 * Sincroniza dinámicamente `COMMAND_IDS` y `COMMAND_LABELS` con el catálogo de la API.
 * @param {Array<object>} catalog
 */
export function syncCommandIdsFromCatalog(catalog = []) {
  if (!Array.isArray(catalog)) return;

  catalog.forEach((item) => {
    const id = Number(item.id_comando);
    const rawName = String(item.nombre || "").trim();
    if (!id || !rawName) return;

    COMMAND_LABELS[id] = rawName;
    const normalizedKey = rawName
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_");

    COMMAND_IDS[normalizedKey] = id;
  });
}

export class CircularJoystick {
  /**
   * @param {object} config
   * @param {HTMLElement} config.baseElement
   * @param {HTMLElement} config.knobElement
   * @param {function(number, string): void} config.onCommand
   * @param {number} [config.rateLimitMs=180]
   * @param {number} [config.deadzoneRatio=0.22]
   */
  constructor({
    baseElement,
    knobElement,
    onCommand,
    rateLimitMs = 180,
    deadzoneRatio = 0.22,
  }) {
    this.baseEl = baseElement;
    this.knobEl = knobElement;
    this.onCommand = onCommand;
    this.rateLimitMs = rateLimitMs;
    this.deadzoneRatio = deadzoneRatio;

    this.isDragging = false;
    this.isDisabled = false;
    this.activePointerId = null;
    this.activeKeyDirection = null;
    this.lastSentCommandKey = "DETENER";
    this.lastSentTimestamp = 0;

    this.initEvents();
  }

  initEvents() {
    if (!this.baseEl || !this.knobEl) return;

    this.baseEl.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    this.baseEl.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    this.baseEl.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    this.baseEl.addEventListener("pointercancel", (e) => this.handlePointerUp(e));
    this.baseEl.addEventListener("lostpointercapture", () => {
      if (this.isDragging) {
        this.resetToCenter(true);
      }
    });

    window.addEventListener("blur", () => {
      if (this.isDragging || this.activeKeyDirection) {
        this.activeKeyDirection = null;
        this.resetToCenter(true);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && (this.isDragging || this.activeKeyDirection)) {
        this.activeKeyDirection = null;
        this.resetToCenter(true);
      }
    });

    this.baseEl.addEventListener("keydown", (e) => this.handleKeyDown(e));
    this.baseEl.addEventListener("keyup", (e) => this.handleKeyUp(e));
  }

  setDisabled(disabled) {
    this.isDisabled = Boolean(disabled);
    if (this.isDisabled && (this.isDragging || this.activeKeyDirection)) {
      this.activeKeyDirection = null;
      this.resetToCenter(false);
    }
  }

  handlePointerDown(event) {
    if (this.isDisabled) return;
    event.preventDefault();
    this.isDragging = true;
    this.activePointerId = event.pointerId;

    if (this.baseEl.setPointerCapture) {
      try {
        this.baseEl.setPointerCapture(event.pointerId);
      } catch {
        // Ignorar si no aplica
      }
    }

    this.baseEl.classList.add("is-active");
    this.knobEl.classList.add("is-dragging");

    this.processPointerPosition(event.clientX, event.clientY);
  }

  handlePointerMove(event) {
    if (!this.isDragging || event.pointerId !== this.activePointerId || this.isDisabled) {
      return;
    }
    event.preventDefault();
    this.processPointerPosition(event.clientX, event.clientY);
  }

  handlePointerUp(event) {
    if (!this.isDragging || (this.activePointerId !== null && event.pointerId !== this.activePointerId)) {
      return;
    }
    event.preventDefault();

    if (this.baseEl.releasePointerCapture && this.activePointerId !== null) {
      try {
        this.baseEl.releasePointerCapture(this.activePointerId);
      } catch {
        // Ignorar si ya fue liberado
      }
    }

    this.resetToCenter(true);
  }

  handleKeyDown(event) {
    if (this.isDisabled) return;

    const keyMap = {
      ArrowUp: { key: "AVANZAR", x: 0, y: -45, angle: 90 },
      ArrowDown: { key: "RETROCEDER", x: 0, y: 45, angle: 270 },
      ArrowLeft: { key: "GIRAR_IZQUIERDA", x: -45, y: 0, angle: 180 },
      ArrowRight: { key: "GIRAR_DERECHA", x: 45, y: 0, angle: 0 },
    };

    if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      this.activeKeyDirection = null;
      this.resetToCenter(true);
      return;
    }

    const mapped = keyMap[event.key];
    if (!mapped) return;

    event.preventDefault();
    if (this.activeKeyDirection === mapped.key) return;

    this.activeKeyDirection = mapped.key;
    this.baseEl.classList.add("is-active");
    this.knobEl.style.transform = `translate3d(calc(-50% + ${mapped.x}px), calc(-50% + ${mapped.y}px), 0)`;

    const cmdId = COMMAND_IDS[mapped.key];
    const label = getCommandNameById(cmdId);

    updateJoystickTelemetry({
      angle: mapped.angle,
      force: 100,
      direction: label,
      commandLabel: label,
    });

    this.dispatchCommandTransition(mapped.key, true);
  }

  handleKeyUp(event) {
    if (!this.activeKeyDirection) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      this.activeKeyDirection = null;
      this.resetToCenter(true);
    }
  }

  processPointerPosition(clientX, clientY) {
    const rect = this.baseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const maxRadius = (rect.width - this.knobEl.offsetWidth) / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const distance = Math.hypot(deltaX, deltaY);

    const angleRad = Math.atan2(-deltaY, deltaX);
    let angleDeg = (angleRad * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;

    const clampedDistance = Math.min(distance, maxRadius);
    const ratio = maxRadius > 0 ? clampedDistance / maxRadius : 0;

    const clampedX =
      distance > maxRadius ? (deltaX / distance) * maxRadius : deltaX;
    const clampedY =
      distance > maxRadius ? (deltaY / distance) * maxRadius : deltaY;

    this.knobEl.style.transform = `translate3d(calc(-50% + ${clampedX.toFixed(
      1
    )}px), calc(-50% + ${clampedY.toFixed(1)}px), 0)`;

    const forcePercent = Math.round(ratio * 100);
    const commandKey = this.resolveDirectionCommand(angleDeg, ratio);
    const commandId = COMMAND_IDS[commandKey] ?? COMMAND_IDS.DETENER;
    const label = getCommandNameById(commandId);

    updateJoystickTelemetry({
      angle: ratio < this.deadzoneRatio ? 0 : angleDeg,
      force: forcePercent,
      direction: label,
      commandLabel: label,
    });

    this.dispatchCommandTransition(commandKey, commandKey === "DETENER");
  }

  resolveDirectionCommand(angleDeg, ratio) {
    if (ratio < this.deadzoneRatio) {
      return "DETENER";
    }

    if (angleDeg >= 45 && angleDeg < 135) {
      return "AVANZAR";
    }
    if (angleDeg >= 135 && angleDeg < 225) {
      return "GIRAR_IZQUIERDA";
    }
    if (angleDeg >= 225 && angleDeg < 315) {
      return "RETROCEDER";
    }
    return "GIRAR_DERECHA";
  }

  dispatchCommandTransition(commandKey, forceImmediate = false) {
    if (commandKey === this.lastSentCommandKey && !forceImmediate) {
      return;
    }

    if (commandKey === "DETENER" && this.lastSentCommandKey === "DETENER" && this.isDragging) {
      return;
    }

    const now = performance.now();
    if (!forceImmediate && now - this.lastSentTimestamp < this.rateLimitMs) {
      return;
    }

    const comandoId = COMMAND_IDS[commandKey] ?? COMMAND_IDS.DETENER;
    const label = getCommandNameById(comandoId);

    this.lastSentCommandKey = commandKey;
    this.lastSentTimestamp = now;

    if (typeof this.onCommand === "function") {
      this.onCommand(comandoId, label);
    }
  }

  resetToCenter(triggerStopCommand = true) {
    this.isDragging = false;
    this.activePointerId = null;

    this.baseEl.classList.remove("is-active");
    this.knobEl.classList.remove("is-dragging");
    this.knobEl.style.transform = "translate3d(-50%, -50%, 0)";

    const stopId = COMMAND_IDS.DETENER;
    const stopLabel = getCommandNameById(stopId);

    updateJoystickTelemetry({
      angle: 0,
      force: 0,
      direction: stopLabel,
      commandLabel: stopLabel,
    });

    if (triggerStopCommand) {
      this.lastSentCommandKey = "DETENER";
      this.lastSentTimestamp = performance.now();
      if (typeof this.onCommand === "function") {
        this.onCommand(stopId, stopLabel);
      }
    }
  }
}
