# Ligas de Fútbol

Sitio estático para ligas regionales de fútbol amateur de Argentina. Muestra un mapa con las ligas adheridas y, para cada liga, sus posiciones, fechas, goleadores, noticias y clubes. Cada visitante puede elegir su liga y su equipo y recibir avisos de sus partidos.

Los datos viven en una planilla de Google Sheets. Los admins de cada club los cargan desde AppSheet, y el sitio los lee a través de una API hecha con Apps Script.

Ejemplo cargado: Liga de Fútbol de Bolívar, Copa Centenario 2026, Primera división.

## Estructura

| Archivo | Qué es |
| --- | --- |
| `index.html` | Página única del sitio |
| `css/estilos.css` | Estilos |
| `js/config.js` | Configuración: URL de la API y frecuencia de los avisos |
| `js/app.js` | Rutas, cálculos (posiciones, goleadores) y avisos en vivo |
| `js/mapa.js` | Mapa interactivo de Argentina en SVG (sin servicios externos) |
| `data/argentina.json` | Límites provinciales simplificados, de Natural Earth (dominio público) |
| `data/snapshot.json` | Copia de los datos para cuando la API no está configurada |
| `backend/Code.gs` | API de Apps Script que lee la planilla |

## Publicar en GitHub Pages

1. Subí estos archivos a la rama `main` del repositorio.
2. En GitHub andá a Settings > Pages.
3. En "Build and deployment" elegí "Deploy from a branch", rama `main`, carpeta `/ (root)`, y guardá.
4. En uno o dos minutos el sitio queda en `https://creamix-ds.github.io/ligasdefutbol/`.

Para usar un dominio propio, cargalo en Settings > Pages > Custom domain y configurá el DNS como indica GitHub.

## Conectar la planilla (API)

1. Abrí la planilla y andá a Extensiones > Apps Script.
2. Pegá el contenido de `backend/Code.gs` en un archivo del proyecto. `API_PLANILLA_ID` ya tiene el ID de la planilla.
3. Implementar > Nueva implementación > Aplicación web. Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario.
4. Copiá la URL que termina en `/exec` y pegala en `API_URL` dentro de `js/config.js`.

Sin `API_URL`, el sitio usa `data/snapshot.json`.

La API responde, entre otros, a:
- `?r=posiciones&torneo=T01`
- `?r=partidos&torneo=T01&fecha=13`
- `?r=goleadores&torneo=T01`

## Avisos de partidos

Desde "Mi equipo", el visitante elige su liga y su equipo, y el navegador le pide permiso para mostrar avisos. Con la API configurada, el sitio revisa los partidos de ese equipo cada 60 segundos y avisa cuando:
- empieza el partido (el estado pasa a "En juego"),
- hay un gol,
- termina el partido.

Para que esto funcione, el admin del club tiene que cambiar el estado del partido a "En juego" y cargar los goles mientras se juega.

Por ahora los avisos llegan solo con el sitio abierto, aunque esté en otra pestaña. Para recibirlos con el sitio cerrado hay que integrar Firebase Cloud Messaging: un service worker en el sitio y un envío desde Apps Script cuando cambia un partido. Ese es el próximo paso.

## Datos

En la pestaña Partidos, el campo `estado` puede valer `Programado`, `En juego`, `Finalizado` o `Postergado`.

Cuando no se conoce el marcador, se carga el ganador en `resultado_manual` (`L`, `E` o `V`). Ese partido suma puntos, pero no goles.

Las fuentes de los datos del ejemplo están en la pestaña Fuentes de la planilla.

## Mapa

El mapa de la portada es propio: un SVG con las 24 jurisdicciones, incluidas las Islas Malvinas como parte de Tierra del Fuego. No depende de Google Maps ni de otros servicios.

Cada liga aparece donde indican sus columnas `lat` y `lng` de la pestaña Ligas. La provincia se pinta según la columna `provincia`, que tiene que coincidir con el nombre oficial, por ejemplo "Buenos Aires" o "Córdoba".

Para navegar el mapa:
- arrastrar mueve el mapa,
- los botones +, − y el doble clic acercan o alejan,
- Ctrl + rueda hace zoom,
- en celular se usa el gesto de pellizcar.
