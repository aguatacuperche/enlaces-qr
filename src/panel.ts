/** El panel de los profesores: sus enlaces, el creador de QR y, para los administradores, todos los enlaces y los usuarios. */
import express, { type Request, type Response } from 'express';
import type { Bd } from './db.ts';
import { exigirAdmin, exigirUsuario } from './entrada.ts';
import {
  actualizarEnlace, actualizarPagina, borrarEnlace, cambiarActivo, cambiarDueno, crearEnlace, crearPagina, elementosDe,
  enlacePorId, ErrorDeFormulario, etiquetas, ignorarAviso, ignorarAvisoElemento, limpiarNombre, listarEnlaces, MAX_ELEMENTOS, nombreAutomaticoLibre,
  nombreLibre, recuento, seriesDiarias, seriesSemanales, type Enlace, type Estado, type Filtro,
} from './enlaces.ts';
import { comprobarEnlace } from './comprobador.ts';
import type { Opciones as OpcionesComprobacion } from './comprobacion.ts';
import { config } from './config.ts';
import { problemaConNombre } from './nombres.ts';
import { refrescarEnlace } from './redireccion.ts';
import { cambiarAcceso, cambiarAdmin, cerrarAyuda, guardarPreferenciasQR, listarUsuarios, pasarEnlaces, type Usuario } from './usuarios.ts';
import { urlCorta } from './config.ts';
import { admiteLogo, dibujarQR } from './qr/dibujo.ts';
import { pdf, png, seLee } from './qr/exportar.ts';
import { aConsulta, leerOpciones, pixelesDe, POR_DEFECTO, TAMANOS, type Opciones } from './qr/opciones.ts';
import { cartel, HOJAS, pegatinas, problemaConHoja, problemaConTamano, type Hoja } from './qr/impresion.ts';
import type { Cartero } from './correo.ts';
import { contexto, destinatarios, enviarUno, informeApagado, momento, proximoEnvio } from './informe.ts';
import {
  cambiarLlave, cambiarPrograma, crearPrograma, listarProgramas, programaPorId, retirarPrograma, type DatosPrograma,
} from './programas.ts';

/** La hoja de pegatinas pedida: uno de los formatos habituales o una a medida (campos m_*). */
function hojaDesde(q: Request['query']): { hoja: Hoja; problema: string | null } {
  const clave = texto(q.hoja);
  if (clave !== 'medida') return { hoja: Object.hasOwn(HOJAS, clave) ? HOJAS[clave] : Object.values(HOJAS)[0], problema: null };
  const n = (k: string, d: number) => {
    const v = texto(q[k]).replace(',', '.').trim();
    return v === '' ? d : Number(v);
  };
  const hoja: Hoja = {
    nombre: 'A medida', columnas: Math.round(n('m_columnas', 3)), filas: Math.round(n('m_filas', 7)), ancho: n('m_ancho', 70),
    alto: n('m_alto', 42.4), margenSuperior: n('m_sup', 0), margenIzquierdo: n('m_izq', 0), separacionH: n('m_seph', 0), separacionV: n('m_sepv', 0),
  };
  return { hoja, problema: problemaConHoja(hoja) };
}

const entero = (v: unknown, min: number, max: number, porDefecto: number) => {
  const n = Math.round(Number(texto(v)));
  return Number.isFinite(n) && texto(v) !== '' ? Math.min(max, Math.max(min, n)) : porDefecto;
};

const usuarioDe = (res: Response) => res.locals.usuario as Usuario;
const texto = (v: unknown) => typeof v === 'string' ? v : '';
/** Un campo que puede venir repetido (los enlaces de una página): siempre como lista. */
const lista = (v: unknown): string[] => Array.isArray(v) ? v.map(texto) : typeof v === 'string' ? [v] : [];

/** En pruebas se comprueba contra un servidor local; en producción, nunca la red interna. */
const opcionesComprobacion = (): OpcionesComprobacion =>
  ({ permitirRedInterna: !config.produccion && process.env.COMPROBAR_RED_INTERNA === 'si' });

/** Tras crear o cambiar un enlace, su destino se comprueba enseguida, sin hacer esperar al profesor. */
function comprobarEnSegundoPlano(bd: Bd, id: number) {
  if (process.env.COMPROBAR_ENLACES === 'no') return;
  comprobarEnlace(bd, id, opcionesComprobacion()).catch(e => console.error('Comprobación:', e));
}

function filtroDesde(q: Request['query']): Filtro {
  const estado = texto(q.estado);
  const orden = texto(q.orden);
  return {
    q: texto(q.q).trim().slice(0, 100) || undefined,
    estado: (['activo', 'pausa', 'caducado'] as const).includes(estado as Estado) ? estado as Estado : '',
    etiqueta: texto(q.etiqueta) || undefined,
    orden: (['recientes', 'visitas', 'titulo'] as const).includes(orden as 'visitas') ? orden as Filtro['orden'] : 'recientes',
    problemas: q.problemas === '1',
  };
}

export function rutasDelPanel(bd: Bd, cartero: Cartero | null = null) {
  const r = express.Router();
  r.use(exigirUsuario);

  /** El enlace, si este usuario lo puede tocar (el suyo, o cualquiera si es administrador). */
  async function enlaceDe(req: Request, res: Response): Promise<Enlace | undefined> {
    const id = /^\d{1,9}$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const e = Number.isNaN(id) ? undefined : await enlacePorId(bd, id);
    const u = usuarioDe(res);
    if (e && (u.admin || e.usuario_id === u.id)) return e;
    res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese enlace no existe o no es tuyo.' });
  }

  async function listado(req: Request, res: Response, vista: 'mios' | 'todos', formulario?: { datos: Record<string, string>; error: ErrorDeFormulario }) {
    const u = usuarioDe(res);
    const sinDueno = vista === 'todos' && req.query.dueno === 'sin';
    // Los enlaces de un programa (se llega desde Programas).
    const programa = vista === 'todos' && !sinDueno && req.query.programa ? await programaPorId(bd, Number(req.query.programa)) : undefined;
    const base: Filtro = vista === 'mios' ? { usuarioId: u.id } : sinDueno ? { usuarioId: null } : programa ? { programaId: programa.id } : {};
    const filtro = { ...base, ...filtroDesde(req.query) };
    const enlaces = await listarEnlaces(bd, filtro);
    res.status(formulario ? 422 : 200).render('panel', {
      vista, filtro, sinDueno, programa, enlaces,
      series: await seriesDiarias(bd, enlaces.map(e => e.id)),
      cuentas: await recuento(bd, base),
      etiquetas: await etiquetas(bd, base.usuarioId, base.programaId),
      misEnlaces: vista === 'mios' ? undefined : (await recuento(bd, { usuarioId: u.id })).todos,
      totalTodos: u.admin ? (await recuento(bd, {})).todos : undefined,
      nuevo: formulario?.datos ?? { nombre: await nombreAutomaticoLibre(bd) },
      error: formulario?.error,
      recienCreado: Number(req.query.creado) || undefined,
      mostrarAyuda: vista === 'mios' && !u.ayuda_cerrada,
    });
  }

  r.get('/', (req, res) => listado(req, res, 'mios'));
  r.get('/todos', exigirAdmin, (req, res) => listado(req, res, 'todos'));

  // ---------- Ayuda ----------

  r.get('/ayuda', (_req, res) => res.render('ayuda', { maxElementos: MAX_ELEMENTOS }));
  r.post('/ayuda/cerrar', async (req, res) => {
    await cerrarAyuda(bd, usuarioDe(res).id);
    res.redirect(volverA(req));
  });

  /** Comprobación al momento mientras se escribe el nombre. */
  r.get('/nombre', async (req, res) => {
    const nombre = limpiarNombre(texto(req.query.valor));
    const problema = problemaConNombre(nombre) ?? (await nombreLibre(bd, nombre) ? null : `${res.app.locals.corta(nombre)} ya existe.`);
    res.json({ nombre, problema });
  });

  r.post('/enlaces', async (req, res) => {
    const datos = { nombre: texto(req.body.nombre), destino: texto(req.body.destino), titulo: texto(req.body.titulo), etiqueta: texto(req.body.etiqueta) };
    try {
      const id = await crearEnlace(bd, usuarioDe(res).id, datos);
      await refrescarEnlace(bd, id);
      comprobarEnSegundoPlano(bd, id);
      res.redirect(`/panel?creado=${id}`);
    } catch (e) {
      if (!(e instanceof ErrorDeFormulario)) throw e;
      await listado(req, res, 'mios', { datos, error: e });
    }
  });

  r.get('/enlaces/:id', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await ficha(req, res, e);
  });

  type Formulario = { datos: Record<string, string>; elementos?: { titulo: string; url: string }[]; error: ErrorDeFormulario };

  async function ficha(req: Request, res: Response, e: Enlace, formulario?: Formulario) {
    res.status(formulario ? 422 : 200).render('enlace', {
      e, semanas: await seriesSemanales(bd, e.id), usuarios: usuarioDe(res).admin ? await listarUsuarios(bd) : [],
      elementos: formulario?.elementos ?? (e.tipo === 'pagina' ? await elementosDe(bd, e.id) : []), maxElementos: MAX_ELEMENTOS,
      datos: formulario?.datos, error: formulario?.error, guardado: req.query.guardado === '1',
      comprobado: req.query.comprobado === '1', nueva: req.query.nueva === '1',
    });
  }

  r.post('/paginas', async (_req, res) => {
    const id = await crearPagina(bd, usuarioDe(res).id);
    await refrescarEnlace(bd, id);
    res.redirect(`/panel/enlaces/${id}?nueva=1`);
  });

  r.post('/enlaces/:id', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    const datos = {
      nombre: texto(req.body.nombre), destino: texto(req.body.destino), titulo: texto(req.body.titulo),
      etiqueta: texto(req.body.etiqueta), caduca: texto(req.body.caduca), activo: req.body.activo === 'si',
    };
    const titulos = lista(req.body.elemento_titulo), urls = lista(req.body.elemento_url);
    const elementos = urls.map((url, i) => ({ titulo: titulos[i] ?? '', url }));
    try {
      if (e.tipo === 'pagina') {
        await actualizarPagina(bd, e.id, { ...datos, descripcion: texto(req.body.descripcion), elementos });
      } else {
        await actualizarEnlace(bd, e.id, datos);
      }
      await refrescarEnlace(bd, e.id);
      comprobarEnSegundoPlano(bd, e.id);
      res.redirect(`/panel/enlaces/${e.id}?guardado=1`);
    } catch (err) {
      if (!(err instanceof ErrorDeFormulario)) throw err;
      await ficha(req, res, e, {
        datos: { ...datos, activo: datos.activo ? 'si' : '', descripcion: texto(req.body.descripcion) }, elementos, error: err,
      });
    }
  });

  r.post('/enlaces/:id/activo', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await cambiarActivo(bd, e.id, !e.activo);
    await refrescarEnlace(bd, e.id);
    res.redirect(volverA(req));
  });

  r.post('/enlaces/:id/comprobar', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await comprobarEnlace(bd, e.id, opcionesComprobacion());
    res.redirect(`/panel/enlaces/${e.id}?comprobado=1`);
  });

  r.post('/enlaces/:id/ignorar', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await ignorarAviso(bd, e.id);
    res.redirect(`/panel/enlaces/${e.id}`);
  });

  r.post('/enlaces/:id/elementos/:elemento/ignorar', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await ignorarAvisoElemento(bd, e.id, Number(req.params.elemento) || 0);
    res.redirect(`/panel/enlaces/${e.id}`);
  });

  r.post('/enlaces/:id/borrar', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await borrarEnlace(bd, e.id);
    await refrescarEnlace(bd, e.id);
    res.redirect('/panel');
  });

  r.post('/enlaces/:id/dueno', exigirAdmin, async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    // «programa»: se queda con el programa que lo creó.
    if (req.body.usuario !== 'programa') await cambiarDueno(bd, e.id, Number(req.body.usuario) || null);
    res.redirect(`/panel/enlaces/${e.id}`);
  });

  // ---------- Creador de QR ----------

  const opcionesDe = (req: Request, res: Response) => leerOpciones(req.query, { ...POR_DEFECTO, ...leerOpciones(usuarioDe(res).preferencias_qr ?? {}) });

  r.get('/enlaces/:id/qr', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    res.render('qr', {
      e, o: opcionesDe(req, res), tamanos: TAMANOS, hojas: HOJAS, consulta: aConsulta, modo: texto(req.query.modo) || 'codigo',
      admiteLogo: admiteLogo(urlCorta(e.nombre)),
    });
  });

  r.get('/enlaces/:id/qr.:formato', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    const o: Opciones = opcionesDe(req, res);
    const svg = dibujarQR(urlCorta(e.nombre), o, e.nombre);
    const archivo = `qr-${e.nombre.replace(/[^\w-]+/g, '_')}-${o.tamano}`;
    const descargar = req.query.descargar === '1';
    if (descargar) {
      await guardarPreferenciasQR(bd, usuarioDe(res).id, { ...o, texto: '' });
      res.attachment(`${archivo}.${req.params.formato}`);
    }
    res.set('Cache-Control', 'private, no-store');
    switch (req.params.formato) {
      case 'svg': return res.type('image/svg+xml').send(svg);
      case 'png': return res.type('image/png').send(png(svg, pixelesDe(o.tamano)));
      case 'pdf': return res.type('application/pdf').send(await pdf(svg, o, `${res.app.locals.corta(e.nombre)} · ${e.titulo}`));
      case 'json': return res.json({ seLee: seLee(svg, urlCorta(e.nombre)) });
      default: res.status(404).end();
    }
  });

  // ---------- Cartel y pegatinas ----------

  r.get('/enlaces/:id/cartel.pdf', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    const o = opcionesDe(req, res);
    const titulo = (typeof req.query.cartel_titulo === 'string' ? req.query.cartel_titulo : e.titulo).slice(0, 140);
    const pdfCartel = await cartel(dibujarQR(urlCorta(e.nombre), o, e.nombre), res.app.locals.corta(e.nombre), config.centro.pie, {
      tamano: req.query.cartel_tamano === 'a3' ? 'a3' : 'a4', titulo, texto: texto(req.query.cartel_texto).slice(0, 300),
    });
    if (req.query.descargar === '1') {
      await guardarPreferenciasQR(bd, usuarioDe(res).id, { ...o, texto: '' });
      res.attachment(`cartel-${e.nombre.replace(/[^\w-]+/g, '_')}.pdf`);
    }
    res.set('Cache-Control', 'private, no-store').type('application/pdf').send(pdfCartel);
  });

  r.get('/enlaces/:id/pegatinas.pdf', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    const { hoja, problema } = hojaDesde(req.query);
    if (problema) return res.status(422).type('html').send(`<p style="font:16px sans-serif;padding:1em;color:#5a1219">${problema}</p>`);
    // En las pegatinas el código va sin marco: el texto va al lado o debajo.
    const o: Opciones = { ...opcionesDe(req, res), marco: 'no' };
    const porHoja = hoja.columnas * hoja.filas;
    const empezar = entero(req.query.empezar, 1, porHoja, 1);
    const textoPegatina = (['titulo', 'direccion', 'nada'] as const).find(t => t === req.query.pegatina_texto) ?? 'titulo';
    const svg = dibujarQR(urlCorta(e.nombre), o, e.nombre);
    const pequeno = problemaConTamano(hoja, textoPegatina, Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1]));
    if (pequeno) return res.status(422).type('html').send(`<p style="font:16px sans-serif;padding:1em;color:#5a1219">${pequeno}</p>`);
    const pdfPegatinas = await pegatinas(svg, res.app.locals.corta(e.nombre), e.titulo, {
      hoja, empezar, cuantas: entero(req.query.cuantas, 1, 400, porHoja - empezar + 1), texto: textoPegatina, bordes: req.query.bordes === 'si',
    });
    if (req.query.descargar === '1') {
      await guardarPreferenciasQR(bd, usuarioDe(res).id, { ...opcionesDe(req, res), texto: '' });
      res.attachment(`pegatinas-${e.nombre.replace(/[^\w-]+/g, '_')}.pdf`);
    }
    res.set('Cache-Control', 'private, no-store').type('application/pdf').send(pdfPegatinas);
  });

  // ---------- Usuarios (administradores) ----------

  r.get('/usuarios', exigirAdmin, async (req, res) => {
    const { mes } = momento();
    res.render('usuarios', {
      usuarios: await listarUsuarios(bd), sinDueno: (await recuento(bd, { usuarioId: null })).todos, hecho: req.query.hecho,
      informe: { correo: !!cartero, apagado: informeApagado(), remitente: cartero?.remitente ?? '', proximo: proximoEnvio(), mes },
      prueba: texto(req.query.prueba),
    });
  });

  /** El informe tal como le llegaría a este administrador; si no tiene nada roto, con enlaces de ejemplo del centro. */
  r.post('/usuarios/informe-prueba', exigirAdmin, async (_req, res) => {
    const u = usuarioDe(res);
    if (!cartero) return res.redirect('/panel/usuarios?prueba=sin-correo');
    const todos = await destinatarios(bd);
    const propio = todos.find(d => d.id === u.id);
    const enlaces = propio?.enlaces ?? todos.flatMap(d => d.enlaces).slice(0, 5);
    if (!enlaces.length) return res.redirect('/panel/usuarios?prueba=nada');
    try {
      await enviarUno(cartero, { id: u.id, correo: u.correo, nombre: u.nombre, enlaces }, contexto(config.urlPublica, config.centro.pie), true);
      res.redirect(`/panel/usuarios?prueba=${propio ? 'enviada' : 'ejemplo'}`);
    } catch (e) {
      console.error('Informe de prueba:', e);
      res.redirect('/panel/usuarios?prueba=error');
    }
  });

  r.post('/usuarios/:id/admin', exigirAdmin, async (req, res) => {
    const id = Number(req.params.id);
    // Que nadie se quite a sí mismo: siempre queda al menos un administrador.
    if (id !== usuarioDe(res).id) await cambiarAdmin(bd, id, req.body.admin === 'si');
    res.redirect('/panel/usuarios');
  });

  r.post('/usuarios/:id/acceso', exigirAdmin, async (req, res) => {
    const id = Number(req.params.id);
    // Nadie se quita el acceso a sí mismo.
    if (id !== usuarioDe(res).id) await cambiarAcceso(bd, id, req.body.bloqueado === 'si');
    res.redirect('/panel/usuarios');
  });

  r.post('/usuarios/pasar', exigirAdmin, async (req, res) => {
    const de = req.body.de === 'sin' ? null : Number(req.body.de), a = Number(req.body.a);
    const n = a && de !== a ? await pasarEnlaces(bd, de, a) : 0;
    res.redirect(`/panel/usuarios?hecho=${n}`);
  });

  // ---------- Programas que crean enlaces por la API (administradores) ----------

  type Extra = { llave?: { nombre: string; llave: string }; error?: ErrorDeFormulario; datos?: DatosPrograma; editando?: number; guardado?: boolean };

  /** La llave nueva se enseña en la respuesta misma, sin guardarla en ningún sitio: no se vuelve a ver. */
  async function programas(res: Response, extra: Extra = {}) {
    res.status(extra.error ? 422 : 200).set('Cache-Control', 'no-store').render('programas', {
      programas: await listarProgramas(bd), api: `${config.urlPublica}/yourls-api.php`,
      llave: undefined, error: undefined, datos: undefined, editando: undefined, guardado: false, ...extra,
    });
  }

  const datosPrograma = (req: Request): DatosPrograma =>
    ({ nombre: texto(req.body.nombre), dominios: texto(req.body.dominios), por_minuto: texto(req.body.por_minuto) });

  r.get('/programas', exigirAdmin, (req, res) => programas(res, { guardado: req.query.guardado === '1' }));

  r.post('/programas', exigirAdmin, async (req, res) => {
    const datos = datosPrograma(req);
    try {
      const { id, llave } = await crearPrograma(bd, usuarioDe(res).id, datos);
      await programas(res, { llave: { nombre: (await programaPorId(bd, id))!.nombre, llave } });
    } catch (e) {
      if (!(e instanceof ErrorDeFormulario)) throw e;
      await programas(res, { error: e, datos });
    }
  });

  r.post('/programas/:id', exigirAdmin, async (req, res) => {
    const id = Number(req.params.id), datos = datosPrograma(req);
    try {
      await cambiarPrograma(bd, id, datos);
      res.redirect('/panel/programas?guardado=1');
    } catch (e) {
      if (!(e instanceof ErrorDeFormulario)) throw e;
      await programas(res, { error: e, datos, editando: id });
    }
  });

  r.post('/programas/:id/llave', exigirAdmin, async (req, res) => {
    const p = await programaPorId(bd, Number(req.params.id));
    if (!p) return res.redirect('/panel/programas');
    await programas(res, { llave: { nombre: p.nombre, llave: await cambiarLlave(bd, p.id) } });
  });

  r.post('/programas/:id/retirar', exigirAdmin, async (req, res) => {
    await retirarPrograma(bd, Number(req.params.id));
    res.redirect('/panel/programas');
  });

  return r;
}

/** Vuelve a la lista de la que vino el formulario, sin salir de la app. */
function volverA(req: Request): string {
  const v = texto(req.body.volver);
  return v.startsWith('/panel') && !v.startsWith('//') ? v : '/panel';
}
