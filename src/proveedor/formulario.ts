import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts } from "pdf-lib";
import { rutas } from "./fuentes";
import type { CampoSolicitado, Mapeo, Solicitud } from "./tipos";

/** Fecha fija en los metadatos: el mismo caso produce el mismo archivo (determinismo). */
const FECHA_FIJA = new Date("2026-01-01T00:00:00Z");

const MARCA_CONFIRMAR = " [por confirmar]";
const MARCA_FALTANTE = "[FALTANTE: completar manualmente]";

interface Valor {
  texto: string;
  estado: "lleno" | "confirmar" | "faltante";
}

/** Valor que va en el formulario para cada etiqueta según el mapeo. */
export function valoresPorEtiqueta(mapeo: Mapeo): Map<string, Valor> {
  const valores = new Map<string, Valor>();
  for (const l of mapeo.llenos) valores.set(l.etiqueta, { texto: l.valor, estado: "lleno" });
  for (const c of mapeo.requiere_confirmacion) valores.set(c.etiqueta, { texto: c.valor ?? "", estado: "confirmar" });
  for (const f of mapeo.faltantes) valores.set(f.etiqueta, { texto: "", estado: "faltante" });
  return valores;
}

export interface Formulario {
  ruta: string;
  formato: Solicitud["formato"];
  soportado: boolean;
  aviso?: string;
}

/** HU-3: produce el formulario en el formato del cliente (P0 xlsx, P1 pdf, P2 portal → valores para copiar). */
export async function generarFormulario(dir: string, s: Solicitud, campos: CampoSolicitado[], mapeo: Mapeo): Promise<Formulario> {
  const carpeta = rutas(dir, s.id).salida;
  await mkdir(carpeta, { recursive: true });
  const valores = valoresPorEtiqueta(mapeo);
  if (s.formato === "xlsx") {
    await Bun.write(join(carpeta, "formulario.xlsx"), await excel(campos, valores));
    return { ruta: join("out", s.id, "formulario.xlsx"), formato: "xlsx", soportado: true };
  }
  if (s.formato === "pdf") {
    await Bun.write(join(carpeta, "formulario.pdf"), await pdf(s, campos, valores));
    return { ruta: join("out", s.id, "formulario.pdf"), formato: "pdf", soportado: true };
  }
  await Bun.write(join(carpeta, "valores-portal.md"), portal(s, campos, valores));
  return {
    ruta: join("out", s.id, "valores-portal.md"),
    formato: "portal",
    soportado: false,
    aviso: "Formato no soportado: el portal web lo diligencia una persona. Se generaron los valores listos para copiar.",
  };
}

/** P0: cada etiqueta y su valor exactamente en la hoja y celda que indica la plantilla. */
async function excel(campos: CampoSolicitado[], valores: Map<string, Valor>): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Agente de registro como proveedor — Periferia IT Group";
  libro.created = FECHA_FIJA;
  libro.modified = FECHA_FIJA;
  for (const campo of campos) {
    if (!campo.ubicacion) continue;
    const { hoja, celda_etiqueta, celda_valor } = campo.ubicacion;
    const hojaExcel = libro.getWorksheet(hoja) ?? libro.addWorksheet(hoja);
    const etiqueta = hojaExcel.getCell(celda_etiqueta);
    etiqueta.value = campo.etiqueta;
    etiqueta.font = { bold: true };
    const v = valores.get(campo.etiqueta);
    const celda = hojaExcel.getCell(celda_valor);
    celda.value = v?.estado === "faltante" ? null : `${v?.texto ?? ""}${v?.estado === "confirmar" ? MARCA_CONFIRMAR : ""}`;
    if (v?.estado !== "lleno") celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: v?.estado === "faltante" ? "FFF8D7DA" : "FFFFF3CD" } };
    hojaExcel.getColumn(etiqueta.col).width = 34;
    hojaExcel.getColumn(celda.col).width = 48;
  }
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

/** P1: PDF generado (no un AcroForm) con todos los campos, con etiqueta y valor, en el orden dado. */
async function pdf(s: Solicitud, campos: CampoSolicitado[], valores: Map<string, Valor>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FECHA_FIJA);
  doc.setModificationDate(FECHA_FIJA);
  doc.setTitle(`Formulario de proveedor — ${s.cliente}`);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  let pagina = doc.addPage([595, 842]);
  let y = 790;
  const escribir = (texto: string, fuente: PDFFont, tam = 10) => {
    if (y < 80) {
      pagina = doc.addPage([595, 842]);
      y = 790;
    }
    pagina.drawText(winAnsi(texto), { x: 50, y, size: tam, font: fuente });
    y -= tam + 6;
  };

  escribir(`Formulario de calificación de proveedores — ${s.cliente}`, negrita, 13);
  escribir("Proveedor: Periferia IT Group S.A.S.", normal);
  y -= 8;
  for (const campo of campos) {
    const v = valores.get(campo.etiqueta);
    const valor = v?.estado === "faltante" ? MARCA_FALTANTE : `${v?.texto ?? ""}${v?.estado === "confirmar" ? MARCA_CONFIRMAR : ""}`;
    escribir(`${campo.etiqueta}${campo.obligatorio ? " *" : ""}`, negrita);
    for (const linea of envolver(valor, 95)) escribir(`    ${linea}`, normal);
  }
  firma(pagina, normal, Math.max(y - 40, 60));
  return doc.save();
}

function firma(pagina: PDFPage, fuente: PDFFont, y: number) {
  pagina.drawText("* Campo obligatorio.", { x: 50, y: y + 24, size: 8, font: fuente });
  pagina.drawLine({ start: { x: 50, y }, end: { x: 260, y }, thickness: 0.5 });
  pagina.drawText("Firma del representante legal", { x: 50, y: y - 12, size: 9, font: fuente });
}

/** P2: valores listos para copiar en el portal. Credenciales y "Enviar" son siempre humanos (7.4). */
function portal(s: Solicitud, campos: CampoSolicitado[], valores: Map<string, Valor>): string {
  const filas = campos.map((c) => {
    const v = valores.get(c.etiqueta);
    const valor = v?.estado === "faltante" ? "**FALTANTE**" : `\`${v?.texto ?? ""}\`${v?.estado === "confirmar" ? " ⚠️ por confirmar" : ""}`;
    return `| ${c.etiqueta}${c.obligatorio ? " *" : ""} | ${valor} |`;
  });
  return [
    `# Valores para el portal de ${s.cliente}`,
    "",
    "> Formato no soportado para llenado automático. Copia cada valor en el campo correspondiente del portal.",
    "> El ingreso de credenciales y el clic en **Enviar** los hace una persona. Las credenciales nunca pasan por el agente.",
    "",
    "| Campo del portal | Valor |",
    "|---|---|",
    ...filas,
    "",
    "\\* Campo obligatorio.",
    "",
  ].join("\n");
}

function envolver(texto: string, ancho: number): string[] {
  if (texto.length <= ancho) return [texto];
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    if (`${actual} ${palabra}`.trim().length > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else actual = `${actual} ${palabra}`.trim();
  }
  return [...lineas, actual];
}

/** Las fuentes estándar del PDF usan WinAnsi: tildes y ñ sí; otros símbolos se sustituyen. */
function winAnsi(texto: string): string {
  return texto.replace(/[—–]/g, "-").replace(/[^\x20-\x7E -ÿ]/g, "?");
}
