# Pruebas de Protección Civil

En esta carpeta hay dos cosas distintas. `unitarias.mjs` —lo que explica este documento— prueba
las funciones por dentro, en un segundo y sin abrir ningún navegador. Al lado está
`e2e-fotos.mjs`, que es otra cosa: abre el formulario en un Chrome de verdad con pantalla de
teléfono y lo usa como lo usaría una persona; ese trae sus propias instrucciones en la cabecera
del archivo.

Las unitarias sirven para una cosa muy concreta:
que los errores que ya nos pasaron una vez **no puedan volver a pasar sin que nos enteremos**.
Comprueban las tres piezas que tocan las fotos del formulario público. Primero, el **botón de
agregar foto**: que el tope de 10 se respete aunque la persona toque dos veces seguidas (esto
falló de verdad: entraban 11 fotos, y como la base solo acepta 10, el reporte entero rebotaba),
que las fotos de iPhone en formato HEIC se avisen con palabras claras, que una foto que no se
pudo subir nunca se dé por buena, y que el formulario jamás diga "enviado" si el servidor no
confirmó. Segundo, el **tablero de los funcionarios**: que solo se pinten enlaces de fotos de
nuestro propio depósito —un enlace de otro sitio metido ahí se ejecutaría dentro de la sesión
de quien lo abra—, que todo el texto que viene de la calle se escape antes de mostrarlo, y que
lo que se exporta a Excel no se abra como fórmula. Y tercero, el **worker de Cloudflare** que
guarda las fotos: que reconozca una imagen de verdad por sus primeros bytes (no por el nombre,
que se falsifica en dos segundos), que el nombre al azar con el que se guarda sirva después para
volver a verla, y que no le conteste a sitios ajenos.

Para correrlas no hay que instalar nada: ni npm, ni bibliotecas, ni nada. Solo Node:

```bash
cd C:/Users/carlo/Documents/protcivil
node pruebas/unitarias.mjs
```

Si todo está bien termina diciendo *"Pasaron las 187 pruebas"*. Si algo se rompió, lista una por
una las que fallaron, con lo que esperaba y lo que dio, y termina con error (código 1), por si
algún día se quiere enganchar a un automatismo. **Hay que correrlas cada vez que se toque
`reportar-riesgo.html`, `informes-resultados.html` o `worker-fotos/worker.js`.** Un detalle
importante de cómo están hechas: las páginas de este repositorio son HTML sueltos con el
JavaScript metido dentro, así que las pruebas **abren el archivo, le sacan el trozo de código de
verdad y ejecutan ese trozo**. No hay ni una sola copia pegada a mano, a propósito: una copia
seguiría pasando la prueba aunque el original se rompiera, o sea, mentiría. Por eso, si alguien
le cambia el nombre a una función o la mueve, las pruebas no fallan calladas: se paran de golpe
con un mensaje que dice qué no encontró y en qué archivo. Eso no es un fallo de las pruebas, es
un aviso de que hay que actualizarlas. Hay dos comprobaciones que se saltan solas si no encuentran
la carpeta `alcaldia-admin` al lado de esta (ahí viven las reglas de Firebase, y se compara que
el tablero filtre exactamente igual que ellas); cuando eso pasa lo dice con un `(omitida)`.

## Asistencia con GPS: la base de datos (`asistencia-base.mjs`)

La app de asistencia y su gestor web guardan todo en Supabase, esquema `protcivil`
(el archivo es `sql/asistencia.sql`). Esta prueba manda ese archivo y
`asistencia-base.sql` en **una sola transacción que siempre se deshace**: se instala todo,
se prueba haciéndose pasar por el teléfono, por el jefe y por un intruso, y al final la base
tira todo para atrás. No queda ni un dato de prueba en producción.

```bash
node pruebas/asistencia-base.mjs              # 80 pruebas
node pruebas/asistencia-base.mjs --mutantes   # además rompe cada candado y exige que se note
```

Hace falta el token de Supabase guardado en la bóveda de Windows (`supabase-alcaldia` /
`sbp_token`). **Hay que correrlas cada vez que se toque `sql/asistencia.sql`**, y volver a
aplicar ese archivo en Supabase después.
