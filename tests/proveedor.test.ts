import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { leerResultado } from "../src/core/herramientas";
import { leerGlosario, leerMaestro } from "../src/proveedor/fuentes";
import { mapearCampos, similitud, valorEnRuta } from "../src/proveedor/mapeo";
import { listoParaFirma, revisarSoportes } from "../src/proveedor/paquete";
import type { Soporte } from "../src/proveedor/tipos";
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from "../src/tools/proveedor";

const RAIZ = join(import.meta.dir, "..");
const TEMPORAL = join(RAIZ, ".tmp-tests");
const FECHA = "2026-09-03";

/** Cada test de herramientas trabaja sobre una copia de los fixtures, con su propio `out/`. */
let dir: string;
const ctx = () => ({ directory: dir, sessionId: "test" });
beforeEach(async () => {
  await mkdir(TEMPORAL, { recursive: true });
  dir = await mkdtemp(join(TEMPORAL, "caso-"));
  await cp(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true });
  await Bun.$`chmod -R u+w ${dir}`;
});
afterAll(async () => {
  await rm(TEMPORAL, { recursive: true, force: true });
});

const correr = async (p: Promise<string>) => leerResultado(await p);
const campo = (etiqueta: string) => ({ etiqueta, obligatorio: true });

describe("mapeo de campos (HU-2)", () => {
  test("resuelve sinónimos del glosario, rutas anidadas y formatos de presentación", async () => {
    const [maestro, glosario] = [await leerMaestro(RAIZ), await leerGlosario(RAIZ)];
    const m = mapearCampos([campo("Correo de facturación"), campo("País"), campo("Ingresos anuales"), campo("correo electronico")], "CO", maestro, glosario);
    expect(m.llenos.map((l) => [l.etiqueta, l.valor])).toEqual([
      ["Correo de facturación", "facturacion@periferia-ficticia.com"],
      ["País", "Colombia"],
      ["Ingresos anuales", "COP 98.000.000.000 (año 2025)"],
      ["correo electronico", "lgomez@periferia-ficticia.com"],
    ]);
    expect(m.llenos[3]?.confianza).toBe(0.95);
  });

  test("nunca inventa: lo que no está en el maestro es faltante", async () => {
    const m = mapearCampos([campo("Referencias comerciales"), campo("Número de contribuyente especial")], "EC", await leerMaestro(RAIZ), await leerGlosario(RAIZ));
    expect(m.faltantes.map((f) => f.etiqueta)).toEqual(["Referencias comerciales", "Número de contribuyente especial"]);
    expect(m.llenos).toHaveLength(0);
  });

  test("RN1: identificador extranjero y etiqueta ambigua van a confirmación con el NIT", async () => {
    const [maestro, glosario] = [await leerMaestro(RAIZ), await leerGlosario(RAIZ)];
    const extranjero = mapearCampos([campo("RTN")], "HN", maestro, glosario);
    expect(extranjero.requiere_confirmacion[0]).toMatchObject({ valor: "900123456-7" });
    expect(extranjero.requiere_confirmacion[0]?.motivo).toContain("Identificador extranjero");
    const ambigua = mapearCampos([campo("Identificación tributaria")], "PE", maestro, glosario);
    expect(ambigua.requiere_confirmacion[0]?.motivo).toContain("RUC");
    const colombia = mapearCampos([campo("NIT"), campo("Dígito de verificación")], "CO", maestro, glosario);
    expect(colombia.llenos.map((l) => l.valor)).toEqual(["900123456", "7"]);
  });

  test("un parecido intermedio se propone pero pide confirmación", async () => {
    const m = mapearCampos([campo("Nombre del representante legal de la empresa")], "CO", await leerMaestro(RAIZ), await leerGlosario(RAIZ));
    expect(m.requiere_confirmacion).toHaveLength(1);
    expect(m.requiere_confirmacion[0]?.confianza).toBeLessThan(0.8);
  });

  test("utilidades: similitud y rutas con puntos", () => {
    expect(similitud("Razón social", "razon social")).toBe(1);
    expect(valorEnRuta({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(valorEnRuta({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("soportes (RN3)", () => {
  const indice: Soporte[] = [
    { tipo: "rut", archivo: "rut.txt", vigencia_hasta: null, pais_emisor: "CO", descripcion: "" },
    { tipo: "camara_comercio", archivo: "cc.txt", vigencia_hasta: "2026-09-30", pais_emisor: "CO", descripcion: "" },
  ];

  test("vencido o ausente bloquea la firma; sin vigencia nunca vence", () => {
    expect(listoParaFirma(revisarSoportes(["rut", "camara_comercio"], indice, FECHA, "CO"))).toBe(true);
    expect(revisarSoportes(["camara_comercio"], indice, "2026-10-01", "CO")[0]?.estado).toBe("vencido");
    expect(revisarSoportes(["iso"], indice, FECHA, "CO")[0]?.estado).toBe("ausente");
  });
});

describe("herramientas", () => {
  test("leer_solicitud devuelve país, formato, campos con ubicación y soportes", async () => {
    const r = await correr(leer_solicitud.execute({ caso: "co-industrias-delta" }, ctx()));
    expect(r.ok && r.data).toMatchObject({ pais: "CO", formato: "xlsx", soportes: ["camara_comercio", "rut", "certificacion_bancaria", "estados_financieros"] });
    const campos = r.ok ? (r.data as { campos: { ubicacion?: { hoja: string } }[] }).campos : [];
    expect(campos[0]?.ubicacion).toMatchObject({ hoja: "Datos Proveedor", celda_valor: "C3" });
  });

  test("el Excel queda con cada etiqueta y valor en la hoja y celda de la plantilla (P0)", async () => {
    const r = await correr(generar_formulario.execute({ caso: "co-industrias-delta" }, ctx()));
    expect(r.ok && r.data).toMatchObject({ formato: "xlsx", llenos: 17 });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(join(dir, "out/co-industrias-delta/formulario.xlsx"));
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("B4").value).toBe("NIT");
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("C4").value).toBe("900123456");
    expect(libro.getWorksheet("Datos Bancarios")?.getCell("C5").value).toBe("03100012345");
  });

  test("PDF (P1) y portal (P2, formato no soportado con valores para copiar)", async () => {
    const pdf = await correr(generar_formulario.execute({ caso: "ec-corp-andina" }, ctx()));
    expect(pdf.ok && pdf.data).toMatchObject({ formato: "pdf", soportado: true });
    const portal = await correr(generar_formulario.execute({ caso: "pa-logistica-istmo" }, ctx()));
    expect(portal.ok && portal.data).toMatchObject({ formato: "portal", soportado: false });
    expect(await Bun.file(join(dir, "out/pa-logistica-istmo/valores-portal.md")).text()).toContain("Enviar");
  });

  test("mapear_campos marca la confirmación pendiente para que el chat la resalte", async () => {
    const r = await correr(mapear_campos.execute({ caso: "hn-agroexport-sula" }, ctx()));
    expect(r.confirmacion?.motivo).toContain("RTN");
  });

  test("el paquete: soportes copiados, checklist, borrador sin datos bancarios (RN2) y estado de firma", async () => {
    const co = await correr(armar_paquete.execute({ caso: "co-industrias-delta", fecha_referencia: FECHA }, ctx()));
    expect(co.ok && co.data).toMatchObject({ listo_para_firma: true });
    const borrador = await Bun.file(join(dir, "out/co-industrias-delta/paquete/borrador-correo.md")).text();
    expect(borrador).not.toMatch(/03100012345|Bancolombia|COLOCOBM|Ahorros/);
    expect(await Bun.file(join(dir, "out/co-industrias-delta/paquete/soportes/rut-2026.txt")).exists()).toBe(true);

    const hn = await correr(armar_paquete.execute({ caso: "hn-agroexport-sula", fecha_referencia: FECHA }, ctx()));
    expect(hn.ok && hn.data).toMatchObject({ listo_para_firma: false });
  });

  test("envío simulado: exige confirmación y advierte si el paquete no está listo (RN4)", async () => {
    expect(leerResultado(await simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx())).ok).toBe(false);
    await armar_paquete.execute({ caso: "co-industrias-delta", fecha_referencia: FECHA }, ctx());
    const sin = await correr(simular_envio.execute({ caso: "co-industrias-delta" }, ctx()));
    expect(!sin.ok && sin.error).toBe("requiere confirmación explícita");
    expect(await Bun.file(join(dir, "out/co-industrias-delta/ENVIO-SIMULADO.md")).exists()).toBe(false);

    await armar_paquete.execute({ caso: "ec-corp-andina", fecha_referencia: FECHA }, ctx());
    const incompleto = await correr(simular_envio.execute({ caso: "ec-corp-andina" }, ctx()));
    expect(incompleto.confirmacion?.motivo).toContain("certificado_cumplimiento_tributario");
    const enviado = await correr(simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx()));
    expect(enviado.ok).toBe(true);
    expect(await Bun.file(join(dir, "out/ec-corp-andina/ENVIO-SIMULADO.md")).text()).toContain("NO está listo para firma");
  });

  test("errores legibles: caso inexistente, nombre inseguro y plantilla corrupta (HU-5)", async () => {
    const inexistente = await correr(leer_solicitud.execute({ caso: "zz-nada" }, ctx()));
    expect(!inexistente.ok && inexistente.error).toContain("No existe el caso");
    await writeFile(join(dir, "fixtures/reto-01/casos/hn-agroexport-sula/plantilla-celdas.json"), "[{ roto");
    const corrupta = await correr(generar_formulario.execute({ caso: "hn-agroexport-sula" }, ctx()));
    expect(!corrupta.ok && corrupta.error).toContain("corrupto");
  });

  test("plantilla corrupta: leer_solicitud y armar_paquete entregan lo que sí se puede (HU-5)", async () => {
    await writeFile(join(dir, "fixtures/reto-01/casos/hn-agroexport-sula/plantilla-celdas.json"), "[{ roto");
    const leida = await correr(leer_solicitud.execute({ caso: "hn-agroexport-sula" }, ctx()));
    expect(leida.ok && leida.data).toMatchObject({ pais: "HN", soportes: ["camara_comercio", "rut", "parafiscales"], campos: [] });
    const paquete = await correr(armar_paquete.execute({ caso: "hn-agroexport-sula", fecha_referencia: FECHA }, ctx()));
    expect(paquete.ok && paquete.data).toMatchObject({ listo_para_firma: false, formulario: null });
    expect(await Bun.file(join(dir, "out/hn-agroexport-sula/paquete/checklist.md")).text()).toContain("plantilla");
  });

  test("nunca lanza ni escribe fuera de out/ con argumentos inválidos (llamada directa)", async () => {
    const nulo = await correr(leer_solicitud.execute(null as unknown as { caso: string }, ctx()));
    expect(!nulo.ok && nulo.error).toContain("Argumentos inválidos");
    const fuera = await correr(leer_solicitud.execute({ caso: "../fuera" }, ctx()));
    expect(fuera.ok).toBe(false);
    expect(await Bun.file(join(dir, "fuera/log.jsonl")).exists()).toBe(false);
    await leer_solicitud.execute({ caso: "no-existe" }, ctx());
    expect(await Bun.file(join(dir, "out/no-existe/log.jsonl")).exists()).toBe(false);
  });

  test("el valor de la celda es exacto; lo que hay que confirmar va como nota (HU-3)", async () => {
    await generar_formulario.execute({ caso: "hn-agroexport-sula" }, ctx());
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(join(dir, "out/hn-agroexport-sula/formulario.xlsx"));
    const celda = libro.getWorksheet("Registro")?.getCell("B3");
    expect(celda?.value).toBe("900123456-7");
    expect(JSON.stringify(celda?.note)).toContain("Identificador extranjero");
  });

  test("el borrador no adjunta soportes vencidos", async () => {
    await armar_paquete.execute({ caso: "hn-agroexport-sula", fecha_referencia: FECHA }, ctx());
    const borrador = await Bun.file(join(dir, "out/hn-agroexport-sula/paquete/borrador-correo.md")).text();
    expect(borrador).toContain("rut-2026.txt");
    expect(borrador).not.toContain("parafiscales");
  });

  test("cada ejecución deja su línea en out/<caso>/log.jsonl (RN5)", async () => {
    await leer_solicitud.execute({ caso: "ec-corp-andina" }, ctx());
    const linea = JSON.parse((await Bun.file(join(dir, "out/ec-corp-andina/log.jsonl")).text()).trim());
    expect(Object.keys(linea)).toEqual(["ts", "herramienta", "ok", "resumen"]);
    expect(linea).toMatchObject({ herramienta: "proveedor_leer_solicitud", ok: true });
  });
});
