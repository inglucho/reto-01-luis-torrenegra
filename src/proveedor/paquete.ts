import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { rutas } from "./fuentes";
import { NOMBRE_PAIS, type Mapeo, type Solicitud, type Soporte } from "./tipos";

export type EstadoSoporte = "presente" | "ausente" | "vencido";

export interface ItemChecklist {
  tipo: string;
  estado: EstadoSoporte;
  archivo: string | null;
  vigencia_hasta: string | null;
  nota?: string;
}

/** RN3: estado de cada soporte exigido. Vencido = `vigencia_hasta` anterior a la fecha de referencia. */
export function revisarSoportes(exigidos: string[], indice: Soporte[], fecha: string, pais: Solicitud["pais"]): ItemChecklist[] {
  return exigidos.map((tipo) => {
    const soporte = indice.find((s) => s.tipo === tipo);
    if (!soporte) return { tipo, estado: "ausente", archivo: null, vigencia_hasta: null, nota: "No existe en el repositorio de soportes." };
    const vencido = soporte.vigencia_hasta !== null && soporte.vigencia_hasta < fecha;
    const extranjero = soporte.pais_emisor !== pais ? `Emitido en ${NOMBRE_PAIS[soporte.pais_emisor as Solicitud["pais"]] ?? soporte.pais_emisor}.` : undefined;
    return {
      tipo,
      estado: vencido ? "vencido" : "presente",
      archivo: soporte.archivo,
      vigencia_hasta: soporte.vigencia_hasta,
      nota: [vencido ? `Venció el ${soporte.vigencia_hasta}: hay que solicitar uno nuevo.` : undefined, extranjero].filter(Boolean).join(" ") || undefined,
    };
  });
}

/** RN3: un soporte vencido o ausente bloquea la firma; un campo faltante no. */
export const listoParaFirma = (checklist: ItemChecklist[]) => checklist.every((i) => i.estado === "presente");

interface EntradaPaquete {
  solicitud: Solicitud;
  mapeo: Mapeo;
  checklist: ItemChecklist[];
  /** `null` si la plantilla del cliente es ilegible: el paquete se arma igual con los soportes. */
  formulario: { ruta: string; formato: Solicitud["formato"] } | null;
  fecha: string;
  /** Razón social del proveedor, leída del maestro. */
  razonSocial: string;
  errorPlantilla?: string;
}

/** Estado con que se armó el paquete; el envío simulado lo usa para no recalcular con otra fecha. */
export interface EstadoPaquete {
  fecha_referencia: string;
  listo_para_firma: boolean;
  pendientes: string[];
}

export async function leerEstadoPaquete(dir: string, caso: string): Promise<EstadoPaquete | null> {
  const archivo = Bun.file(join(rutas(dir, caso).paquete, "estado.json"));
  return (await archivo.exists()) ? ((await archivo.json()) as EstadoPaquete) : null;
}

/** HU-4: arma `out/<caso>/paquete/` con formulario, soportes, checklist y borrador de correo. */
export async function armarPaquete(dir: string, e: EntradaPaquete): Promise<{ ruta: string; listo_para_firma: boolean; archivos: string[] }> {
  const r = rutas(dir, e.solicitud.id);
  await rm(r.paquete, { recursive: true, force: true });
  await mkdir(join(r.paquete, "soportes"), { recursive: true });

  const archivos: string[] = [];
  if (e.formulario) {
    archivos.push(basename(e.formulario.ruta));
    await copyFile(join(dir, e.formulario.ruta), join(r.paquete, basename(e.formulario.ruta)));
  }
  // Los vencidos también se copian, para que la analista los vea; el checklist los marca.
  for (const item of e.checklist) {
    if (!item.archivo) continue;
    await copyFile(join(r.soportes, item.archivo), join(r.paquete, "soportes", item.archivo));
    archivos.push(`soportes/${item.archivo}`);
  }
  // Sin formulario (plantilla ilegible) no hay nada que firmar.
  const listo = listoParaFirma(e.checklist) && e.formulario !== null;
  const estado: EstadoPaquete = {
    fecha_referencia: e.fecha,
    listo_para_firma: listo,
    pendientes: [
      ...e.checklist.filter((i) => i.estado !== "presente").map((i) => `${i.tipo} (${i.estado})`),
      ...(e.formulario ? [] : ["formulario (plantilla ilegible)"]),
    ],
  };
  await Bun.write(join(r.paquete, "estado.json"), `${JSON.stringify(estado, null, 2)}\n`);
  await Bun.write(join(r.paquete, "checklist.md"), checklistMd(e, listo));
  await Bun.write(join(r.paquete, "borrador-correo.md"), borradorCorreo(e));
  return { ruta: join("out", e.solicitud.id, "paquete"), listo_para_firma: listo, archivos: [...archivos, "checklist.md", "borrador-correo.md"] };
}

const ICONO: Record<EstadoSoporte, string> = { presente: "✅ presente", ausente: "❌ ausente", vencido: "⛔ vencido" };

function checklistMd(e: EntradaPaquete, listo: boolean): string {
  const { solicitud: s, mapeo: m } = e;
  return [
    `# Checklist — registro como proveedor de ${s.cliente}`,
    "",
    `- **Caso:** ${s.id} · **País:** ${NOMBRE_PAIS[s.pais]} · **Formato:** ${s.formato} · **Fecha de referencia:** ${e.fecha}`,
    `- **Estado:** ${listo ? "✅ LISTO PARA FIRMA" : `⛔ NO LISTO PARA FIRMA (${e.formulario ? "soportes vencidos o ausentes" : "no se pudo generar el formulario"})`}`,
    ...(e.errorPlantilla ? [`- **Plantilla del cliente:** ${e.errorPlantilla} Hay que pedir al cliente que la reenvíe.`] : []),
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Vigencia | Nota |",
    "|---|---|---|---|",
    ...e.checklist.map((i) => `| ${i.tipo} | ${ICONO[i.estado]} | ${i.vigencia_hasta ?? "no aplica"} | ${i.nota ?? ""} |`),
    "",
    "## Campos del formulario",
    "",
    `- Llenos desde el maestro: **${m.llenos.length}**`,
    `- Por confirmar: **${m.requiere_confirmacion.length}**${m.requiere_confirmacion.map((c) => `\n  - ${c.etiqueta}: \`${c.valor ?? ""}\` — ${c.motivo}`).join("")}`,
    `- Faltantes (no existen en el maestro; no bloquean la firma): **${m.faltantes.length}**${m.faltantes.map((f) => `\n  - ${f.etiqueta}${f.obligatorio ? " (obligatorio)" : ""}`).join("")}`,
    "",
    "## Antes de enviar",
    "",
    "- [ ] El representante legal firma el formulario.",
    "- [ ] Se confirman los campos marcados.",
    ...e.checklist.filter((i) => i.estado !== "presente").map((i) => `- [ ] Conseguir ${i.tipo} (${i.estado}).`),
    "",
  ].join("\n");
}

/** RN2: el borrador nunca incluye datos bancarios. Solo adjunta soportes vigentes. */
function borradorCorreo(e: EntradaPaquete): string {
  const s = e.solicitud;
  const adjuntos = [
    ...(e.formulario ? [basename(e.formulario.ruta)] : []),
    ...e.checklist.filter((i) => i.estado === "presente" && i.archivo).map((i) => i.archivo as string),
  ];
  return [
    `**Para:** ${s.de}`,
    `**Asunto:** RE: ${s.asunto}`,
    "",
    "Buen día,",
    "",
    `En respuesta a su solicitud, adjuntamos la documentación de ${e.razonSocial} para el registro como proveedor de ${s.cliente}:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier información adicional que requieran.",
    "",
    "Cordialmente,",
    "",
    "Área Administrativa",
    e.razonSocial,
    "",
  ].join("\n");
}
