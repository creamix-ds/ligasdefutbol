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
 * Endpoints (POST, body JSON enviado como text/plain para evitar el preflight de CORS):
 *  {"accion":"suscribir","token_push":"...","liga_id":"L01","equipo_id":"E02"}
 *  {"accion":"admin_datos","token":"<ID token de Google>"}
 *  {"accion":"admin_lote","token":"...","ops":[{"op":"crear|editar|borrar|sumar", ...}]}
 *
 * El panel de administración necesita GOOGLE_CLIENT_ID (más abajo) y que la
 * implementación tenga permiso para conectarse a servicios externos (UrlFetchApp).
 */

const CACHE_SEGUNDOS = 60;

// ID de la planilla (lo que va entre /d/ y /edit en su URL).
const API_PLANILLA_ID = '17e2wXdLBrZNAt8c8uTA4kc9uURa43vDJlcqi9oD6GNI';

// Siempre abre la planilla por su ID, aunque el script esté vinculado a otra hoja.
function planilla_() {
  return SpreadsheetApp.openById(API_PLANILLA_ID);
}

function doGet(e) {
  const p = (e && e.parameter) || { r: 'posiciones', torneo: 'T01' };
  try {
    const version = PropertiesService.getScriptProperties().getProperty('version') || '0';
    const cacheKey = version + JSON.stringify(p);
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
    if (body.accion === 'admin_datos') return json_({ ok: true, data: adminDatos_(body) });
    if (body.accion === 'admin_lote') return json_({ ok: true, data: adminLote_(body) });
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

// ===================== PANEL DE ADMINISTRACIÓN =====================
//
// Ingreso con cuenta de Google: el sitio manda el ID token, acá se verifica con Google
// y se busca el email en la pestaña Usuarios (activo = SI).
//   rol dev        → puede editar todo.
//   rol admin_club → solo los datos de su club (club_id) y las noticias de su liga.
// Cada cambio queda anotado en la pestaña Registro.

// ID de cliente OAuth de Google. El mismo valor va en js/config.js (GOOGLE_CLIENT_ID).
const GOOGLE_CLIENT_ID = '1052940348586-oe5937rmtir144qe57spetjjlos8rjr4.apps.googleusercontent.com';

const TABLAS_ADMIN = {
  Ligas:     { pref: 'L',  dig: 2 },
  Clubes:    { pref: 'CL', dig: 2 },
  Equipos:   { pref: 'E',  dig: 2, formulas: { club: '=INDEX(Clubes!C:C,MATCH({club_id},Clubes!A:A,0))' } },
  Jugadores: { pref: 'J',  dig: 3, formulas: {
    club: '=INDEX(Equipos!D:D,MATCH({equipo_id},Equipos!A:A,0))',
    goles: '=COUNTIFS(Eventos!E:E,{id},Eventos!D:D,"Gol")' } },
  Torneos:   { pref: 'T',  dig: 2 },
  Partidos:  { pref: 'P',  dig: 3, formulas: {
    local: '=INDEX(Equipos!D:D,MATCH({local_id},Equipos!A:A,0))',
    visitante: '=INDEX(Equipos!D:D,MATCH({visitante_id},Equipos!A:A,0))',
    resultado: '=IF({estado}<>"Finalizado","",IF(AND(ISNUMBER({goles_local}),ISNUMBER({goles_visitante})),IF({goles_local}>{goles_visitante},"L",IF({goles_local}<{goles_visitante},"V","E")),{resultado_manual}))' } },
  Eventos:   { pref: 'EV', dig: 3 },
  Noticias:  { pref: 'N',  dig: 2 },
  Usuarios:  { pref: 'U',  dig: 2 }
};

// Campos que puede tocar un admin de club, por tabla.
const CAMPOS_CLUB = {
  Clubes: ['nombre', 'ciudad', 'escudo', 'web', 'contacto', 'cancha', 'direccion'],
  Jugadores: ['equipo_id', 'nombre', 'apellido', 'numero', 'posicion', 'foto', 'activo', 'observaciones'],
  Partidos: ['fecha_jugada', 'hora', 'cancha', 'goles_local', 'goles_visitante', 'resultado_manual', 'estado', 'observaciones'],
  Eventos: ['partido_id', 'minuto', 'tipo', 'jugador_id', 'equipo_id', 'observaciones'],
  Noticias: ['liga_id', 'fecha', 'titulo', 'resumen', 'fuente', 'url', 'imagen']
};

const REQUERIDOS = {
  Ligas: ['nombre', 'provincia'], Clubes: ['liga_id', 'nombre'], Equipos: ['club_id', 'categoria'],
  Jugadores: ['equipo_id', 'apellido'], Torneos: ['liga_id', 'nombre'],
  Partidos: ['torneo_id', 'local_id', 'visitante_id'], Eventos: ['partido_id', 'tipo', 'equipo_id'],
  Noticias: ['liga_id', 'titulo'], Usuarios: ['email', 'rol']
};

// Qué tablas apuntan a cada una (para no borrar algo que está en uso).
const REFERENCIAS = {
  Ligas: [['Clubes', 'liga_id'], ['Torneos', 'liga_id'], ['Noticias', 'liga_id']],
  Clubes: [['Equipos', 'club_id']],
  Equipos: [['Jugadores', 'equipo_id'], ['Partidos', 'local_id'], ['Partidos', 'visitante_id']],
  Jugadores: [['Eventos', 'jugador_id']],
  Torneos: [['Partidos', 'torneo_id']],
  Partidos: [['Eventos', 'partido_id']]
};

const VALORES = {
  rol: ['dev', 'admin_club'],
  estado_partido: ['Programado', 'En juego', 'Finalizado', 'Postergado'],
  tipo_evento: ['Gol', 'Gol en contra', 'Amarilla', 'Roja'],
  resultado_manual: ['', 'L', 'E', 'V'],
  si_no: ['SI', 'NO']
};

function adminDatos_(body) {
  const ctx = sesion_(body.token);
  return datosPara_(ctx);
}

function adminLote_(body) {
  const ctx = sesion_(body.token);
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length) throw new Error('No hay cambios para guardar.');
  if (ops.length > 40) throw new Error('Demasiados cambios juntos. Guardá de a partes.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const creados = [];
  try {
    ops.forEach(op => validarOp_(ctx, op, creados));
    ops.forEach(op => creados.push(aplicarOp_(ctx, op, creados)));
    PropertiesService.getScriptProperties().setProperty('version', String(Date.now()));
  } finally {
    lock.releaseLock();
  }
  const datos = datosPara_(sesion_(body.token));
  datos.creados = creados;
  return datos;
}

// ---------- sesión ----------

function sesion_(token) {
  if (!GOOGLE_CLIENT_ID) throw new Error('El panel no está configurado: falta GOOGLE_CLIENT_ID en Code.gs.');
  if (!token) throw new Error('Sesión vencida. Volvé a ingresar.');
  const info = verificarToken_(token);
  const filas = rows_('Usuarios').filter(u => String(u.email).toLowerCase().trim() === info.email && u.activo === 'SI');
  if (!filas.length) throw new Error('La cuenta ' + info.email + ' no tiene acceso al panel. Pedile al administrador que la agregue en la pestaña Usuarios.');
  const dev = filas.some(u => u.rol === 'dev');
  const clubes = dev ? [] : filas.filter(u => u.rol === 'admin_club' && u.club_id).map(u => String(u.club_id));
  const ligas = dev ? [] : filas.map(u => String(u.liga_id)).filter(Boolean);
  if (!dev && !clubes.length) throw new Error('Tu usuario no tiene un club asignado. Revisá la columna club_id en Usuarios.');
  const equipos = new Set(rows_('Equipos').filter(e => clubes.indexOf(String(e.club_id)) >= 0).map(e => String(e.id)));
  return {
    usuario: { email: info.email, nombre: filas[0].nombre || info.nombre, rol: dev ? 'dev' : 'admin_club', clubes: clubes, ligas: ligas },
    equipos: equipos
  };
}

function verificarToken_(token) {
  const cache = CacheService.getScriptCache();
  const clave = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const guardado = cache.get(clave);
  if (guardado) return JSON.parse(guardado);
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Sesión vencida. Volvé a ingresar.');
  const t = JSON.parse(res.getContentText());
  if (t.aud !== GOOGLE_CLIENT_ID) throw new Error('El ingreso no corresponde a este sitio.');
  if (String(t.email_verified) !== 'true') throw new Error('La cuenta de Google no tiene el email verificado.');
  const vence = Number(t.exp) * 1000;
  if (vence < Date.now()) throw new Error('Sesión vencida. Volvé a ingresar.');
  const info = { email: String(t.email).toLowerCase(), nombre: t.name || '' };
  cache.put(clave, JSON.stringify(info), Math.max(1, Math.min(900, Math.floor((vence - Date.now()) / 1000))));
  return info;
}

function datosPara_(ctx) {
  const u = ctx.usuario;
  const dev = u.rol === 'dev';
  const datos = {
    usuario: u,
    valores: VALORES,
    ligas: rows_('Ligas'),
    clubes: rows_('Clubes'),
    equipos: rows_('Equipos'),
    jugadores: rows_('Jugadores').filter(j => dev || j.activo === 'SI' || ctx.equipos.has(String(j.equipo_id))),
    torneos: rows_('Torneos'),
    partidos: rows_('Partidos'),
    eventos: rows_('Eventos'),
    noticias: rows_('Noticias')
  };
  if (dev) datos.usuarios = rows_('Usuarios');
  return datos;
}

// ---------- permisos ----------

function validarOp_(ctx, op, creados) {
  const tabla = op.tabla;
  if (!TABLAS_ADMIN[tabla]) throw new Error('Tabla desconocida: ' + tabla);
  if (['crear', 'editar', 'borrar', 'sumar'].indexOf(op.op) < 0) throw new Error('Operación desconocida: ' + op.op);
  const h = hoja_(tabla);
  let vieja = null;
  if (op.op !== 'crear') {
    const fila = buscarFila_(h, op.id);
    if (!fila) throw new Error('No se encontró ' + tabla + ' ' + op.id + '. Puede que otro usuario lo haya borrado.');
    vieja = filaObjeto_(h, fila);
  }
  let nueva = null;
  if (op.op === 'crear') nueva = resolverRefs_(op.fila || {}, creados);
  if (op.op === 'editar') nueva = Object.assign({}, vieja, resolverRefs_(op.cambios || {}, creados));
  if (op.op === 'sumar') {
    if (tabla !== 'Partidos' || ['goles_local', 'goles_visitante'].indexOf(op.campo) < 0) throw new Error('Solo se pueden sumar goles a un partido.');
  }
  const campos = op.op === 'crear' ? Object.keys(op.fila || {}) : op.op === 'editar' ? Object.keys(op.cambios || {}) : op.op === 'sumar' ? [op.campo] : [];
  permitir_(ctx, tabla, op.op, nueva, vieja, campos);
  if (nueva) validarValores_(tabla, nueva, op.op);
}

function permitir_(ctx, tabla, accion, nueva, vieja, campos) {
  const u = ctx.usuario;
  if (u.rol === 'dev') return;
  const mios = ctx.equipos;
  const no = m => { throw new Error(m); };
  const permitidos = CAMPOS_CLUB[tabla];
  if (!permitidos) no('No tenés permiso para modificar ' + tabla + '.');
  campos.forEach(c => { if (permitidos.indexOf(c) < 0 && !(tabla === 'Noticias' && c === 'autor_email')) no('No tenés permiso para modificar el campo ' + c + '.'); });
  const juegaMiClub = p => p && (mios.has(String(p.local_id)) || mios.has(String(p.visitante_id)));
  switch (tabla) {
    case 'Clubes':
      if (accion !== 'editar' || u.clubes.indexOf(String(vieja.id)) < 0) no('Solo podés editar los datos de tu club.');
      return;
    case 'Jugadores':
      if (accion === 'borrar') no('Para sacar a un jugador del plantel, marcalo como inactivo.');
      [vieja, nueva].forEach(f => { if (f && !mios.has(String(f.equipo_id))) no('Solo podés cargar jugadores de tu club.'); });
      return;
    case 'Partidos':
      if (accion === 'crear' || accion === 'borrar') no('El fixture lo carga la liga.');
      if (!juegaMiClub(vieja)) no('Solo podés cargar resultados de partidos de tu club.');
      return;
    case 'Eventos':
      [vieja, nueva].forEach(f => {
        if (!f) return;
        const p = filaPorId_('Partidos', f.partido_id);
        if (!juegaMiClub(p)) no('Solo podés cargar goles y tarjetas de partidos de tu club.');
      });
      return;
    case 'Noticias':
      if (nueva && u.ligas.indexOf(String(nueva.liga_id)) < 0) no('Solo podés publicar noticias de tu liga.');
      if (vieja && String(vieja.autor_email).toLowerCase() !== u.email) no('Solo podés modificar las noticias que publicaste vos.');
      return;
  }
  no('No tenés permiso para modificar ' + tabla + '.');
}

function validarValores_(tabla, f, accion) {
  const no = m => { throw new Error(m); };
  if (accion === 'crear') (REQUERIDOS[tabla] || []).forEach(c => { if (f[c] === '' || f[c] == null) no('Falta completar ' + c + '.'); });
  if (tabla === 'Partidos') {
    if (f.estado && VALORES.estado_partido.indexOf(f.estado) < 0) no('Estado de partido inválido.');
    if (f.local_id && f.local_id === f.visitante_id) no('Un equipo no puede jugar contra sí mismo.');
    ['goles_local', 'goles_visitante'].forEach(c => { if (f[c] !== '' && f[c] != null && !(Number(f[c]) >= 0)) no('Los goles tienen que ser un número desde 0.'); });
    if (f.resultado_manual && VALORES.resultado_manual.indexOf(f.resultado_manual) < 0) no('El resultado manual tiene que ser L, E o V.');
  }
  if (tabla === 'Eventos') {
    if (VALORES.tipo_evento.indexOf(f.tipo) < 0) no('Tipo de evento inválido.');
    const p = filaPorId_('Partidos', f.partido_id);
    if (!p) no('El partido no existe.');
    if (String(f.equipo_id) !== String(p.local_id) && String(f.equipo_id) !== String(p.visitante_id)) no('Ese equipo no juega ese partido.');
  }
  if (tabla === 'Usuarios') {
    if (VALORES.rol.indexOf(f.rol) < 0) no('El rol tiene que ser dev o admin_club.');
    if (f.rol === 'admin_club' && !f.club_id) no('Un admin de club necesita un club asignado.');
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email).trim())) no('El email no es válido.');
  }
  ['activo', 'activa'].forEach(c => { if (f[c] && VALORES.si_no.indexOf(f[c]) < 0) no('El campo ' + c + ' tiene que ser SI o NO.'); });
}

// ---------- aplicar cambios ----------

function aplicarOp_(ctx, op, creados) {
  const tabla = op.tabla;
  const h = hoja_(tabla);
  const formulas = (TABLAS_ADMIN[tabla].formulas) || {};
  const u = ctx.usuario;

  if (op.op === 'crear') {
    const fila = resolverRefs_(op.fila || {}, creados);
    const def = TABLAS_ADMIN[tabla];
    if (h.head.indexOf('id') >= 0) fila.id = siguienteId_(h, def.pref, def.dig);
    if (tabla === 'Noticias') { fila.autor_email = u.email; if (!fila.fecha) fila.fecha = hoy_(); }
    if (tabla === 'Jugadores' && !fila.activo) fila.activo = 'SI';
    if (tabla === 'Ligas' && !fila.activa) fila.activa = 'SI';
    if (tabla === 'Usuarios' && !fila.activo) fila.activo = 'SI';
    if (tabla === 'Partidos' && !fila.estado) fila.estado = 'Programado';
    if (tabla === 'Usuarios' && fila.email) fila.email = String(fila.email).toLowerCase().trim();
    const n = h.sh.getLastRow() + 1;
    const valores = h.head.map(c => formulas[c] ? '' : valorCelda_(fila[c]));
    h.sh.getRange(n, 1, 1, h.head.length).setValues([valores]);
    h.head.forEach((c, i) => { if (formulas[c]) h.sh.getRange(n, i + 1).setFormula(formula_(formulas[c], h.head, n)); });
    registrar_(u.email, 'crear', tabla, fila.id || fila.email, fila);
    if (tabla === 'Clubes' && op.crearEquipo !== false) {
      aplicarOp_(ctx, { op: 'crear', tabla: 'Equipos', fila: { club_id: fila.id, categoria: 'Primera' } }, creados);
    }
    return fila.id || '';
  }

  const n = buscarFila_(h, op.id);
  if (op.op === 'borrar') {
    (REFERENCIAS[tabla] || []).forEach(([t, c]) => {
      if (rows_(t).some(r => String(r[c]) === String(op.id))) throw new Error('No se puede borrar: está en uso en ' + t + '. Primero borrá o cambiá esos datos.');
    });
    h.sh.deleteRow(n);
    registrar_(u.email, 'borrar', tabla, op.id, {});
    return op.id;
  }

  if (op.op === 'sumar') {
    const col = h.head.indexOf(op.campo);
    const celda = h.sh.getRange(n, col + 1);
    const actual = Number(celda.getValue()) || 0;
    const nuevo = Math.max(0, actual + (Number(op.delta) || 0));
    celda.setValue(nuevo);
    registrar_(u.email, 'sumar', tabla, op.id, { campo: op.campo, valor: nuevo });
    return op.id;
  }

  // editar
  const cambios = resolverRefs_(op.cambios || {}, creados);
  Object.keys(cambios).forEach(c => {
    const col = h.head.indexOf(c);
    if (col < 0 || c === 'id' || formulas[c]) return;
    let v = cambios[c];
    if (tabla === 'Usuarios' && c === 'email') v = String(v || '').toLowerCase().trim();
    h.sh.getRange(n, col + 1).setValue(valorCelda_(v));
  });
  registrar_(u.email, 'editar', tabla, op.id, cambios);
  return op.id;
}

// ---------- utilidades del panel ----------

function hoja_(tabla) {
  const sh = planilla_().getSheetByName(tabla);
  if (!sh) throw new Error('No existe la pestaña ' + tabla);
  const values = sh.getDataRange().getValues();
  return { sh: sh, head: values[0].map(String), values: values };
}

function buscarFila_(h, id) {
  const col = h.head.indexOf('id');
  if (col < 0 || id === '' || id == null) return 0;
  for (let i = 1; i < h.values.length; i++) if (String(h.values[i][col]) === String(id)) return i + 1;
  return 0;
}

function filaObjeto_(h, n) {
  const tz = Session.getScriptTimeZone();
  const o = {};
  h.head.forEach((c, i) => { const v = h.values[n - 1][i]; o[c] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
  return o;
}

function filaPorId_(tabla, id) {
  const h = hoja_(tabla);
  const n = buscarFila_(h, id);
  return n ? filaObjeto_(h, n) : null;
}

function siguienteId_(h, pref, dig) {
  const col = h.head.indexOf('id');
  let max = 0;
  for (let i = 1; i < h.values.length; i++) {
    const m = String(h.values[i][col]).match(new RegExp('^' + pref + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return pref + String(max + 1).padStart(dig, '0');
}

function formula_(plantilla, head, fila) {
  return plantilla.replace(/\{(\w+)\}/g, (_, c) => columna_(head.indexOf(c) + 1) + fila);
}

function columna_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Los textos que empiezan con = + - @ se guardan como texto, no como fórmula.
function valorCelda_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  v = String(v).trim();
  if (/^-?\d+([.,]\d+)?$/.test(v)) return Number(v.replace(',', '.'));
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

// En un lote, "$0", "$1"... se reemplazan por el id creado en esa operación.
function resolverRefs_(obj, creados) {
  const o = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    const m = typeof v === 'string' && v.match(/^\$(\d+)$/);
    o[k] = m ? (creados[Number(m[1])] !== undefined ? creados[Number(m[1])] : '__pendiente__') : v;
  });
  return o;
}

function registrar_(email, accion, tabla, id, detalle) {
  let sh = planilla_().getSheetByName('Registro');
  if (!sh) { sh = planilla_().insertSheet('Registro'); sh.appendRow(['fecha', 'email', 'accion', 'tabla', 'id', 'detalle']); }
  sh.appendRow([new Date(), email, accion, tabla, id, JSON.stringify(detalle).slice(0, 500)]);
}

function hoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
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
