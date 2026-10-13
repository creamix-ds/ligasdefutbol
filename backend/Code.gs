/**
 * API de la plataforma de ligas amateur.
 *
 * Instalación:
 *  1. Abrí la planilla > Extensiones > Apps Script y pegá este archivo.
 *  2. Implementar > Nueva implementación > Aplicación web.
 *     Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario.
 *  3. Copiá la URL /exec. Esa es la base de la API para el sitio en GitHub Pages.
 *
 * Endpoints (GET):
 *  ?r=ligas
 *  ?r=clubes&liga=L01
 *  ?r=equipos&liga=L01
 *  ?r=jugadores&equipo=E02
 *  ?r=torneos&liga=L01
 *  ?r=partidos&torneo=T01            (opcional: &fecha=13, &equipo=E02, &estado=Finalizado)
 *  ?r=eventos&partido=P049
 *  ?r=noticias&liga=L01              (opcional: &limite=10)
 *  ?r=posiciones&torneo=T01
 *  ?r=goleadores&torneo=T01          (opcional: &limite=10)
 *
 * Endpoint (POST, body JSON enviado como text/plain para evitar el preflight de CORS):
 *  {"accion":"suscribir","token_push":"...","liga_id":"L01","equipo_id":"E02"}
 */

const CACHE_SEGUNDOS = 60;

// ID de la planilla (lo que va entre /d/ y /edit en su URL).
const API_PLANILLA_ID = '17e2wXdLBrZNAt8c8uTA4kc9uURa43vDJlcqi9oD6GNI';

function planilla_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(API_PLANILLA_ID);
}

function doGet(e) {
  const p = e.parameter || {};
  try {
    const cacheKey = JSON.stringify(p);
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return json_(JSON.parse(cached));

    const data = route_(p);
    const body = { ok: true, data: data };
    const text = JSON.stringify(body);
    if (text.length < 90000) cache.put(cacheKey, text, CACHE_SEGUNDOS);
    return json_(body);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.accion === 'suscribir') return json_({ ok: true, data: suscribir_(body) });
    throw new Error('Acción desconocida');
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function route_(p) {
  switch (p.r) {
    case 'ligas':
      return rows_('Ligas').filter(l => l.activa === 'SI');
    case 'clubes':
      return rows_('Clubes').filter(by_('liga_id', p.liga));
    case 'equipos': {
      const clubes = ids_(rows_('Clubes').filter(by_('liga_id', p.liga)));
      return rows_('Equipos').filter(eq => !p.liga || clubes.has(eq.club_id));
    }
    case 'jugadores':
      return rows_('Jugadores').filter(by_('equipo_id', p.equipo)).filter(j => j.activo === 'SI');
    case 'torneos':
      return rows_('Torneos').filter(by_('liga_id', p.liga));
    case 'partidos':
      return partidos_(p);
    case 'eventos':
      return rows_('Eventos').filter(by_('partido_id', p.partido));
    case 'noticias': {
      const n = rows_('Noticias').filter(by_('liga_id', p.liga))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      return p.limite ? n.slice(0, Number(p.limite)) : n;
    }
    case 'posiciones':
      return posiciones_(p.torneo);
    case 'goleadores':
      return goleadores_(p.torneo, p.limite);
    default:
      throw new Error('Recurso desconocido. Usá ?r=ligas, clubes, equipos, jugadores, torneos, partidos, eventos, noticias, posiciones o goleadores');
  }
}

function partidos_(p) {
  return rows_('Partidos')
    .filter(by_('torneo_id', p.torneo))
    .filter(m => !p.fecha || String(m.fecha_nro) === String(p.fecha))
    .filter(m => !p.estado || m.estado === p.estado)
    .filter(m => !p.equipo || m.local_id === p.equipo || m.visitante_id === p.equipo);
}

/** Tabla calculada en el servidor (no depende de la pestaña Posiciones). */
function posiciones_(torneo) {
  const nombres = {};
  rows_('Equipos').forEach(e => nombres[e.id] = e.club);
  const t = {};
  const fila = id => t[id] || (t[id] = { equipo_id: id, equipo: nombres[id] || id, PJ: 0, G: 0, E: 0, P: 0, GF: 0, GC: 0, DIF: 0, PTS: 0 });

  rows_('Partidos').filter(by_('torneo_id', torneo)).forEach(m => {
    const L = fila(m.local_id), V = fila(m.visitante_id);
    if (m.estado !== 'Finalizado') return;
    const res = resultado_(m);
    if (!res) return;
    L.PJ++; V.PJ++;
    if (num_(m.goles_local) && num_(m.goles_visitante)) {
      L.GF += m.goles_local; L.GC += m.goles_visitante;
      V.GF += m.goles_visitante; V.GC += m.goles_local;
    }
    if (res === 'L') { L.G++; V.P++; L.PTS += 3; }
    else if (res === 'V') { V.G++; L.P++; V.PTS += 3; }
    else { L.E++; V.E++; L.PTS++; V.PTS++; }
  });

  return Object.values(t)
    .map(r => (r.DIF = r.GF - r.GC, r))
    .sort((a, b) => b.PTS - a.PTS || b.DIF - a.DIF || b.GF - a.GF)
    .map((r, i) => (r.pos = i + 1, r));
}

function goleadores_(torneo, limite) {
  const partidos = ids_(rows_('Partidos').filter(by_('torneo_id', torneo)));
  const jug = {};
  rows_('Jugadores').forEach(j => jug[j.id] = j);
  const goles = {};
  rows_('Eventos')
    .filter(ev => ev.tipo === 'Gol' && (!torneo || partidos.has(ev.partido_id)))
    .forEach(ev => goles[ev.jugador_id] = (goles[ev.jugador_id] || 0) + 1);
  const lista = Object.keys(goles).map(id => ({
    jugador_id: id,
    jugador: jug[id] ? (jug[id].nombre + ' ' + jug[id].apellido) : id,
    club: jug[id] ? jug[id].club : '',
    goles: goles[id]
  })).sort((a, b) => b.goles - a.goles || a.jugador.localeCompare(b.jugador));
  return limite ? lista.slice(0, Number(limite)) : lista;
}

function suscribir_(b) {
  if (!b.token_push || !b.liga_id) throw new Error('Faltan token_push o liga_id');
  const sh = planilla_().getSheetByName('Suscripciones');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existentes = rows_('Suscripciones');
    const ya = existentes.find(s => s.token_push === b.token_push && s.equipo_id === (b.equipo_id || ''));
    if (ya) return { id: ya.id, nuevo: false };
    const id = 'S' + Utilities.getUuid().slice(0, 8);
    sh.appendRow([id, b.token_push, b.liga_id, b.equipo_id || '', new Date(), 'SI']);
    return { id: id, nuevo: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- utilidades ----------

/** Lee una pestaña como lista de objetos usando la fila 1 como nombres de campo. */
function rows_(nombre) {
  const sh = planilla_().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la pestaña ' + nombre);
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(String);
  const tz = Session.getScriptTimeZone();
  return values
    .filter(r => r[0] !== '' && r[0] !== null)
    .map(r => {
      const o = {};
      head.forEach((h, i) => {
        if (!h) return;
        const v = r[i];
        o[h] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v;
      });
      return o;
    });
}

function resultado_(m) {
  if (num_(m.goles_local) && num_(m.goles_visitante)) {
    return m.goles_local > m.goles_visitante ? 'L' : m.goles_local < m.goles_visitante ? 'V' : 'E';
  }
  return m.resultado_manual || '';
}

function by_(campo, valor) { return o => !valor || String(o[campo]) === String(valor); }
function ids_(lista) { return new Set(lista.map(o => o.id)); }
function num_(v) { return typeof v === 'number' && !isNaN(v); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Probá desde el editor: Ejecutar > test_ y mirá el registro. */
function test_() {
  Logger.log(JSON.stringify(posiciones_('T01').slice(0, 3)));
  Logger.log(JSON.stringify(goleadores_('T01', 5)));
}
