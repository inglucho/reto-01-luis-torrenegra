# Reto 01 — Agente conversacional "Registro como Proveedor"

Agente que, a partir de la solicitud de un cliente, identifica los campos pedidos, los llena desde el repositorio maestro de Periferia, genera el formulario en el formato del cliente (Excel, PDF o valores para portal web) y arma el paquete de soportes para la firma del representante legal. Nunca firma ni envía: prepara y deja la decisión final a una persona.

- **Link de prueba:** _pendiente de despliegue_
- **Planteamiento de la solución y diseño de portales web:** [`SOLUCION.md`](SOLUCION.md)
- **PRD del reto:** [`docs/PRD.md`](docs/PRD.md)

La interfaz se explica sola: la pantalla inicial muestra cómo funciona, ejemplos con lo que se puede esperar y los datos de prueba disponibles, y el botón **Guía de uso** abre un manual con las confirmaciones, la lectura de la pantalla, los resultados y los límites. El contenido de la guía está en `src/presentacion.ts`.

## Puesta en marcha (un comando)

```bash
bun install
cp .env.example .env     # pega tu clave gratuita de https://aistudio.google.com/apikey en LLM_API_KEY
bun run dev              # front + backend en http://localhost:3000
```

Con Docker: `docker build -t reto-01 . && docker run -p 3000:3000 --env-file .env reto-01`.

## Verificación sin modelo de lenguaje

```bash
bun install && bun run demo.ts
```

Ejecuta los 4 casos llamando directamente a las herramientas, sin ninguna clave, y muestra el envío simulado (sin confirmar se bloquea; con confirmación se escribe). Usa la fecha de referencia **2026-09-03**, la de los PRD. Compara cada caso con el resultado esperado y sale con código 1 si algo no coincide. Los Excel y PDF generados son idénticos byte a byte entre ejecuciones.

| Caso | Formato | Campos | Soportes | Firma |
|---|---|---|---|---|
| co-industrias-delta | Excel | 17 llenos | 4/4 presentes | ✅ Listo |
| ec-corp-andina | PDF | 13 llenos · RUC por confirmar · 1 faltante | Falta certificado de cumplimiento tributario | ⛔ No listo |
| hn-agroexport-sula | Excel | 9 llenos · RTN por confirmar · 1 faltante | Parafiscales vencidos (31/08) | ⛔ No listo |
| pa-logistica-istmo | Portal (no soportado → valores para copiar) | 8 llenos · RUC por confirmar | 2/2 presentes | ✅ Listo |

Otros comandos: `bun test` (sin clave), `bun run typecheck`, `bun run modulo` (regenera `modulo/`).

## Variables de entorno

| Variable | Uso | Por defecto |
|---|---|---|
| `LLM_PROVIDER` | Proveedor de lenguaje: `gemini` o `anthropic` | `gemini` |
| `LLM_MODEL` | Modelo; vacío = el del proveedor | `gemini-3.5-flash` (respaldo automático a `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`) |
| `LLM_API_KEY` | Clave del proveedor. Solo en el entorno del backend: nunca en el repo, el front, los logs ni la API | — |
| `FECHA_REFERENCIA` | Fecha contra la que se revisa la vigencia de los soportes. `2026-09-03` reproduce el escenario de la prueba (la demo y el link la usan) | hoy |
| `LLM_TIMEOUT_MS` | Tiempo máximo de espera al proveedor | `120000` |
| `MAX_ITERACIONES` | Rondas herramienta → modelo por turno | `25` |
| `MAX_TOKENS_SESION` | Tope de tokens por conversación | `500000` |
| `MAX_TOKENS_DIA` | Tope diario de tokens para todo el servidor (el link es público) | `3000000` |
| `MAX_MENSAJES_POR_IP` / `VENTANA_MINUTOS` | Mensajes permitidos por IP en cada ventana | `30` cada `10` minutos |
| `PORT` | Puerto HTTP | `3000` |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → stream SSE de eventos: `texto`, `llamada`, `resultado`, `error`, `fin_turno` (`necesitaConfirmacion`, uso de tokens) |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `DELETE` | `/api/sessions/:id` | Descarta la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }`, sin exponer claves |
| `GET` | `/api/herramientas` | Herramientas registradas |
| `GET` | `/api/info` | Título, descripción y sugerencias que muestra el chat |

La referencia de la sección 6.4 del PRD (`{ reply, toolCalls[], needsConfirmation }`) se entrega como stream: el texto llega en eventos `texto`, cada llamada en `llamada` y `resultado`, y `fin_turno` trae `necesitaConfirmacion`. `POST /api/chat` responde 429 si una IP supera su límite de mensajes.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `proveedor_listar_casos` | Casos disponibles |
| `proveedor_leer_solicitud` | País, cliente, formato, campos pedidos (con hoja y celda si es Excel), soportes exigidos y etiquetas ambiguas |
| `proveedor_mapear_campos` | Cada campo como lleno (con la ruta en el maestro), faltante o por confirmar |
| `proveedor_generar_formulario` | `out/<caso>/formulario.xlsx` (P0), `formulario.pdf` (P1) o `valores-portal.md` (P2, formato no soportado) |
| `proveedor_armar_paquete` | `out/<caso>/paquete/` con formulario, soportes, `checklist.md` y `borrador-correo.md`; indica `listo_para_firma` |
| `proveedor_simular_envio` | Escribe `out/<caso>/ENVIO-SIMULADO.md`, solo con `confirmado: true` tras la confirmación del usuario |

Cada ejecución deja `{ ts, herramienta, ok, resumen }` en `out/<caso>/log.jsonl` (RN5), y cada llamada del chat queda en `out/log.jsonl` (CA4).

## Estructura

```
agent/prompt.md                     comportamiento (system prompt)
src/knowledge/registro-proveedor.md conocimiento del proceso (estados de campo, RN1–RN4, formatos)
src/tools/proveedor.ts              herramientas: { description, args (zod), execute } → proveedor_<export>
src/proveedor/                      lógica: fuentes, mapeo, formulario (xlsx/pdf/portal), paquete, log
src/core/                           ciclo del agente, confirmación, sesiones, bitácora (genérico)
src/llm/                            adaptador LLM neutral + Gemini y Anthropic
src/server.ts                       API HTTP + SSE
web/                                chat (HTML + TypeScript, sin framework)
modulo/                             bonus: agente empaquetado (generado de las mismas fuentes)
fixtures/reto-01/                   datos entregados (solo lectura)
out/                                generado en ejecución
```
