/** El panel de los profesores: sus enlaces, el creador de QR y, para los administradores, todos los enlaces y los usuarios. */
import express, { type Request, type Response } from 'express';
import type { Bd } from './db.ts';
import { exigirAdmin, exigirUsuario } from './entrada.ts';
import {
  actualizarEnlace, borrarEnlace, cambiarActivo, cambiarDueno, crearEnlace, enlacePorId, ErrorDeFormulario, etiquetas,
  limpiarNombre, listarEnlaces, nombreAutomaticoLibre, nombreLibre, recuento, seriesDiarias, seriesSemanales,
  type Enlace, type Estado, type Filtro,
} from './enlaces.ts';
import { problemaConNombre } from './nombres.ts';
import { recargar } from './redireccion.ts';
import { cambiarAdmin, guardarPreferenciasQR, listarUsuarios, pasarEnlaces, type Usuario } from './usuarios.ts';
import { urlCorta } from './config.ts';
import { dibujarQR } from './qr/dibujo.ts';
import { pdf, png, seLee } from './qr/exportar.ts';
import { aConsulta, leerOpciones, pixelesDe, POR_DEFECTO, TAMANOS, type Opciones } from './qr/opciones.ts';

const usuarioDe = (res: Response) => res.locals.usuario as Usuario;
const texto = (v: unknown) => typeof v === 'string' ? v : '';

function filtroDesde(q: Request['query']): Filtro {
  const estado = texto(q.estado);
  const orden = texto(q.orden);
  return {
    q: texto(q.q).trim().slice(0, 100) || undefined,
    estado: (['activo', 'pausa', 'caducado'] as const).includes(estado as Estado) ? estado as Estado : '',
    etiqueta: texto(q.etiqueta) || undefined,
    orden: (['recientes', 'visitas', 'titulo'] as const).includes(orden as 'visitas') ? orden as Filtro['orden'] : 'recientes',
  };
}

export function rutasDelPanel(bd: Bd) {
  const r = express.Router();
  r.use(exigirUsuario);

  /** El enlace, si este usuario lo puede tocar (el suyo, o cualquiera si es administrador). */
  async function enlaceDe(req: Request, res: Response): Promise<Enlace | undefined> {
    const e = await enlacePorId(bd, Number(req.params.id));
    const u = usuarioDe(res);
    if (e && (u.admin || e.usuario_id === u.id)) return e;
    res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese enlace no existe o no es tuyo.' });
  }

  async function lista(req: Request, res: Response, vista: 'mios' | 'todos', formulario?: { datos: Record<string, string>; error: ErrorDeFormulario }) {
    const u = usuarioDe(res);
    const sinDueno = vista === 'todos' && req.query.dueno === 'sin';
    const base: Filtro = vista === 'mios' ? { usuarioId: u.id } : sinDueno ? { usuarioId: null } : {};
    const filtro = { ...base, ...filtroDesde(req.query) };
    const enlaces = await listarEnlaces(bd, filtro);
    res.status(formulario ? 422 : 200).render('panel', {
      vista, filtro, sinDueno, enlaces,
      series: await seriesDiarias(bd, enlaces.map(e => e.id)),
      cuentas: await recuento(bd, base),
      etiquetas: await etiquetas(bd, base.usuarioId),
      misEnlaces: vista === 'mios' ? undefined : (await recuento(bd, { usuarioId: u.id })).todos,
      totalTodos: u.admin ? (await recuento(bd, {})).todos : undefined,
      nuevo: formulario?.datos ?? { nombre: await nombreAutomaticoLibre(bd) },
      error: formulario?.error,
      recienCreado: Number(req.query.creado) || undefined,
    });
  }

  r.get('/', (req, res) => lista(req, res, 'mios'));
  r.get('/todos', exigirAdmin, (req, res) => lista(req, res, 'todos'));

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
      await recargar(bd);
      res.redirect(`/panel?creado=${id}`);
    } catch (e) {
      if (!(e instanceof ErrorDeFormulario)) throw e;
      await lista(req, res, 'mios', { datos, error: e });
    }
  });

  r.get('/enlaces/:id', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await ficha(req, res, e);
  });

  async function ficha(req: Request, res: Response, e: Enlace, formulario?: { datos: Record<string, string>; error: ErrorDeFormulario }) {
    res.status(formulario ? 422 : 200).render('enlace', {
      e, semanas: await seriesSemanales(bd, e.id), usuarios: usuarioDe(res).admin ? await listarUsuarios(bd) : [],
      datos: formulario?.datos, error: formulario?.error, guardado: req.query.guardado === '1',
    });
  }

  r.post('/enlaces/:id', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    const datos = {
      nombre: texto(req.body.nombre), destino: texto(req.body.destino), titulo: texto(req.body.titulo),
      etiqueta: texto(req.body.etiqueta), caduca: texto(req.body.caduca), activo: req.body.activo === 'si',
    };
    try {
      await actualizarEnlace(bd, e.id, datos);
      await recargar(bd);
      res.redirect(`/panel/enlaces/${e.id}?guardado=1`);
    } catch (err) {
      if (!(err instanceof ErrorDeFormulario)) throw err;
      await ficha(req, res, e, { datos: { ...datos, activo: datos.activo ? 'si' : '' }, error: err });
    }
  });

  r.post('/enlaces/:id/activo', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await cambiarActivo(bd, e.id, !e.activo);
    await recargar(bd);
    res.redirect(volverA(req));
  });

  r.post('/enlaces/:id/borrar', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await borrarEnlace(bd, e.id);
    await recargar(bd);
    res.redirect('/panel');
  });

  r.post('/enlaces/:id/dueno', exigirAdmin, async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    await cambiarDueno(bd, e.id, Number(req.body.usuario) || null);
    res.redirect(`/panel/enlaces/${e.id}`);
  });

  // ---------- Creador de QR ----------

  const opcionesDe = (req: Request, res: Response) => leerOpciones(req.query, { ...POR_DEFECTO, ...leerOpciones(usuarioDe(res).preferencias_qr ?? {}) });

  r.get('/enlaces/:id/qr', async (req, res) => {
    const e = await enlaceDe(req, res);
    if (!e) return;
    res.render('qr', { e, o: opcionesDe(req, res), tamanos: TAMANOS, consulta: aConsulta });
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

  // ---------- Usuarios (administradores) ----------

  r.get('/usuarios', exigirAdmin, async (_req, res) => {
    res.render('usuarios', { usuarios: await listarUsuarios(bd), sinDueno: (await recuento(bd, { usuarioId: null })).todos, hecho: _req.query.hecho });
  });

  r.post('/usuarios/:id/admin', exigirAdmin, async (req, res) => {
    const id = Number(req.params.id);
    // Que nadie se quite a sí mismo: siempre queda al menos un administrador.
    if (id !== usuarioDe(res).id) await cambiarAdmin(bd, id, req.body.admin === 'si');
    res.redirect('/panel/usuarios');
  });

  r.post('/usuarios/pasar', exigirAdmin, async (req, res) => {
    const de = req.body.de === 'sin' ? null : Number(req.body.de), a = Number(req.body.a);
    const n = a && de !== a ? await pasarEnlaces(bd, de, a) : 0;
    res.redirect(`/panel/usuarios?hecho=${n}`);
  });

  return r;
}

/** Vuelve a la lista de la que vino el formulario, sin salir de la app. */
function volverA(req: Request): string {
  const v = texto(req.body.volver);
  return v.startsWith('/panel') && !v.startsWith('//') ? v : '/panel';
}
