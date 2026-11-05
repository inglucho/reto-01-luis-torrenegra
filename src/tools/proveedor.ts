import { join } from "node:path";
import { z } from "zod";
import { config } from "../config";
import { type Contexto, fallo, leerResultado, ok } from "../core/herramientas";
import { generarFormulario } from "../proveedor/formulario";
import {
  CasoSchema,
  ErrorFuente,
  leerCampos,
  leerGlosario,
  leerIndiceSoportes,
  leerMaestro,
  leerSolicitud,
  leerSoportesExigidos,
  listarCasos,
  rutas,
} from "../proveedor/fuentes";
import { registrarLog } from "../proveedor/log";
import { etiquetasAmbiguas, mapearCampos } from "../proveedor/mapeo";
import { armarPaquete, leerEstadoPaquete, revisarSoportes } from "../proveedor/paquete";
import { NOMBRE_PAIS } from "../proveedor/tipos";

/**
 * Herramientas del reto 01. El modelo las ve como `proveedor_<export>`.
 * Todas devuelven `{ ok, data }` o `{ ok: false, error }` serializado, nunca lanzan y
 * dejan su línea en `out/<caso>/log.jsonl` (RN5). Recalculan todo desde los fixtures:
 * lo que envía el modelo (campos, mapeo) solo se compara, nunca se usa como fuente.
 */

/**
 * Valida los argumentos (también cuando se llama sin el backend, p. ej. desde demo.ts o el
 * módulo), ejecuta, convierte errores en `{ ok: false }` y deja la línea del log del caso.
 */
async function ejecutar<A extends z.ZodRawShape>(
  ctx: Contexto,
  herramienta: string,
  esquema: A,
  args: unknown,
  cuerpo: (a: z.output<z.ZodObject<A>>) => Promise<string>,
): Promise<string> {
  const validos = z.object(esquema).safeParse(args ?? {});
  if (!validos.success) return fallo(`Argumentos inválidos: ${z.prettifyError(validos.error)}`);
  let resultado: string;
  try {
    resultado = await cuerpo(validos.data);
  } catch (err) {
    resultado = fallo(err instanceof ErrorFuente ? err.message : `Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  }
  const caso = (validos.data as { caso?: string }).caso;
  // Solo se escribe el log de casos que existen: un nombre inválido o inexistente no crea carpetas en out/.
  if (caso && (await Bun.file(join(rutas(ctx.directory, caso).caso, "solicitud.json")).exists())) {
    const r = leerResultado(resultado);
    const resumen = r.resumen ?? (r.confirmacion ? `requiere confirmación: ${r.confirmacion.motivo}` : r.ok ? "ok" : r.error);
    await registrarLog(ctx.directory, caso, { herramienta: `proveedor_${herramienta}`, ok: r.ok, resumen });
  }
  return resultado;
}

/** Solicitud, campos pedidos y mapeo contra el maestro: la base de casi todas las herramientas. */
async function prepararCaso(ctx: Contexto, caso: string) {
  const solicitud = await leerSolicitud(ctx.directory, caso);
  const [campos, maestro, glosario] = await Promise.all([
    leerCampos(ctx.directory, caso, solicitud.formato),
    leerMaestro(ctx.directory),
    leerGlosario(ctx.directory),
  ]);
  const razonSocial = typeof maestro.razon_social === "string" ? maestro.razon_social : "Periferia IT Group S.A.S.";
  return { solicitud, campos, mapeo: mapearCampos(campos, solicitud.pais, maestro, glosario), razonSocial };
}

async function razonSocialDelMaestro(ctx: Contexto): Promise<string> {
  const maestro = await leerMaestro(ctx.directory);
  return typeof maestro.razon_social === "string" ? maestro.razon_social : "Periferia IT Group S.A.S.";
}

function resumenMapeo(m: { llenos: unknown[]; requiere_confirmacion: { etiqueta: string }[]; faltantes: { etiqueta: string }[] }): string {
  const partes = [`${m.llenos.length} llenos`];
  if (m.requiere_confirmacion.length > 0) partes.push(`por confirmar: ${m.requiere_confirmacion.map((c) => c.etiqueta).join(", ")}`);
  if (m.faltantes.length > 0) partes.push(`faltan: ${m.faltantes.map((f) => f.etiqueta).join(", ")}`);
  return partes.join(" · ");
}

async function revisarCaso(ctx: Contexto, caso: string, pais: Parameters<typeof revisarSoportes>[3], fecha: string) {
  const [exigidos, indice] = await Promise.all([leerSoportesExigidos(ctx.directory, caso), leerIndiceSoportes(ctx.directory)]);
  return revisarSoportes(exigidos, indice, fecha, pais);
}

const FechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Opcional. Fecha de referencia YYYY-MM-DD para la vigencia de los soportes; por defecto la configurada en el servidor");

export const listar_casos = {
  description: "Lista los casos de solicitud de registro como proveedor disponibles.",
  args: {},
  async execute(args: Record<string, never>, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "listar_casos", {}, args, async () => {
      const casos = await listarCasos(ctx.directory);
      return ok({ casos }, `${casos.length} casos disponibles: ${casos.join(", ")}`);
    });
  },
};

export const leer_solicitud = {
  description: "Lee el correo y la plantilla de un caso: país, cliente, formato, campos pedidos y soportes exigidos.",
  args: { caso: CasoSchema },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "leer_solicitud", { caso: CasoSchema }, args, async ({ caso }) => {
      const solicitud = await leerSolicitud(ctx.directory, caso);
      const soportes = await leerSoportesExigidos(ctx.directory, caso);
      // HU-5: si la plantilla está corrupta, se entrega igual lo que sí se pudo leer.
      let campos: Awaited<ReturnType<typeof leerCampos>> = [];
      let error_plantilla: string | undefined;
      try {
        campos = await leerCampos(ctx.directory, caso, solicitud.formato);
      } catch (err) {
        if (!(err instanceof ErrorFuente)) throw err;
        error_plantilla = err.message;
      }
      const data = {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        campos,
        soportes,
        requiere_confirmacion: etiquetasAmbiguas(campos, solicitud.pais),
        ...(error_plantilla ? { error_plantilla } : {}),
      };
      const resumen = `${solicitud.cliente} (${NOMBRE_PAIS[solicitud.pais]}) · formato ${solicitud.formato} · ${
        error_plantilla ? "plantilla ilegible" : `${campos.length} campos`
      } · ${soportes.length} soportes exigidos`;
      return ok(data, resumen);
    });
  },
};

export const mapear_campos = {
  description: "Cruza cada campo pedido con el repositorio maestro y lo clasifica en lleno, faltante o por confirmar.",
  args: {
    caso: CasoSchema,
    campos: z.array(z.string()).optional().describe("Opcional. Etiquetas pedidas; se recalculan desde la plantilla y se avisa si difieren"),
  },
  async execute(args: { caso: string; campos?: string[] }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "mapear_campos", mapear_campos.args, args, async (a) => {
      const { solicitud, campos, mapeo } = await prepararCaso(ctx, a.caso);
      const ignoradas = (a.campos ?? []).filter((e) => !campos.some((c) => c.etiqueta === e));
      const data = { ...mapeo, pais: NOMBRE_PAIS[solicitud.pais], advertencias: ignoradas.map((e) => `Se ignoró "${e}": no está en la plantilla del cliente.`) };
      const resumen = resumenMapeo(mapeo);
      if (mapeo.requiere_confirmacion.length > 0) {
        const motivo = `Confirmar ${mapeo.requiere_confirmacion.map((c) => c.etiqueta).join(", ")} antes de enviar el formulario.`;
        return JSON.stringify({ ok: true, data, resumen, confirmacion: { motivo } });
      }
      return ok(data, resumen);
    });
  },
};

export const generar_formulario = {
  description: "Genera el formulario lleno en el formato del cliente: Excel, PDF o, para portales, los valores listos para copiar.",
  args: {
    caso: CasoSchema,
    mapeo: z.record(z.string(), z.unknown()).optional().describe("Opcional. Mapeo de proveedor_mapear_campos; se recalcula desde la fuente"),
  },
  async execute(args: { caso: string; mapeo?: Record<string, unknown> }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "generar_formulario", generar_formulario.args, args, async (a) => {
      const { solicitud, campos, mapeo, razonSocial } = await prepararCaso(ctx, a.caso);
      const formulario = await generarFormulario(ctx.directory, solicitud, campos, mapeo, razonSocial);
      const resumen = formulario.soportado
        ? `Formulario ${formulario.formato.toUpperCase()} generado en ${formulario.ruta} · ${resumenMapeo(mapeo)}`
        : `Formato no soportado (portal web): valores listos para copiar en ${formulario.ruta}`;
      return ok({ ...formulario, llenos: mapeo.llenos.length, por_confirmar: mapeo.requiere_confirmacion.length, faltantes: mapeo.faltantes.length }, resumen);
    });
  },
};

export const armar_paquete = {
  description: "Arma el paquete para firma (formulario, soportes, checklist y borrador de correo) e indica si está listo para firma.",
  args: { caso: CasoSchema, fecha_referencia: FechaSchema },
  async execute(args: { caso: string; fecha_referencia?: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "armar_paquete", armar_paquete.args, args, async (a) => {
      const fecha = a.fecha_referencia ?? config.fechaReferencia;
      const solicitud = await leerSolicitud(ctx.directory, a.caso);
      const checklist = await revisarCaso(ctx, a.caso, solicitud.pais, fecha);
      const razonSocial = await razonSocialDelMaestro(ctx);
      // HU-5: con la plantilla corrupta no hay formulario, pero el checklist de soportes se genera igual.
      let caso: Awaited<ReturnType<typeof prepararCaso>> | null = null;
      let error_plantilla: string | undefined;
      try {
        caso = await prepararCaso(ctx, a.caso);
      } catch (err) {
        if (!(err instanceof ErrorFuente)) throw err;
        error_plantilla = err.message;
      }
      const formulario = caso ? await generarFormulario(ctx.directory, solicitud, caso.campos, caso.mapeo, razonSocial) : null;
      const mapeo = caso?.mapeo ?? { llenos: [], faltantes: [], requiere_confirmacion: [] };
      const paquete = await armarPaquete(ctx.directory, { solicitud, mapeo, checklist, formulario, fecha, razonSocial, errorPlantilla: error_plantilla });
      const pendientes = checklist.filter((i) => i.estado !== "presente").map((i) => `${i.tipo} ${i.estado}`);
      const resumen = `${paquete.listo_para_firma ? "Listo para firma" : "No listo para firma"} (vigencias al ${fecha})${
        pendientes.length > 0 ? ` · ${pendientes.join(", ")}` : " · soportes completos y vigentes"
      }${error_plantilla ? " · sin formulario: plantilla ilegible" : ""}`;
      return ok(
        {
          ...paquete,
          fecha_referencia: fecha,
          checklist,
          formulario: formulario?.ruta ?? null,
          aviso_formato: formulario?.aviso,
          ...(error_plantilla ? { error_plantilla } : {}),
          campos: { llenos: mapeo.llenos.length, por_confirmar: mapeo.requiere_confirmacion.map((c) => c.etiqueta), faltantes: mapeo.faltantes.map((f) => f.etiqueta) },
        },
        resumen,
      );
    });
  },
};

export const simular_envio = {
  description: "Simula el envío del paquete al cliente escribiendo ENVIO-SIMULADO.md; exige confirmado = true y advierte si el paquete no está listo para firma.",
  args: {
    caso: CasoSchema,
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente el envío en su último mensaje"),
  },
  async execute(args: { caso: string; confirmado?: boolean }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "simular_envio", simular_envio.args, args, async (a) => {
      const r = rutas(ctx.directory, a.caso);
      const estado = await leerEstadoPaquete(ctx.directory, a.caso);
      if (!estado || !(await Bun.file(join(r.paquete, "borrador-correo.md")).exists())) {
        return fallo("Primero hay que armar el paquete con proveedor_armar_paquete.");
      }
      const solicitud = await leerSolicitud(ctx.directory, a.caso);
      // Se usa el estado con que se armó el paquete (misma fecha de referencia), no uno recalculado.
      // "Listo para firma" y "enviar" son decisiones distintas: un paquete incompleto no se bloquea,
      // pero la confirmación lo advierte de forma explícita y el envío deja constancia.
      const pendientes = estado.pendientes;
      const advertencia = estado.listo_para_firma ? null : `El paquete NO está listo para firma: ${pendientes.join(", ")}.`;
      if (!a.confirmado) {
        const motivo = `Confirmar el envío del paquete a ${solicitud.de}, una vez firmado por el representante legal.${advertencia ? ` ${advertencia} ¿Enviar de todas formas?` : ""}`;
        return JSON.stringify({
          ok: false,
          error: "requiere confirmación explícita",
          resumen: `No se envió: falta tu confirmación explícita${advertencia ? " (el paquete no está listo para firma)" : ""}`,
          confirmacion: { motivo, detalles: { pendientes } },
        });
      }
      const borrador = await Bun.file(join(r.paquete, "borrador-correo.md")).text();
      const encabezado = [
        "# ENVÍO SIMULADO",
        "",
        "> No se envió ningún correo. Este archivo registra lo que se habría enviado.",
        "",
        `- **Fecha:** ${new Date().toISOString()}`,
        `- **Confirmado por:** usuario del chat (sesión ${ctx.sessionId})`,
        `- **Estado del paquete:** ${advertencia ?? "listo para firma"}`,
      ].join("\n");
      await Bun.write(join(r.salida, "ENVIO-SIMULADO.md"), `${encabezado}\n\n---\n\n${borrador}`);
      return ok(
        { ruta: join("out", a.caso, "ENVIO-SIMULADO.md"), destinatario: solicitud.de, advertencia },
        `Envío simulado a ${solicitud.de}: out/${a.caso}/ENVIO-SIMULADO.md${advertencia ? " (con advertencia: paquete incompleto)" : ""}`,
      );
    });
  },
};
