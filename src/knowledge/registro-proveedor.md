## Registro como proveedor ante clientes

Entre 8 y 12 veces al mes, un cliente de Colombia, Ecuador, Perú, Panamá u Honduras pide a Periferia registrarse como su proveedor. Envía un formato propio (plantilla Excel, formulario PDF o portal web) y una lista de soportes. Los datos casi siempre son los mismos y ya están en el repositorio maestro.

**Actores.** Recepción deja la solicitud en la carpeta de entrada. La analista administrativa prepara el formulario y los soportes, revisa faltantes y aprueba el paquete. El representante legal firma; nunca interactúa con el agente. El cliente recibe el paquete; el envío lo decide una persona.

## Campos

Cada campo pedido termina en uno de tres estados:

- **Lleno:** existe en el maestro. Se registra la ruta del dato, por ejemplo `representante_legal.nombre`.
- **Faltante:** no existe en el maestro. Nunca se inventa; queda en el checklist y no bloquea la firma.
- **Por confirmar:** el mapeo tiene confianza menor a 0,8 (la etiqueta solo se parece a un sinónimo conocido) o aplica una regla de país.

El glosario resuelve los sinónimos que usan los clientes ("Nombre de la empresa" → razón social, "Domicilio fiscal" → dirección…).

## Identificador tributario por país (RN1)

| País | Identificador |
|---|---|
| Colombia | NIT |
| Ecuador, Perú, Panamá | RUC |
| Honduras | RTN |

Periferia solo tiene NIT colombiano. Para otros países el campo se llena con el NIT y se marca por confirmar como "identificador extranjero". Si la plantilla pide el dígito de verificación aparte, el NIT va sin él.

## Datos bancarios (RN2)

Se llenan solo si la plantilla los pide explícitamente. Nunca van en el borrador de correo.

## Soportes (RN3)

Soportes disponibles en el repositorio: Cámara de Comercio (vigencia 30 días), RUT (sin vencimiento), certificación bancaria, parafiscales (certificación del revisor fiscal), estados financieros y certificado ISO 9001.

- Un soporte con `vigencia_hasta` anterior a la fecha de referencia está **vencido** y bloquea "listo para firma".
- Un soporte exigido que no existe en el repositorio está **ausente** y también bloquea.
- Un campo faltante **no** bloquea, pero aparece en el checklist.

## Acciones externas (RN4)

El envío, la firma o la carga a un portal requieren una confirmación explícita de la analista en el mensaje inmediatamente anterior. En esta versión, "enviar" solo escribe `out/<caso>/ENVIO-SIMULADO.md`.

## Formatos

- **Excel:** cada etiqueta y su valor en la hoja y celda exactas de la plantilla.
- **PDF:** documento generado con todos los campos, con etiqueta y valor, en el orden pedido.
- **Portal web:** no se automatiza. Se entregan los valores listos para copiar. Las credenciales y el clic en "Enviar" son siempre humanos.
