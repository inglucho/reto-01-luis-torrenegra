import { join } from "node:path";
import { z } from "zod";
import {
  type CampoSolicitado,
  type Maestro,
  PlantillaCamposSchema,
  PlantillaCeldasSchema,
  type Solicitud,
  SolicitudSchema,
  type Soporte,
  SoporteSchema,
} from "./tipos";

/** Rutas del reto. Los fixtures son de solo lectura; todo lo que se escribe va a `out/<caso>/`. */
export function rutas(dir: string, caso = "") {
  const fixtures = join(dir, "fixtures", "reto-01");
  return {
    caso: join(fixtures, "casos", caso),
    maestro: join(fixtures, "repositorio", "maestro.json"),
    soportes: join(fixtures, "repositorio", "soportes"),
    glosario: join(fixtures, "glosario-campos.json"),
    salida: join(dir, "out", caso),
    paquete: join(dir, "out", caso, "paquete"),
  };
}

/** Nombre de carpeta seguro: evita rutas como `../../etc` desde un argumento del modelo. */
export const CasoSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "El caso debe ser el nombre de una carpeta, p. ej. co-industrias-delta")
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, p. ej. ec-corp-andina");

export class ErrorFuente extends Error {
  override name = "ErrorFuente";
}

async function leerJson<S extends z.ZodType>(ruta: string, esquema: S, nombre: string): Promise<z.output<S>> {
  const archivo = Bun.file(ruta);
  if (!(await archivo.exists())) throw new ErrorFuente(`Falta ${nombre}.`);
  let crudo: unknown;
  try {
    crudo = JSON.parse(await archivo.text());
  } catch {
    throw new ErrorFuente(`${nombre}: el archivo está corrupto, no es un JSON válido.`);
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) throw new ErrorFuente(`${nombre}: el archivo está corrupto (${z.prettifyError(r.error)}).`);
  return r.data;
}

export async function listarCasos(dir: string): Promise<string[]> {
  const casos: string[] = [];
  for await (const ruta of new Bun.Glob("*/solicitud.json").scan(join(dir, "fixtures", "reto-01", "casos"))) {
    casos.push(ruta.split("/")[0] ?? ruta);
  }
  return casos.sort();
}

export async function leerSolicitud(dir: string, caso: string): Promise<Solicitud> {
  if (!(await Bun.file(join(rutas(dir, caso).caso, "solicitud.json")).exists())) throw new ErrorFuente(`No existe el caso "${caso}".`);
  return leerJson(join(rutas(dir, caso).caso, "solicitud.json"), SolicitudSchema, "solicitud.json");
}

/** Campos pedidos: de `plantilla-celdas.json` (Excel) o `plantilla-campos.json` (PDF y portal). */
export async function leerCampos(dir: string, caso: string, formato: Solicitud["formato"]): Promise<CampoSolicitado[]> {
  const base = rutas(dir, caso).caso;
  if (formato === "xlsx") {
    const celdas = await leerJson(join(base, "plantilla-celdas.json"), PlantillaCeldasSchema, "La plantilla de celdas (plantilla-celdas.json)");
    return celdas.map((c) => ({ etiqueta: c.etiqueta, obligatorio: true, ubicacion: { hoja: c.hoja, celda_etiqueta: c.celda_etiqueta, celda_valor: c.celda_valor } }));
  }
  return leerJson(join(base, "plantilla-campos.json"), PlantillaCamposSchema, "La plantilla de campos (plantilla-campos.json)");
}

export async function leerSoportesExigidos(dir: string, caso: string): Promise<string[]> {
  return leerJson(join(rutas(dir, caso).caso, "soportes-exigidos.json"), z.array(z.string()), "soportes-exigidos.json");
}

export async function leerMaestro(dir: string): Promise<Maestro> {
  return leerJson(rutas(dir).maestro, z.record(z.string(), z.unknown()), "El repositorio maestro");
}

export async function leerGlosario(dir: string): Promise<Record<string, string>> {
  return leerJson(rutas(dir).glosario, z.record(z.string(), z.string()), "El glosario de campos");
}

export async function leerIndiceSoportes(dir: string): Promise<Soporte[]> {
  return leerJson(join(rutas(dir).soportes, "index.json"), z.array(SoporteSchema), "El índice de soportes");
}
