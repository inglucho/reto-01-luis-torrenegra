/**
 * Verificación sin modelo de lenguaje (sección 6.6 del PRD): ejecuta todos los casos de
 * fixtures/reto-01/casos/ llamando directamente a las herramientas e imprime un resumen
 * por caso. Muestra además el envío simulado: bloqueado sin confirmación y hecho con ella.
 * Compara cada caso con el resultado esperado y sale con código 1 si algo no coincide.
 *
 *   bun install && bun run demo.ts
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./src/config";
import { leerResultado } from "./src/core/herramientas";
import type { ItemChecklist } from "./src/proveedor/paquete";
import type { Mapeo } from "./src/proveedor/tipos";
import { armar_paquete, listar_casos, mapear_campos, simular_envio } from "./src/tools/proveedor";

const ctx = { directory: config.directorio, sessionId: "demo" };
/** Fecha de los PRD: reproduce el escenario de la prueba (Cámara de Comercio vigente, parafiscales vencidos). */
const FECHA = "2026-09-03";

interface Esperado {
  formato: string;
  faltantes: string[];
  por_confirmar: string[];
  listo: boolean;
}

/** Resultados esperados según los objetivos O1–O3 y las reglas RN1–RN3 del PRD. */
const ESPERADO: Record<string, Esperado> = {
  "co-industrias-delta": { formato: "xlsx", faltantes: [], por_confirmar: [], listo: true },
  "ec-corp-andina": { formato: "pdf", faltantes: ["Número de contribuyente especial"], por_confirmar: ["RUC"], listo: false },
  "hn-agroexport-sula": { formato: "xlsx", faltantes: ["Referencias comerciales"], por_confirmar: ["RTN"], listo: false },
  "pa-logistica-istmo": { formato: "portal", faltantes: [], por_confirmar: ["RUC"], listo: true },
};

type Datos = Record<string, unknown>;
let fallos = 0;

function verificar(condicion: boolean, mensaje: string) {
  if (!condicion) {
    fallos++;
    console.log(`   ✘ ${mensaje}`);
  }
}

async function ejecutar(promesa: Promise<string>) {
  const r = leerResultado(await promesa);
  return { ...r, datos: (r.ok ? r.data : {}) as Datos };
}

const ICONO = { presente: "✅", ausente: "❌", vencido: "⛔" } as const;

async function procesar(caso: string) {
  const esperado = ESPERADO[caso];
  const m = await ejecutar(mapear_campos.execute({ caso }, ctx));
  const p = await ejecutar(armar_paquete.execute({ caso, fecha_referencia: FECHA }, ctx));
  if (!m.ok || !p.ok) {
    fallos++;
    return console.log(`\n■ ${caso}  ✘ ${!m.ok ? m.error : !p.ok ? p.error : ""}`);
  }
  const mapeo = m.datos as unknown as Mapeo;
  const checklist = p.datos.checklist as ItemChecklist[];
  const formato = String(p.datos.formulario).split(".").pop() === "md" ? "portal" : String(p.datos.formulario).split(".").pop();

  console.log(`\n■ ${caso} (${m.datos.pais}) → ${p.datos.formulario}`);
  if (p.datos.aviso_formato) console.log(`   ℹ️  ${p.datos.aviso_formato}`);
  console.log(`   Campos: ${mapeo.llenos.length} llenos · ${mapeo.requiere_confirmacion.length} por confirmar · ${mapeo.faltantes.length} faltantes`);
  for (const c of mapeo.requiere_confirmacion) console.log(`   ?  ${c.etiqueta} = ${c.valor} — ${c.motivo}`);
  for (const f of mapeo.faltantes) console.log(`   ✘  ${f.etiqueta} — ${f.motivo}`);
  console.log(`   Soportes: ${checklist.map((i) => `${ICONO[i.estado]} ${i.tipo}`).join(" · ")}`);
  console.log(`   ${p.datos.listo_para_firma ? "✅ LISTO PARA FIRMA" : "⛔ NO LISTO PARA FIRMA"} · paquete en ${p.datos.ruta}/`);

  if (!esperado) return verificar(false, `caso sin resultado esperado: ${caso}`);
  verificar(formato === esperado.formato, `formato: esperado ${esperado.formato}`);
  verificar(JSON.stringify(mapeo.faltantes.map((f) => f.etiqueta)) === JSON.stringify(esperado.faltantes), `faltantes: esperado ${esperado.faltantes.join(", ") || "ninguno"}`);
  verificar(JSON.stringify(mapeo.requiere_confirmacion.map((c) => c.etiqueta)) === JSON.stringify(esperado.por_confirmar), `por confirmar: esperado ${esperado.por_confirmar.join(", ") || "ninguno"}`);
  verificar(p.datos.listo_para_firma === esperado.listo, `listo para firma: esperado ${esperado.listo}`);
}

async function envioSimulado() {
  console.log("\n■ Envío simulado (RN4)");
  const sinConfirmar = await ejecutar(simular_envio.execute({ caso: "co-industrias-delta" }, ctx));
  console.log(`   co-industrias-delta sin confirmar → ${sinConfirmar.ok ? "✘ se envió" : sinConfirmar.error}`);
  verificar(!sinConfirmar.ok && sinConfirmar.error === "requiere confirmación explícita", "sin confirmación no debe enviarse");

  const confirmado = await ejecutar(simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx));
  console.log(`   co-industrias-delta con confirmado = true → ${confirmado.ok ? confirmado.datos.ruta : confirmado.error}`);
  verificar(confirmado.ok, "con confirmación debe escribir ENVIO-SIMULADO.md");

  const incompleto = await ejecutar(simular_envio.execute({ caso: "hn-agroexport-sula" }, ctx));
  console.log(`   hn-agroexport-sula sin confirmar → ${incompleto.confirmacion?.motivo ?? "✘ sin advertencia"}`);
  verificar(Boolean(incompleto.confirmacion?.motivo.includes("NO está listo")), "la confirmación debe advertir que el paquete no está listo");
}

// Determinismo: cada ejecución parte de `out/` vacío y de la misma fecha de referencia.
await rm(join(config.directorio, "out"), { recursive: true, force: true });
process.env.FECHA_REFERENCIA = FECHA;
config.fechaReferencia = FECHA;
console.log(`Demo reto 01 · Registro como proveedor (sin modelo de lenguaje) · fecha de referencia ${FECHA}`);

const listado = await ejecutar(listar_casos.execute({}, ctx));
const casos = (listado.datos.casos as string[] | undefined) ?? [];
for (const caso of casos) await procesar(caso);
await envioSimulado();

console.log("\nArchivos: out/<caso>/formulario.{xlsx,pdf} · valores-portal.md · paquete/{checklist.md, borrador-correo.md, soportes/} · log.jsonl");
console.log(fallos === 0 ? `\n✔ ${casos.length} casos con el resultado esperado` : `\n✘ ${fallos} verificaciones fallaron`);
process.exit(fallos === 0 ? 0 : 1);
