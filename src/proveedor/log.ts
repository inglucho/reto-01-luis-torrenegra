import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rutas } from "./fuentes";

/**
 * RN5: toda ejecución deja una línea en `out/<caso>/log.jsonl` con `{ ts, herramienta, ok, resumen }`.
 * La escriben las propias herramientas, así también queda registro desde demo.ts.
 */
export async function registrarLog(dir: string, caso: string, entrada: { herramienta: string; ok: boolean; resumen: string }) {
  try {
    const carpeta = rutas(dir, caso).salida;
    await mkdir(carpeta, { recursive: true });
    await appendFile(join(carpeta, "log.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`);
  } catch (err) {
    console.error("No se pudo escribir el log del caso:", err);
  }
}
