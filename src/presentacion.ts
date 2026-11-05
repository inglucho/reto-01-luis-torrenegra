import type { Presentacion } from "./core/presentacion";

/**
 * Lo que el chat le explica a quien lo usa: qué hace el agente, ejemplos con lo que se
 * puede esperar, los datos de prueba y cómo funcionan las confirmaciones. Los resultados
 * esperados son los que verifica `demo.ts` (vigencias al 2026-09-03).
 */
export const presentacion: Presentacion = {
  reto: "Reto 01",
  titulo: "Registro como Proveedor",
  descripcion:
    "Llena el formulario de registro como proveedor que pide cada cliente (Excel, PDF o portal web) con los datos del repositorio de Periferia y arma el paquete de soportes para la firma del representante legal. Nunca envía nada sin tu confirmación.",
  placeholder: 'Escribe una instrucción, por ejemplo: Procesa el caso "co-industrias-delta"',
  queHace: [
    "Lee la solicitud del cliente y su plantilla: país, formato (Excel, PDF o portal web), campos pedidos y soportes exigidos.",
    "Llena cada campo con los datos del repositorio de Periferia y separa lo lleno, lo que falta y lo que hay que confirmar. Nunca inventa un dato.",
    "Genera el formulario en el formato del cliente: Excel con las celdas exactas, PDF o, para portales, los valores listos para copiar.",
    "Arma el paquete para firma: formulario, soportes, checklist de vigencias y borrador de correo (sin datos bancarios).",
    "Solo simula el envío, y únicamente con tu confirmación explícita.",
  ],
  sugerencias: [
    {
      titulo: "Formulario en Excel",
      texto: 'Procesa el caso "co-industrias-delta" y dime si el paquete está listo para firma.',
      espera: "17 campos llenos y los 4 soportes vigentes: el paquete queda listo para firma.",
    },
    {
      titulo: "Formulario en PDF",
      texto:
        'Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.',
      espera: "13 campos llenos; el RUC se llena con el NIT y queda por confirmar; falta el certificado de cumplimiento tributario.",
    },
    {
      titulo: "Soporte vencido",
      texto: 'Arma el paquete del caso "hn-agroexport-sula" y explícame qué lo bloquea.',
      espera: "Los parafiscales vencieron el 31 de agosto, así que el paquete no está listo para firma.",
    },
    {
      titulo: "Portal web",
      texto: 'Prepara el registro de "pa-logistica-istmo", que se hace en un portal web.',
      espera: "Explica que el portal lo diligencia una persona y entrega los valores listos para copiar.",
    },
    {
      titulo: "Simular el envío",
      texto: 'Arma el paquete del caso "co-industrias-delta" y envíalo.',
      espera: "Arma el paquete y, antes de enviar, te pide confirmación explícita. El envío solo se simula.",
    },
  ],
  casos: [
    { id: "co-industrias-delta", descripcion: "Colombia · plantilla Excel", resultado: "Listo para firma", tono: "ok", instruccion: 'Procesa el caso "co-industrias-delta".' },
    { id: "ec-corp-andina", descripcion: "Ecuador · formulario PDF", resultado: "Falta un soporte · RUC por confirmar", tono: "bloqueo", instruccion: 'Procesa el caso "ec-corp-andina".' },
    { id: "hn-agroexport-sula", descripcion: "Honduras · plantilla Excel", resultado: "Parafiscales vencidos · RTN por confirmar", tono: "bloqueo", instruccion: 'Procesa el caso "hn-agroexport-sula".' },
    { id: "pa-logistica-istmo", descripcion: "Panamá · portal web", resultado: "Valores listos para copiar", tono: "info", instruccion: 'Procesa el caso "pa-logistica-istmo".' },
  ],
  confirmaciones:
    "El agente nunca envía, firma ni carga nada por su cuenta. Antes de cualquier envío te muestra qué se enviaría y a quién, advierte si el paquete está incompleto y se detiene. Responde «Confirmo» para continuar; si dices «no envíes nada todavía», no lo hará. En esta versión el envío solo se simula (ENVIO-SIMULADO.md).",
  resultados: [
    { ruta: "out/<caso>/formulario.xlsx o .pdf", descripcion: "El formulario lleno en el formato del cliente." },
    { ruta: "out/<caso>/valores-portal.md", descripcion: "Para portales web: los valores listos para copiar." },
    { ruta: "out/<caso>/paquete/", descripcion: "Formulario, soportes, checklist.md y borrador-correo.md." },
    { ruta: "out/<caso>/ENVIO-SIMULADO.md", descripcion: "Lo que se habría enviado, solo tras tu confirmación." },
    { ruta: "out/<caso>/log.jsonl", descripcion: "Cada ejecución de herramienta en ese caso." },
  ],
};
