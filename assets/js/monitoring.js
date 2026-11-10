/**
 * @file monitoring.js
 * @description Módulo de MONITOREO en tiempo real (Práctica 4.2):
 * - Tarjeta destacada del último movimiento / estado reportado con fecha y hora verificables.
 * - Tabla dinámica de los 10 movimientos individuales más recientes persistidos en Amazon RDS.
 * - Deduplicación por id_historial, filtro por vehículo, orden descendente y reconciliación REST tras WSS.
 * - Protección contra respuestas HTTP tardías y exclusión de pasos internos de DEMO en el historial.
 */

import {
  CONFIG,
  fetchVehicleLastState,
  fetchVehicleHistory,
} from "./api.js?v=2";
import { parseBackendTimestamp } from "./datetime.js?v=2";

const MOVEMENT_VISUALS = {
  1: { icon: "bi-arrow-up-circle-fill", tone: "tone-cyan", label: "Avanzar" },
  2: { icon: "bi-arrow-down-circle-fill", tone: "tone-cyan", label: "Retroceder" },
  3: { icon: "bi-arrow-counterclockwise", tone: "tone-cyan", label: "Cabina Izquierda" },
  4: { icon: "bi-arrow-clockwise", tone: "tone-cyan", label: "Cabina Derecha" },
  5: { icon: "bi-arrow-right-circle-fill", tone: "tone-cyan", label: "Girar Derecha" },
  6: { icon: "bi-arrow-left-circle-fill", tone: "tone-cyan", label: "Girar Izquierda" },
  7: { icon: "bi-box-arrow-in-down", tone: "tone-amber", label: "Bajar Garra" },
  8: { icon: "bi-box-arrow-up", tone: "tone-amber", label: "Subir Garra" },
  9: { icon: "bi-lightbulb-fill", tone: "tone-emerald", label: "Luz" },
  10: { icon: "bi-volume-up-fill", tone: "tone-purple", label: "Sonido" },
  11: { icon: "bi-speedometer2", tone: "tone-blue", label: "Velocidad" },
  12: { icon: "bi-play-btn-fill", tone: "tone-emerald", label: "Demo" },
  13: { icon: "bi-sign-stop-fill", tone: "tone-red", label: "Detener" },
};

export class MonitoringManager {
  constructor({ getCommandNameById, onSyncStatusChange }) {
    this.getCommandNameById = getCommandNameById;
    this.onSyncStatusChange = onSyncStatusChange;

    // Control de concurrencia y orden para evitar que respuestas HTTP viejas pisen eventos WSS nuevos
    this.syncSequenceId = 0;
    this.lastAppliedEpochMs = 0;
    this.lastAppliedHistorialId = 0;
    this.reconcileTimer = null;
    this.currentHistory = [];
    this.hasLoadedOnce = false;
  }

  /**
   * Carga inicial o resincronización completa de Último Estado + 10 registros de Historial vía REST
   */
  async syncFromBackend({ reason = "CARGA_INICIAL", silent = false } = {}) {
    const requestSeq = ++this.syncSequenceId;

    if (!silent && !this.hasLoadedOnce) {
      this.renderTableLoadingState("Consultando últimos 10 movimientos en Amazon RDS...");
    }
    this.setSyncBadgeState("syncing", "Sincronizando RDS...");

    try {
      const [stateData, historyList] = await Promise.all([
        fetchVehicleLastState(),
        fetchVehicleHistory(),
      ]);

      // Descartar respuesta si una sincronización más reciente ya fue disparada
      if (requestSeq < this.syncSequenceId) {
        return { ok: true, superseded: true };
      }

      const normalizedHistory = this.normalizeAndDeduplicateHistory(historyList);
      this.currentHistory = normalizedHistory;
      this.hasLoadedOnce = true;

      // Renderizar la tabla de máximo 10 movimientos individuales persistidos
      this.renderHistoryTable(normalizedHistory);

      // Determinar el último estado combinando /estado y el registro #1 más reciente si procede
      this.applyBackendLastState(stateData, normalizedHistory[0] || null, reason);

      this.setSyncBadgeState("synced", "Sincronizado con RDS");
      if (typeof this.onSyncStatusChange === "function") {
        this.onSyncStatusChange({ ok: true, stateData, history: normalizedHistory });
      }

      return { ok: true, stateData, history: normalizedHistory };
    } catch (err) {
      if (requestSeq < this.syncSequenceId) {
        return { ok: false, superseded: true };
      }

      this.setSyncBadgeState("error", "Sin datos actualizados");
      if (!this.hasLoadedOnce) {
        this.renderTableErrorState(
          err?.message || "No se pudo recuperar el historial desde la API."
        );
        this.renderLastMovementEmptyOrError("Sin datos actualizados");
      }
      if (typeof this.onSyncStatusChange === "function") {
        this.onSyncStatusChange({ ok: false, error: err });
      }
      return { ok: false, error: err };
    }
  }

  /**
   * Normaliza, filtra por vehículo, elimina duplicados por id_historial,
   * ordena del más reciente al más antiguo y limita estrictamente a 10 filas.
   */
  normalizeAndDeduplicateHistory(rawList) {
    if (!Array.isArray(rawList)) return [];

    const seenIds = new Set();
    const validItems = [];

    for (const item of rawList) {
      if (!item || typeof item !== "object") continue;

      // Filtrar registros de otro vehículo si existieran
      if (
        item.id_vehiculo !== undefined &&
        Number(item.id_vehiculo) !== Number(CONFIG.VEHICULO_ID)
      ) {
        continue;
      }

      const histId = Number(item.id_historial ?? item.id ?? 0);
      if (histId > 0) {
        if (seenIds.has(histId)) continue;
        seenIds.add(histId);
      }

      const rawTs = item.fecha_hora || item.fecha_actualizacion || item.fecha || "";
      const parsedTs = parseBackendTimestamp(rawTs);
      const codigo = Number(item.codigo ?? item.id_comando ?? 0);
      const comandoNombre = String(
        item.comando || this.getCommandNameById(codigo) || "Movimiento"
      );

      validItems.push({
        id_historial: histId,
        id_vehiculo: Number(item.id_vehiculo ?? CONFIG.VEHICULO_ID),
        comando: comandoNombre,
        codigo: codigo > 0 ? codigo : null,
        origen: String(item.origen || "REST_API"),
        rawTimestamp: rawTs,
        dateText: parsedTs.dateText,
        timeText: parsedTs.timeText,
        epochMs: parsedTs.epochMs,
      });
    }

    // Ordenar del más nuevo al más antiguo usando id_historial y timestamp real
    validItems.sort((a, b) => {
      if (a.id_historial && b.id_historial && a.id_historial !== b.id_historial) {
        return b.id_historial - a.id_historial;
      }
      return b.epochMs - a.epochMs;
    });

    if (validItems.length > 0 && validItems[0].id_historial > this.lastAppliedHistorialId) {
      this.lastAppliedHistorialId = validItems[0].id_historial;
    }

    // Limitar estrictamente a los 10 movimientos individuales más recientes
    return validItems.slice(0, CONFIG.MAX_HISTORY_ROWS);
  }

  /**
   * Actualiza la tarjeta del Último Movimiento con datos confirmados por REST (/estado)
   */
  applyBackendLastState(stateData, newestHistoryRow, reason = "REST") {
    if (!stateData || typeof stateData !== "object") {
      if (newestHistoryRow) {
        this.renderLastMovementCard({
          commandName: newestHistoryRow.comando,
          commandCode: newestHistoryRow.codigo,
          vehicleName: "Excavadora IoT",
          vehicleId: CONFIG.VEHICULO_ID,
          dateText: newestHistoryRow.dateText,
          timeText: newestHistoryRow.timeText,
          sourceLabel: "Persistido en RDS (REST)",
          sourceType: "persisted",
          originText: formatOriginLabel(newestHistoryRow.origen),
        });
      } else {
        this.renderLastMovementEmptyOrError("Sin movimientos");
      }
      return;
    }

    const rawTs =
      stateData.fecha_actualizacion ||
      stateData.fecha_hora ||
      newestHistoryRow?.rawTimestamp ||
      "";
    const parsedTs = parseBackendTimestamp(rawTs);

    // Evitar que una respuesta REST con timestamp más antiguo reemplace un estado más reciente
    if (
      parsedTs.epochMs > 0 &&
      this.lastAppliedEpochMs > 0 &&
      parsedTs.epochMs < this.lastAppliedEpochMs &&
      reason !== "RECONEXION_WSS"
    ) {
      return;
    }

    if (parsedTs.epochMs > 0) {
      this.lastAppliedEpochMs = parsedTs.epochMs;
    }

    const cmdCode = Number(stateData.codigo ?? stateData.id_comando ?? 0);
    const cmdName = String(
      stateData.comando || this.getCommandNameById(cmdCode) || "Sin movimientos"
    );
    const vehicleName = String(stateData.vehiculo || "Excavadora IoT");
    const vehicleId = Number(stateData.id_vehiculo ?? CONFIG.VEHICULO_ID);

    // Si el comando actual de /estado coincide con el último del historial, mostramos su origen
    const matchingOrigin =
      newestHistoryRow &&
      (newestHistoryRow.comando.toLowerCase() === cmdName.toLowerCase() ||
        newestHistoryRow.codigo === cmdCode)
        ? formatOriginLabel(newestHistoryRow.origen)
        : "Estado reportado en RDS";

    this.renderLastMovementCard({
      commandName: cmdName,
      commandCode: cmdCode > 0 ? cmdCode : null,
      vehicleName,
      vehicleId,
      dateText: parsedTs.dateText,
      timeText: parsedTs.timeText,
      sourceLabel: "Persistido en RDS (REST)",
      sourceType: "persisted",
      originText: matchingOrigin,
    });
  }

  /**
   * Procesa un evento recibido en vivo por el canal WebSocket (WSS).
   * - Si es NUEVO_MOVIMIENTO: actualiza inmediatamente la tarjeta de último movimiento
   *   y programa la reconciliación REST de la tabla de 10 registros.
   * - Si es INICIO_DEMO / MOVIMIENTO_DEMO / FIN_DEMO: actualiza la tarjeta de último estado
   *   en tiempo real pero NO inserta pasos internos de DEMO en el historial individual.
   */
  handleRealtimeWsEvent(payload) {
    if (!payload || typeof payload !== "object") return;

    // Validar que el evento corresponda al vehículo monitoreado
    if (
      payload.vehiculo_id !== undefined &&
      Number(payload.vehiculo_id) !== Number(CONFIG.VEHICULO_ID)
    ) {
      return;
    }

    const evento = String(payload.evento || "");

    if (evento === "NUEVO_MOVIMIENTO") {
      const cmdId = Number(payload.comando_id ?? payload.datos?.comando_id ?? 0);
      const cmdName =
        payload.datos?.comando || this.getCommandNameById(cmdId) || "Movimiento";

      const rawTs = payload.fecha_hora || payload.timestamp || payload.datos?.fecha_hora || "";
      const parsedTs = parseBackendTimestamp(rawTs);

      // Mostrar inmediatamente el evento WSS mientras se reconcilia la persistencia real en RDS
      this.renderLastMovementCard({
        commandName: cmdName,
        commandCode: cmdId > 0 ? cmdId : null,
        vehicleName: "Excavadora IoT",
        vehicleId: CONFIG.VEHICULO_ID,
        dateText: parsedTs.valid ? parsedTs.dateText : "Sincronizando...",
        timeText: parsedTs.valid ? parsedTs.timeText : "Sincronizando...",
        sourceLabel: "Evento en vivo (WSS)",
        sourceType: "wss-live",
        originText: "Confirmando persistencia en RDS...",
      });

      this.scheduleRestReconciliation("EVENTO_WSS_MOVIMIENTO");
      return;
    }

    if (evento === "INICIO_DEMO") {
      this.renderLastMovementCard({
        commandName: "Inicio de DEMO",
        commandCode: 12,
        vehicleName: "Excavadora IoT",
        vehicleId: CONFIG.VEHICULO_ID,
        dateText: this.getLastKnownDateText(),
        timeText: this.getLastKnownTimeText(),
        sourceLabel: "Evento DEMO (WSS · No historial)",
        sourceType: "demo-step",
        originText: `Secuencia automática (${payload.total_movimientos || "N"} pasos)`,
      });
      return;
    }

    if (evento === "MOVIMIENTO_DEMO") {
      const cmdId = Number(payload.comando_id ?? 0);
      const cmdName = this.getCommandNameById(cmdId) || "Paso DEMO";
      const stepNum = payload.orden ? `Paso #${payload.orden}` : "Paso en ejecución";

      // Regla de negocio 4.3 / 9.3: Los movimientos internos de DEMO actualizan el último estado
      // pero NO se agregan a la tabla de los 10 movimientos individuales.
      this.renderLastMovementCard({
        commandName: `DEMO · ${cmdName}`,
        commandCode: cmdId > 0 ? cmdId : 12,
        vehicleName: "Excavadora IoT",
        vehicleId: CONFIG.VEHICULO_ID,
        dateText: this.getLastKnownDateText(),
        timeText: this.getLastKnownTimeText(),
        sourceLabel: "Paso interno DEMO (WSS · No historial)",
        sourceType: "demo-step",
        originText: `${stepNum} · Excluido de historial individual`,
      });
      return;
    }

    if (evento === "FIN_DEMO") {
      this.renderLastMovementCard({
        commandName: "Fin de DEMO (Detener)",
        commandCode: 13,
        vehicleName: "Excavadora IoT",
        vehicleId: CONFIG.VEHICULO_ID,
        dateText: this.getLastKnownDateText(),
        timeText: this.getLastKnownTimeText(),
        sourceLabel: "Evento DEMO (WSS)",
        sourceType: "persisted",
        originText: "Secuencia finalizada",
      });
      // Al concluir la DEMO consultamos el estado real en RDS para verificar consistencia
      this.scheduleRestReconciliation("FIN_DEMO");
    }
  }

  /**
   * Reconcilia con la API REST aplicando un debounce corto (180ms) para evitar tormentas
   * de peticiones si llegan múltiples eventos WSS seguidos.
   */
  scheduleRestReconciliation(reason = "WSS") {
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
    }
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this.syncFromBackend({ reason, silent: true });
    }, 180);
  }

  getLastKnownDateText() {
    const el = document.getElementById("mon-last-date");
    const current = el ? el.textContent.trim() : "";
    return current && current !== "--/--/----" ? current : "Tiempo real (WSS)";
  }

  getLastKnownTimeText() {
    const el = document.getElementById("mon-last-time");
    const current = el ? el.textContent.trim() : "";
    return current && current !== "--:--:--" ? current : "En ejecución";
  }

  /**
   * Actualiza el DOM de la tarjeta destacada del Último Movimiento
   */
  renderLastMovementCard({
    commandName,
    commandCode,
    vehicleName,
    vehicleId,
    dateText,
    timeText,
    sourceLabel,
    sourceType,
    originText,
  }) {
    const visual = resolveMovementVisual(commandCode, commandName);

    const iconWrap = document.getElementById("mon-last-icon-wrap");
    const iconEl = document.getElementById("mon-last-icon");
    const nameEl = document.getElementById("mon-last-command");
    const codeBadgeEl = document.getElementById("mon-last-code-badge");
    const vehicleEl = document.getElementById("mon-last-vehicle");
    const dateEl = document.getElementById("mon-last-date");
    const timeEl = document.getElementById("mon-last-time");
    const sourceBadgeEl = document.getElementById("mon-last-source-badge");
    const originEl = document.getElementById("mon-last-origin");
    const heroCard = document.getElementById("mon-hero-card");

    if (iconWrap) {
      iconWrap.className = `mon-hero-icon ${visual.tone}`;
    }
    if (iconEl) {
      iconEl.className = `bi ${visual.icon}`;
    }
    if (nameEl) {
      nameEl.textContent = commandName || "Sin movimientos";
    }
    if (codeBadgeEl) {
      if (commandCode) {
        codeBadgeEl.textContent = `Código #${commandCode}`;
        codeBadgeEl.classList.remove("d-none");
      } else {
        codeBadgeEl.classList.add("d-none");
      }
    }
    if (vehicleEl) {
      vehicleEl.textContent = `${vehicleName} (ID #${vehicleId})`;
    }
    if (dateEl) {
      dateEl.textContent = dateText || "Sin fecha";
    }
    if (timeEl) {
      timeEl.textContent = timeText || "Sin hora";
    }
    if (originEl) {
      originEl.textContent = originText || "Reporte verificado";
    }
    if (sourceBadgeEl) {
      sourceBadgeEl.textContent = sourceLabel || "Persistido en RDS";
      sourceBadgeEl.className = `mon-source-pill ${sourceType || "persisted"}`;
    }
    if (heroCard) {
      heroCard.classList.remove("pulse-update");
      void heroCard.offsetWidth;
      heroCard.classList.add("pulse-update");
    }
  }

  renderLastMovementEmptyOrError(statusLabel = "Sin movimientos") {
    const nameEl = document.getElementById("mon-last-command");
    const sourceBadgeEl = document.getElementById("mon-last-source-badge");
    if (nameEl && (!nameEl.textContent || nameEl.textContent === "Cargando...")) {
      nameEl.textContent = statusLabel;
    }
    if (sourceBadgeEl) {
      sourceBadgeEl.textContent = statusLabel;
      sourceBadgeEl.className = "mon-source-pill warning";
    }
  }

  /**
   * Renderiza la tabla semántica con los últimos 10 movimientos individuales persistidos
   */
  renderHistoryTable(rows) {
    const tbody = document.getElementById("mon-history-tbody");
    const countBadge = document.getElementById("mon-history-count");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      if (countBadge) countBadge.textContent = "0 / 10 registros";
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="mon-table-empty">
            <i class="bi bi-inbox me-2"></i>Sin movimientos individuales registrados para este vehículo.
          </td>
        </tr>
      `;
      return;
    }

    if (countBadge) {
      countBadge.textContent = `${rows.length} / 10 recientes`;
    }

    const fragment = document.createDocumentFragment();

    rows.forEach((row, index) => {
      const visual = resolveMovementVisual(row.codigo, row.comando);
      const tr = document.createElement("tr");
      if (index === 0) {
        tr.className = "mon-row-latest";
      }

      // 1. Columna # (Numeración visual 1..10)
      const tdNum = document.createElement("td");
      tdNum.className = "col-num";
      tdNum.textContent = String(index + 1);

      // 2. Columna Movimiento (Icono + Nombre + Código real)
      const tdMove = document.createElement("td");
      tdMove.className = "col-move";

      const moveWrap = document.createElement("div");
      moveWrap.className = "mon-move-cell";

      const iconSpan = document.createElement("span");
      iconSpan.className = `mon-row-icon ${visual.tone}`;
      const iconTag = document.createElement("i");
      iconTag.className = `bi ${visual.icon}`;
      iconSpan.appendChild(iconTag);

      const textWrap = document.createElement("div");
      textWrap.className = "mon-move-texts";

      const titleSpan = document.createElement("span");
      titleSpan.className = "mon-move-name";
      titleSpan.textContent = row.comando;
      textWrap.appendChild(titleSpan);

      if (row.codigo) {
        const metaSpan = document.createElement("span");
        metaSpan.className = "mon-move-code";
        metaSpan.textContent = `Cód. #${row.codigo}${row.id_historial ? ` · Reg. #${row.id_historial}` : ""}`;
        textWrap.appendChild(metaSpan);
      }

      moveWrap.appendChild(iconSpan);
      moveWrap.appendChild(textWrap);
      tdMove.appendChild(moveWrap);

      // 3. Columna Origen
      const tdOrigin = document.createElement("td");
      tdOrigin.className = "col-origin";
      const originPill = document.createElement("span");
      originPill.className = "mon-origin-tag";
      originPill.textContent = formatOriginLabel(row.origen);
      tdOrigin.appendChild(originPill);

      // 4. Columna Fecha
      const tdDate = document.createElement("td");
      tdDate.className = "col-date";
      tdDate.textContent = row.dateText;

      // 5. Columna Hora
      const tdTime = document.createElement("td");
      tdTime.className = "col-time";
      tdTime.textContent = row.timeText;

      tr.appendChild(tdNum);
      tr.appendChild(tdMove);
      tr.appendChild(tdOrigin);
      tr.appendChild(tdDate);
      tr.appendChild(tdTime);

      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
  }

  renderTableLoadingState(message = "Cargando...") {
    const tbody = document.getElementById("mon-history-tbody");
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="mon-table-empty">
          <span class="spinner-border spinner-border-sm text-info me-2" role="status" aria-hidden="true"></span>
          ${escapeHtml(message)}
        </td>
      </tr>
    `;
  }

  renderTableErrorState(message = "Error al cargar el historial") {
    const tbody = document.getElementById("mon-history-tbody");
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="mon-table-empty text-danger">
          <i class="bi bi-exclamation-octagon-fill me-2"></i>${escapeHtml(message)}
        </td>
      </tr>
    `;
  }

  setSyncBadgeState(state, text) {
    const badge = document.getElementById("mon-sync-status-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.className = `panel-tag sync-${state}`;
  }
}

function resolveMovementVisual(codigo, nombre = "") {
  const numCode = Number(codigo);
  if (MOVEMENT_VISUALS[numCode]) {
    return MOVEMENT_VISUALS[numCode];
  }

  const lower = String(nombre).toLowerCase();
  if (lower.includes("detener") || lower.includes("paro")) return MOVEMENT_VISUALS[13];
  if (lower.includes("avanzar")) return MOVEMENT_VISUALS[1];
  if (lower.includes("retroceder")) return MOVEMENT_VISUALS[2];
  if (lower.includes("cabina") && lower.includes("izq")) return MOVEMENT_VISUALS[3];
  if (lower.includes("cabina") && lower.includes("der")) return MOVEMENT_VISUALS[4];
  if (lower.includes("girar") && lower.includes("der")) return MOVEMENT_VISUALS[5];
  if (lower.includes("girar") && lower.includes("izq")) return MOVEMENT_VISUALS[6];
  if (lower.includes("bajar")) return MOVEMENT_VISUALS[7];
  if (lower.includes("subir")) return MOVEMENT_VISUALS[8];
  if (lower.includes("luz")) return MOVEMENT_VISUALS[9];
  if (lower.includes("sonido")) return MOVEMENT_VISUALS[10];
  if (lower.includes("velocidad")) return MOVEMENT_VISUALS[11];
  if (lower.includes("demo")) return MOVEMENT_VISUALS[12];

  return { icon: "bi-activity", tone: "tone-cyan", label: nombre || "Movimiento" };
}

function formatOriginLabel(rawOrigin = "") {
  const upper = String(rawOrigin).toUpperCase();
  if (upper.includes("JOYSTICK")) return "Joystick";
  if (upper.includes("BOTON") || upper.includes("BOTÓN")) return "Botón táctil";
  if (upper.includes("PRIORIDAD") || upper.includes("DETENER")) return "Paro prioritario";
  if (upper.includes("FIN_DEMO")) return "Fin DEMO";
  if (upper.includes("THUNDER") || upper.includes("POSTMAN")) return "Cliente externo";
  return rawOrigin || "Control Web";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
