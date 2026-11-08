/**
 * API para que otros programas creen enlaces cortos, compatible con la de YOURLS: POST /yourls-api.php con
 * `action=shorturl` (o `update`, como el complemento «edit url» de YOURLS), `signature=<llave>` y `format=json`.
 *
 * Cada programa tiene su llave (la crea un administrador en el panel), solo puede crear enlaces hacia sus dominios y
 * tiene un tope de peticiones por minuto. Sus enlaces salen a su nombre en el panel, donde se pueden pausar o pasar a
 * un profesor. Detalle en el README, «API para otros programas».
 */
import express, { type Request } from 'express';
import type { Bd } from './db.ts';
import { config, urlCorta } from './config.ts';
import {
  actualizarEnlace, crearEnlace, enlacePorId, ErrorDeFormulario, nombreAutomaticoLibre, problemaConDestino, type Enlace,
} from './enlaces.ts';
import { apuntarUso, enlaceDelPrograma, enlaceDelProgramaHacia, programaPorLlave, type ProgramaActivo } from './programas.ts';
import { recargar } from './redireccion.ts';

type Respuesta = Record<string, unknown> & { statusCode: number };

const fallo = (statusCode: number, code: string, message: string): Respuesta =>
  ({ status: 'fail', code, message, errorCode: String(statusCode), statusCode });

/** La llave solo se lee del cuerpo: en la dirección acabaría en los registros. */
function campo(req: Request, nombre: string): string {
  const v = (req.body as Record<string, unknown> | undefined)?.[nombre] ?? (nombre === 'signature' ? undefined : req.query[nombre]);
  return typeof v === 'string' ? v.trim() : '';
}

/** Peticiones de cada programa en el minuto en curso. */
const usos = new Map<number, { minuto: number; n: number }>();

function dentroDelTope(p: ProgramaActivo): boolean {
  const minuto = Math.floor(Date.now() / 60_000), u = usos.get(p.id);
  if (!u || u.minuto !== minuto) {
    usos.set(p.id, { minuto, n: 1 });
    return true;
  }
  return ++u.n <= p.por_minuto;
}

function problemaDeDestino(p: ProgramaActivo, url: string): string | null {
  if (!url) return 'Falta url, la dirección de destino.';
  const problema = problemaConDestino(url);
  if (problema) return problema;
  if (!p.dominios.includes(new URL(url).hostname.toLowerCase())) return `Este programa solo puede crear enlaces hacia ${p.dominios.join(', ')}.`;
  return null;
}

/**
 * El enlace corto y las direcciones de su QR, que un YOURLS normal no trae: así el programa sabe que este acortador
 * dibuja el QR, y lo pide con las opciones del creador por la consulta (?fondo=transparente&color=principal…).
 */
const direcciones = (nombre: string) => ({
  shorturl: urlCorta(nombre),
  qrsvg: `${config.urlPublica}/svg/${encodeURIComponent(nombre)}`,
  qrpng: `${config.urlPublica}/png/${encodeURIComponent(nombre)}`,
});

/** Como en YOURLS: la fecha en UTC, «2026-11-07 10:30:00». */
const fecha = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const datosDe = (e: Enlace) => ({ keyword: e.nombre, url: e.destino, title: e.titulo, date: fecha(e.creado) });

async function acortar(bd: Bd, p: ProgramaActivo, url: string, keyword: string, title: string): Promise<Respuesta> {
  const problema = problemaDeDestino(p, url);
  if (problema) return fallo(400, problema.startsWith('Este programa') ? 'error:domain' : 'error:nourl', problema);
  // Si ese destino ya tiene enlace de este programa, el mismo (YOURLS lo da como «error:url» con el enlace que ya hay).
  const ya = await enlaceDelProgramaHacia(bd, p.id, url);
  if (ya) {
    return {
      status: 'fail', code: 'error:url', message: `${url} ya tiene enlace: ${urlCorta(ya.nombre)}`,
      title: ya.titulo, ...direcciones(ya.nombre), url: datosDe(ya), statusCode: 200,
    };
  }
  let id: number | undefined;
  // Sin nombre pedido, el automático; si justo lo ha cogido otro a la vez, se prueba con otro.
  for (let intento = 0; id === undefined; intento++) {
    try {
      id = await crearEnlace(bd, null, { nombre: keyword || await nombreAutomaticoLibre(bd), destino: url, titulo: title }, p.id);
    } catch (e) {
      if (!(e instanceof ErrorDeFormulario)) throw e;
      if (e.campo === 'nombre' && !keyword && intento < 3) continue;
      return fallo(400, e.campo === 'nombre' ? 'error:keyword' : 'error:nourl', e.message);
    }
  }
  await recargar(bd);
  const e = (await enlacePorId(bd, id))!;
  return { status: 'success', message: `${url} añadido`, title: e.titulo, ...direcciones(e.nombre), url: datosDe(e), statusCode: 200 };
}

/** «https://<este dominio>/ABCD» o «ABCD» → «ABCD». */
function nombreDe(shorturl: string): string {
  if (!URL.canParse(shorturl)) return shorturl;
  const u = new URL(shorturl);
  if (u.host !== new URL(config.urlPublica).host) return shorturl;
  try { return decodeURIComponent(u.pathname.slice(1)); } catch { return u.pathname.slice(1); }
}

/** Cambiar el destino (y el título, si viene) de un enlace del programa, con las respuestas de «edit url». */
async function cambiar(bd: Bd, p: ProgramaActivo, shorturl: string, url: string, title: string): Promise<Respuesta> {
  if (!shorturl || !url) return { status: 'fail', code: 'error:missing', message: 'error: missing param', simple: 'Faltan shorturl o url.', statusCode: 400 };
  const e = await enlaceDelPrograma(bd, p.id, nombreDe(shorturl));
  if (!e) return { status: 'fail', code: 'error:notfound', message: 'error: not found', simple: `${shorturl} no existe o no es de este programa.`, statusCode: 404 };
  const problema = problemaDeDestino(p, url);
  if (problema) return { ...fallo(400, problema.startsWith('Este programa') ? 'error:domain' : 'error:nourl', problema), simple: problema };
  await actualizarEnlace(bd, e.id, {
    nombre: e.nombre, destino: url, titulo: title || e.titulo, etiqueta: e.etiqueta ?? '', caduca: e.caduca ?? '', activo: e.activo,
  });
  await recargar(bd);
  return {
    status: 'success', message: 'success: updated', simple: `${urlCorta(e.nombre)} lleva ahora a ${url}`,
    ...direcciones(e.nombre), url: { keyword: e.nombre, url, title: title || e.titulo }, statusCode: 200,
  };
}

export function rutasDeLaApi(bd: Bd) {
  const r = express.Router();
  r.all('/yourls-api.php', async (req, res) => {
    const formato = campo(req, 'format') || 'json';
    const responder = (o: Respuesta, simple: string) => {
      res.status(o.statusCode).set('Cache-Control', 'no-store');
      if (formato === 'simple') res.type('text').send(simple);
      else res.json(o);
    };
    const responderFallo = (o: Respuesta) => responder(o, String(o.simple ?? o.message));

    if (req.method !== 'POST') return responderFallo(fallo(405, 'error:method', 'Usa POST: la llave no puede ir en la dirección.'));
    if (req.is('multipart/form-data')) return responderFallo(fallo(415, 'error:format', 'Envía los campos como application/x-www-form-urlencoded.'));
    if (formato !== 'json' && formato !== 'simple') return responderFallo(fallo(400, 'error:format', 'Formato no admitido: usa json o simple.'));

    const p = await programaPorLlave(bd, campo(req, 'signature'));
    if (!p) return responderFallo(fallo(403, 'error:auth', 'Falta la llave (signature) o no es válida.'));
    if (!dentroDelTope(p)) return responderFallo(fallo(429, 'error:limit', `Como mucho ${p.por_minuto} peticiones por minuto.`));
    await apuntarUso(bd, p.id);

    const accion = campo(req, 'action');
    if (accion === 'shorturl') {
      const o = await acortar(bd, p, campo(req, 'url'), campo(req, 'keyword'), campo(req, 'title'));
      return responder(o, String(o.shorturl ?? o.message));
    }
    if (accion === 'update') {
      const o = await cambiar(bd, p, campo(req, 'shorturl'), campo(req, 'url'), campo(req, 'title'));
      return responder(o, String(o.simple));
    }
    responderFallo(fallo(400, 'error:action', 'Acción desconocida: usa shorturl o update.'));
  });
  return r;
}
