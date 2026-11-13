/**
 * Entrar y salir. Solo con la cuenta de Google del centro; no hay contraseñas propias.
 * Con ENTRADA_DE_PRUEBA=si (solo en desarrollo) se entra escribiendo un correo, para probar sin Google.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import * as oidc from 'openid-client';
import { config } from './config.ts';
import type { Bd } from './db.ts';
import { puedeEntrar } from './acceso.ts';
import { registrarEntrada, usuarioPorId, type Usuario } from './usuarios.ts';

declare module 'express-session' {
  interface SessionData {
    usuarioId?: number;
    /** Cuándo entró (ms): la sesión dura como mucho NOVENTA_DIAS aunque se use a diario. */
    entrada?: number;
    /** Adónde iba antes de que le pidiera entrar (un enlace del correo mensual, por ejemplo). */
    volver?: string;
    google?: { verificador: string; estado: string };
  }
}

const DIA = 24 * 3600 * 1000;
/** Sin usarla, la sesión caduca a los 30 días. */
const TREINTA_DIAS = 30 * DIA;
/**
 * Aunque se use, a los 90 días hay que volver a entrar con Google: así se vuelve a comprobar que la cuenta sigue siendo
 * del centro (una cuenta suspendida en Google no cierra las sesiones de esta app).
 */
const NOVENTA_DIAS = 90 * DIA;
const DIEZ_MINUTOS = 10 * 60 * 1000;
/**
 * En producción, con el prefijo __Host-: el navegador solo la acepta de esta misma dirección, por https y sin dominio,
 * así que otra web del mismo dominio (un subdominio) no puede colar la suya.
 */
const GALLETA = config.produccion ? '__Host-enlaces' : 'enlaces';

export function sesiones(bd: Bd) {
  const Almacen = connectPgSimple(session);
  return session({
    store: new Almacen({ pool: bd, tableName: 'sesiones', pruneSessionInterval: 3600 }),
    name: GALLETA,
    secret: config.secretoSesion,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.produccion, maxAge: TREINTA_DIAS },
  });
}

/**
 * Deja en `res.locals.usuario` al profesor que ha entrado, si lo hay y si aún puede: no tiene el acceso quitado, su
 * correo sigue cumpliendo las reglas de entrada (pueden haber cambiado) y la sesión no ha pasado de 90 días.
 */
export function cargarUsuario(bd: Bd) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const id = req.session.usuarioId;
    if (id) {
      const u = await usuarioPorId(bd, id);
      // Las sesiones de antes de este cambio no tienen fecha de entrada: cuentan desde ahora.
      req.session.entrada ??= Date.now();
      const vale = u && !u.bloqueado && puedeEntrar(u.correo, config.acceso).ok && Date.now() - req.session.entrada < NOVENTA_DIAS;
      if (vale) res.locals.usuario = u;
      else {
        delete req.session.usuarioId;
        delete req.session.entrada;
      }
    }
    next();
  };
}

export function exigirUsuario(req: Request, res: Response, next: NextFunction) {
  if (res.locals.usuario) return next();
  if (req.method === 'GET') {
    // Al volver a entrar, se le lleva adonde iba (por ejemplo, la ficha de un enlace desde el correo mensual).
    req.session.volver = req.originalUrl;
    // Como en /entrar: quien no ha entrado no deja una sesión de 30 días en la tabla.
    req.session.cookie.maxAge = DIEZ_MINUTOS;
    return req.session.save(() => res.redirect('/'));
  }
  res.status(401).render('error', { titulo: 'Tienes que entrar otra vez', mensaje: 'Tu sesión ha caducado. Entra otra vez con tu cuenta del centro.', enlace: { href: '/', texto: 'Entrar' } });
}

export function exigirAdmin(_req: Request, res: Response, next: NextFunction) {
  if ((res.locals.usuario as Usuario | undefined)?.admin) return next();
  res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esta página no existe.' });
}

let google: Promise<oidc.Configuration> | undefined;

function configuracionGoogle(): Promise<oidc.Configuration> {
  google ??= oidc.discovery(new URL('https://accounts.google.com'), config.google!.id, config.google!.secreto)
    .catch(e => { google = undefined; throw e; });
  return google;
}

const urlVuelta = () => `${config.urlPublica}/auth/google/callback`;

type Rechazo = { motivo: 'excluido' | 'otro-dominio' | 'sin-verificar' | 'google' | 'bloqueado'; correo?: string };

function pantallaDeEntrada(res: Response, rechazo?: Rechazo) {
  res.status(rechazo ? 403 : 200).render('entrada', { rechazo, entradaDePrueba: config.entradaDePrueba });
}

async function iniciarSesion(req: Request, res: Response, bd: Bd, correo: string, nombre: string) {
  const v = puedeEntrar(correo, config.acceso);
  if (!v.ok) return pantallaDeEntrada(res, { motivo: v.motivo, correo });
  const u = await registrarEntrada(bd, correo, nombre, config.administradores.has(correo.trim().toLowerCase()));
  if (u.bloqueado) return pantallaDeEntrada(res, { motivo: 'bloqueado', correo });
  // Solo una página del panel: nada de llevar a otra web después de entrar.
  const volver = req.session.volver?.startsWith('/panel') ? req.session.volver : '/panel';
  // Sesión nueva al entrar, para que nadie pueda colar una sesión preparada de antes.
  req.session.regenerate(err => {
    if (err) return res.status(500).render('error', { titulo: 'Error', mensaje: 'No se ha podido entrar. Prueba otra vez.' });
    req.session.usuarioId = u.id;
    req.session.entrada = Date.now();
    req.session.save(() => res.redirect(volver));
  });
}

export function rutasDeEntrada(bd: Bd) {
  const r = express.Router();

  r.get('/', (_req, res) => res.locals.usuario ? res.redirect('/panel') : pantallaDeEntrada(res));

  r.get('/entrar', async (req, res, next) => {
    if (config.entradaDePrueba) return pantallaDeEntrada(res);
    try {
      const g = await configuracionGoogle();
      const verificador = oidc.randomPKCECodeVerifier(), estado = oidc.randomState();
      req.session.google = { verificador, estado };
      // Cualquiera puede abrir esta página sin llegar a entrar: su sesión a medias caduca en 10 minutos, no en 30 días,
      // para que una ráfaga no llene la tabla. Al entrar, la sesión nueva vuelve a durar 30 días.
      if (!req.session.usuarioId) req.session.cookie.maxAge = DIEZ_MINUTOS;
      const url = oidc.buildAuthorizationUrl(g, {
        redirect_uri: urlVuelta(), scope: 'openid email profile', state: estado, hd: config.acceso.dominio, prompt: 'select_account',
        code_challenge: await oidc.calculatePKCECodeChallenge(verificador), code_challenge_method: 'S256',
      });
      req.session.save(() => res.redirect(url.href));
    } catch (e) { next(e); }
  });

  r.get('/auth/google/callback', async (req, res) => {
    const datos = req.session.google;
    delete req.session.google;
    if (!datos || !config.google || req.query.error) return res.redirect('/');
    try {
      const tokens = await oidc.authorizationCodeGrant(await configuracionGoogle(), new URL(req.originalUrl, config.urlPublica),
        { pkceCodeVerifier: datos.verificador, expectedState: datos.estado });
      const c = tokens.claims();
      if (!c || typeof c.email !== 'string' || c.email_verified !== true) return pantallaDeEntrada(res, { motivo: 'sin-verificar' });
      // `hd` lo pone Google solo para cuentas de un dominio de Google Workspace: es la prueba de que la cuenta es del centro.
      if (c.hd !== config.acceso.dominio) return pantallaDeEntrada(res, { motivo: 'otro-dominio', correo: c.email });
      await iniciarSesion(req, res, bd, c.email, typeof c.name === 'string' ? c.name : '');
    } catch (e) {
      console.error('Entrada con Google:', e);
      pantallaDeEntrada(res, { motivo: 'google' });
    }
  });

  if (config.entradaDePrueba) {
    r.post('/entrar/prueba', async (req, res) => {
      const correo = String(req.body.correo ?? '');
      await iniciarSesion(req, res, bd, correo, String(req.body.nombre ?? ''));
    });
  }

  r.post('/salir', (req, res) => req.session.destroy(() => res.clearCookie(GALLETA, { path: '/', secure: config.produccion }).redirect('/')));

  return r;
}
