/**
 * @file joystick.js
 * @description Joystick virtual responsivo con soporte Pointer Events (táctil/mouse) y teclado
 */

import { updateJoystickTelemetry } from "./ui.js?v=1";

export const JOYSTICK_DIRECTIONS = {
  NEUTRAL: { key: "NEUTRAL", code: "DETENER", id: 13, label: "En espera" },
  UP: { key: "UP", code: "AVANZAR", id: 1, label: "Avanzar" },
  DOWN: { key: "DOWN", code: "RETROCEDER", id: 2, label: "Retroceder" },
  LEFT: { key: "LEFT", code: "GIRAR_IZQUIERDA", id: 6, label: "Girar Izquierda" },
  RIGHT: { key: "RIGHT", code: "GIRAR_DERECHA", id: 5, label: "Girar Derecha" },
};

export class VirtualJoystick {
  constructor({ baseEl, handleEl, onDirectionChange }) {
    this.baseEl = baseEl;
    this.handleEl = handleEl;
    this.onDirectionChange = onDirectionChange;

    this.isDragging = false;
    this.activePointerId = null;
    this.currentDirection = JOYSTICK_DIRECTIONS.NEUTRAL;
    this.disabled = false;
    this.deadZoneRatio = 0.28;
    this.pressedKeys = new Set();

    this.initEvents();
  }

  setCommandMapping(mapping) {
    Object.keys(mapping).forEach((dirKey) => {
      if (JOYSTICK_DIRECTIONS[dirKey] && mapping[dirKey]) {
        JOYSTICK_DIRECTIONS[dirKey].id = mapping[dirKey].id;
        JOYSTICK_DIRECTIONS[dirKey].label = mapping[dirKey].nombre;
      }
    });
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    if (disabled && this.isDragging) {
      this.resetToCenter(false);
    }
  }

  initEvents() {
    if (!this.baseEl || !this.handleEl) return;

    this.baseEl.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
    window.addEventListener("pointermove", (e) => this.handlePointerMove(e));
    window.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    window.addEventListener("pointercancel", (e) => this.handlePointerUp(e));

    window.addEventListener("keydown", (e) => this.handleKeyDown(e));
    window.addEventListener("keyup", (e) => this.handleKeyUp(e));
  }

  handlePointerDown(e) {
    if (this.disabled) return;
    e.preventDefault();

    this.isDragging = true;
    this.activePointerId = e.pointerId;
    this.baseEl.classList.add("active");
    this.handleEl.classList.add("dragging");

    try {
      this.baseEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignorar si no soporta captura
    }

    this.updateFromPoint(e.clientX, e.clientY);
  }

  handlePointerMove(e) {
    if (!this.isDragging || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.updateFromPoint(e.clientX, e.clientY);
  }

  handlePointerUp(e) {
    if (!this.isDragging || e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    this.resetToCenter(true);
  }

  updateFromPoint(clientX, clientY) {
    const rect = this.baseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2 - this.handleEl.offsetWidth / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const clampedDist = Math.min(distance, maxRadius);

    const angleRad = Math.atan2(dy, dx);
    const moveX = Math.cos(angleRad) * clampedDist;
    const moveY = Math.sin(angleRad) * clampedDist;

    this.handleEl.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;

    const ratio = maxRadius > 0 ? clampedDist / maxRadius : 0;
    const distancePercent = Math.round(ratio * 100);

    let angleDeg = Math.round((-angleRad * 180) / Math.PI);
    if (angleDeg < 0) angleDeg += 360;

    let newDir = JOYSTICK_DIRECTIONS.NEUTRAL;
    if (ratio >= this.deadZoneRatio) {
      if (angleDeg >= 45 && angleDeg < 135) {
        newDir = JOYSTICK_DIRECTIONS.UP;
      } else if (angleDeg >= 135 && angleDeg < 225) {
        newDir = JOYSTICK_DIRECTIONS.LEFT;
      } else if (angleDeg >= 225 && angleDeg < 315) {
        newDir = JOYSTICK_DIRECTIONS.DOWN;
      } else {
        newDir = JOYSTICK_DIRECTIONS.RIGHT;
      }
    }

    updateJoystickTelemetry({
      angle: ratio >= this.deadZoneRatio ? angleDeg : 0,
      distancePercent,
      directionLabel: newDir.label,
    });

    this.emitDirectionIfChanged(newDir);
  }

  resetToCenter(shouldTriggerStop = true) {
    this.isDragging = false;
    this.activePointerId = null;
    this.baseEl.classList.remove("active");
    this.handleEl.classList.remove("dragging");
    this.handleEl.style.transform = "translate3d(0px, 0px, 0px)";

    updateJoystickTelemetry({
      angle: 0,
      distancePercent: 0,
      directionLabel: JOYSTICK_DIRECTIONS.NEUTRAL.label,
    });

    if (shouldTriggerStop) {
      this.emitDirectionIfChanged(JOYSTICK_DIRECTIONS.NEUTRAL);
    } else {
      this.currentDirection = JOYSTICK_DIRECTIONS.NEUTRAL;
    }
  }

  emitDirectionIfChanged(newDir) {
    if (this.currentDirection.key === newDir.key) return;
    this.currentDirection = newDir;
    if (typeof this.onDirectionChange === "function") {
      this.onDirectionChange(newDir);
    }
  }

  handleKeyDown(e) {
    if (this.disabled) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    const keyMap = {
      ArrowUp: JOYSTICK_DIRECTIONS.UP,
      KeyW: JOYSTICK_DIRECTIONS.UP,
      ArrowDown: JOYSTICK_DIRECTIONS.DOWN,
      KeyS: JOYSTICK_DIRECTIONS.DOWN,
      ArrowLeft: JOYSTICK_DIRECTIONS.LEFT,
      KeyA: JOYSTICK_DIRECTIONS.LEFT,
      ArrowRight: JOYSTICK_DIRECTIONS.RIGHT,
      KeyD: JOYSTICK_DIRECTIONS.RIGHT,
    };

    const dir = keyMap[e.code];
    if (!dir) return;

    e.preventDefault();
    if (this.pressedKeys.has(e.code)) return;
    this.pressedKeys.add(e.code);

    const offset = 36;
    const moves = {
      UP: [0, -offset, 90],
      DOWN: [0, offset, 270],
      LEFT: [-offset, 0, 180],
      RIGHT: [offset, 0, 0],
    };
    const [mx, my, ang] = moves[dir.key];
    this.baseEl.classList.add("active");
    this.handleEl.style.transform = `translate3d(${mx}px, ${my}px, 0)`;

    updateJoystickTelemetry({
      angle: ang,
      distancePercent: 100,
      directionLabel: dir.label,
    });

    this.emitDirectionIfChanged(dir);
  }

  handleKeyUp(e) {
    if (!this.pressedKeys.has(e.code)) return;
    this.pressedKeys.delete(e.code);

    if (this.pressedKeys.size === 0) {
      this.resetToCenter(true);
    }
  }
}
