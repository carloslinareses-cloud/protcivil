# Archivos proporcionados por Carlos

Carpeta de trabajo para las siguientes instrucciones: `C:\Users\carlo\Documents\protcivil form\nuevo`.

El 5 de octubre de 2026 sustituyo `logos/pc.png` por una copia exacta de `LOGO PC MODIFICADO_Mesa de trabajo 1.png` (949 × 937 píxeles, PNG con transparencia). Las referencias de las páginas llevan versión para actualizar la caché. Los PDF de visitas y puntos de atención utilizan también este logo, con su proporción original.

## Educación

Fuente: `PLANTILLA EDUCACION.xlsx`, hoja `Hoja1`. El original permanece intacto.

- `educacion-data.js`: los 47 campos de los doce apartados de la plantilla; fuente única para formulario, ficha, Excel y PDF.
- `educacion.html`: formulario público en el menú habitual. Las cantidades vacías permanecen desconocidas; cero se conserva como cero. Los cuatro totales se calculan cuando ambas cantidades están completas. La matrícula general se mantiene como campo propio, tal como aparece en el Excel.
- `educacion-resultados.html`: tablero privado del personal con fichas completas, filtros, edición, Excel de todos los resultados y PDF institucional. Solo `admin_plus` elimina. La edición y eliminación dejan una entrada atómica en `pc_bitacora`.
- `pc_educacion`: nodo independiente. El público crea con el interruptor habitual abierto, sin lectura ni modificación de registros existentes. Los permisos y validaciones están en `reglas-educacion.json`; `pruebas/educacion-reglas.mjs --publicar` conserva y verifica las otras reglas.
- `pruebas/e2e-educacion.mjs`: recorrido real móvil y escritorio, creación pública, privacidad, campos, panel, ficha, exportaciones y edición. Retira sus datos y cuenta temporales al finalizar.

IAPEM, Guardia del Pueblo, Policía Municipal y P.C.A.D. conservan las cuatro opciones de la hoja como selecciones Sí/No. No se infieren cantidades ni información personal.

Los demás archivos de la carpeta solo se procesan según las instrucciones posteriores de Carlos.

## Solicitud ciudadana de inspección

Fuente autorizada el 16/10/2026: `C:\Users\carlo\Documents\SOLICITUD DE INSPECCION.docx`. El Word original permanece intacto. Carlos indicó que el ciudadano describe el motivo en el apartado «Diagnóstico».

- `solicitud-inspeccion.html`: formulario público independiente, sin acceso desde `reportar-riesgo.html`. Conserva los 23 campos generales del Word: ubicación, solicitante, cantidades familiares, seis tipos de inspección y diagnóstico o motivo. Estado Miranda y municipio Cristóbal Rojas son los valores del documento. Cantidades vacías permanecen desconocidas y cero se conserva como cero; no se suman categorías que pueden solaparse.
- `solicitud-inspeccion-data.mjs`: esquema compartido para controles, validación, lectura y exportaciones. Para casa o apartamento se permite añadir hasta 50 integrantes del núcleo familiar con parentesco, nombre, edad, sexo, cédula y plantel. Las cédulas de familiares son opcionales; no se deducen datos de menores ni se inventan edades.
- `solicitud-inspeccion-resultados.html`: acceso desde el administrador y su resumen en vivo. Permite consultar todas las solicitudes completas, buscar y filtrar, descargar todas las coincidencias en PDF o Excel y ver la ficha de cada solicitud. La tarjeta para compartir pertenece a este tablero: copiar enlace, abrir formulario, WhatsApp y descargar QR PNG. El QR contiene únicamente el enlace público, no datos personales.
- `pc_solicitudes_inspeccion`: nodo propio. El ciudadano solo crea una solicitud nueva con identificador válido y fecha del servidor; no puede leer, modificar ni borrar solicitudes. El personal con rol `admin` o `admin_plus` y cambio obligatorio resuelto puede leerlas. Las solicitudes se conservan sin edición o borrado desde esta interfaz. El formulario es independiente del interruptor de los formularios habituales.
- `reglas-solicitud-inspeccion.json` y `pruebas/solicitud-inspeccion-reglas.mjs`: publican únicamente el nodo nuevo conservando y verificando las demás reglas efectivas. La copia del nodo se sincroniza con `alcaldia-admin/firebase-rules.json`.
- `pruebas/solicitud-inspeccion-e2e.mjs`: prueba pública y privada con datos ficticios, privacidad, rechazo de modificaciones y campos inválidos, conservación completa de campos y familia, filtros, copia de enlace, QR, Excel, PDF y teléfono. Los registros propios de prueba se retiran al finalizar; no se crean cuentas temporales.

La confirmación acredita la recepción de la solicitud; no asigna una fecha de visita ni constituye una evaluación técnica. El catálogo público de formularios permanece sin modificaciones.

## Riesgo controlado

Fuentes comparadas y renderizadas con PowerPoint: `Riesgo Controlado FORMATO.pptx` (vacío) e `INVERSIONES PARAVELAS, C.A..pptx` (lleno y modelo final). Ambos contienen una página vertical de 7,5 × 10 pulgadas. El modelo final define bordes, posiciones, tipografía, texto institucional, pie y firma. Los originales permanecen intactos.

- `riesgo-controlado.html` y `riesgo-controlado.js`: panel exclusivo del administrador, con once datos variables, vista previa al escribir, informes guardados y edición. No se agrega al menú público.
- `riesgo-controlado.css`: impresión de una página con las dimensiones del PowerPoint, borde azul, encabezado, establecimiento y fechas en rojo, director y pie del modelo final. La impresión usa el mismo artículo de la vista previa; la escala de pantalla se elimina al imprimir. Los textos largos se ajustan dentro de límites legibles; si todavía exceden el espacio, se bloquea la impresión y se muestra el problema en lugar de recortar información.
- La casilla «Incluir firma digital al imprimir» comienza desmarcada, incluso al abrir un informe guardado. Su estado no se guarda en el registro. Se utiliza el JPEG original; el navegador reconoce su orientación EXIF y se conserva la caja horizontal equivalente al PowerPoint, sin volver a rotarlo ni deformarlo.
- `pc_riesgo_controlado`: registros privados. `pc_riesgo_controlado_config`: firma original privada, accesible solo tras comprobar el rol del personal. La firma no se incluye en archivos públicos del sitio.
- `reglas-riesgo-controlado.json`: fragmento de permisos y validaciones. `pruebas/riesgo-controlado-preparar.mjs --publicar` incorpora estos nodos conservando las demás reglas y verifica los datos privados preparados. No modifica los informes existentes.
- `pruebas/e2e-riesgo-controlado.mjs`: privacidad, acceso desde admin, guardado, edición, móvil y PDF con/sin firma. Comprueba que el menú público no lo ofrezca y reproduce el ejemplo lleno solo en el navegador para comparar, sin guardarlo en Firebase. Retira registros y cuenta temporales al terminar.

El contenido técnico y los datos de inspección los introduce y revisa el personal responsable. El panel reproduce el documento proporcionado, sin deducir que se realizó una inspección ni emitir por su cuenta una aprobación.

## Corrección del administrador

Se corrigen las tildes e iconos de las tarjetas y del menú que se habían deteriorado al insertar texto desde PowerShell. El contador de brigadas compara correctamente `Sí`, con tilde. Las tarjetas nuevas utilizan enlaces nativos que pueden abrirse con teclado. El panel conserva su diseño y adapta contenedor, selector de módulo y cifras a 320 y 375 píxeles sin desbordamiento. La prueba de Educación comprueba textos, iconos, contador real, enlaces de ambos módulos y capturas de escritorio/teléfono. Las futuras ediciones conservan UTF-8 y no introducen texto Unicode mediante una tubería de PowerShell a Python.
