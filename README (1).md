<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ligas de Fútbol</title>
  <meta name="description" content="Posiciones, fixture, goleadores y noticias de las ligas regionales de fútbol amateur de Argentina.">
  <meta name="theme-color" content="#0F2240">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/estilos.css">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230F2240'/%3E%3Cpath d='M16 6l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V9z' fill='%2363B3ED'/%3E%3C/svg%3E">
</head>
<body>
  <a class="saltar" href="#contenido">Ir al contenido</a>

  <header class="cabeza">
    <div class="cabeza__barra contenedor">
      <a class="marca" href="#/">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l11 4v9.5C27 23 22.3 27.6 16 29.5 9.7 27.6 5 23 5 16.5V7z"/><path d="M16 9v15M10 15h12"/></svg>
        <span>Ligas de Fútbol</span>
      </a>
      <nav class="cabeza__nav" aria-label="Principal">
        <a href="#/" data-nav="inicio">Ligas</a>
        <a href="#/mi-equipo" data-nav="mi-equipo" id="nav-favorito">Mi equipo</a>
      </nav>
    </div>
    <div class="cinta" id="cinta" aria-label="Resultados de la última fecha"></div>
  </header>

  <main id="contenido" tabindex="-1">
    <p class="contenedor cargando">Cargando datos de la liga…</p>
  </main>

  <footer class="pie">
    <div class="contenedor pie__dentro">
      <p><strong>Ligas de Fútbol.</strong> Los datos los cargan las ligas y los clubes adheridos.</p>
      <p id="pie-origen"></p>
      <p><a href="#/admin">Acceso para ligas y clubes</a></p>
    </div>
  </footer>

  <div id="aviso" class="aviso" role="status" aria-live="polite" hidden></div>

  <script src="js/config.js"></script>
  <script src="js/mapa.js"></script>
  <script src="js/admin.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
