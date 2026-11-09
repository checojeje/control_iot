/**
 * @file ui.js
 * @description Gestión visual de indicadores, controles táctiles y estado de la interfaz
 */

const ICON_MAP = {
  CABINA_IZQ: { icon: "bi-arrow-counterclockwise", variant: "action-cyan", category: "Giro de torreta" },
  CABINA_DER: { icon: "bi-arrow-clockwise", variant: "action-cyan", category: "Giro de torreta" },
  BAJAR_GARRA: { icon: "bi-box-arrow-in-down", variant: "action-amber", category: "Brazo hidráulico" },
  SUBIR_GARRA: { icon: "bi-box-arrow-up", variant: "action-amber", category: "Brazo hidráulico" },
  LUZ: { icon: "bi-lightbulb-fill", variant: "action-emerald", category: "Sistema óptico" },
  SONIDO: { icon: "bi-volume-up-fill", variant: "action-purple", category: "Alerta acústica" },
  VELOCIDAD: { icon: "bi-speedometer2", variant: "action-blue", category: "Potencia motor" },
};

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

/**
 * Muestra un aviso claro al usuario
 */
export function showErrorBanner(message) {
  const banner = document.getElementById("error-banner");
  const msgSpan = document.getElementById("error-banner-msg");
  if (!banner || !msgSpan) return;

  msgSpan.textContent = message;
  banner.classList.remove("d-none");
}

/**
 * Oculta el banner de aviso
 */
export function hideErrorBanner() {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.classList.add("d-none");
  }
}

/**
 * Actualiza el indicador del comando actual sin mostrar IDs internos
 */
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

/**
 * Actualiza los valores del joystick en pantalla
 */
export function updateJoystickTelemetry({ angle, distancePercent, directionLabel }) {
  const angleEl = document.getElementById("joy-angle");
  const distEl = document.getElementById("joy-distance");
  const dirEl = document.getElementById("joy-direction");

  if (angleEl) angleEl.textContent = `${angle}°`;
  if (distEl) distEl.textContent = `${distancePercent}%`;
  if (dirEl) dirEl.textContent = directionLabel;
}

/**
 * Renderiza los botones de funciones del vehículo ocupando todo el espacio de su tarjeta
 */
export function renderActionButtons(commands, onCommandClick) {
  const grid = document.getElementById("secondary-controls-grid");
  const badge = document.getElementById("catalog-status-badge");
  if (!grid) return;

  grid.innerHTML = "";

  if (!commands || commands.length === 0) {
    grid.innerHTML = `<div class="text-secondary small text-center py-2" style="grid-column: span 12;">Sin funciones adicionales</div>`;
    return;
  }

  if (badge) {
    badge.textContent = `${commands.length} Funciones`;
  }

  commands.forEach((cmd, idx) => {
    const meta = resolveCommandMeta(cmd);
    // Primeros 4 botones (Cabina y Garra) ocupan mitad en vertical/PC y cuarto en landscape; los últimos 3 (Luz, Sonido, Velocidad) ocupan un tercio
    const spanClass = idx < 4 ? "tile-half" : "tile-third";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn-action-cmd ${meta.variant} ${spanClass}`;
    btn.dataset.comandoId = cmd.id;
    btn.dataset.comandoNombre = cmd.nombre;
    btn.innerHTML = `
      <span class="action-icon-box"><i class="bi ${meta.icon}"></i></span>
      <span class="action-text-wrap">
        <span class="action-label">${escapeHtml(cmd.nombre)}</span>
        <span class="action-sub">${escapeHtml(meta.category)}</span>
      </span>
    `;

    btn.addEventListener("click", () => onCommandClick(cmd, btn));
    grid.appendChild(btn);
  });
}

/**
 * Resalta brevemente el botón presionado o confirmado
 */
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

/**
 * Llena el selector de secuencias DEMO con nombres limpios
 */
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
    opt.textContent = demo.descripcion
      ? `${demo.nombre} · ${demo.descripcion}`
      : demo.nombre;
    select.appendChild(opt);
  });
}

/**
 * Actualiza el estado visual de la ejecución DEMO
 */
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

/**
 * Habilita o deshabilita los botones de funciones durante una DEMO
 */
export function setControlsDisabled(disabled) {
  document.querySelectorAll(".btn-action-cmd").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function resolveCommandMeta(cmd) {
  const code = (cmd.codigo || "").toUpperCase();
  if (ICON_MAP[code]) return ICON_MAP[code];

  const name = (cmd.nombre || "").toLowerCase();
  if (name.includes("cabina") && name.includes("izq")) return ICON_MAP.CABINA_IZQ;
  if (name.includes("cabina") && name.includes("der")) return ICON_MAP.CABINA_DER;
  if (name.includes("bajar")) return ICON_MAP.BAJAR_GARRA;
  if (name.includes("subir")) return ICON_MAP.SUBIR_GARRA;
  if (name.includes("luz")) return ICON_MAP.LUZ;
  if (name.includes("sonido") || name.includes("claxon")) return ICON_MAP.SONIDO;
  if (name.includes("velocidad")) return ICON_MAP.VELOCIDAD;

  return { icon: "bi-Sliders", variant: "action-cyan", category: "Operación" };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
