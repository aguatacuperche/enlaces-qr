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
    google?: { verificador: string; estado: string };
  }
}

const TREINTA_DIAS = 30 * 24 * 3600 * 1000;

export function sesiones(bd: Bd) {
  const Almacen = connectPgSimple(session);
  return session({
    store: new Almacen({ pool: bd, tableName: 'sesiones', pruneSessionInterval: 3600 }),
    name: 'enlaces',
    secret: config.secretoSesion,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.produccion, maxAge: TREINTA_DIAS },
  });
}

/** Deja en `res.locals.usuario` al profesor que ha entrado, si lo hay. */
export function cargarUsuario(bd: Bd) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const id = req.session.usuarioId;
    if (id) {
      const u = await usuarioPorId(bd, id);
      if (u) res.locals.usuario = u;
      else delete req.session.usuarioId;
    }
    next();
  };
}

export function exigirUsuario(req: Request, res: Response, next: NextFunction) {
  if (res.locals.usuario) return next();
  if (req.method === 'GET') return res.redirect('/');
  res.status(401).send('Tienes que entrar otra vez.');
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

type Rechazo = { motivo: 'excluido' | 'otro-dominio' | 'sin-verificar' | 'google'; correo?: string };

function pantallaDeEntrada(res: Response, rechazo?: Rechazo) {
  res.status(rechazo ? 403 : 200).render('entrada', { rechazo, entradaDePrueba: config.entradaDePrueba });
}

async function iniciarSesion(req: Request, res: Response, bd: Bd, correo: string, nombre: string) {
  const v = puedeEntrar(correo, config.acceso);
  if (!v.ok) return pantallaDeEntrada(res, { motivo: v.motivo, correo });
  const u = await registrarEntrada(bd, correo, nombre);
  // Sesión nueva al entrar, para que nadie pueda colar una sesión preparada de antes.
  req.session.regenerate(err => {
    if (err) return res.status(500).render('error', { titulo: 'Error', mensaje: 'No se ha podido entrar. Prueba otra vez.' });
    req.session.usuarioId = u.id;
    req.session.save(() => res.redirect('/panel'));
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

  r.post('/salir', (req, res) => req.session.destroy(() => res.clearCookie('enlaces').redirect('/')));

  return r;
}
