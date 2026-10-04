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
