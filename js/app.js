/* Ligas de Fútbol: sitio estático que lee la planilla vía Apps Script
   (o data/snapshot.json mientras no haya API configurada). */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const $main = document.getElementById('contenido');
  const D = { ligas: [], clubes: [], equipos: [], jugadores: [], torneos: [], partidos: [], eventos: [], noticias: [] };
  let origen = '';
  let mapa = null;

  // ---------- utilidades ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlSegura = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const porId = (tabla, id) => D[tabla].find(x => x.id === id);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function fecha(iso, conDia) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso || '');
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return `${conDia === false ? '' : DIAS[d.getDay()] + ' '}${d.getDate()} ${MESES[d.getMonth()]}`;
  }
  function iniciales(nombre) {
    const palabras = String(nombre).split(/\s+/).filter(w => !/^(de|del|la|el|y)$/i.test(w));
    return (palabras.length > 1 ? palabras[0][0] + palabras[1][0] : String(nombre).slice(0, 2)).toUpperCase();
  }
  function aviso(texto) {
    const el = document.getElementById('aviso');
    el.textContent = texto; el.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { el.hidden = true; }, 4000);
  }
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const leer = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

  // ---------- datos ----------
  async function api(r, extra) {
    const u = new URL(CFG.API_URL);
    u.searchParams.set('r', r);
    Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u.toString());
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Error de la API');
    return j.data;
  }

  async function cargar() {
    if (CFG.API_URL) {
      try {
        const nombres = Object.keys(D);
        const tablas = await Promise.all(nombres.map(n => api(n)));
        nombres.forEach((n, i) => { D[n] = tablas[i]; });
        origen = 'Datos en vivo desde la planilla de la liga.';
        return normalizar();
      } catch (e) {
        console.warn('No se pudo leer la API, uso la copia local.', e);
      }
    }
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    const s = await res.json();
    Object.keys(D).forEach(n => { D[n] = s[n] || []; });
    origen = `Datos actualizados al ${fecha(s.generado, false)}.`;
    normalizar();
  }

  function normalizar() {
    D.partidos.forEach(p => {
      p.fecha_nro = num(p.fecha_nro);
      p.goles_local = num(p.goles_local);
      p.goles_visitante = num(p.goles_visitante);
    });
    D.ligas.forEach(l => { l.lat = num(l.lat); l.lng = num(l.lng); });
    // Dirección de cada liga en el sitio (#/liga/LigadeBolivar). Sale de la columna
    // "slug" de la pestaña Ligas o, si está vacía, del nombre sin tildes ni espacios.
    const usados = new Set();
    D.ligas.forEach(l => {
      let s = aSlug(l.slug || String(l.nombre || '').replace(/\s*(de\s+)?f[uú]tbol\b/i, '')) || l.id;
      if (usados.has(s.toLowerCase())) s = s + l.id;
      usados.add(s.toLowerCase());
      l.slug = s;
    });
    D.torneos.forEach(t => { t.temporada = String(t.temporada || '').replace(/^'/, ''); });
    document.getElementById('pie-origen').textContent = origen;
  }

  function aSlug(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '');
  }
  const ligaPorRuta = x => {
    const k = String(x || '').toLowerCase();
    return D.ligas.find(l => String(l.slug).toLowerCase() === k) || D.ligas.find(l => String(l.id).toLowerCase() === k) || null;
  };
  // Link a una liga: acepta el objeto o el id.
  const urlLiga = (l, resto) => {
    const liga = typeof l === 'object' ? l : porId('ligas', l);
    return '#/liga/' + encodeURIComponent(liga ? liga.slug : l) + (resto ? '/' + resto : '');
  };

  // ---------- modelo ----------
  const clubDeEquipo = eid => { const e = porId('equipos', eid); return e ? porId('clubes', e.club_id) : null; };
  const nombreEquipo = eid => { const c = clubDeEquipo(eid); return c ? c.nombre : eid; };
  const torneosDeLiga = lid => D.torneos.filter(t => t.liga_id === lid);
  // Torneo que se muestra de cada liga: el que eligió el visitante en esta visita o, si no,
  // el que tiene el último partido jugado (si empatan, el que está más abajo en la planilla).
  // Los torneos sin partidos cargados solo se muestran si la liga no tiene otro.
  const torneoElegido = {};
  // Fecha del último partido jugado; si todavía no se jugó ninguno, cuenta como muy vieja.
  const actividad = tid => partidosDe(tid).reduce((m, p) => {
    const f = p.estado === 'Finalizado' ? String(p.fecha_jugada || p.fecha_programada || '0') : '0';
    return f > m ? f : m;
  }, partidosDe(tid).length ? '0' : '');
  const torneosConPartidos = lid => torneosDeLiga(lid).filter(t => partidosDe(t.id).length);
  const torneoActual = lid => {
    const todos = torneosDeLiga(lid);
    const elegido = todos.find(t => t.id === torneoElegido[lid]);
    if (elegido) return elegido;
    let mejor = null;
    todos.forEach(t => { const a = actividad(t.id); if (a && (!mejor || a >= actividad(mejor.id))) mejor = t; });
    return mejor || todos[todos.length - 1];
  };
  const ligaDeEquipo = eid => { const c = clubDeEquipo(eid); return c ? c.liga_id : null; };
  const partidosDe = tid => D.partidos.filter(p => p.torneo_id === tid);
  const tieneMarcador = p => p.goles_local != null && p.goles_visitante != null;

  function resultado(p) {
    if (p.estado !== 'Finalizado') return '';
    if (tieneMarcador(p)) return p.goles_local > p.goles_visitante ? 'L' : p.goles_local < p.goles_visitante ? 'V' : 'E';
    return p.resultado_manual || '';
  }
  // G, E o P desde el punto de vista de un equipo
  function resultadoPara(p, eid) {
    const r = resultado(p);
    if (!r) return '';
    if (r === 'E') return 'E';
    return (r === 'L') === (p.local_id === eid) ? 'G' : 'P';
  }
  const ordenJugado = p => (p.fecha_jugada || p.fecha_programada || '') + String(p.fecha_nro).padStart(3, '0');

  function posiciones(tid) {
    const t = {};
    const fila = id => t[id] || (t[id] = { id, PJ: 0, G: 0, E: 0, P: 0, GF: 0, GC: 0, PTS: 0, forma: [] });
    const lista = partidosDe(tid).slice().sort((a, b) => ordenJugado(a).localeCompare(ordenJugado(b)));
    lista.forEach(p => {
      const L = fila(p.local_id), V = fila(p.visitante_id);
      const r = resultado(p);
      if (!r) return;
      L.PJ++; V.PJ++;
      if (tieneMarcador(p)) { L.GF += p.goles_local; L.GC += p.goles_visitante; V.GF += p.goles_visitante; V.GC += p.goles_local; }
      if (r === 'L') { L.G++; V.P++; L.PTS += 3; }
      else if (r === 'V') { V.G++; L.P++; V.PTS += 3; }
      else { L.E++; V.E++; L.PTS++; V.PTS++; }
      L.forma.push(resultadoPara(p, p.local_id)); V.forma.push(resultadoPara(p, p.visitante_id));
    });
    return Object.values(t)
      .map(r => Object.assign(r, { DIF: r.GF - r.GC, forma: r.forma.slice(-5) }))
      .sort((a, b) => b.PTS - a.PTS || b.DIF - a.DIF || b.GF - a.GF);
  }

  function goleadores(tid) {
    const ids = new Set(partidosDe(tid).map(p => p.id));
    const g = {};
    D.eventos.filter(e => e.tipo === 'Gol' && ids.has(e.partido_id)).forEach(e => { g[e.jugador_id] = (g[e.jugador_id] || 0) + 1; });
    return Object.entries(g).map(([jid, goles]) => ({ j: porId('jugadores', jid), goles }))
      .filter(x => x.j)
      .sort((a, b) => b.goles - a.goles || a.j.apellido.localeCompare(b.j.apellido));
  }
  const nombreJugador = j => j ? `${j.nombre || ''} ${j.apellido || ''}`.trim() : 'Sin identificar';

  function fechasDe(tid) {
    return [...new Set(partidosDe(tid).map(p => p.fecha_nro))].filter(n => n != null).sort((a, b) => a - b);
  }
  const fechaPendiente = tid => fechasDe(tid).find(f => partidosDe(tid).some(p => p.fecha_nro === f && p.estado !== 'Finalizado'));
  function ultimaJugada(tid) {
    // La fecha con el partido finalizado más reciente
    const fin = partidosDe(tid).filter(p => p.estado === 'Finalizado').sort((a, b) => ordenJugado(b).localeCompare(ordenJugado(a)));
    return fin.length ? fin[0].fecha_nro : null;
  }

  // ---------- favoritos ----------
  const favorito = () => leer('favorito') || {};
  function setFavorito(f) { guardar('favorito', f); actualizarNav(); dibujarCinta(); iniciarVivo(); }
  function actualizarNav() {
    const f = favorito();
    document.getElementById('nav-favorito').textContent = f.equipo ? nombreEquipo(f.equipo) : 'Mi equipo';
  }

  // ---------- componentes ----------
  const ESCUDO_PATH = 'M16 2l13 4.5v10.2C29 25 23.6 30.4 16 34 8.4 30.4 3 25 3 16.7V6.5z';
  function escudo(club, tam) {
    if (!club) return '';
    const img = urlSegura(club.escudo);
    const cls = `escudo${tam ? ' escudo--' + tam : ''}`;
    if (img) return `<span class="${cls}"><img src="${esc(img)}" alt=""></span>`;
    return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 32 36"><path d="${ESCUDO_PATH}"/></svg><span>${esc(iniciales(club.nombre))}</span></span>`;
  }
  const forma = lista => `<span class="forma" aria-label="Últimos resultados: ${lista.map(x => ({ G: 'ganó', E: 'empató', P: 'perdió' }[x])).join(', ')}">${lista.map(x => `<i class="${x}">${x}</i>`).join('')}</span>`;
  const linkClub = eid => { const c = clubDeEquipo(eid); return c ? `#/club/${esc(c.id)}` : '#/'; };

  function filaCompacta(p) {
    const fav = favorito();
    const r = resultado(p);
    const fila = (eid, goles, gano) => `<a class="compacto__equipo${gano ? ' gana' : ''}" href="${linkClub(eid)}">${escudo(clubDeEquipo(eid))}<span>${esc(nombreEquipo(eid))}</span></a><b>${goles == null ? '' : goles}</b>`;
    const estado = p.estado === 'En juego' ? '<span class="vivo">En juego</span>' : esc(p.estado);
    const esFav = fav.equipo && (fav.equipo === p.local_id || fav.equipo === p.visitante_id);
    return `<li class="partido partido--compacto${esFav ? ' es-favorito' : ''}">
      <div class="compacto__estado">${estado}, ${fecha(p.fecha_jugada || p.fecha_programada)}${p.hora ? `, ${esc(p.hora)}` : ''}</div>
      <div class="compacto__filas">${fila(p.local_id, p.goles_local, r === 'L')}${fila(p.visitante_id, p.goles_visitante, r === 'V')}</div></li>`;
  }

  function filaPartido(p, opciones) {
    if (opciones && opciones.compacto) return filaCompacta(p);
    const fav = favorito();
    const r = resultado(p);
    const vivo = p.estado === 'En juego';
    const lado = (eid, esLocal) => {
      const pierde = (r === 'L' && !esLocal) || (r === 'V' && esLocal);
      const club = clubDeEquipo(eid);
      const nombre = `<span>${esc(nombreEquipo(eid))}</span>`;
      return `<a class="lado ${esLocal ? 'lado--local' : ''} ${pierde ? 'pierde' : ''}" href="${linkClub(eid)}">${esLocal ? nombre + escudo(club) : escudo(club) + nombre}</a>`;
    };
    let marcador;
    if (tieneMarcador(p)) marcador = `<div class="marcador${vivo ? ' marcador--vivo' : ''}" aria-label="Resultado">${p.goles_local}<span aria-hidden="true">-</span>${p.goles_visitante}</div>`;
    else if (p.estado === 'Finalizado' && r) marcador = `<div class="marcador marcador--nada" title="Marcador sin publicar">–</div>`;
    else marcador = `<div class="marcador marcador--nada">${p.hora ? esc(p.hora) : 'vs'}</div>`;
    const estado = vivo ? '<b class="vivo">En juego</b>'
      : p.estado === 'Finalizado' ? '<b>Final</b>' : p.estado === 'Postergado' ? '<b>Postergado</b>' : '<b>Programado</b>';
    const cuando = fecha(p.fecha_jugada || p.fecha_programada);

    // goles agrupados por jugador y asignados al equipo que los suma
    const grupos = [];
    D.eventos.filter(e => e.partido_id === p.id && (e.tipo === 'Gol' || e.tipo === 'Gol en contra')).forEach(e => {
      const k = (e.jugador_id || 'sin-' + e.equipo_id) + e.tipo;
      const g = grupos.find(x => x.k === k);
      if (g) { g.n++; if (e.minuto) g.min.push(e.minuto); }
      else grupos.push({ k, j: porId('jugadores', e.jugador_id), eq: e.equipo_id || (porId('jugadores', e.jugador_id) || {}).equipo_id, contra: e.tipo === 'Gol en contra', n: 1, min: e.minuto ? [e.minuto] : [] });
    });
    const paraLocal = g => g.contra ? g.eq !== p.local_id : g.eq === p.local_id;
    const li = g => `<li>${esc(nombreJugador(g.j))}${g.n > 1 ? ` (${g.n})` : ''}${g.contra ? ', en contra' : ''}${g.min.length ? ` ${g.min.map(m => esc(m) + "'").join(', ')}` : ''}</li>`;
    const gl = grupos.filter(paraLocal).map(li).join(''), gv = grupos.filter(g => !paraLocal(g)).map(li).join('');
    const notas = [];
    if (p.estado === 'Finalizado' && !tieneMarcador(p) && r) notas.push(`Ganó ${esc(nombreEquipo(r === 'L' ? p.local_id : p.visitante_id))}; el marcador no se publicó.`);
    if (p.cancha) notas.push(esc(p.cancha));
    const fuente = !(opciones && opciones.sinFuente) ? urlSegura(p.fuente) : '';
    const esFav = fav.equipo && (fav.equipo === p.local_id || fav.equipo === p.visitante_id);
    return `<li class="partido${esFav ? ' es-favorito' : ''}">
      <div class="partido__fila">
        <div class="partido__estado">${estado}<span>${opciones && opciones.conFecha ? `Fecha ${p.fecha_nro}, ` : ''}${cuando}</span>${fuente ? `<a href="${esc(fuente)}" target="_blank" rel="noopener">Crónica</a>` : ''}</div>
        ${lado(p.local_id, true)}${marcador}${lado(p.visitante_id, false)}
      </div>
      ${(gl || gv) ? `<div class="partido__goles"><ul aria-label="Goles de ${esc(nombreEquipo(p.local_id))}">${gl}</ul><ul aria-label="Goles de ${esc(nombreEquipo(p.visitante_id))}">${gv}</ul></div>` : ''}
      ${notas.length ? `<div class="partido__pie">${notas.join(' ')}</div>` : ''}
    </li>`;
  }

  function tablaPosiciones(t, opciones) {
    const compacta = opciones && opciones.compacta;
    const zonas = (CFG.ZONAS || {})[t.id] || { semis: 2, cuartos: 6 };
    const fav = favorito();
    let filas = posiciones(t.id);
    if (compacta) filas = filas.slice(0, opciones.limite || 4);
    return `<table class="tabla${compacta ? ' mini-tabla' : ''}">
      <caption class="saltar">Tabla de posiciones de ${esc(t.nombre)}</caption>
      <thead><tr><th scope="col">#</th><th scope="col" class="c-equipo">Equipo</th>
        ${compacta ? '' : '<th scope="col" title="Partidos jugados">PJ</th><th scope="col" title="Ganados">G</th><th scope="col" title="Empatados">E</th><th scope="col" title="Perdidos">P</th><th scope="col" class="ocultar-movil" title="Goles a favor">GF</th><th scope="col" class="ocultar-movil" title="Goles en contra">GC</th>'}
        <th scope="col" title="Diferencia de gol">Dif</th><th scope="col" title="Puntos">Pts</th>
        ${compacta ? '' : '<th scope="col" class="ocultar-movil">Últimos 5</th>'}</tr></thead>
      <tbody>${filas.map((r, i) => {
        const cls = [i < zonas.semis ? 'zona-semi' : i < zonas.cuartos ? 'zona-cuartos' : '', fav.equipo === r.id ? 'es-favorito' : ''].join(' ').trim();
        return `<tr class="${cls}"><td class="c-pos">${i + 1}</td>
          <td class="c-equipo"><a class="equipo-celda" href="${linkClub(r.id)}">${escudo(clubDeEquipo(r.id))}<span>${esc(nombreEquipo(r.id))}</span></a></td>
          ${compacta ? '' : `<td>${r.PJ}</td><td>${r.G}</td><td>${r.E}</td><td>${r.P}</td><td class="ocultar-movil">${r.GF}</td><td class="ocultar-movil">${r.GC}</td>`}
          <td class="c-dif">${r.DIF > 0 ? '+' : ''}${r.DIF}</td><td class="c-pts">${r.PTS}</td>
          ${compacta ? '' : `<td class="ocultar-movil">${forma(r.forma)}</td>`}</tr>`;
      }).join('')}</tbody></table>`;
  }

  function listaGoleadores(t, limite, compacto) {
    let lista = goleadores(t.id);
    if (!lista.length) return '<p class="vacio">Todavía no hay goles cargados.</p>';
    const max = lista[0].goles;
    let puesto = 0, ant = null;
    lista = lista.map((x, i) => { if (x.goles !== ant) { puesto = i + 1; ant = x.goles; } return Object.assign({ puesto }, x); });
    if (limite) lista = lista.slice(0, limite);
    return `<ol class="goleadores${compacto ? ' goleadores--compacto' : ''}">${lista.map(x => {
      const club = clubDeEquipo(x.j.equipo_id);
      return `<li><span class="num">${x.puesto}</span>
        <span class="quien"><b>${esc(nombreJugador(x.j))}</b><small>${esc(club ? club.nombre : '')}</small></span>
        <span class="barra" aria-hidden="true"><i style="width:${Math.round(x.goles / max * 100)}%"></i></span>
        <span class="goles">${x.goles}</span></li>`;
    }).join('')}</ol>`;
  }

  // ---------- cinta de resultados ----------
  function dibujarCinta() {
    const $c = document.getElementById('cinta');
    const f = favorito();
    const liga = porId('ligas', f.liga) || D.ligas[0];
    const t = liga && torneoActual(liga.id);
    if (!t) { $c.innerHTML = ''; return; }
    const n = ultimaJugada(t.id);
    const partidos = partidosDe(t.id).filter(p => p.fecha_nro === n && p.estado === 'Finalizado');
    if (!partidos.length) { $c.innerHTML = ''; return; }
    $c.innerHTML = `<div class="cinta__dentro"><span class="cinta__titulo">${esc(liga.ciudad || liga.nombre)}, fecha ${n}</span>${partidos.map(p => {
      const r = resultado(p);
      const fila = (eid, goles, gano) => `<span class="${gano ? 'gana' : r && r !== 'E' ? 'pierde' : ''}">${esc(nombreEquipo(eid))}</span><b>${goles == null ? (gano ? 'G' : r === 'E' ? 'E' : '') : goles}</b>`;
      return `<a class="cinta__item" href="${urlLiga(liga, 'fechas/' + n)}">${fila(p.local_id, p.goles_local, r === 'L')}${fila(p.visitante_id, p.goles_visitante, r === 'V')}</a>`;
    }).join('')}</div>`;
  }

  // ---------- vistas ----------
  function vistaInicio() {
    const fav = favorito();
    $main.innerHTML = `
      <section class="portada">
        <div class="contenedor portada__grilla">
          <div>
            <h1>El fútbol de las ligas regionales</h1>
            <p>Tablas, fixture, goleadores y noticias de cada liga amateur del país, cargados por los propios clubes.</p>
            <div class="acciones">
              ${D.ligas[0] ? `<a class="boton boton--primario" href="${urlLiga(porId('ligas', fav.liga) || D.ligas[0])}">Ver ${esc((porId('ligas', fav.liga) || D.ligas[0]).nombre)}</a>` : ''}
              <a class="boton boton--claro" href="#/mi-equipo">Seguir a mi equipo</a>
            </div>
          </div>
          <div id="mapa" class="mapa" role="region" aria-label="Mapa de ligas adheridas"></div>
        </div>
      </section>
      <div class="contenedor pagina">
        <div class="grilla">
          <div>${D.ligas.map(l => {
            const t = torneoActual(l.id);
            const n = t && ultimaJugada(t.id);
            const ultimos = t ? partidosDe(t.id).filter(p => p.fecha_nro === n && p.estado === 'Finalizado') : [];
            return `<section class="panel liga-resumen">
              <div class="panel__cabeza"><div class="liga-resumen__titulo">${escudo({ nombre: l.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''), escudo: l.logo }, 'm')}
                <div><h2>${esc(l.nombre)}</h2><p>${esc(l.ciudad)}, ${esc(l.provincia)}${t ? `. ${esc(t.nombre)}` : ''}</p></div></div>
                <a href="${urlLiga(l)}">Ver liga</a></div>
              ${t ? tablaPosiciones(t, { compacta: true, limite: 4 }) : '<p class="vacio">Sin torneo cargado.</p>'}
              ${ultimos.length ? `<div class="panel__cabeza" style="border-top:1px solid var(--linea)"><h3>Fecha ${n}</h3><a href="${urlLiga(l, 'fechas/' + n)}">Todas las fechas</a></div>
                <ul class="partidos">${ultimos.map(p => filaPartido(p, { sinFuente: true })).join('')}</ul>` : ''}
            </section>`;
          }).join('')}</div>
          <aside>${noticiasMini(null, 5)}</aside>
        </div>
      </div>`;
    dibujarMapa();
  }

  let geoArgentina = null;
  async function dibujarMapa() {
    const el = document.getElementById('mapa');
    try {
      if (!geoArgentina) geoArgentina = await (await fetch('data/argentina.json')).json();
    } catch (e) { el.innerHTML = '<p class="vacio">No se pudo cargar el mapa.</p>'; return; }
    if (!document.body.contains(el)) return;
    const fav = favorito();
    mapa = window.MapaArgentina.crear(el, {
      geo: geoArgentina,
      ligas: D.ligas,
      favorita: fav.liga,
      resumenLiga: l => {
        const t = torneoActual(l.id);
        const clubes = D.clubes.filter(c => c.liga_id === l.id).length;
        const lider = t && posiciones(t.id)[0];
        return `<dl class="mapa-ar__datos"><div><dt>Clubes</dt><dd>${clubes}</dd></div>${t ? `<div><dt>Torneo</dt><dd>${esc(t.nombre)}</dd></div>` : ''}${lider ? `<div><dt>Puntero</dt><dd>${esc(nombreEquipo(lider.id))}, ${lider.PTS} pts</dd></div>` : ''}</dl>`;
      }
    });
  }

  const SECCIONES = [['posiciones', 'Tabla'], ['fechas', 'Fixture'], ['goleadores', 'Goleadores'], ['noticias', 'Noticias'], ['clubes', 'Clubes']];

  function vistaLiga(lid, seccion, extra) {
    const liga = porId('ligas', lid);
    if (!liga) return vistaNoEncontrada('Esa liga no existe o ya no está adherida.');
    const t = torneoActual(lid);
    seccion = SECCIONES.some(s => s[0] === seccion) ? seccion : 'posiciones';
    const fav = favorito();
    const esFav = fav.liga === lid;
    const hayVivo = t && partidosDe(t.id).some(p => p.estado === 'En juego');
    $main.innerHTML = `
      <section class="banda"><div class="contenedor">
        <div class="banda__fila">
          <div class="banda__id">${escudo({ nombre: liga.nombre.replace(/^Liga (de Fútbol )?(de )?/, ''), escudo: liga.logo }, 'l')}
            <div><h1>${esc(liga.nombre)}</h1>
              <p>${t ? `${esc(t.nombre)}, ${esc(t.categoria)} ${esc(t.temporada)}` : 'Sin torneo cargado'}</p>
              <div class="chips">${hayVivo ? '<span class="chip chip--vivo">Partidos en juego</span>' : ''}${t && t.estado ? `<span class="chip">${esc(t.estado)}</span>` : ''}<span class="chip">${D.clubes.filter(c => c.liga_id === lid).length} clubes</span></div>
            </div></div>
          <div class="acciones">
            <button class="boton boton--claro" id="btn-liga-fav" aria-pressed="${esFav}">${esFav ? 'Es tu liga' : 'Elegir como mi liga'}</button>
            <a class="boton boton--primario" href="#/mi-equipo">Seguir a mi equipo</a>
          </div>
        </div>
        ${torneosConPartidos(lid).length > 1 ? `<div class="chips torneos" role="group" aria-label="Elegir torneo">${torneosConPartidos(lid).map(x => `<button class="chip${t && x.id === t.id ? ' chip--activo' : ''}" data-torneo="${esc(x.id)}" aria-pressed="${t && x.id === t.id}">${esc(x.nombre)}</button>`).join('')}</div>` : ''}
        <nav class="pestanas" aria-label="Secciones de la liga">
          ${SECCIONES.map(([k, n]) => `<a href="${urlLiga(liga, k)}" ${k === seccion ? 'aria-current="page"' : ''}>${n}</a>`).join('')}
        </nav>
      </div></section>
      <div class="contenedor pagina" id="seccion"></div>`;
    document.getElementById('btn-liga-fav').addEventListener('click', () => {
      if (favorito().liga === lid) { setFavorito({}); aviso('Quitaste esta liga de tus favoritas.'); }
      else { setFavorito({ liga: lid }); aviso('Guardamos esta liga como tu favorita.'); }
      vistaLiga(lid, seccion, extra);
    });
    $main.querySelectorAll('[data-torneo]').forEach(b => b.addEventListener('click', () => {
      torneoElegido[lid] = b.dataset.torneo;
      vistaLiga(lid, seccion === 'fechas' ? 'fechas' : seccion);
    }));
    const $s = document.getElementById('seccion');
    if (!t && seccion !== 'noticias' && seccion !== 'clubes') { $s.innerHTML = '<p class="vacio">Esta liga todavía no cargó su torneo.</p>'; return; }
    ({ posiciones: secTabla, fechas: secFixture, goleadores: secGoleadores, noticias: secNoticias, clubes: secClubes }[seccion])($s, liga, t, extra);
  }

  function secTabla($s, liga, t) {
    const pend = fechaPendiente(t.id);
    const proximos = pend != null ? partidosDe(t.id).filter(p => p.fecha_nro === pend && p.estado !== 'Finalizado') : [];
    const sinMarcador = partidosDe(t.id).some(p => p.estado === 'Finalizado' && !tieneMarcador(p));
    $s.innerHTML = `<div class="grilla">
      <div>
        <section class="panel">
          <div class="panel__cabeza"><h2>Tabla de posiciones</h2></div>
          <div style="overflow-x:auto">${tablaPosiciones(t)}</div>
          <div class="referencias"><span class="ref-semi">Semifinales directas</span><span class="ref-cuartos">Cuartos de final</span></div>
        </section>
        ${t.formato ? `<p class="nota" style="margin-left:0">${esc(t.formato)}${sinMarcador ? ' Los partidos sin marcador publicado suman puntos pero no goles.' : ''}</p>` : ''}
      </div>
      <aside>
        ${proximos.length ? `<section class="panel"><div class="panel__cabeza"><h2>Fecha ${pend}</h2><a href="${urlLiga(liga, 'fechas/' + pend)}">Ver fecha</a></div>
          <ul class="partidos">${proximos.map(p => filaPartido(p, { compacto: true })).join('')}</ul></section>` : ''}
        <section class="panel"><div class="panel__cabeza"><h2>Goleadores</h2><a href="${urlLiga(liga, 'goleadores')}">Ver todos</a></div>
          ${listaGoleadores(t, 5, true)}</section>
        ${noticiasMini(liga.id, 3)}
      </aside></div>`;
  }

  function secFixture($s, liga, t, extra) {
    const fechas = fechasDe(t.id);
    if (!fechas.length) { $s.innerHTML = '<p class="vacio">Todavía no hay fixture cargado.</p>'; return; }
    let n = num(extra);
    if (n == null || !fechas.includes(n)) { const pend = fechaPendiente(t.id); n = pend != null ? pend : fechas[fechas.length - 1]; }
    const partidos = partidosDe(t.id).filter(p => p.fecha_nro === n);
    const pendientes = new Set(fechas.filter(f => partidosDe(t.id).some(p => p.fecha_nro === f && p.estado !== 'Finalizado')));
    $s.innerHTML = `<section class="panel panel--fixture">
      <div class="panel__cabeza"><h2>Fecha ${n}</h2><span style="color:var(--tinta-2);font-size:.88rem">Programada para el ${fecha(partidos[0] && partidos[0].fecha_programada)}</span></div>
      <nav class="fechas" aria-label="Elegir fecha">${fechas.map(f => `<a href="${urlLiga(liga, 'fechas/' + f)}" class="${pendientes.has(f) ? 'pendiente' : ''}" ${f === n ? 'aria-current="page"' : ''} title="${pendientes.has(f) ? 'Fecha con partidos pendientes' : 'Fecha jugada'}">F${f}</a>`).join('')}</nav>
      <ul class="partidos">${partidos.map(p => filaPartido(p)).join('')}</ul>
    </section>`;
    const actual = $s.querySelector('.fechas [aria-current]');
    if (actual) actual.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function secGoleadores($s, liga, t) {
    $s.innerHTML = `<section class="panel" style="max-width:760px">
      <div class="panel__cabeza"><h2>Goleadores</h2></div>
      ${listaGoleadores(t)}
      <p class="nota">Cuenta los goles con autor publicado en las crónicas. Los goles en contra no suman al jugador.</p>
    </section>`;
  }

  function noticiasMini(lid, cuantas) {
    const n = D.noticias.filter(x => !lid || x.liga_id === lid).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, cuantas);
    if (!n.length) return '';
    return `<section class="panel"><div class="panel__cabeza"><h2>Noticias</h2>${lid ? `<a href="${urlLiga(lid, 'noticias')}">Ver todas</a>` : ''}</div>
      <ul class="partidos">${n.map(x => `<li class="partido" style="padding:12px 16px"><div class="noticia-mini"><small style="color:var(--tinta-3)">${fecha(x.fecha)}</small>
        <h3 style="margin-top:2px"><a href="${urlLiga(x.liga_id, 'noticias')}" style="color:inherit;text-decoration:none">${esc(x.titulo)}</a></h3></div></li>`).join('')}</ul></section>`;
  }

  function secNoticias($s, liga) {
    const n = D.noticias.filter(x => x.liga_id === liga.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    if (!n.length) { $s.innerHTML = '<p class="vacio">Esta liga todavía no publicó noticias.</p>'; return; }
    $s.innerHTML = `<div class="noticias">${n.map(x => `
      <article class="noticia">
        <div class="meta"><time datetime="${esc(x.fecha)}">${fecha(x.fecha)}</time>${x.fuente ? `, ${esc(x.fuente)}` : ''}</div>
        <h3>${esc(x.titulo)}</h3>
        <p>${esc(x.resumen)}</p>
        ${urlSegura(x.url) ? `<a href="${esc(urlSegura(x.url))}" target="_blank" rel="noopener">Leer la nota completa</a>` : ''}
      </article>`).join('')}</div>`;
  }

  function secClubes($s, liga, t) {
    const tabla = t ? posiciones(t.id) : [];
    const c = D.clubes.filter(x => x.liga_id === liga.id).sort((a, b) => a.nombre.localeCompare(b.nombre));
    $s.innerHTML = `<div class="clubes">${c.map(club => {
      const eq = D.equipos.find(e => e.club_id === club.id);
      const i = eq ? tabla.findIndex(r => r.id === eq.id) : -1;
      return `<a class="club-ficha" href="#/club/${esc(club.id)}">${escudo(club, 'm')}
        <span><h3>${esc(club.nombre)}</h3><p>${esc(club.ciudad)}${i >= 0 ? `. ${i + 1}° con ${tabla[i].PTS} puntos` : ''}</p></span></a>`;
    }).join('')}</div>`;
  }

  function vistaClub(cid) {
    const club = porId('clubes', cid);
    if (!club) return vistaNoEncontrada('Ese club no existe.');
    const liga = porId('ligas', club.liga_id);
    const equipos = D.equipos.filter(e => e.club_id === cid);
    const eids = new Set(equipos.map(e => e.id));
    const principal = equipos[0];
    const t = liga ? torneoActual(liga.id) : null;
    const fav = favorito();
    const esFav = principal && fav.equipo === principal.id;
    const tabla = t ? posiciones(t.id) : [];
    const pos = principal ? tabla.findIndex(r => r.id === principal.id) : -1;
    const fila = pos >= 0 ? tabla[pos] : null;

    const golesDe = {};
    D.eventos.filter(e => e.tipo === 'Gol').forEach(e => { golesDe[e.jugador_id] = (golesDe[e.jugador_id] || 0) + 1; });
    const plantel = D.jugadores.filter(j => eids.has(j.equipo_id))
      .sort((a, b) => (golesDe[b.id] || 0) - (golesDe[a.id] || 0) || a.apellido.localeCompare(b.apellido));
    const partidos = D.partidos.filter(p => eids.has(p.local_id) || eids.has(p.visitante_id)).sort((a, b) => a.fecha_nro - b.fecha_nro);

    const web = urlSegura(club.web);
    const contacto = String(club.contacto || '').trim();
    const contactoHtml = urlSegura(contacto) ? `<a href="${esc(contacto)}" target="_blank" rel="noopener">${esc(contacto.replace(/^https?:\/\//, ''))}</a>`
      : /@/.test(contacto) ? `<a href="mailto:${esc(contacto)}">${esc(contacto)}</a>` : esc(contacto);
    const sinDato = '<span class="sin-dato">El club todavía no lo cargó</span>';

    $main.innerHTML = `
      <section class="banda"><div class="contenedor">
        <div class="banda__fila">
          <div class="banda__id">${escudo(club, 'l')}
            <div><h1>${esc(club.nombre)}</h1>
              <p>${esc(club.ciudad)}${liga ? `. <a href="${urlLiga(liga)}">${esc(liga.nombre)}</a>` : ''}</p></div></div>
          ${principal ? `<div class="acciones"><button class="boton ${esFav ? '' : 'boton--primario'}" id="btn-equipo-fav" aria-pressed="${esFav}">${esFav ? 'Siguiendo' : 'Seguir a este equipo'}</button></div>` : ''}
        </div>
        ${fila ? `<div class="stats">
          <div class="stat"><b>${pos + 1}°</b><small>Posición</small></div>
          <div class="stat"><b>${fila.PTS}</b><small>Puntos</small></div>
          <div class="stat"><b>${fila.G}-${fila.E}-${fila.P}</b><small>Ganados, empatados, perdidos</small></div>
          <div class="stat"><b>${fila.GF}:${fila.GC}</b><small>Goles a favor y en contra</small></div>
          <div class="stat"><b style="padding-top:6px">${forma(fila.forma)}</b><small>Últimos 5</small></div>
        </div>` : '<div style="height:24px"></div>'}
      </div></section>
      <div class="contenedor pagina"><div class="grilla">
        <section class="panel">
          <div class="panel__cabeza"><h2>Partidos</h2>${t ? `<span style="color:var(--tinta-2);font-size:.88rem">${esc(t.nombre)}</span>` : ''}</div>
          ${partidos.length ? `<ul class="partidos">${partidos.map(p => filaPartido(p, { conFecha: true, sinFuente: true })).join('')}</ul>` : '<p class="vacio">Sin partidos cargados.</p>'}
        </section>
        <aside>
          <section class="panel datos"><div class="panel__cabeza"><h2>El club</h2></div><div class="panel__cuerpo"><dl>
            <dt>Cancha</dt><dd>${club.cancha ? esc(club.cancha) + (club.direccion ? `, ${esc(club.direccion)}` : '') : sinDato}</dd>
            <dt>Sitio web</dt><dd>${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">${esc(web.replace(/^https?:\/\//, ''))}</a>` : sinDato}</dd>
            <dt>Contacto</dt><dd>${contactoHtml || sinDato}</dd>
          </dl></div></section>
          <section class="panel"><div class="panel__cabeza"><h2>Plantel</h2><span style="color:var(--tinta-2);font-size:.88rem">${plantel.length} jugadores</span></div>
            ${plantel.length ? `<ul class="plantel">${plantel.map(j => `<li><span style="color:var(--tinta)">${j.numero ? `<b>${esc(j.numero)}</b> ` : ''}${esc(nombreJugador(j))}</span>
              <span>${golesDe[j.id] ? `${golesDe[j.id]} ${golesDe[j.id] === 1 ? 'gol' : 'goles'}` : esc(j.posicion || '')}</span></li>`).join('')}</ul>
              <p class="nota">Por ahora figuran los jugadores con goles publicados. El plantel oficial lo carga el club.</p>`
              : '<p class="vacio">El club todavía no cargó su plantel.</p>'}
          </section>
        </aside>
      </div></div>`;
    const b = document.getElementById('btn-equipo-fav');
    if (b) b.addEventListener('click', () => {
      if (esFav) { setFavorito({ liga: club.liga_id }); aviso(`Dejaste de seguir a ${club.nombre}.`); }
      else { setFavorito({ liga: club.liga_id, equipo: principal.id }); aviso(`Ahora seguís a ${club.nombre}.`); pedirPermisoAvisos(); }
      vistaClub(cid);
    });
  }

  function vistaMiEquipo() {
    const fav = favorito();
    const ligaSel = fav.liga || (D.ligas[0] && D.ligas[0].id) || '';
    const opcionesEquipos = lid => D.equipos.filter(e => ligaDeEquipo(e.id) === lid)
      .map(e => ({ id: e.id, n: `${nombreEquipo(e.id)}${e.categoria && e.categoria !== 'Primera' ? ` (${e.categoria})` : ''}` }))
      .sort((a, b) => a.n.localeCompare(b.n));
    const permiso = ('Notification' in window) ? Notification.permission : 'no-soportado';
    $main.innerHTML = `
      <section class="banda"><div class="contenedor" style="padding-bottom:28px">
        <h1>Mi equipo</h1>
        <p>Elegí tu liga y tu equipo. Te avisamos cuando empieza el partido, en cada gol y al final.</p>
      </div></section>
      <div class="contenedor pagina"><div class="grilla">
        <section class="panel"><div class="panel__cuerpo">
          <form class="formulario" id="form-fav">
            <label for="sel-liga">Liga</label>
            <select id="sel-liga">${D.ligas.map(l => `<option value="${esc(l.id)}" ${l.id === ligaSel ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select>
            <label for="sel-equipo">Equipo</label>
            <select id="sel-equipo"></select>
            <div class="acciones">
              <button class="boton boton--primario" type="submit">Guardar y activar avisos</button>
              ${fav.equipo ? '<button class="boton" type="button" id="btn-quitar">Dejar de seguir</button>' : ''}
            </div>
          </form>
        </div></section>
        <aside><section class="panel"><div class="panel__cabeza"><h2>Sobre los avisos</h2></div><div class="panel__cuerpo" id="estado-avisos" style="color:var(--tinta-2);font-size:.92rem"></div></section></aside>
      </div></div>`;
    const $l = document.getElementById('sel-liga'), $e = document.getElementById('sel-equipo');
    const llenar = () => { $e.innerHTML = opcionesEquipos($l.value).map(o => `<option value="${esc(o.id)}" ${o.id === fav.equipo ? 'selected' : ''}>${esc(o.n)}</option>`).join(''); };
    $l.addEventListener('change', llenar); llenar();
    const lineas = [];
    if (permiso === 'granted') lineas.push('Los avisos están activados en este navegador.');
    if (permiso === 'denied') lineas.push('Bloqueaste los avisos para este sitio. Podés habilitarlos desde el candado de la barra de direcciones.');
    if (permiso === 'no-soportado') lineas.push('Este navegador no permite avisos. En iPhone, agregá el sitio a la pantalla de inicio y abrilo desde ahí.');
    lineas.push(CFG.API_URL ? 'Por ahora llegan mientras tengas el sitio abierto, aunque sea en otra pestaña.' : 'Los avisos en vivo se activan cuando la liga conecta su planilla.');
    document.getElementById('estado-avisos').innerHTML = lineas.map(x => `<p>${esc(x)}</p>`).join('');
    document.getElementById('form-fav').addEventListener('submit', async ev => {
      ev.preventDefault();
      setFavorito({ liga: $l.value, equipo: $e.value });
      await pedirPermisoAvisos();
      suscribirEnServidor();
      aviso(`Ahora seguís a ${nombreEquipo($e.value)}.`);
      vistaMiEquipo();
    });
    const q = document.getElementById('btn-quitar');
    if (q) q.addEventListener('click', () => { setFavorito({ liga: fav.liga }); aviso('Dejaste de seguir a tu equipo.'); vistaMiEquipo(); });
  }

  function vistaNoEncontrada(msg) {
    $main.innerHTML = `<section class="banda"><div class="contenedor" style="padding-bottom:28px"><h1>No encontramos esa página</h1><p>${esc(msg)}</p></div></section>
      <div class="contenedor pagina"><a class="boton" href="#/">Ver todas las ligas</a></div>`;
  }

  // ---------- avisos en vivo ----------
  async function pedirPermisoAvisos() {
    if (!('Notification' in window)) return 'no-soportado';
    if (Notification.permission === 'default') {
      try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
    }
    return Notification.permission;
  }

  function suscribirEnServidor() {
    // Guarda la suscripción en la pestaña Suscripciones. El token push real se agrega
    // cuando se integre Firebase Cloud Messaging; mientras tanto se usa un id del navegador.
    const f = favorito();
    if (!CFG.API_URL || !f.equipo) return;
    let id = leer('id_navegador');
    if (!id) { id = 'web-' + Math.random().toString(36).slice(2, 10); guardar('id_navegador', id); }
    fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'suscribir', token_push: id, liga_id: f.liga, equipo_id: f.equipo }) }).catch(() => {});
  }

  function notificar(titulo, cuerpo) {
    aviso(`${titulo}. ${cuerpo}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(titulo, { body: cuerpo, tag: titulo + cuerpo }); } catch (e) {}
    }
  }

  let timerVivo = null;
  function iniciarVivo() {
    clearInterval(timerVivo);
    const f = favorito();
    if (!CFG.API_URL || !f.equipo) return;
    const t = torneoActual(f.liga);
    if (!t) return;
    const huella = p => `${p.estado}|${p.goles_local}|${p.goles_visitante}`;
    const previo = {};
    D.partidos.filter(p => p.local_id === f.equipo || p.visitante_id === f.equipo).forEach(p => { previo[p.id] = huella(p); });
    timerVivo = setInterval(async () => {
      try {
        const nuevos = await api('partidos', { torneo: t.id, equipo: f.equipo });
        nuevos.forEach(p => {
          p.goles_local = num(p.goles_local); p.goles_visitante = num(p.goles_visitante); p.fecha_nro = num(p.fecha_nro);
          const h = huella(p);
          if (previo[p.id] && previo[p.id] !== h) {
            const marcador = `${nombreEquipo(p.local_id)} ${p.goles_local ?? 0} - ${p.goles_visitante ?? 0} ${nombreEquipo(p.visitante_id)}`;
            const estAnt = previo[p.id].split('|')[0];
            if (p.estado === 'En juego' && estAnt !== 'En juego') notificar('Empezó el partido', marcador);
            else if (p.estado === 'Finalizado' && estAnt !== 'Finalizado') notificar('Final del partido', marcador);
            else notificar('Gol', marcador);
          }
          previo[p.id] = h;
          const i = D.partidos.findIndex(x => x.id === p.id);
          if (i >= 0) Object.assign(D.partidos[i], p);
        });
      } catch (e) { console.warn('Sin conexión con la planilla', e); }
    }, Math.max(30, CFG.REFRESCO_EN_VIVO_SEG || 60) * 1000);
  }

  // ---------- rutas ----------
  function ruta() {
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    document.querySelectorAll('.cabeza__nav a').forEach(a => a.removeAttribute('aria-current'));
    if (partes[0] === 'liga') {
      const liga = ligaPorRuta(partes[1]);
      // Los links viejos con el id (#/liga/L01) pasan a la dirección con nombre.
      if (liga && partes[1] !== liga.slug) history.replaceState(null, '', urlLiga(liga, partes.slice(2).join('/')));
      vistaLiga(liga ? liga.id : partes[1], partes[2], partes[3]);
    }
    else if (partes[0] === 'club') vistaClub(partes[1]);
    else if (partes[0] === 'admin') { window.Admin.mostrar($main, partes.slice(1)); document.title = 'Panel de clubes | Ligas de Fútbol'; window.scrollTo(0, 0); return; }
    else if (partes[0] === 'mi-equipo') { vistaMiEquipo(); document.querySelector('[data-nav="mi-equipo"]').setAttribute('aria-current', 'page'); }
    else { vistaInicio(); document.querySelector('[data-nav="inicio"]').setAttribute('aria-current', 'page'); }
    const titulo = $main.querySelector('h1');
    document.title = titulo && partes.length ? `${titulo.textContent} | Ligas de Fútbol` : 'Ligas de Fútbol';
    window.scrollTo(0, 0);
    $main.focus({ preventScroll: true });
  }

  // Para el panel: avisos y recarga de datos después de guardar cambios.
  window.LF = {
    aviso,
    recargar: async () => { try { await cargar(); actualizarNav(); dibujarCinta(); } catch (e) { console.warn(e); } }
  };

  (async function iniciar() {
    try { await cargar(); }
    catch (e) {
      $main.innerHTML = '<p class="contenedor vacio">No se pudieron cargar los datos. Revisá tu conexión y recargá la página.</p>';
      console.error(e); return;
    }
    actualizarNav();
    dibujarCinta();
    window.addEventListener('hashchange', ruta);
    ruta();
    iniciarVivo();
  })();
})();
