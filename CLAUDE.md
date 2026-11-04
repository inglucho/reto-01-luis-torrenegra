# Reto 01 — Registro como Proveedor (prueba técnica Periferia)

Agente conversacional en TypeScript + Bun. El PRD está en `docs/PRD.md`; su sección 6 fija la arquitectura (nombres de archivo, contrato de herramientas, API) y la 7 las reglas RN1–RN5. El PRD manda sobre cualquier suposición.

## Comandos

- `bun run dev`: servidor en http://localhost:3000 (el chat requiere `LLM_API_KEY` en `.env`)
- `bun run demo.ts`: los 4 casos sin modelo, con fecha de referencia 2026-09-03 y verificación del resultado esperado
- `bun test` · `bun run typecheck` · `bun run modulo` (regenera `modulo/`)

Antes de cada commit: `bun run typecheck && bun test && bun run demo.ts`.

## Dónde va cada cosa

- Comportamiento → `agent/prompt.md`. Conocimiento → `src/knowledge/registro-proveedor.md`. Ejecución → `src/tools/proveedor.ts`.
- Mapeo de campos y RN1 → `src/proveedor/mapeo.ts`. Formatos → `formulario.ts`. Soportes, checklist y borrador (RN2, RN3) → `paquete.ts`.
- Tras editar el prompt o el conocimiento, ejecutar `bun run modulo`; un test falla si `modulo/` queda desactualizado.
- `fixtures/` es de solo lectura; todo lo generado va a `out/<caso>/`.

## Convenciones

- Herramientas: `{ description, args, execute(args, ctx) }`, devuelven string JSON, **nunca lanzan** y escriben su línea en `out/<caso>/log.jsonl` (RN5).
- Un campo sin fuente en el maestro es **faltante**; nunca se completa con un valor plausible.
- Datos bancarios solo si la plantilla los pide; nunca en el borrador de correo (RN2).
- Ninguna acción externa (envío) sin `confirmado: true`; el backend solo lo acepta para la acción que pidió la confirmación (RN4).
- Generación determinista: fechas fijas en los metadatos de Excel y PDF.
- Código y mensajes en español, TypeScript sin `any`. Ninguna clave en el repo.
- Nunca hacer commit en `main`: ramas `feat/…`, `fix/…`, `docs/…` y pull request.
