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
import { armarPaquete, listoParaFirma, revisarSoportes } from "../proveedor/paquete";
import { NOMBRE_PAIS } from "../proveedor/tipos";

/**
 * Herramientas del reto 01. El modelo las ve como `proveedor_<export>`.
 * Todas devuelven `{ ok, data }` o `{ ok: false, error }` serializado, nunca lanzan y
 * dejan su línea en `out/<caso>/log.jsonl` (RN5). Recalculan todo desde los fixtures:
 * lo que envía el modelo (campos, mapeo) solo se compara, nunca se usa como fuente.
 */

async function ejecutar(ctx: Contexto, herramienta: string, caso: string | null, cuerpo: () => Promise<string>): Promise<string> {
  let resultado: string;
  try {
    resultado = await cuerpo();
  } catch (err) {
    resultado = fallo(err instanceof ErrorFuente ? err.message : `Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (caso) {
    const r = leerResultado(resultado);
    const resumen = r.confirmacion ? `requiere confirmación: ${r.confirmacion.motivo}` : r.ok ? JSON.stringify(r.data).slice(0, 160) : r.error;
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
  return { solicitud, campos, mapeo: mapearCampos(campos, solicitud.pais, maestro, glosario) };
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
  async execute(_args: Record<string, never>, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "listar_casos", null, async () => ok({ casos: await listarCasos(ctx.directory) }));
  },
};

export const leer_solicitud = {
  description: "Lee el correo y la plantilla de un caso: país, cliente, formato, campos pedidos y soportes exigidos.",
  args: { caso: CasoSchema },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "leer_solicitud", args.caso, async () => {
      const solicitud = await leerSolicitud(ctx.directory, args.caso);
      const campos = await leerCampos(ctx.directory, args.caso, solicitud.formato);
      const soportes = await leerSoportesExigidos(ctx.directory, args.caso);
      return ok({
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        campos,
        soportes,
        requiere_confirmacion: etiquetasAmbiguas(campos, solicitud.pais),
      });
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
    return ejecutar(ctx, "mapear_campos", args.caso, async () => {
      const { solicitud, campos, mapeo } = await prepararCaso(ctx, args.caso);
      const ignoradas = (args.campos ?? []).filter((e) => !campos.some((c) => c.etiqueta === e));
      const data = { ...mapeo, pais: NOMBRE_PAIS[solicitud.pais], advertencias: ignoradas.map((e) => `Se ignoró "${e}": no está en la plantilla del cliente.`) };
      if (mapeo.requiere_confirmacion.length > 0) {
        const motivo = `Confirmar ${mapeo.requiere_confirmacion.map((c) => c.etiqueta).join(", ")} antes de enviar el formulario.`;
        return JSON.stringify({ ok: true, data, confirmacion: { motivo } });
      }
      return ok(data);
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
    return ejecutar(ctx, "generar_formulario", args.caso, async () => {
      const { solicitud, campos, mapeo } = await prepararCaso(ctx, args.caso);
      const formulario = await generarFormulario(ctx.directory, solicitud, campos, mapeo);
      return ok({ ...formulario, llenos: mapeo.llenos.length, por_confirmar: mapeo.requiere_confirmacion.length, faltantes: mapeo.faltantes.length });
    });
  },
};

export const armar_paquete = {
  description: "Arma el paquete para firma (formulario, soportes, checklist y borrador de correo) e indica si está listo para firma.",
  args: { caso: CasoSchema, fecha_referencia: FechaSchema },
  async execute(args: { caso: string; fecha_referencia?: string }, ctx: Contexto): Promise<string> {
    return ejecutar(ctx, "armar_paquete", args.caso, async () => {
      const fecha = args.fecha_referencia ?? config.fechaReferencia;
      const { solicitud, campos, mapeo } = await prepararCaso(ctx, args.caso);
      const formulario = await generarFormulario(ctx.directory, solicitud, campos, mapeo);
      const checklist = await revisarCaso(ctx, args.caso, solicitud.pais, fecha);
      const paquete = await armarPaquete(ctx.directory, { solicitud, mapeo, checklist, formulario, fecha });
      return ok({
        ...paquete,
        fecha_referencia: fecha,
        checklist,
        formulario: formulario.ruta,
        aviso_formato: formulario.aviso,
        campos: { llenos: mapeo.llenos.length, por_confirmar: mapeo.requiere_confirmacion.map((c) => c.etiqueta), faltantes: mapeo.faltantes.map((f) => f.etiqueta) },
      });
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
    return ejecutar(ctx, "simular_envio", args.caso, async () => {
      const r = rutas(ctx.directory, args.caso);
      if (!(await Bun.file(join(r.paquete, "borrador-correo.md")).exists())) return fallo("Primero hay que armar el paquete con proveedor_armar_paquete.");
      const solicitud = await leerSolicitud(ctx.directory, args.caso);
      const checklist = await revisarCaso(ctx, args.caso, solicitud.pais, config.fechaReferencia);
      // "Listo para firma" y "enviar" son decisiones distintas: un paquete incompleto no se bloquea,
      // pero la confirmación lo advierte de forma explícita y el envío deja constancia.
      const pendientes = checklist.filter((i) => i.estado !== "presente").map((i) => `${i.tipo} (${i.estado})`);
      const advertencia = listoParaFirma(checklist) ? null : `El paquete NO está listo para firma: ${pendientes.join(", ")}.`;
      if (!args.confirmado) {
        const motivo = `Confirmar el envío del paquete a ${solicitud.de}, una vez firmado por el representante legal.${advertencia ? ` ${advertencia} ¿Enviar de todas formas?` : ""}`;
        return JSON.stringify({ ok: false, error: "requiere confirmación explícita", confirmacion: { motivo, detalles: { pendientes } } });
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
      return ok({ ruta: join("out", args.caso, "ENVIO-SIMULADO.md"), destinatario: solicitud.de, advertencia });
    });
  },
};
