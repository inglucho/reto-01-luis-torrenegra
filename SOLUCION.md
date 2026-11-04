# SOLUCION — Reto 01: Registro como Proveedor

## 1. Problema en una frase

Entre 8 y 12 veces al mes, el área administrativa transcribe a mano en el formato de cada cliente (Excel, PDF o portal) datos que ya existen en el repositorio interno, y busca los soportes uno por uno. Eso consume días, arriesga errores en datos sensibles (NIT, cuenta bancaria) y depende de una persona que se va. Le duele a la analista administrativa, que hace el trabajo, y a Periferia, que no puede facturar hasta quedar registrada.

## 2. Arquitectura

```
┌──────────── web/ (chat) ─────────────┐   POST /api/chat    ┌──────────── src/server.ts ────────────┐
│ historial · tarjetas de herramientas │ ──────────────────▶ │ sesiones en memoria · SSE             │
│ turno resaltado si pide confirmación │ ◀── SSE: texto,     │  src/core/agente.ts (ciclo del agente)│
│ botones Confirmo / No, cancela       │   llamada, resultado│   topes · guardia de confirmación     │
└──────────────────────────────────────┘   fin_turno         │   bitácora → out/log.jsonl (CA4)      │
                                                             └───┬───────────────┬───────────────────┘
                                          src/llm/adapter.ts ◀───┘               ▼
                                          gemini.ts · anthropic.ts   src/tools/proveedor.ts (proveedor_*)
                                                                                 │  log por caso → out/<caso>/log.jsonl (RN5)
                     src/proveedor/  fuentes · mapeo (glosario, RN1) · formulario (xlsx/pdf/portal) · paquete (RN2, RN3)
                                                                                 │
              fixtures/reto-01 (lectura): casos/<caso>/, repositorio/{maestro.json, soportes/}, glosario-campos.json
              out/<caso>/ (escritura): formulario.xlsx|pdf · valores-portal.md · paquete/ · ENVIO-SIMULADO.md · log.jsonl
```

| Capa | Dónde | Qué contiene |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Cómo procesa un caso, qué resume, cuándo pregunta y qué nunca hace (firmar, enviar) |
| Conocimiento | `src/knowledge/registro-proveedor.md` | Los estados de campo, el identificador por país, los datos bancarios, la vigencia de soportes y los formatos. Se anexa al prompt |
| Ejecución | `src/tools/proveedor.ts` → `src/proveedor/` | Herramientas tipadas con zod y, debajo, el mapeo y la generación como funciones deterministas |

## 3. Ciclo del agente

El ciclo es propio (`src/core/agente.ts`, menos de 220 líneas) y no depende del proveedor. Se agrega el mensaje a la sesión, se llama al modelo vía `AdaptadorLLM.enviar(mensajes, herramientas)`, se validan con zod los argumentos de cada herramienta, se ejecuta y se devuelve el resultado al modelo. Esto se repite hasta que el modelo responde sin herramientas. Cada llamada se ve en el chat por SSE y queda en `out/log.jsonl`.

**Topes.** Hay un máximo de 25 rondas por turno; en la última se le pide al modelo cerrar con lo que tiene y lo que falta. También hay un tope de tokens por sesión y un timeout al proveedor; los tres son configurables.

**Confirmación humana (CA3 y RN4).** Ninguna acción externa ocurre sin una confirmación explícita en el mensaje inmediatamente anterior:
1. **La herramienta decide.** `proveedor_simular_envio` sin `confirmado` responde `{ ok: false, error: "requiere confirmación explícita" }` y explica qué se va a enviar. Si el paquete no está listo para firma, lo advierte en la pregunta.
2. **El backend garantiza, por acción.** Cada confirmación queda ligada a la acción que la pidió. `confirmado: true` solo se acepta para esa acción y solo si el siguiente mensaje del usuario la confirma sin negación. Un "sí" a otra pregunta (por ejemplo, sobre el RUC) **no** autoriza un envío.

   Esto lo encontró la prueba real: tras "envía", el modelo intentó enviar directamente con `confirmado: true` aprovechando una confirmación pendiente sobre el RUC. Ahora el backend lo bloquea y el agente pregunta.
3. **El chat lo hace visible.** El turno se resalta con botones de respuesta rápida.

**Errores (CA5 y HU-5).** Una plantilla corrupta, un caso inexistente o un nombre de caso inseguro devuelven un mensaje claro, sin traza cruda, y el resto del trabajo sigue.

## 4. Elección del modelo

**Proveedor y modelo:** Google Gemini, `gemini-3.5-flash`, con respaldo automático a `gemini-3.5-flash-lite` y luego a `gemini-3.1-flash-lite`.

**Por qué:**
- **Costo cero para la demo.** La capa gratuita de Google AI Studio no exige tarjeta.
- **El trabajo pesado no lo hace el modelo.** El mapeo, el Excel, el PDF y la revisión de soportes son deterministas. El modelo orquesta las herramientas y redacta el resumen, y un modelo rápido basta.
- **Disponibilidad.** Cada modelo tiene su propia cuota gratuita; ante un 503 o un 429 el adaptador pasa al siguiente en la misma petición.
- **Independencia del proveedor.** Hay una implementación de Anthropic y se cambia con `LLM_PROVIDER`.

**Costo estimado por caso.** Medí el flujo completo de la sección 11 del PRD (procesar ec-corp-andina, "envía" y la confirmación): 6 llamadas al modelo, unos **17.000 tokens de entrada** (de ellos 6.000 desde caché) y **700 de salida**. En la capa gratuita, el costo es **$0**. Con tarifas de pago de Anthropic (USD por millón, entrada / salida):

| Modelo | Tarifa | Por caso | 12 solicitudes al mes |
|---|---|---|---|
| Claude Haiku 5.5 | 0,10 / 0,50 | ≈ USD 0,002 | ≈ USD 0,03 |
| Claude Sonnet 5.5 | 2 / 10 | ≈ USD 0,04 | ≈ USD 0,5 |
| Claude Opus 5.5 | 4 / 20 | ≈ USD 0,08 | ≈ USD 1 |

Con este volumen, el costo del modelo es irrelevante frente a las horas de transcripción que ahorra. Para Gemini en capa de pago se aplica la misma fórmula con su tarifa vigente.

## 5. Diseño del portal web (formato P2)

El caso pa-logistica-istmo pide registrarse en un portal (VendorHub) con usuario y contraseña enviados al representante legal. Hoy el agente responde "formato no soportado" y genera `out/<caso>/valores-portal.md`: una tabla campo → valor lista para copiar, con los campos por confirmar marcados. Así abordaría la automatización:

**Estrategia: asistente en el navegador del usuario, no un robot autónomo.**

| Opción | Ventaja | Límite | Decisión |
|---|---|---|---|
| **Extensión de navegador que rellena el formulario abierto** | La persona ya inició sesión: el agente nunca ve las credenciales, y CAPTCHA y MFA los resuelve un humano | Hay que mapear campos de un DOM que cambia | **Elegida**, como evolución de `valores-portal.md` |
| Navegador controlado por el agente (Playwright, uso de computador) | Automatiza de punta a punta | Necesita las credenciales, choca con CAPTCHA y MFA, se rompe con cada cambio de layout y puede violar los términos del portal | Solo para portales sin MFA, con autorización del cliente |
| RPA tradicional (UiPath, Power Automate) | Herramienta conocida en áreas administrativas | Un flujo frágil por portal y con costo de licencia; con 8 a 12 solicitudes al mes no compensa | Descartada |

**Cómo funcionaría la extensión:**
1. La analista abre el portal e inicia sesión con las credenciales del representante legal, que gestiona ella o él.
2. La extensión lee las etiquetas visibles del formulario (`<label>`, `aria-label`, `placeholder`) y las manda al mismo mapeo que usan el Excel y el PDF (`proveedor_mapear_campos`), con el mismo glosario y las mismas reglas: RN1, RN2 y faltantes sin inventar.
3. Rellena los campos llenos y resalta en ámbar los que están por confirmar y en rojo los faltantes, igual que el Excel.
4. Los soportes se adjuntan con el selector de archivos del navegador, porque la persona elige el archivo.
5. **La persona revisa y hace clic en "Enviar".** La extensión nunca envía.

**Credenciales.** Nunca se guardan en el repositorio, en el prompt, en la bitácora ni en el agente. Si en el futuro se automatiza un portal sin MFA, las credenciales irían en un gestor de secretos de la empresa (Bitwarden o 1Password empresarial, Azure Key Vault). El robot las pediría en el momento de usarlas, con acceso auditado y una cuenta por portal, rotadas tras cada uso si el portal lo permite.

**Qué hace cada uno:**

| El agente | La persona |
|---|---|
| Mapea los campos y rellena los valores | Ingresa usuario y contraseña, y resuelve CAPTCHA y MFA |
| Marca los faltantes y los campos por confirmar | Confirma los campos marcados y completa los faltantes |
| Prepara los soportes vigentes y avisa de los vencidos | Adjunta los archivos |
| Registra lo que se diligenció (log por caso) | **Hace clic en "Enviar"** |

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Mapeo determinista** (glosario exacto, luego normalizado, luego por parecido de palabras) con confianza explícita | Pedirle al modelo que relacione etiquetas y valores | Es el riesgo principal del PRD: que el modelo "complete" un campo con un valor plausible. Con reglas, todo valor tiene la ruta del dato en el maestro, y lo que no tiene fuente es faltante |
| 2 | **Fecha de referencia configurable** (`FECHA_REFERENCIA`; la demo usa 2026-09-03) | Comparar siempre contra la fecha real | Con la fecha real (noviembre de 2026) la Cámara de Comercio también vence y ningún caso quedaría listo. Fijarla reproduce el escenario de la prueba y hace la demo determinista |
| 3 | **Enviar un paquete incompleto se permite, pero con una advertencia explícita** | Bloquear el envío si no está listo para firma | El PRD distingue "listo para firma" de "enviar", y su ejemplo (ec-corp-andina) espera el envío tras confirmación. Quien decide es la persona, con la advertencia por delante, y el envío deja constancia |
| 4 | **Confirmación ligada a la acción** en el núcleo | Una confirmación genérica por turno | La prueba real mostró que un "sí" sobre el RUC podía autorizar un envío. Ligarla a la acción hace cumplir RN4 aunque el modelo se equivoque |
| 5 | **exceljs 4.4.0** para el Excel y **pdf-lib** para el PDF | SheetJS (`xlsx`) desde npm | La versión de npm de SheetJS (0.18.5) tiene vulnerabilidades conocidas. exceljs es estable y permite escribir celdas exactas y estilos |
| 6 | **Excel y PDF con fechas fijas en los metadatos** | Metadatos con la fecha actual | Los archivos salen idénticos byte a byte entre ejecuciones: la demo es determinista incluso en binarios |

## 7. Supuestos

1. El Excel se genera desde cero con las hojas y celdas de `plantilla-celdas.json`, porque los fixtures no traen el `.xlsx` original del cliente. Con el original, se abriría y se escribiría sobre él.
2. Los campos por confirmar **se escriben** en el formulario con la marca "[por confirmar]" y celda ámbar; los faltantes quedan vacíos con celda roja.
3. El NIT va sin dígito de verificación si la plantilla lo pide aparte; si no, va como `900123456-7`.
4. "País" se escribe con el nombre ("Colombia"), no con el código ("CO"); los ingresos, con moneda y año. Es una presentación del mismo dato del maestro.
5. En los formularios Excel todos los campos se tratan como obligatorios, porque la plantilla de celdas no lo indica.
6. Los soportes vencidos se copian igual al paquete, para que la analista los vea, y se marcan como vencidos en el checklist.
7. Un soporte emitido en un país distinto al del cliente se anota en el checklist ("Emitido en Colombia"), pero no bloquea, porque Periferia es colombiana.
8. Un portal se considera "listo" si sus soportes lo están: no hay firma de formulario, pero sí paquete de soportes.
9. "Enviar" solo escribe `ENVIO-SIMULADO.md`. El borrador de correo nunca incluye datos bancarios (RN2).

## 8. Cobertura

| Historia | Estado | Notas | Falta para producción |
|---|---|---|---|
| HU-1 Leer la solicitud | ✅ Hecho | País, cliente, formato, campos con ubicación, soportes y etiquetas ambiguas con el equivalente del país | Leer el correo y los adjuntos reales |
| HU-2 Mapear campos | ✅ Hecho | Lleno con ruta, faltante o por confirmar; glosario y RN1 | Aprender sinónimos nuevos confirmados por la analista |
| HU-3 Formulario | ✅ P0 Excel · ✅ P1 PDF · ✅ P2 portal (valores para copiar) | Celdas exactas; PDF con todos los campos en orden | Escribir sobre el `.xlsx` original y rellenar AcroForms |
| HU-4 Paquete para firma | ✅ Hecho | Soportes, checklist (presentes, ausentes, vencidos), borrador sin datos bancarios y estado de firma | Firma electrónica (fuera de alcance) |
| HU-5 Errores | ✅ Hecho | Plantilla corrupta, caso inexistente, nombre inseguro | Alertas operativas |
| `proveedor_simular_envio` (P1) | ✅ Hecho | Confirmación ligada a la acción | Envío real por correo con aprobación |
| Bonus `modulo/` | ✅ Hecho | Generado de las mismas fuentes y verificado por test | — |

## 9. Uso de IA

Usé **Claude Code** (modelo Claude Opus 5.5) como asistente de desarrollo:

| Tarea | Qué hizo la IA | Qué decidí o revisé yo |
|---|---|---|
| Análisis | Leyó el PRD y los fixtures y detectó la trampa de la fecha (parafiscales vencidos al 3 de septiembre; con la fecha real, también la Cámara de Comercio) | La fecha de referencia configurable |
| Reutilización | Partió del núcleo común de los retos 02 y 03 | La estrategia de un núcleo para los tres retos |
| Código | Escribió el mapeo, el Excel, el PDF, el paquete y 36 tests; verificó el Excel leyéndolo de vuelta celda por celda | Las reglas de presentación (NIT con o sin dígito, país por nombre) |
| Pruebas reales | Ejecutó el flujo de la sección 11 contra Gemini | — |
| Documentación | Redactó README, CLAUDE.md y este documento, incluido el diseño de portales | Validar supuestos y redacción |

**Lo que descarté de lo propuesto o lo que corregí:**
- **Bloquear el envío de paquetes incompletos:** era la primera versión. La cambié al releer el PRD, cuyo ejemplo espera el envío de un caso no listo tras la confirmación.
- **Confirmación genérica por turno:** la prueba real mostró que un "sí" sobre el RUC habilitaba el envío. Ahora la confirmación se liga a la acción, y el arreglo se llevó al núcleo de los tres retos.
- **SheetJS desde npm:** lo descarté por las vulnerabilidades conocidas de esa versión.
- **El modelo atribuía el bloqueo de la firma a los campos por confirmar:** lo corregí en el prompt, porque solo los soportes bloquean (RN3).

## 10. Riesgos de llevar esto a producción

| Riesgo | Mitigación |
|---|---|
| Plantillas reales más desordenadas (celdas combinadas, etiquetas inesperadas) | Lo que no se reconoce queda por confirmar o faltante, nunca se inventa. Medir el % de campos por confirmar y ampliar el glosario con lo que confirme la analista |
| Datos sensibles (cuenta bancaria, cédula) en archivos y logs | Solo se llenan si la plantilla los pide, nunca van en el borrador y los logs guardan resúmenes. En producción: cifrado en reposo y retención limitada |
| Soportes vencidos que pasan desapercibidos | La revisión de vigencia es determinista y bloquea "listo para firma". Agregar una alerta proactiva antes del vencimiento, como la Cámara de Comercio de 30 días |
| Envío por error | Confirmación ligada a la acción, más la advertencia si el paquete no está listo. En producción, el envío real también requeriría la firma registrada |
| Credenciales de portales | Nunca pasan por el agente (sección 5) |
| Maestro desactualizado | Un dueño del dato. El checklist muestra de dónde salió cada valor, para detectarlo |
| Cuota gratuita del proveedor de IA | Modelos de respaldo y mensajes claros. En producción, capa de pago con límite de gasto |
