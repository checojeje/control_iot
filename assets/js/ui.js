/**
 * @file ui.js
 * @description Gestión visual de navegación entre las 3 vistas (CONTROL / MONITOREO / ADMINISTRACIÓN),
 * 3 indicadores de infraestructura, botones táctiles dinámicos por unidad y progreso de DEMO.
 */

const ICON_MAP = {
  CABINA_IZQ: { icon: "bi-arrow-counterclockwise", variant: "action-cyan", category: "Giro de torreta" },
  CABINA_DER: { icon: "bi-arrow-clockwise", variant: "action-cyan", category: "Giro de torreta" },
  BAJAR_GARRA: { icon: "bi-box-arrow-in-down", variant: "action-amber", category: "Brazo hidráulico" },
  SUBIR_GARRA: { icon: "bi-box-arrow-up", variant: "action-amber", category: "Brazo hidráulico" },
  BAJAR_BRAZO: { icon: "bi-box-arrow-in-down", variant: "action-amber", category: "Brazo hidráulico" },
  SUBIR_BRAZO: { icon: "bi-box-arrow-up", variant: "action-amber", category: "Brazo hidráulico" },
  ABRIR_PALA: { icon: "bi-arrows-angle-expand", variant: "action-emerald", category: "Pala frontal" },
  CERRAR_PALA: { icon: "bi-arrows-angle-contract", variant: "action-purple", category: "Pala frontal" },
  LUZ: { icon: "bi-lightbulb-fill", variant: "action-emerald", category: "Sistema óptico" },
  SONIDO: { icon: "bi-volume-up-fill", variant: "action-purple", category: "Alerta acústica" },
  VELOCIDAD: { icon: "bi-speedometer2", variant: "action-blue", category: "Potencia motor" },
};

/**
 * Alterna entre las 3 vistas principales: CONTROL (4.1), MONITOREO (4.2) y ADMINISTRACIÓN (4.3)
 * @param {'control'|'monitoreo'|'administracion'} viewName
 */
export function switchActiveView(viewName) {
  const views = {
    control: document.getElementById("view-control"),
    monitoreo: document.getElementById("view-monitoreo"),
    administracion: document.getElementById("view-administracion"),
  };
  const buttons = {
    control: document.getElementById("tab-btn-control"),
    monitoreo: document.getElementById("tab-btn-monitoreo"),
    administracion: document.getElementById("tab-btn-administracion"),
  };
  const unreadDot = document.getElementById("mon-unread-dot");

  Object.keys(views).forEach((key) => {
    const isTarget = key === viewName;
    if (views[key]) {
      views[key].classList.toggle("d-none", !isTarget);
    }
    if (buttons[key]) {
      buttons[key].classList.toggle("active", isTarget);
      buttons[key].setAttribute("aria-selected", String(isTarget));
    }
  });

  if (viewName === "monitoreo" && unreadDot) {
    unreadDot.classList.add("d-none");
  }
}

export function notifyUnreadMonitoringEvent() {
  const viewMonitoreo = document.getElementById("view-monitoreo");
  const unreadDot = document.getElementById("mon-unread-dot");
  if (viewMonitoreo && viewMonitoreo.classList.contains("d-none") && unreadDot) {
    unreadDot.classList.remove("d-none");
  }
}

/**
 * Actualiza uno de los 3 indicadores superiores:
 * @param {'ws'|'api'|'rds'} target
 * @param {'online'|'checking'|'offline'} status
 * @param {string} labelText
 */
export function setIndicatorState(target, status, labelText) {
  const dot = document.getElementById(`status-${target}-dot`);
  const badge = document.getElementById(`status-${target}-text`);
  const pillCard = document.getElementById(`pill-${target}`);

  if (dot) {
    dot.className = `status-dot ${status}`;
  }
  if (badge) {
    badge.className = `status-badge ${status}`;
    badge.textContent = labelText;
  }
  if (pillCard) {
    pillCard.classList.remove("online", "checking", "offline");
    pillCard.classList.add(status);
  }
}

export function showErrorBanner(message) {
  const banner = document.getElementById("error-banner");
  const msgSpan = document.getElementById("error-banner-msg");
  if (!banner || !msgSpan) return;

  msgSpan.textContent = message;
  banner.classList.remove("d-none");
}

export function hideErrorBanner() {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.classList.add("d-none");
  }
}

export function updateActiveCommandBadge(commandName, isStop = false) {
  const badge = document.getElementById("active-command-badge");
  if (!badge) return;

  badge.textContent = commandName;
  if (isStop) {
    badge.className = "command-pill stop";
  } else {
    badge.className = "command-pill active";
  }
}

export function updateJoystickTelemetry({ angle, distancePercent, directionLabel }) {
  const angleEl = document.getElementById("joy-angle");
  const distEl = document.getElementById("joy-distance");
  const dirEl = document.getElementById("joy-direction");

  if (angleEl) angleEl.textContent = `${angle}°`;
  if (distEl) distEl.textContent = `${distancePercent}%`;
  if (dirEl) dirEl.textContent = directionLabel;
}

/**
 * Renderiza dinámicamente los botones de funciones habilitados según el modelo/unidad seleccionada
 */
export function renderActionButtons(commands, onCommandClick) {
  const grid = document.getElementById("secondary-controls-grid");
  const badge = document.getElementById("catalog-status-badge");
  if (!grid) return;

  grid.innerHTML = "";

  if (!commands || commands.length === 0) {
    if (badge) badge.textContent = "Tracción 4WD";
    grid.innerHTML = `
      <div class="mon-table-empty" style="grid-column: span 12; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <i class="bi bi-dpad text-info fs-3 mb-2"></i>
        <span>Esta unidad opera mediante tracción direccional (Joystick) y secuencias DEMO.</span>
      </div>
    `;
    return;
  }

  if (badge) {
    badge.textContent = `${commands.length} Funciones`;
  }

  commands.forEach((cmd, idx) => {
    const meta = resolveCommandMeta(cmd);
    const total = commands.length;
    let spanClass = "tile-half";
    if (total === 7 && idx >= 4) {
      spanClass = "tile-third";
    } else if (total % 3 === 0) {
      spanClass = "tile-third";
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn-action-cmd ${meta.variant} ${spanClass}`;
    btn.dataset.comandoId = cmd.id;
    btn.dataset.comandoNombre = cmd.nombre;
    btn.innerHTML = `
      <span class="action-icon-box"><i class="bi ${meta.icon}"></i></span>
      <span class="action-text-wrap">
        <span class="action-label">${escapeHtml(formatCleanCommandName(cmd.nombre))}</span>
        <span class="action-sub">${escapeHtml(meta.category)}</span>
      </span>
    `;

    btn.addEventListener("click", () => onCommandClick(cmd, btn));
    grid.appendChild(btn);
  });
}

export function highlightActiveButton(comandoId) {
  const buttons = document.querySelectorAll(".btn-action-cmd");
  buttons.forEach((btn) => {
    if (Number(btn.dataset.comandoId) === Number(comandoId)) {
      btn.classList.add("active-pulse");
      setTimeout(() => btn.classList.remove("active-pulse"), 550);
    } else {
      btn.classList.remove("active-pulse");
    }
  });
}

export function populateDemoSelect(demos) {
  const select = document.getElementById("select-demo");
  if (!select) return;

  select.innerHTML = "";

  if (!demos || demos.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin secuencias disponibles";
    select.appendChild(opt);
    return;
  }

  demos.forEach((demo) => {
    const opt = document.createElement("option");
    opt.value = demo.id;
    const tag = demo.tipo_demo === "PRIVADA" ? " [Privada]" : "";
    opt.textContent = `${demo.nombre}${tag}`;
    select.appendChild(opt);
  });
}

export function setDemoProgressUI({ active, stepText = "", percent = 0 }) {
  const container = document.getElementById("demo-progress-container");
  const stepTextEl = document.getElementById("demo-step-text");
  const counterEl = document.getElementById("demo-step-counter");
  const barEl = document.getElementById("demo-progress-bar");
  const statusBadge = document.getElementById("demo-status-badge");
  const btnStart = document.getElementById("btn-start-demo");
  const btnCancel = document.getElementById("btn-cancel-demo");
  const selectDemo = document.getElementById("select-demo");

  if (!container) return;

  if (active) {
    container.classList.remove("d-none");
    if (stepTextEl) stepTextEl.textContent = stepText;
    if (counterEl) counterEl.textContent = `${percent}%`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (statusBadge) {
      statusBadge.className = "panel-tag running";
      statusBadge.textContent = "En curso";
    }
    if (btnStart) btnStart.disabled = true;
    if (btnCancel) btnCancel.disabled = false;
    if (selectDemo) selectDemo.disabled = true;
  } else {
    container.classList.add("d-none");
    if (barEl) barEl.style.width = "0%";
    if (statusBadge) {
      statusBadge.className = "panel-tag";
      statusBadge.textContent = "Inactivo";
    }
    if (btnStart) btnStart.disabled = false;
    if (btnCancel) btnCancel.disabled = true;
    if (selectDemo) selectDemo.disabled = false;
  }
}

export function setControlsDisabled(disabled) {
  document.querySelectorAll(".btn-action-cmd").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function resolveCommandMeta(cmd) {
  const rawName = String(cmd.nombre || "").toUpperCase();
  if (ICON_MAP[rawName]) return ICON_MAP[rawName];

  const name = rawName.toLowerCase();
  if (name.includes("cabina") && name.includes("izq")) return ICON_MAP.CABINA_IZQ;
  if (name.includes("cabina") && name.includes("der")) return ICON_MAP.CABINA_DER;
  if (name.includes("bajar")) return ICON_MAP.BAJAR_GARRA;
  if (name.includes("subir")) return ICON_MAP.SUBIR_GARRA;
  if (name.includes("abrir")) return ICON_MAP.ABRIR_PALA;
  if (name.includes("cerrar")) return ICON_MAP.CERRAR_PALA;
  if (name.includes("luz")) return ICON_MAP.LUZ;
  if (name.includes("sonido") || name.includes("claxon")) return ICON_MAP.SONIDO;
  if (name.includes("velocidad")) return ICON_MAP.VELOCIDAD;

  return { icon: "bi-sliders", variant: "action-cyan", category: "Operación" };
}

function formatCleanCommandName(name) {
  return String(name || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
