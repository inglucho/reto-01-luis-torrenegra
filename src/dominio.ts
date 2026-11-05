import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OpcionesBitacora } from "./core/bitacora";
import { registrar } from "./core/herramientas";
import * as proveedor from "./tools/proveedor";

/**
 * Único punto donde se conecta el dominio del reto: cada export de `src/tools/proveedor.ts`
 * se registra como `proveedor_<export>`. El prompt y el conocimiento son archivos.
 */
export const herramientas = registrar("proveedor", proveedor);

/** El núcleo registra todas las llamadas en out/log.jsonl (CA4); las herramientas, además, el log por caso (RN5). */
export const opcionesBitacora: OpcionesBitacora = {};

/** Cómo se presenta el agente en el chat: título, descripción y sugerencias para empezar. */
export const presentacion = {
  reto: "Reto 01",
  titulo: "Registro como Proveedor",
  descripcion:
    "Llena el formulario de registro como proveedor que pide cada cliente (Excel, PDF o portal web) con los datos del repositorio de Periferia y arma el paquete de soportes para la firma del representante legal. Nunca envía nada sin tu confirmación.",
  sugerencias: [
    { titulo: "Formulario en Excel", texto: 'Procesa el caso "co-industrias-delta" y dime si el paquete está listo para firma.' },
    {
      titulo: "Formulario en PDF",
      texto:
        'Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.',
    },
    { titulo: "Soporte vencido", texto: 'Arma el paquete del caso "hn-agroexport-sula" y explícame qué lo bloquea.' },
    { titulo: "Portal web", texto: 'Prepara el registro de "pa-logistica-istmo", que se hace en un portal web.' },
  ],
};


/**
 * System prompt = comportamiento (`agent/prompt.md`) + conocimiento del proceso
 * (`src/knowledge/*.md`). Se mantienen en archivos separados, como pide el PRD.
 */
export async function cargarSistema(directorio: string): Promise<string> {
  const prompt = await Bun.file(join(directorio, "agent", "prompt.md")).text();
  const carpeta = join(directorio, "src", "knowledge");
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".md")).sort();
  const conocimiento = await Promise.all(archivos.map((f) => Bun.file(join(carpeta, f)).text()));
  return [prompt.trim(), "# Conocimiento del proceso", ...conocimiento.map((c) => c.trim())].join("\n\n");
}
