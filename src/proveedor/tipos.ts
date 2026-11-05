import { z } from "zod";

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const;
export type Pais = (typeof PAISES)[number];

export const NOMBRE_PAIS: Record<Pais, string> = { CO: "Colombia", EC: "Ecuador", PE: "Perú", PA: "Panamá", HN: "Honduras" };

/** RN1: cómo se llama el identificador tributario en cada país. */
export const IDENTIFICADOR_PAIS: Record<Pais, string> = { CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" };

/** HU-2: mapeos con confianza menor a este umbral requieren confirmación. */
export const UMBRAL_CONFIANZA = 0.8;

export const SolicitudSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.enum(PAISES),
  cliente: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

const Celda = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/, "referencia de celda inválida");

export const PlantillaCeldasSchema = z
  .array(z.object({ hoja: z.string().min(1).max(31), celda_etiqueta: Celda, etiqueta: z.string().min(1), celda_valor: Celda }))
  .min(1);
export const PlantillaCamposSchema = z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() })).min(1);

export const SoporteSchema = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.iso.date().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string(),
});
export type Soporte = z.infer<typeof SoporteSchema>;

/** Un campo que pide el cliente, con su ubicación en la plantilla Excel si aplica. */
export interface CampoSolicitado {
  etiqueta: string;
  obligatorio: boolean;
  ubicacion?: { hoja: string; celda_etiqueta: string; celda_valor: string };
}

export interface CampoLleno {
  etiqueta: string;
  /** Ruta del dato en el maestro, p. ej. `representante_legal.nombre`. */
  ruta: string;
  valor: string;
  confianza: number;
  metodo: string;
}

export interface CampoFaltante {
  etiqueta: string;
  obligatorio: boolean;
  motivo: string;
}

export interface CampoPorConfirmar {
  etiqueta: string;
  ruta: string | null;
  /** Valor propuesto; se escribe en el formulario y se marca para confirmar. */
  valor: string | null;
  confianza: number;
  motivo: string;
}

export interface Mapeo {
  llenos: CampoLleno[];
  faltantes: CampoFaltante[];
  requiere_confirmacion: CampoPorConfirmar[];
}

export type Maestro = Record<string, unknown>;
