/**
 * Genera `modulo/` (bonus 9.4 del PRD) desde las mismas fuentes que usa la aplicación:
 * el prompt (`agent/prompt.md`) y el conocimiento (`src/knowledge/registro-proveedor.md`).
 * Las herramientas no se copian: `modulo/tools/proveedor.ts` reexporta `src/tools/proveedor.ts`.
 *
 *   bun run modulo            # regenera los archivos
 *   bun run modulo --check    # falla si están desactualizados (lo usa el test)
 */
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");

export async function contenidoModulo(): Promise<Record<string, string>> {
  const prompt = (await Bun.file(join(raiz, "agent", "prompt.md")).text()).trim();
  const conocimiento = (await Bun.file(join(raiz, "src", "knowledge", "registro-proveedor.md")).text()).trim();
  return {
    "modulo/agent.md": `---
description: Llena formularios de registro como proveedor (Excel, PDF o valores para portal) desde el repositorio maestro y arma el paquete de soportes para la firma del representante legal, sin enviar nada sin confirmación humana.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`,
    "modulo/skill/registro-proveedor/SKILL.md": `---
name: registro-proveedor
description: Conocimiento del registro como proveedor de Periferia — estados de campo, identificador tributario por país (RN1), datos bancarios (RN2), vigencia de soportes (RN3) y formatos. Úsalo al llenar un formulario de proveedor.
---

${conocimiento}
`,
    "modulo/tools/proveedor.ts": `/**
 * Las mismas herramientas que usa la aplicación (no es una copia): cada export es
 * \`{ description, args, execute(args, ctx) }\` y se registra como \`proveedor_<export>\`.
 * Se importan sin el servidor; \`ctx.directory\` debe apuntar a la raíz con \`fixtures/\`.
 */
export * from "../../src/tools/proveedor";
`,
  };
}

if (import.meta.main) {
  const verificar = process.argv.includes("--check");
  const desactualizados: string[] = [];
  for (const [ruta, contenido] of Object.entries(await contenidoModulo())) {
    const archivo = Bun.file(join(raiz, ruta));
    const actual = (await archivo.exists()) ? await archivo.text() : null;
    if (actual === contenido) continue;
    if (verificar) desactualizados.push(ruta);
    else await Bun.write(join(raiz, ruta), contenido);
  }
  if (desactualizados.length > 0) {
    console.error(`modulo/ desactualizado: ${desactualizados.join(", ")}. Ejecuta \`bun run modulo\`.`);
    process.exit(1);
  }
  console.log(verificar ? "modulo/ sincronizado" : "modulo/ generado");
}
