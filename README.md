# Práctica 4.2 · Aplicación de Control y Monitoreo para IoT

Ampliación responsiva de la aplicación web de **CONTROL (Práctica 4.1)** incorporando el módulo de **MONITOREO en tiempo real (Práctica 4.2)** sobre el mismo proyecto, conectada mediante **HTTPS (Fetch / async-await)** y **WebSocket Seguro (WSS)** hacia las **21 APIs REST con FastAPI en AWS** y **Amazon RDS MySQL (`vehiculo_iot`)**.

---

## 1. Arquitectura de la Solución

```
GitHub Pages (HTML5 + CSS3 + Bootstrap 5 + JS ES6+ Modular)
   ├── Vista CONTROL (Joystick + 7 Controles + DETENER Prioritario + DEMO)
   └── Vista MONITOREO (Último Movimiento en Tiempo Real + Tabla de 10 Registros)
          │
          ├── HTTPS (Fetch / async-await) ──► FastAPI en AWS (21 APIs REST) ──► Amazon RDS MySQL
          └── WSS (Sesión Única Compartida) ◄── Eventos en Tiempo Real (NUEVO_MOVIMIENTO / DEMO)
```

---

## 2. Estructura Modular del Proyecto

```text
monitoreo_iot/
├── index.html                  # Vistas CONTROL y MONITOREO, navegación accesible y 3 indicadores
├── README.md                   # Documentación técnica de las etapas 4.1 y 4.2
└── assets/
    ├── favicon.svg             # Favicon vectorial relativo para GitHub Pages
    ├── css/
    │   └── style.css           # Diseño Industrial Cockpit (Cero Scroll en PC y Móvil Vertical/Horizontal)
    └── js/
        ├── app.js              # Orquestador principal de CONTROL, MONITOREO, REST y WSS compartido
        ├── api.js              # Cliente HTTP Fetch con async/await, timeouts y cola secuencial
        ├── ws.js               # Cliente WebSocket nativo compartido con reconexión y resincronización
        ├── monitoring.js       # Lógica de Último Movimiento, Tabla de 10 registros y deduplicación
        ├── datetime.js         # Parseo y formato verificable de Fecha (DD/MM/YYYY) y Hora (HH:MM:SS)
        ├── joystick.js         # Joystick virtual (Pointer Events táctil/mouse + teclado)
        └── ui.js               # Controlador de pestañas, indicadores y componentes visuales
```

---

## 3. Contratos Reales Consumidos en AWS

- **Servidor Base HTTPS**: `https://api-iot-sergio.duckdns.org`
- **Canal WebSocket WSS**: `wss://api-iot-sergio.duckdns.org/ws/vehiculo/1`
- **Vehículo Monitoreado**: `ID #1` (`Excavadora IoT`)

| Operación | Método y Ruta | Procedimiento / Función en Backend |
| :--- | :--- | :--- |
| Salud de API AWS (21 servicios) | `GET /openapi.json` | Esquema OpenAPI de los 21 endpoints |
| Diagnóstico RDS y Último Estado | `GET /api/vehiculos/1/estado` | `sp_obtener_estado(1)` |
| Últimos 10 Movimientos Individuales | `GET /api/vehiculos/1/historial` | `sp_obtener_historial(1)` |
| Catálogo de Comandos | `GET /api/vehiculos/1/comandos` | `sp_obtener_comandos_vehiculo(1)` |
| Ejecutar Movimiento Individual | `POST /api/vehiculos/movimiento` | `sp_actualizar_estado` + `sp_registrar_historial` + Broadcast WSS |
| Consultar Secuencias DEMO | `GET /api/vehiculos/1/demos` | `sp_obtener_demos(1)` |
| Movimientos de una DEMO | `GET /api/demos/{id}/movimientos` | `sp_obtener_movimientos_demo(id)` |
| Ejecutar Secuencia DEMO | `POST /api/vehiculos/demo` | Ejecución asíncrona con `INICIO_DEMO`, `MOVIMIENTO_DEMO`, `FIN_DEMO` |

---

## 4. Reglas de Negocio Implementadas en 4.2

1. **Conservación íntegra de CONTROL (4.1)**: Joystick con retorno automático a `Detener`, 7 botones táctiles del catálogo, botón prioritario `DETENER VEHÍCULO` y ejecución/cancelación de `DEMO`.
2. **Tarjeta del Último Movimiento Reportado**: Muestra el movimiento actual, código real, vehículo, fecha y hora provenientes del backend, diferenciando entre estado persistido en RDS (`REST`), evento en vivo (`WSS`) y pasos internos de una `DEMO`.
3. **Tabla Dinámica de 10 Movimientos Individuales**: Muestra como máximo los 10 registros más recientes de `historial_comandos`, ordenados del más nuevo al más antiguo, deduplicados por `id_historial` y filtrados por `id_vehiculo = 1`.
4. **Exclusión de pasos internos de DEMO en el historial**: Durante una DEMO, los eventos `MOVIMIENTO_DEMO` actualizan la tarjeta de último estado en tiempo real pero **no** contaminan la tabla de los 10 movimientos individuales.
5. **Reconciliación tras Reconexión WSS**: Una sola conexión WSS alimenta ambas vistas y, al reconectarse tras una caída de red, vuelve a sincronizar automáticamente el estado y la tabla de 10 registros vía REST.

---

**Desarrollado por Jesús Sergio Quiroz Guzmán · 2026**
