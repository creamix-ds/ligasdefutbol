// Configuración del sitio.
//
// API_URL: la URL /exec de tu Apps Script implementado como aplicación web.
// Mientras esté vacía, el sitio usa la copia de datos de data/snapshot.json.
//
// Ejemplo: 'https://script.google.com/macros/s/AKfycb.../exec'
window.CONFIG = {
  API_URL: '',

  // Cada cuántos segundos se revisan los partidos en juego del equipo que seguís.
  REFRESCO_EN_VIVO_SEG: 60,

  // Contacto que aparece en el pie para ligas que quieren sumarse.
  CONTACTO: ''
};
