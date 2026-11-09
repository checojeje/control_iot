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

/**
 * Actualiza uno de los 3 indicadores visuales del Panel de Conectividad.
 * @param {'ws' | 'api' | 'rds'} service
 * @param {'connected' | 'connecting' | 'disconnected'} state
 * @param {string} [customLabel]
 */
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

/**
 * Actualiza el indicador de estado de envío en la tarjeta de controles (`#dispatch-state-badge`).
 * @param {'normal' | 'sending' | 'accepted' | 'error'} state
 * @param {string} [label]
 */
export function setDispatchStateBadge(state, label) {
  const badge = document.getElementById("dispatch-state-badge");
  if (!badge) return;

  const map = {
    normal: { cls: "badge text-bg-secondary", text: label || "Listo" },
    sending: { cls: "badge text-bg-warning", text: label || "Enviando..." },
    accepted: { cls: "badge text-bg-success", text: label || "Aceptado" },
    error: { cls: "badge text-bg-danger", text: label || "Error" },
  };

  const cfg = map[state] || map.normal;
  badge.className = cfg.cls;
  badge.textContent = cfg.text;
}

/**
 * Aplica los estados visuales a un botón de comando:
 * normal, presionado, enviando, aceptado, error y deshabilitado.
 * @param {number|string} cmdId
 * @param {'normal' | 'pressed' | 'sending' | 'accepted' | 'error' | 'disabled'} state
 */
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

/**
 * Habilita o deshabilita todos los botones secundarios (por ejemplo, mientras corre una DEMO).
 * @param {boolean} disabled
 */
export function setAllActionButtonsDisabled(disabled) {
  const buttons = document.querySelectorAll(".btn-action-cmd");
  buttons.forEach((btn) => {
    btn.disabled = Boolean(disabled);
  });
}

/**
 * Muestra un mensaje flotante temporal sin alterar el alto de la pantalla.
 * @param {string} message
 * @param {'success' | 'danger' | 'warning' | 'info'} [type='info']
 * @param {number} [timeoutMs=2500]
 */
export function showAlert(message, type = "info", timeoutMs = 2500) {
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

/**
 * Función de compatibilidad para registro interno (la bitácora visual fue removida para limpiar la vista del usuario).
 */
export function appendEventLog() {
  // No-op en vista de usuario final
}

export function clearEventLog() {
  // No-op en vista de usuario final
}

/**
 * Actualiza los indicadores visuales de dirección del Joystick y el badge de comando activo.
 * @param {object} telemetry
 * @param {number} telemetry.angle
 * @param {number} telemetry.force
 * @param {string} telemetry.direction
 * @param {string} [telemetry.commandLabel]
 */
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
      ? "badge rounded-pill text-bg-secondary"
      : "badge rounded-pill text-bg-info";
  }
}

/**
 * Actualiza el badge de estado de ejecución de DEMO.
 * @param {'idle' | 'running' | 'cancelled'} state
 * @param {string} [text]
 */
export function updateDemoStatusBadge(state, text) {
  const badge = document.getElementById("demo-status-badge");
  if (!badge) return;

  if (state === "running") {
    badge.className = "badge text-bg-success";
    badge.textContent = text || "En ejecución";
  } else if (state === "cancelled") {
    badge.className = "badge text-bg-warning";
    badge.textContent = text || "Cancelada";
  } else {
    badge.className = "badge text-bg-secondary";
    badge.textContent = text || "Inactivo";
  }
}

/**
 * Llena el selector `<select id="select-demo">` con las secuencias DEMO disponibles.
 * @param {Array<object>} demos
 */
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
 * Renderiza dinámicamente los botones de controles secundarios a partir del catálogo real
 * sin mostrar IDs internos de programación al usuario final.
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
      return { btnClass: "btn-outline-info", icon: "bi-arrow-counterclockwise", colClass: "col-6 p-1" };
    }
    if (upper.includes("CABINA DERECHA")) {
      return { btnClass: "btn-outline-info", icon: "bi-arrow-clockwise", colClass: "col-6 p-1" };
    }
    if (upper.includes("BAJAR GARRA")) {
      return { btnClass: "btn-outline-warning", icon: "bi-arrow-down-circle-fill", colClass: "col-6 p-1" };
    }
    if (upper.includes("SUBIR GARRA")) {
      return { btnClass: "btn-outline-warning", icon: "bi-arrow-up-circle-fill", colClass: "col-6 p-1" };
    }
    if (upper.includes("LUZ")) {
      return { btnClass: "btn-outline-light", icon: "bi-lightbulb-fill text-warning", colClass: "col-4 p-1" };
    }
    if (upper.includes("SONIDO")) {
      return { btnClass: "btn-outline-light", icon: "bi-volume-up-fill text-info", colClass: "col-4 p-1" };
    }
    if (upper.includes("VELOCIDAD")) {
      return { btnClass: "btn-outline-light", icon: "bi-speedometer2 text-success", colClass: "col-4 p-1" };
    }
    return { btnClass: "btn-outline-info", icon: "bi-lightning-charge-fill", colClass: "col-6 p-1" };
  };

  extraCommands.forEach((cmd) => {
    const cmdId = Number(cmd.id_comando);
    if (!Number.isInteger(cmdId) || cmdId <= 0) return;

    const cmdName = String(cmd.nombre || "Acción");
    const { btnClass, icon, colClass } = getButtonStyleAndIcon(cmdName);

    const col = document.createElement("div");
    col.className = colClass;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${btnClass} w-100 btn-action-cmd text-truncate`;
    btn.dataset.cmdId = String(cmdId);
    btn.dataset.cmdName = cmdName;

    const iconEl = document.createElement("i");
    iconEl.className = `bi ${icon} me-1`;
    iconEl.setAttribute("aria-hidden", "true");

    const labelNode = document.createTextNode(` ${cmdName}`);

    btn.appendChild(iconEl);
    btn.appendChild(labelNode);

    btn.addEventListener("click", () => {
      if (typeof onCommandClick === "function") {
        onCommandClick(cmdId, cmdName);
      }
    });

    col.appendChild(btn);
    container.appendChild(col);
  });
}
