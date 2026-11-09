/**
 * MÓDULO DE INTERFAZ DE USUARIO (assets/js/ui.js)
 * Funciones puras y actualizadores seguros del DOM para los 3 indicadores
 * de conectividad, estados visuales de botones, joystick y DEMO.
 */

const STATUS_CLASSES = ["status-connected", "status-connecting", "status-disconnected"];

const DEFAULT_SERVICE_LABELS = {
  ws: {
    connected: "En línea",
    connecting: "Conectando",
    disconnected: "Desconectado",
  },
  api: {
    connected: "Disponible",
    connecting: "Comprobando",
    disconnected: "No disponible",
  },
  rds: {
    connected: "Disponible",
    connecting: "Sin verificar",
    disconnected: "No disponible",
  },
};

export function updateServiceStatus(service, state, customLabel) {
  const dotEl = document.getElementById(`status-dot-${service}`);
  const textEl = document.getElementById(`status-text-${service}`);
  const iconEl = document.getElementById(`status-icon-${service}`);

  if (dotEl) {
    dotEl.classList.remove(...STATUS_CLASSES);
    const targetClass =
      state === "connected"
        ? "status-connected"
        : state === "connecting"
        ? "status-connecting"
        : "status-disconnected";
    dotEl.classList.add(targetClass);
  }

  if (iconEl) {
    iconEl.classList.remove("text-success", "text-warning", "text-danger");
    iconEl.classList.add(
      state === "connected"
        ? "text-success"
        : state === "connecting"
        ? "text-warning"
        : "text-danger"
    );
  }

  if (textEl) {
    const label =
      customLabel ||
      (DEFAULT_SERVICE_LABELS[service] && DEFAULT_SERVICE_LABELS[service][state]) ||
      state;
    textEl.textContent = label;
    textEl.className =
      state === "connected"
        ? "badge rounded-pill text-bg-success status-badge"
        : state === "connecting"
        ? "badge rounded-pill text-bg-warning status-badge"
        : "badge rounded-pill text-bg-danger status-badge";
  }
}

export function setDispatchStateBadge(state, label) {
  const badge = document.getElementById("dispatch-state-badge");
  if (!badge) return;

  const map = {
    normal: { cls: "badge rounded-pill text-bg-secondary cmd-badge", text: label || "Listo" },
    sending: { cls: "badge rounded-pill text-bg-warning cmd-badge", text: label || "Enviando..." },
    accepted: { cls: "badge rounded-pill text-bg-success cmd-badge", text: label || "Aceptado" },
    error: { cls: "badge rounded-pill text-bg-danger cmd-badge", text: label || "Error" },
  };

  const cfg = map[state] || map.normal;
  badge.className = cfg.cls;
  badge.textContent = cfg.text;
}

export function setActionButtonState(cmdId, state) {
  const buttons = document.querySelectorAll(`.btn-action-cmd[data-cmd-id="${cmdId}"]`);
  buttons.forEach((btn) => {
    btn.classList.remove(
      "btn-state-pressed",
      "btn-state-sending",
      "btn-state-accepted",
      "btn-state-error"
    );

    if (state === "disabled") {
      btn.disabled = true;
      return;
    }

    btn.disabled = false;
    if (state === "pressed") btn.classList.add("btn-state-pressed");
    if (state === "sending") btn.classList.add("btn-state-sending");
    if (state === "accepted") btn.classList.add("btn-state-accepted");
    if (state === "error") btn.classList.add("btn-state-error");
  });
}

export function setAllActionButtonsDisabled(disabled) {
  const buttons = document.querySelectorAll(".btn-action-cmd");
  buttons.forEach((btn) => {
    btn.disabled = Boolean(disabled);
  });
}

export function showAlert(message, type = "info", timeoutMs = 2400) {
  const container = document.getElementById("alert-container");
  if (!container) return;

  const iconMap = {
    success: "bi-check-circle-fill",
    danger: "bi-exclamation-triangle-fill",
    warning: "bi-exclamation-circle-fill",
    info: "bi-info-circle-fill",
  };

  const wrapper = document.createElement("div");
  wrapper.className = `alert alert-${type} alert-dismissible fade show py-1 px-3 small shadow mb-1 d-flex align-items-center justify-content-between`;
  wrapper.setAttribute("role", "alert");

  const contentDiv = document.createElement("div");
  contentDiv.className = "d-flex align-items-center gap-2";

  const icon = document.createElement("i");
  icon.className = `bi ${iconMap[type] || iconMap.info}`;
  icon.setAttribute("aria-hidden", "true");

  const textSpan = document.createElement("span");
  textSpan.textContent = String(message);

  contentDiv.appendChild(icon);
  contentDiv.appendChild(textSpan);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-close btn-close-white p-2";
  closeBtn.setAttribute("data-bs-dismiss", "alert");
  closeBtn.setAttribute("aria-label", "Cerrar");

  wrapper.appendChild(contentDiv);
  wrapper.appendChild(closeBtn);

  while (container.children.length >= 1) {
    container.removeChild(container.firstChild);
  }

  container.appendChild(wrapper);

  if (timeoutMs > 0) {
    setTimeout(() => {
      if (wrapper.parentNode) {
        wrapper.classList.remove("show");
        setTimeout(() => wrapper.remove(), 180);
      }
    }, timeoutMs);
  }
}

export function appendEventLog() {}
export function clearEventLog() {}

export function updateJoystickTelemetry({ angle, force, direction, commandLabel }) {
  const angleEl = document.getElementById("joystick-angle");
  const forceEl = document.getElementById("joystick-force");
  const dirEl = document.getElementById("joystick-direction");
  const badgeEl = document.getElementById("active-command-badge");

  if (angleEl) angleEl.textContent = `${Math.round(angle)}°`;
  if (forceEl) forceEl.textContent = `${Math.round(force)}%`;
  if (dirEl) dirEl.textContent = String(direction);

  if (badgeEl && commandLabel) {
    badgeEl.textContent = String(commandLabel);
    const isStopped = String(commandLabel).toUpperCase().includes("DETENER");
    badgeEl.className = isStopped
      ? "badge rounded-pill text-bg-secondary cmd-badge"
      : "badge rounded-pill text-bg-info cmd-badge";
  }
}

export function updateDemoStatusBadge(state, text) {
  const badge = document.getElementById("demo-status-badge");
  if (!badge) return;

  if (state === "running") {
    badge.className = "badge rounded-pill text-bg-success cmd-badge";
    badge.textContent = text || "En ejecución";
  } else if (state === "cancelled") {
    badge.className = "badge rounded-pill text-bg-warning cmd-badge";
    badge.textContent = text || "Cancelada";
  } else {
    badge.className = "badge rounded-pill text-bg-secondary cmd-badge";
    badge.textContent = text || "Inactivo";
  }
}

export function renderDemoOptions(demos = []) {
  const selectEl = document.getElementById("select-demo");
  if (!selectEl || !Array.isArray(demos) || demos.length === 0) return;

  selectEl.innerHTML = "";

  demos.forEach((demo, index) => {
    const id = Number(demo.id_demo ?? demo.id);
    if (!Number.isInteger(id) || id <= 0) return;

    const nombre = String(demo.nombre ?? `Demo ${id}`);
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = nombre;
    if (index === 0) option.selected = true;
    selectEl.appendChild(option);
  });
}

/**
 * Renderiza dinámicamente los botones dentro de `.actions-grid` ocupando el 100% del espacio.
 * @param {Array<object>} commands
 * @param {function(number, string): void} onCommandClick
 */
export function renderActionButtons(commands = [], onCommandClick) {
  const container = document.getElementById("commands-container");
  if (!container || !Array.isArray(commands) || commands.length === 0) return;

  const excludedIds = new Set([1, 2, 5, 6, 12, 13]);
  const extraCommands = commands.filter(
    (c) => Number(c.activo ?? 1) === 1 && !excludedIds.has(Number(c.id_comando))
  );

  if (extraCommands.length === 0) return;

  container.innerHTML = "";

  const getButtonStyleAndIcon = (name) => {
    const upper = name.toUpperCase();
    if (upper.includes("CABINA IZQUIERDA")) {
      return { styleClass: "action-cyan span-3", icon: "bi-arrow-counterclockwise", shortLabel: "Cabina Izq." };
    }
    if (upper.includes("CABINA DERECHA")) {
      return { styleClass: "action-cyan span-3", icon: "bi-arrow-clockwise", shortLabel: "Cabina Der." };
    }
    if (upper.includes("BAJAR GARRA")) {
      return { styleClass: "action-amber span-3", icon: "bi-arrow-down-circle-fill", shortLabel: "Bajar Garra" };
    }
    if (upper.includes("SUBIR GARRA")) {
      return { styleClass: "action-amber span-3", icon: "bi-arrow-up-circle-fill", shortLabel: "Subir Garra" };
    }
    if (upper.includes("LUZ")) {
      return { styleClass: "action-neutral span-2", icon: "bi-lightbulb-fill text-warning", shortLabel: "Luz" };
    }
    if (upper.includes("SONIDO")) {
      return { styleClass: "action-neutral span-2", icon: "bi-volume-up-fill text-info", shortLabel: "Sonido" };
    }
    if (upper.includes("VELOCIDAD")) {
      return { styleClass: "action-neutral span-2", icon: "bi-speedometer2 text-success", shortLabel: "Velocidad" };
    }
    return { styleClass: "action-cyan span-3", icon: "bi-lightning-charge-fill", shortLabel: name };
  };

  extraCommands.forEach((cmd) => {
    const cmdId = Number(cmd.id_comando);
    if (!Number.isInteger(cmdId) || cmdId <= 0) return;

    const cmdName = String(cmd.nombre || "Acción");
    const { styleClass, icon, shortLabel } = getButtonStyleAndIcon(cmdName);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn-action-cmd ${styleClass}`;
    btn.dataset.cmdId = String(cmdId);
    btn.dataset.cmdName = cmdName;

    const iconEl = document.createElement("i");
    iconEl.className = `bi ${icon}`;
    iconEl.setAttribute("aria-hidden", "true");

    const spanEl = document.createElement("span");
    spanEl.textContent = shortLabel;

    btn.appendChild(iconEl);
    btn.appendChild(spanEl);

    btn.addEventListener("click", () => {
      if (typeof onCommandClick === "function") {
        onCommandClick(cmdId, cmdName);
      }
    });

    container.appendChild(btn);
  });
}
