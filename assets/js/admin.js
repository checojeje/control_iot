/**
 * @file admin.js
 * @description Módulo de ADMINISTRACIÓN COMERCIAL MULTIUSUARIO (Práctica 4.3).
 * Cualquier visitante que entra al link público ingresa como INVITADO sin privilegios.
 * Para acceder como USUARIO comprador o ADMINISTRADOR es obligatorio autenticarse con correo y contraseña.
 */

import {
  CONFIG,
  setAuthSession,
  restoreSavedSession,
  loginUser,
  requestGuestSession,
  releaseGuestSession,
  fetchAdminDashboard,
  fetchCommercialModels,
  createCommercialModel,
  fetchAuthorizedUnits,
  createPhysicalUnit,
  assignUnitOwner,
  toggleUnitSupportConsent,
  fetchClients,
  createClient,
  fetchAuditLog,
  fetchVehicleCommands,
  fetchAuthorizedDemosWithSteps,
  saveCompleteDemo,
  testCrossVehicleAccess,
} from "./api.js?v=2";

import { parseBackendTimestamp } from "./datetime.js?v=2";
import { showErrorBanner, hideErrorBanner } from "./ui.js?v=2";

export class AdminManager {
  constructor({ onUnitChanged, onDemosUpdated }) {
    this.onUnitChanged = onUnitChanged;
    this.onDemosUpdated = onDemosUpdated;

    this.activeSubTab = "acceso";
    this.models = [];
    this.units = [];
    this.clients = [];
    this.auditLogs = [];
    this.editorSteps = [];
    this.editorUnitCommands = [];
    this.editingDemoId = null;
    this.guestTimerInterval = null;
    this.guestRemainingSec = 0;
  }

  async init() {
    this.bindAdminEvents();

    // Si había una sesión iniciada en esta pestaña la restaura; de lo contrario entra como INVITADO público
    const restored = restoreSavedSession();
    if (!restored) {
      setAuthSession({
        token: null,
        role: "INVITADO",
        user: { id_usuario: null, nombre: "Visitante (Invitado)", rol: "INVITADO" },
        guestSession: null,
      });
    }

    this.updateRoleBadgeUI();
    await this.refreshAllAdminData();

    if (this.units.length > 0 && typeof this.onUnitChanged === "function") {
      this.onUnitChanged(this.units[0].id_vehiculo);
    }

    if (CONFIG.CURRENT_ROLE === "ADMIN") {
      this.switchSubTab("dashboard");
    } else if (CONFIG.CURRENT_ROLE === "USUARIO") {
      this.switchSubTab("clientes");
    } else {
      this.switchSubTab("exhibicion");
    }
  }

  bindAdminEvents() {
    document.querySelectorAll(".admin-subtab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sub = btn.dataset.subtab;
        if (sub) this.switchSubTab(sub);
      });
    });

    // Botón superior de Iniciar Sesión / Cerrar Sesión
    const btnTopAuth = document.getElementById("btn-top-auth");
    if (btnTopAuth) {
      btnTopAuth.addEventListener("click", async () => {
        if (CONFIG.AUTH_TOKEN && CONFIG.CURRENT_ROLE !== "INVITADO") {
          // Cerrar sesión y regresar a modo INVITADO público
          await this.performLogout();
        } else {
          // Abrir pestaña de Inicio de Sesión dentro de Administración
          document.getElementById("tab-btn-administracion")?.click();
          this.switchSubTab("acceso");
          document.getElementById("login-email")?.focus();
        }
      });
    }

    const btnLogoutPanel = document.getElementById("btn-logout-panel");
    if (btnLogoutPanel) {
      btnLogoutPanel.addEventListener("click", async () => {
        await this.performLogout();
      });
    }

    // Selector de Unidad Física Activa en la barra superior
    const unitSelect = document.getElementById("active-unit-select");
    if (unitSelect) {
      unitSelect.addEventListener("change", (e) => {
        const newVid = Number(e.target.value);
        if (newVid && typeof this.onUnitChanged === "function") {
          this.onUnitChanged(newVid);
        }
      });
    }

    // Formulario de Login Real con Correo y Contraseña
    const formLogin = document.getElementById("form-manual-login");
    if (formLogin) {
      formLogin.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email")?.value || "";
        const pwd = document.getElementById("login-password")?.value || "";
        await this.performLogin(email, pwd);
      });
    }

    // Formulario Alta de Modelo Comercial
    const formModel = document.getElementById("form-create-model");
    if (formModel) {
      formModel.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleCreateModel();
      });
    }

    // Formulario Alta de Unidad Física
    const formUnit = document.getElementById("form-create-unit");
    if (formUnit) {
      formUnit.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleCreateUnit();
      });
    }

    // Formulario Alta de Cliente Comprador
    const formClient = document.getElementById("form-create-client");
    if (formClient) {
      formClient.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleCreateClient();
      });
    }

    // Editor Visual de Demos
    const btnAddStep = document.getElementById("btn-editor-add-step");
    if (btnAddStep) {
      btnAddStep.addEventListener("click", () => this.addEditorStepFromInputs());
    }

    const btnSaveDemo = document.getElementById("btn-editor-save-demo");
    if (btnSaveDemo) {
      btnSaveDemo.addEventListener("click", () => this.handleSaveCompleteDemo());
    }

    const btnNewDemo = document.getElementById("btn-editor-clear");
    if (btnNewDemo) {
      btnNewDemo.addEventListener("click", () => this.resetDemoEditor());
    }

    const editorUnitSelect = document.getElementById("editor-unit-select");
    if (editorUnitSelect) {
      editorUnitSelect.addEventListener("change", (e) => {
        this.loadEditorCommandsAndDemos(Number(e.target.value));
      });
    }

    // Botones de Pruebas de Seguridad (P12 / P13)
    const btnTestIdor = document.getElementById("btn-test-idor-403");
    if (btnTestIdor) {
      btnTestIdor.addEventListener("click", () => this.runSecurityTestIdor());
    }

    const btnTestAdminBlock = document.getElementById("btn-test-admin-403");
    if (btnTestAdminBlock) {
      btnTestAdminBlock.addEventListener("click", () => this.runSecurityTestAdminAccess());
    }

    const btnReleaseGuest = document.getElementById("btn-release-guest-top");
    if (btnReleaseGuest) {
      btnReleaseGuest.addEventListener("click", () => this.handleReleaseGuestSession());
    }
  }

  async performLogin(email, password) {
    try {
      hideErrorBanner();
      this.stopGuestTimer();
      const res = await loginUser(email, password);
      setAuthSession({
        token: res.token,
        role: res.usuario.rol,
        user: res.usuario,
        guestSession: null,
      });

      const pwdInput = document.getElementById("login-password");
      if (pwdInput) pwdInput.value = "";

      this.updateRoleBadgeUI();
      await this.refreshAllAdminData();

      if (this.units.length > 0 && typeof this.onUnitChanged === "function") {
        this.onUnitChanged(this.units[0].id_vehiculo);
      }

      if (res.usuario.rol === "ADMIN") {
        this.switchSubTab("dashboard");
      } else {
        this.switchSubTab("clientes");
      }
    } catch (err) {
      showErrorBanner(err?.message || "Credenciales incorrectas");
    }
  }

  async performLogout() {
    hideErrorBanner();
    if (CONFIG.GUEST_SESSION) {
      await this.handleReleaseGuestSession(false);
      return;
    }

    this.stopGuestTimer();
    setAuthSession({
      token: null,
      role: "INVITADO",
      user: { id_usuario: null, nombre: "Visitante (Invitado)", rol: "INVITADO" },
      guestSession: null,
    });

    this.updateRoleBadgeUI();
    await this.refreshAllAdminData();

    if (this.units.length > 0 && typeof this.onUnitChanged === "function") {
      this.onUnitChanged(this.units[0].id_vehiculo);
    }

    this.switchSubTab("exhibicion");
  }

  updateRoleBadgeUI() {
    const roleBadge = document.getElementById("active-role-badge");
    const topRoleBadge = document.getElementById("top-role-pill");
    const btnTopAuth = document.getElementById("btn-top-auth");
    const btnLogoutPanel = document.getElementById("btn-logout-panel");
    const userLabel = document.getElementById("admin-current-user-label");
    const activeSessionCard = document.getElementById("active-session-info-box");

    const role = CONFIG.CURRENT_ROLE;
    const user = CONFIG.CURRENT_USER;
    const isLogged = Boolean(CONFIG.AUTH_TOKEN && role !== "INVITADO");

    const roleNames = {
      ADMIN: "ADMIN · Empresa",
      USUARIO: "USUARIO · Comprador",
      INVITADO: CONFIG.GUEST_SESSION ? "INVITADO · Prueba Activa" : "INVITADO · Visitante",
    };
    const labelText = roleNames[role] || role;

    if (roleBadge) {
      roleBadge.className = `role-indicator-pill role-${role.toLowerCase()}`;
      roleBadge.textContent = labelText;
    }
    if (topRoleBadge) {
      topRoleBadge.className = `role-indicator-pill role-${role.toLowerCase()}`;
      topRoleBadge.textContent = labelText;
    }

    if (btnTopAuth) {
      if (isLogged) {
        btnTopAuth.innerHTML = `<i class="bi bi-box-arrow-right"></i><span class="btn-reconnect-text">Cerrar Sesión</span>`;
        btnTopAuth.classList.add("btn-logout-mode");
      } else {
        btnTopAuth.innerHTML = `<i class="bi bi-person-lock"></i><span class="btn-reconnect-text">Iniciar Sesión</span>`;
        btnTopAuth.classList.remove("btn-logout-mode");
      }
    }

    if (btnLogoutPanel) {
      btnLogoutPanel.classList.toggle("d-none", !isLogged);
    }

    if (userLabel) {
      userLabel.textContent = user ? `${user.nombre}` : "Visitante";
    }

    if (activeSessionCard) {
      activeSessionCard.innerHTML = isLogged
        ? `<div class="text-success fw-bold"><i class="bi bi-patch-check-fill me-1"></i>Sesión autenticada activa</div>
           <div class="small text-light mt-1">Usuario: <strong>${escapeHtml(user?.nombre)}</strong> (${escapeHtml(user?.email)})</div>
           <div class="small text-info">Rol autorizado por FastAPI: <strong>${escapeHtml(role)}</strong></div>`
        : `<div class="text-warning fw-bold"><i class="bi bi-person-badge me-1"></i>Modo Visitante Público (INVITADO)</div>
           <div class="small text-secondary mt-1">Actualmente navegas como prospecto. Solo puedes consultar el catálogo de exhibición o iniciar sesión con tu cuenta de Comprador o Administrador.</div>`;
    }

    const isAdmin = role === "ADMIN";
    const isUser = role === "USUARIO";

    document.querySelectorAll(".admin-subtab-btn").forEach((btn) => {
      const sub = btn.dataset.subtab;
      if (sub === "dashboard" || sub === "inventario" || sub === "auditoria") {
        btn.classList.toggle("d-none", !isAdmin);
      } else if (sub === "clientes") {
        btn.classList.toggle("d-none", !(isAdmin || isUser));
        const span = btn.querySelector("span");
        if (span) span.textContent = isAdmin ? "Clientes y Mis Vehículos" : "Mis Vehículos";
      } else if (sub === "demos") {
        btn.classList.toggle("d-none", !(isAdmin || isUser));
      }
    });

    const adminClientsBlock = document.getElementById("admin-only-clients-block");
    if (adminClientsBlock) {
      adminClientsBlock.classList.toggle("d-none", !isAdmin);
    }
  }

  switchSubTab(subTabName) {
    this.activeSubTab = subTabName;
    document.querySelectorAll(".admin-subtab-btn").forEach((btn) => {
      const active = btn.dataset.subtab === subTabName;
      btn.classList.toggle("active", active);
    });

    document.querySelectorAll(".admin-subview").forEach((panel) => {
      const active = panel.id === `admin-subview-${subTabName}`;
      panel.classList.toggle("d-none", !active);
    });
  }

  async refreshAllAdminData() {
    try {
      const [modelsList, unitsList] = await Promise.all([
        fetchCommercialModels().catch(() => []),
        fetchAuthorizedUnits().catch(() => []),
      ]);

      this.models = modelsList;
      this.units = unitsList;

      this.populateTopUnitSelector(unitsList);
      this.renderModelsCatalog(modelsList);
      this.renderUnitsInventoryTable(unitsList);
      this.renderMyVehiclesCards(unitsList);
      this.renderExhibitionCatalog(unitsList, modelsList);

      if (CONFIG.CURRENT_ROLE === "ADMIN") {
        const dash = await fetchAdminDashboard().catch(() => null);
        if (dash) {
          this.renderDashboardMetrics(dash.metricas);
          this.clients = dash.clientes || [];
          this.auditLogs = dash.auditoria_reciente || [];
          this.renderClientsTable(this.clients);
          this.renderAuditTable(this.auditLogs);
          this.populateUnitFormSelects();
          this.renderUnitsInventoryTable(this.units);
        }
      }

      if (CONFIG.CURRENT_ROLE === "ADMIN" || CONFIG.CURRENT_ROLE === "USUARIO") {
        this.populateEditorUnitSelect(unitsList);
        if (unitsList.length > 0) {
          await this.loadEditorCommandsAndDemos(CONFIG.VEHICULO_ID);
        }
      }
    } catch (_) {
      // Silenciar si hay restricción de rol
    }
  }

  populateTopUnitSelector(units) {
    const select = document.getElementById("active-unit-select");
    if (!select) return;

    select.innerHTML = "";

    if (!units || units.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Sin unidades asignadas";
      select.appendChild(opt);
      return;
    }

    const currentExists = units.some((u) => Number(u.id_vehiculo) === Number(CONFIG.VEHICULO_ID));
    if (!currentExists) {
      CONFIG.VEHICULO_ID = Number(units[0].id_vehiculo);
    }

    units.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id_vehiculo;
      const code = u.codigo_unidad || `UNI-${u.id_vehiculo}`;
      const badge = u.estado_comercial || "ACTIVO";
      opt.textContent = `${code} · ${u.nombre} [${badge}]`;
      if (Number(u.id_vehiculo) === Number(CONFIG.VEHICULO_ID)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  renderDashboardMetrics(metricas) {
    if (!metricas) return;
    const map = {
      "kpi-modelos": metricas.total_modelos,
      "kpi-unidades": metricas.total_unidades,
      "kpi-vendidas": metricas.unidades_vendidas,
      "kpi-exhibicion": metricas.unidades_exhibicion,
      "kpi-clientes": metricas.total_clientes,
      "kpi-demos": metricas.total_demos,
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val ?? 0);
    });
  }

  populateUnitFormSelects() {
    const modSelect = document.getElementById("unit-model-select");
    if (modSelect) {
      modSelect.innerHTML = "";
      this.models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id_modelo;
        opt.textContent = `${m.nombre_modelo} (${m.microcontrolador_base})`;
        modSelect.appendChild(opt);
      });
    }

    const ownerSelect = document.getElementById("unit-owner-select");
    if (ownerSelect) {
      ownerSelect.innerHTML = `<option value="">-- Sin propietario (Inventario / Exhibición) --</option>`;
      this.clients
        .filter((c) => c.rol === "USUARIO")
        .forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id_usuario;
          opt.textContent = `${c.nombre} (${c.email})`;
          ownerSelect.appendChild(opt);
        });
    }
  }

  renderModelsCatalog(models) {
    const tbody = document.getElementById("admin-models-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    models.forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-bold text-info">#${m.id_modelo}</td>
        <td>
          <div class="fw-bold">${escapeHtml(m.nombre_modelo)}</div>
          <div class="small text-secondary">${escapeHtml(m.descripcion || m.categoria)}</div>
        </td>
        <td><span class="mon-origin-tag">${escapeHtml(m.microcontrolador_base)}</span></td>
        <td class="text-center"><span class="status-badge online">${m.total_unidades ?? 0} uds.</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderUnitsInventoryTable(units) {
    const tbody = document.getElementById("admin-units-tbody");
    const dashTbody = document.getElementById("dash-units-tbody");

    const buildRows = (targetTbody, compact = false) => {
      if (!targetTbody) return;
      targetTbody.innerHTML = "";

      units.forEach((u) => {
        const tr = document.createElement("tr");
        const st = u.estado_comercial || "VENDIDO";
        const badgeClass =
          st === "VENDIDO"
            ? "online"
            : st === "EXHIBICION"
              ? "checking"
              : st === "DISPONIBLE"
                ? "online"
                : "offline";

        const ownerOptions = [
          `<option value="" ${!u.id_propietario ? "selected" : ""}>-- Inventario / Exhibición --</option>`,
          ...this.clients
            .filter((c) => c.rol === "USUARIO")
            .map(
              (c) =>
                `<option value="${c.id_usuario}" ${Number(u.id_propietario) === Number(c.id_usuario) ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`
            ),
        ].join("");

        if (compact) {
          tr.innerHTML = `
            <td class="fw-bold text-info">${escapeHtml(u.codigo_unidad || `ID-${u.id_vehiculo}`)}</td>
            <td class="fw-semibold">${escapeHtml(u.nombre)}</td>
            <td><span class="status-badge ${badgeClass}">${escapeHtml(st)}</span></td>
            <td>${escapeHtml(u.propietario_nombre || "Empresa (Sin asignar)")}</td>
            <td>
              <span class="status-badge ${u.soporte_autorizado ? "online" : "offline"}">
                ${u.soporte_autorizado ? "Soporte OK" : "Restringido"}
              </span>
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td class="fw-bold text-info">${escapeHtml(u.codigo_unidad || `ID-${u.id_vehiculo}`)}</td>
            <td>
              <div class="fw-bold">${escapeHtml(u.nombre)}</div>
              <div class="small text-secondary">${escapeHtml(u.nombre_modelo || u.modelo || "IoT")}</div>
            </td>
            <td>
              <select class="form-select form-select-sm admin-inline-select sel-unit-state" data-vid="${u.id_vehiculo}">
                <option value="DISPONIBLE" ${st === "DISPONIBLE" ? "selected" : ""}>DISPONIBLE</option>
                <option value="VENDIDO" ${st === "VENDIDO" ? "selected" : ""}>VENDIDO</option>
                <option value="EXHIBICION" ${st === "EXHIBICION" ? "selected" : ""}>EXHIBICION</option>
                <option value="INACTIVO" ${st === "INACTIVO" ? "selected" : ""}>INACTIVO</option>
              </select>
            </td>
            <td>
              <select class="form-select form-select-sm admin-inline-select sel-unit-owner" data-vid="${u.id_vehiculo}">
                ${ownerOptions}
              </select>
            </td>
            <td class="text-end">
              <button type="button" class="btn-admin-action btn-save-assign" data-vid="${u.id_vehiculo}">
                <i class="bi bi-check2-circle"></i> Aplicar
              </button>
            </td>
          `;
        }
        targetTbody.appendChild(tr);
      });
    };

    buildRows(dashTbody, true);
    buildRows(tbody, false);

    if (tbody) {
      tbody.querySelectorAll(".btn-save-assign").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const vid = Number(btn.dataset.vid);
          const stateSel = tbody.querySelector(`.sel-unit-state[data-vid="${vid}"]`);
          const ownerSel = tbody.querySelector(`.sel-unit-owner[data-vid="${vid}"]`);
          const newState = stateSel ? stateSel.value : "VENDIDO";
          const newOwner = ownerSel && ownerSel.value ? Number(ownerSel.value) : null;

          try {
            hideErrorBanner();
            await assignUnitOwner(vid, newOwner, newState);
            await this.refreshAllAdminData();
          } catch (err) {
            showErrorBanner(err?.message || "Error al actualizar asignación");
          }
        });
      });
    }
  }

  renderClientsTable(clients) {
    const tbody = document.getElementById("admin-clients-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    clients.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-bold">#${c.id_usuario}</td>
        <td>
          <div class="fw-bold">${escapeHtml(c.nombre)}</div>
          <div class="small text-secondary">${escapeHtml(c.email)}</div>
        </td>
        <td><span class="mon-origin-tag">${escapeHtml(c.rol)}</span></td>
        <td class="text-center"><span class="status-badge online">${c.unidades_asignadas ?? 0} unidades</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderMyVehiclesCards(units) {
    const container = document.getElementById("my-vehicles-container");
    if (!container) return;
    container.innerHTML = "";

    if (!units || units.length === 0) {
      container.innerHTML = `
        <div class="mon-table-empty">
          <i class="bi bi-exclamation-circle me-2"></i>No tienes unidades asignadas actualmente a tu cuenta de comprador.
        </div>
      `;
      return;
    }

    units.forEach((u) => {
      const isSelected = Number(u.id_vehiculo) === Number(CONFIG.VEHICULO_ID);
      const card = document.createElement("div");
      card.className = `my-unit-card ${isSelected ? "selected" : ""}`;
      card.innerHTML = `
        <div class="my-unit-header">
          <div>
            <span class="mon-code-pill">${escapeHtml(u.codigo_unidad || `ID #${u.id_vehiculo}`)}</span>
            <h4 class="my-unit-title mt-1 mb-0">${escapeHtml(u.nombre)}</h4>
            <small class="text-secondary">${escapeHtml(u.nombre_modelo || u.modelo || "Vehículo IoT")}</small>
          </div>
          <span class="status-badge online">${escapeHtml(u.estado_comercial || "PROPIO")}</span>
        </div>

        <div class="my-unit-meta">
          <span><i class="bi bi-cpu me-1"></i>${escapeHtml(u.microcontrolador || "ESP8266")}</span>
          <span><i class="bi bi-person-check me-1"></i>${escapeHtml(u.propietario_nombre || "Inventario")}</span>
        </div>

        <div class="my-unit-actions">
          <label class="support-toggle-label" title="Permite o bloquea que el Administrador opere esta unidad vendida">
            <input
              type="checkbox"
              class="form-check-input chk-support-consent"
              data-vid="${u.id_vehiculo}"
              ${u.soporte_autorizado ? "checked" : ""}
            />
            <span>Autorizar soporte de Admin</span>
          </label>

          <button type="button" class="btn-admin-action btn-select-my-unit" data-vid="${u.id_vehiculo}">
            <i class="bi bi-joystick"></i> ${isSelected ? "Unidad Activa" : "Operar Unidad"}
          </button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll(".chk-support-consent").forEach((chk) => {
      chk.addEventListener("change", async (e) => {
        const vid = Number(chk.dataset.vid);
        try {
          hideErrorBanner();
          await toggleUnitSupportConsent(vid, e.target.checked);
          await this.refreshAllAdminData();
        } catch (err) {
          e.target.checked = !e.target.checked;
          showErrorBanner(err?.message || "No se pudo cambiar el permiso de soporte");
        }
      });
    });

    container.querySelectorAll(".btn-select-my-unit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vid = Number(btn.dataset.vid);
        if (typeof this.onUnitChanged === "function") {
          this.onUnitChanged(vid);
        }
        this.renderMyVehiclesCards(this.units);
      });
    });
  }

  populateEditorUnitSelect(units) {
    const sel = document.getElementById("editor-unit-select");
    if (!sel) return;
    sel.innerHTML = "";
    units.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id_vehiculo;
      opt.textContent = `${u.codigo_unidad || `ID-${u.id_vehiculo}`} · ${u.nombre}`;
      if (Number(u.id_vehiculo) === Number(CONFIG.VEHICULO_ID)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }

  async loadEditorCommandsAndDemos(idVehiculo) {
    if (!idVehiculo) return;
    try {
      const [cmds, demos] = await Promise.all([
        fetchVehicleCommands(idVehiculo).catch(() => []),
        fetchAuthorizedDemosWithSteps(idVehiculo).catch(() => []),
      ]);

      this.editorUnitCommands = cmds.filter((c) => !c.nombre.toLowerCase().includes("demo"));

      const cmdSel = document.getElementById("editor-step-cmd-select");
      if (cmdSel) {
        cmdSel.innerHTML = "";
        this.editorUnitCommands.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.nombre} (Cód. #${c.codigo})`;
          cmdSel.appendChild(opt);
        });
      }

      this.renderSavedDemosList(demos);
      if (this.editorSteps.length === 0 && this.editorUnitCommands.length > 0) {
        this.editorSteps = [
          { id_comando: this.editorUnitCommands[0].id, duracion_ms: 2000, pausa_ms: 500 },
        ];
        this.renderEditorStepsList();
      }
    } catch (_) {
      // Ignorar
    }
  }

  renderSavedDemosList(demos) {
    const listEl = document.getElementById("saved-demos-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!demos || demos.length === 0) {
      listEl.innerHTML = `<div class="small text-secondary py-2">Sin secuencias registradas para esta unidad.</div>`;
      return;
    }

    demos.forEach((d) => {
      const item = document.createElement("div");
      item.className = "saved-demo-item";
      const pasosCount = Array.isArray(d.pasos) ? d.pasos.length : 0;
      const badgeTone = d.tipo_demo === "PRIVADA" ? "checking" : "online";
      item.innerHTML = `
        <div>
          <div class="fw-bold small">${escapeHtml(d.nombre)}</div>
          <div class="text-secondary" style="font-size: 0.68rem;">
            <span class="status-badge ${badgeTone} me-1">${escapeHtml(d.tipo_demo || "EMPRESA")}</span>
            ${pasosCount} pasos configurados
          </div>
        </div>
        <button type="button" class="btn-admin-action btn-load-demo-edit" data-did="${d.id_demo}">
          <i class="bi bi-pencil-square"></i> Cargar
        </button>
      `;
      item.querySelector(".btn-load-demo-edit")?.addEventListener("click", () => {
        this.editingDemoId = d.id_demo;
        const nameInput = document.getElementById("editor-demo-name");
        const descInput = document.getElementById("editor-demo-desc");
        if (nameInput) nameInput.value = d.nombre;
        if (descInput) descInput.value = d.descripcion || "";
        this.editorSteps = (d.pasos || []).map((p) => ({
          id_comando: Number(p.id_comando),
          duracion_ms: Number(p.duracion_ms) || 1500,
          pausa_ms: Number(p.pausa_ms) || 0,
        }));
        this.renderEditorStepsList();
      });
      listEl.appendChild(item);
    });
  }

  addEditorStepFromInputs() {
    const cmdSel = document.getElementById("editor-step-cmd-select");
    const durInput = document.getElementById("editor-step-duration");
    const pauseInput = document.getElementById("editor-step-pause");

    const id_comando = Number(cmdSel?.value || 0);
    const duracion_ms = Math.max(300, Math.min(15000, Number(durInput?.value || 1500)));
    const pausa_ms = Math.max(0, Math.min(10000, Number(pauseInput?.value || 500)));

    if (!id_comando) return;
    this.editorSteps.push({ id_comando, duracion_ms, pausa_ms });
    this.renderEditorStepsList();
  }

  resetDemoEditor() {
    this.editingDemoId = null;
    const nameInput = document.getElementById("editor-demo-name");
    const descInput = document.getElementById("editor-demo-desc");
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";
    this.editorSteps = [];
    this.renderEditorStepsList();
  }

  renderEditorStepsList() {
    const tbody = document.getElementById("editor-steps-tbody");
    const totalBadge = document.getElementById("editor-total-time-badge");
    if (!tbody) return;

    tbody.innerHTML = "";
    let totalMs = 0;

    if (this.editorSteps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-secondary small py-2">Agrega movimientos a la secuencia DEMO</td></tr>`;
      if (totalBadge) totalBadge.textContent = "0 pasos · 0.0 s";
      return;
    }

    this.editorSteps.forEach((step, idx) => {
      totalMs += Number(step.duracion_ms) + Number(step.pausa_ms);
      const cmdObj = this.editorUnitCommands.find((c) => Number(c.id) === Number(step.id_comando));
      const cmdName = cmdObj ? cmdObj.nombre : `Comando #${step.id_comando}`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="fw-bold text-info">#${idx + 1}</td>
        <td class="fw-semibold">${escapeHtml(cmdName)}</td>
        <td class="font-monospace">${step.duracion_ms} ms</td>
        <td class="font-monospace">${step.pausa_ms} ms</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn-step-ctrl" data-action="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""} title="Subir">▲</button>
            <button type="button" class="btn-step-ctrl" data-action="down" data-idx="${idx}" ${idx === this.editorSteps.length - 1 ? "disabled" : ""} title="Bajar">▼</button>
            <button type="button" class="btn-step-ctrl text-danger" data-action="del" data-idx="${idx}" title="Quitar">✕</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (totalBadge) {
      totalBadge.textContent = `${this.editorSteps.length} pasos · ${(totalMs / 1000).toFixed(1)} s total`;
    }

    tbody.querySelectorAll(".btn-step-ctrl").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const act = btn.dataset.action;
        if (act === "up" && idx > 0) {
          [this.editorSteps[idx - 1], this.editorSteps[idx]] = [this.editorSteps[idx], this.editorSteps[idx - 1]];
        } else if (act === "down" && idx < this.editorSteps.length - 1) {
          [this.editorSteps[idx + 1], this.editorSteps[idx]] = [this.editorSteps[idx], this.editorSteps[idx + 1]];
        } else if (act === "del") {
          this.editorSteps.splice(idx, 1);
        }
        this.renderEditorStepsList();
      });
    });
  }

  async handleSaveCompleteDemo() {
    const unitSel = document.getElementById("editor-unit-select");
    const nameInput = document.getElementById("editor-demo-name");
    const descInput = document.getElementById("editor-demo-desc");

    const id_vehiculo = Number(unitSel?.value || CONFIG.VEHICULO_ID);
    const nombre = (nameInput?.value || "").trim();
    const descripcion = (descInput?.value || "").trim();

    if (!nombre) {
      showErrorBanner("Ingresa un nombre para la secuencia DEMO.");
      return;
    }
    if (this.editorSteps.length === 0) {
      showErrorBanner("Agrega al menos un paso de movimiento a la DEMO.");
      return;
    }

    try {
      hideErrorBanner();
      await saveCompleteDemo({
        id_demo: this.editingDemoId,
        id_vehiculo,
        nombre,
        descripcion,
        pasos: this.editorSteps,
      });

      this.editingDemoId = null;
      await this.loadEditorCommandsAndDemos(id_vehiculo);
      if (typeof this.onDemosUpdated === "function") {
        this.onDemosUpdated();
      }
    } catch (err) {
      showErrorBanner(err?.message || "No se pudo guardar la secuencia DEMO");
    }
  }

  renderExhibitionCatalog(units) {
    const container = document.getElementById("exhibition-cards-container");
    if (!container) return;
    container.innerHTML = "";

    const exhUnits = units.filter((u) => u.estado_comercial === "EXHIBICION");

    if (exhUnits.length === 0) {
      container.innerHTML = `<div class="small text-secondary">No hay unidades configuradas en modo EXHIBICIÓN en este momento.</div>`;
      return;
    }

    exhUnits.forEach((u) => {
      const reservedBy = u.reservado_por_invitado;
      const isMyReservation =
        CONFIG.GUEST_SESSION && Number(CONFIG.GUEST_SESSION.id_vehiculo) === Number(u.id_vehiculo);

      const card = document.createElement("div");
      card.className = "exhibition-unit-card";
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <span class="mon-code-pill">${escapeHtml(u.codigo_unidad || `EXH-${u.id_vehiculo}`)}</span>
            <h4 class="my-unit-title mt-1 mb-0">${escapeHtml(u.nombre)}</h4>
            <div class="small text-secondary">${escapeHtml(u.descripcion || "Unidad de demostración pública")}</div>
          </div>
          <span class="status-badge ${reservedBy && !isMyReservation ? "offline" : "online"}">
            ${
              isMyReservation
                ? "Tu Reserva Activa"
                : reservedBy
                  ? `Ocupado por ${escapeHtml(reservedBy)}`
                  : "Disponible para Prueba"
            }
          </span>
        </div>

        <div class="small text-info mt-1">
          <i class="bi bi-shield-lock me-1"></i>Comandos habilitados en prueba: Avanzar, Retroceder, Giros, Luz y Detener (180 s máx.)
        </div>

        <div class="d-flex gap-2 mt-2">
          <input
            type="text"
            class="form-control form-control-sm guest-name-input"
            placeholder="Escribe tu nombre para reservar prueba"
            value="${escapeHtml(CONFIG.GUEST_SESSION?.nombre_invitado || "")}"
          />
          <button
            type="button"
            class="btn-demo-start btn-start-guest-test"
            data-vid="${u.id_vehiculo}"
          >
            <i class="bi bi-play-circle-fill"></i>
            <span>${isMyReservation ? "Ir a CONTROL" : "Reservar Prueba"}</span>
          </button>
        </div>
      `;

      const btn = card.querySelector(".btn-start-guest-test");
      const nameInp = card.querySelector(".guest-name-input");
      btn?.addEventListener("click", async () => {
        if (isMyReservation) {
          document.getElementById("tab-btn-control")?.click();
          return;
        }
        const guestName = (nameInp?.value || "").trim() || "Prospecto Invitado";
        await this.handleStartGuestSession(u.id_vehiculo, guestName);
      });

      container.appendChild(card);
    });
  }

  async handleStartGuestSession(idVehiculo, nombreInvitado) {
    try {
      hideErrorBanner();
      const res = await requestGuestSession(idVehiculo, nombreInvitado, 180);

      setAuthSession({
        token: res.token,
        role: "INVITADO",
        user: { id_usuario: null, nombre: res.sesion.nombre_invitado, rol: "INVITADO" },
        guestSession: res.sesion,
      });

      this.updateRoleBadgeUI();
      this.startGuestCountdown(res.sesion.restante_segundos || 180);

      if (typeof this.onUnitChanged === "function") {
        this.onUnitChanged(res.sesion.id_vehiculo);
      }

      await this.refreshAllAdminData();
      document.getElementById("tab-btn-control")?.click();
    } catch (err) {
      showErrorBanner(err?.message || "No se pudo reservar la unidad de exhibición");
    }
  }

  startGuestCountdown(seconds) {
    this.stopGuestTimer();
    this.guestRemainingSec = Number(seconds);

    const banner = document.getElementById("guest-timer-strip");
    const timeEl = document.getElementById("guest-timer-countdown");
    const unitEl = document.getElementById("guest-timer-unit-name");

    if (banner) banner.classList.remove("d-none");
    if (unitEl && CONFIG.GUEST_SESSION) {
      unitEl.textContent = `${CONFIG.GUEST_SESSION.codigo_unidad || ""} · ${CONFIG.GUEST_SESSION.nombre_vehiculo || "Exhibición"}`;
    }

    const updateClock = () => {
      if (!timeEl) return;
      const mins = String(Math.floor(this.guestRemainingSec / 60)).padStart(2, "0");
      const secs = String(this.guestRemainingSec % 60).padStart(2, "0");
      timeEl.textContent = `${mins}:${secs}`;
    };

    updateClock();
    this.guestTimerInterval = setInterval(async () => {
      this.guestRemainingSec -= 1;
      if (this.guestRemainingSec <= 0) {
        await this.handleReleaseGuestSession(true);
      } else {
        updateClock();
      }
    }, 1000);
  }

  stopGuestTimer() {
    if (this.guestTimerInterval) {
      clearInterval(this.guestTimerInterval);
      this.guestTimerInterval = null;
    }
    const banner = document.getElementById("guest-timer-strip");
    if (banner) banner.classList.add("d-none");
  }

  async handleReleaseGuestSession(expired = false) {
    this.stopGuestTimer();
    try {
      await releaseGuestSession();
    } catch (_) {
      // Ignorar
    }

    setAuthSession({
      token: null,
      role: "INVITADO",
      user: { id_usuario: null, nombre: "Visitante (Invitado)", rol: "INVITADO" },
      guestSession: null,
    });
    this.updateRoleBadgeUI();
    await this.refreshAllAdminData();

    if (expired) {
      showErrorBanner("Tiempo de demostración agotado: La reserva se liberó y el vehículo se detuvo con seguridad.");
    }
  }

  async handleCreateModel() {
    const nombre_modelo = document.getElementById("model-name-input")?.value || "";
    const categoria = document.getElementById("model-cat-input")?.value || "Maquinaria IoT";
    const microcontrolador_base = document.getElementById("model-mcu-input")?.value || "ESP8266";
    const descripcion = document.getElementById("model-desc-input")?.value || "";

    try {
      hideErrorBanner();
      await createCommercialModel({
        nombre_modelo,
        categoria,
        microcontrolador_base,
        descripcion,
      });
      document.getElementById("form-create-model")?.reset();
      await this.refreshAllAdminData();
    } catch (err) {
      showErrorBanner(err?.message || "No se pudo crear el modelo comercial");
    }
  }

  async handleCreateUnit() {
    const codigo_unidad = document.getElementById("unit-code-input")?.value || "";
    const nombre = document.getElementById("unit-name-input")?.value || "";
    const id_modelo = Number(document.getElementById("unit-model-select")?.value || 1);
    const estado_comercial = document.getElementById("unit-state-select")?.value || "DISPONIBLE";
    const ownerVal = document.getElementById("unit-owner-select")?.value;
    const id_propietario = ownerVal ? Number(ownerVal) : null;

    try {
      hideErrorBanner();
      await createPhysicalUnit({
        codigo_unidad,
        nombre,
        id_modelo,
        estado_comercial,
        id_propietario,
      });
      document.getElementById("form-create-unit")?.reset();
      await this.refreshAllAdminData();
    } catch (err) {
      showErrorBanner(err?.message || "No se pudo registrar la unidad física");
    }
  }

  async handleCreateClient() {
    const nombre = document.getElementById("client-name-input")?.value || "";
    const email = document.getElementById("client-email-input")?.value || "";
    const telefono = document.getElementById("client-phone-input")?.value || "";
    const password = document.getElementById("client-pwd-input")?.value || "";

    try {
      hideErrorBanner();
      await createClient({ nombre, email, telefono, password, rol: "USUARIO" });
      document.getElementById("form-create-client")?.reset();
      await this.refreshAllAdminData();
    } catch (err) {
      showErrorBanner(err?.message || "No se pudo registrar el cliente comprador");
    }
  }

  renderAuditTable(logs) {
    const tbody = document.getElementById("admin-audit-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-secondary small py-2">Sin eventos de auditoría</td></tr>`;
      return;
    }

    logs.forEach((log) => {
      const parsed = parseBackendTimestamp(String(log.fecha_hora || ""));
      const res = String(log.resultado || "EXITO");
      const badgeClass = res.includes("DENEGADO") || res.includes("40") ? "offline" : "online";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="font-monospace small">${parsed.timeText}</td>
        <td>
          <div class="fw-bold small">${escapeHtml(log.nombre_actor)}</div>
          <span class="mon-origin-tag" style="font-size: 0.58rem;">${escapeHtml(log.rol_actor)}</span>
        </td>
        <td class="fw-semibold small text-info">${escapeHtml(log.accion)}</td>
        <td class="small">${escapeHtml(log.recurso)}${log.id_recurso ? ` #${escapeHtml(log.id_recurso)}` : ""}</td>
        <td><span class="status-badge ${badgeClass}">${escapeHtml(res)}</span></td>
        <td class="small text-secondary">${escapeHtml(log.detalle || "")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async runSecurityTestIdor() {
    const targetVid = CONFIG.CURRENT_ROLE === "USUARIO" && CONFIG.VEHICULO_ID === 1 ? 2 : 1;
    try {
      await testCrossVehicleAccess(targetVid);
      showErrorBanner(`Acceso autorizado a Unidad #${targetVid} porque tu sesión actual (${CONFIG.CURRENT_ROLE}) tiene permiso.`);
    } catch (err) {
      showErrorBanner(`Bloqueo BOLA/IDOR Verificado (${err?.status || 403}): ${err?.message}`);
    }
  }

  async runSecurityTestAdminAccess() {
    try {
      await fetchAdminDashboard();
      showErrorBanner("Acceso concedido a Dashboard porque has iniciado sesión como ADMIN.");
    } catch (err) {
      showErrorBanner(`Rechazo RBAC Verificado (${err?.status || 403}): ${err?.message}`);
    }
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
