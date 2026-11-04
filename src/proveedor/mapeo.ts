import {
  type CampoSolicitado,
  IDENTIFICADOR_PAIS,
  type Maestro,
  type Mapeo,
  NOMBRE_PAIS,
  type Pais,
  PAISES,
  UMBRAL_CONFIANZA,
} from "./tipos";

/** Similitud mínima para proponer una clave por parecido (se pide confirmar). */
export const SIMILITUD_PROPUESTA = 0.5;

/** Minúsculas, sin tildes, signos ni espacios dobles. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "en", "para", "por"]);

/** Similitud de Dice entre las palabras significativas de dos etiquetas (0 a 1). */
export function similitud(a: string, b: string): number {
  const palabras = (t: string) => new Set(normalizar(t).split(" ").filter((p) => p && !VACIAS.has(p)));
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  return (2 * [...pa].filter((p) => pb.has(p)).length) / (pa.size + pb.size);
}

/** Valor de una ruta con puntos en el maestro: `banco.numero_cuenta`. */
export function valorEnRuta(maestro: Maestro, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((obj, clave) => (obj && typeof obj === "object" ? (obj as Record<string, unknown>)[clave] : undefined), maestro);
}

/** Texto para el formulario. Solo cambia la presentación; el dato es el del maestro. */
function presentar(ruta: string, valor: unknown, maestro: Maestro, conDigito: boolean): string {
  if (ruta === "pais" && (PAISES as readonly unknown[]).includes(valor)) return NOMBRE_PAIS[valor as Pais];
  if (ruta === "nit" && conDigito) return `${String(valor)}-${String(maestro.digito_verificacion ?? "")}`.replace(/-$/, "");
  if (ruta === "ingresos_ultimo_ano.valor") {
    const ingresos = maestro.ingresos_ultimo_ano as { moneda?: string; ano?: number } | undefined;
    return `${ingresos?.moneda ?? ""} ${Number(valor).toLocaleString("es-CO")} (año ${ingresos?.ano ?? "?"})`.trim();
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

/** Etiquetas genéricas de identificación tributaria: el cliente no dice cuál quiere (HU-1). */
const ETIQUETAS_AMBIGUAS = new Set(["identificacion tributaria", "numero de identificacion fiscal"]);

/** Resuelve la clave del maestro para una etiqueta: glosario exacto, normalizado o por parecido. */
function resolverClave(etiqueta: string, glosario: Record<string, string>): { ruta: string; confianza: number; metodo: string } | null {
  if (glosario[etiqueta]) return { ruta: glosario[etiqueta], confianza: 1, metodo: "Glosario (coincidencia exacta)" };
  const objetivo = normalizar(etiqueta);
  const normalizada = Object.entries(glosario).find(([sinonimo]) => normalizar(sinonimo) === objetivo);
  if (normalizada) return { ruta: normalizada[1], confianza: 0.95, metodo: `Glosario ("${normalizada[0]}", sin tildes ni mayúsculas)` };
  let mejor: { sinonimo: string; ruta: string; s: number } | null = null;
  for (const [sinonimo, ruta] of Object.entries(glosario)) {
    const s = similitud(etiqueta, sinonimo);
    if (!mejor || s > mejor.s) mejor = { sinonimo, ruta, s };
  }
  if (mejor && mejor.s >= SIMILITUD_PROPUESTA) {
    return { ruta: mejor.ruta, confianza: Number(mejor.s.toFixed(2)), metodo: `Parecido con "${mejor.sinonimo}" (${mejor.s.toFixed(2)})` };
  }
  return null;
}

/**
 * HU-2: cada campo pedido termina lleno (con la ruta del dato en el maestro), faltante
 * (no existe en el maestro, nunca se inventa) o por confirmar (confianza < 0.8 o regla de país).
 */
export function mapearCampos(campos: CampoSolicitado[], pais: Pais, maestro: Maestro, glosario: Record<string, string>): Mapeo {
  const mapeo: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] };
  // Si la plantilla pide el dígito de verificación aparte, el NIT va sin él.
  const conDigito = !campos.some((c) => glosario[c.etiqueta] === "digito_verificacion");

  for (const campo of campos) {
    const clave = resolverClave(campo.etiqueta, glosario);
    if (!clave) {
      mapeo.faltantes.push({ etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, motivo: "No hay una clave equivalente en el glosario ni en el maestro." });
      continue;
    }
    const crudo = valorEnRuta(maestro, clave.ruta);
    if (crudo === undefined || crudo === null || crudo === "") {
      mapeo.faltantes.push({ etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, motivo: `La clave ${clave.ruta} no tiene valor en el maestro.` });
      continue;
    }
    const valor = presentar(clave.ruta, crudo, maestro, conDigito);

    if (clave.ruta === "nit") {
      const regla = reglaIdentificador(campo.etiqueta, pais);
      if (regla) {
        mapeo.requiere_confirmacion.push({ etiqueta: campo.etiqueta, ruta: clave.ruta, valor, confianza: Math.min(clave.confianza, 0.7), motivo: regla });
        continue;
      }
    }
    if (clave.confianza < UMBRAL_CONFIANZA) {
      mapeo.requiere_confirmacion.push({ etiqueta: campo.etiqueta, ruta: clave.ruta, valor, confianza: clave.confianza, motivo: `Mapeo por parecido: ${clave.metodo}.` });
      continue;
    }
    mapeo.llenos.push({ etiqueta: campo.etiqueta, ruta: clave.ruta, valor, confianza: clave.confianza, metodo: clave.metodo });
  }
  return mapeo;
}

/** RN1: el identificador tributario se traduce por país; Periferia solo tiene NIT colombiano. */
function reglaIdentificador(etiqueta: string, pais: Pais): string | null {
  const equivalente = IDENTIFICADOR_PAIS[pais];
  if (ETIQUETAS_AMBIGUAS.has(normalizar(etiqueta))) {
    return `Etiqueta ambigua: en ${NOMBRE_PAIS[pais]} el identificador tributario es el ${equivalente}.${pais === "CO" ? "" : " Periferia solo tiene NIT colombiano (identificador extranjero)."}`;
  }
  if (pais !== "CO") return `Identificador extranjero: el cliente pide ${equivalente} y Periferia solo tiene NIT colombiano; se llena con el NIT.`;
  return null;
}

/** HU-1: etiquetas ambiguas de la plantilla, con el equivalente del país propuesto. */
export function etiquetasAmbiguas(campos: CampoSolicitado[], pais: Pais) {
  return campos
    .filter((c) => ETIQUETAS_AMBIGUAS.has(normalizar(c.etiqueta)))
    .map((c) => ({ etiqueta: c.etiqueta, propuesta: IDENTIFICADOR_PAIS[pais], motivo: `En ${NOMBRE_PAIS[pais]} corresponde al ${IDENTIFICADOR_PAIS[pais]}.` }));
}
