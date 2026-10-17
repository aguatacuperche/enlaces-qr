/**
 * ¿Sigue abriendo el destino de un enlace? Se mira como lo haría el móvil de quien escanea el QR, sin descargar la
 * página entera: se siguen las redirecciones y se decide por el código de respuesta y por adónde lleva al final.
 *
 * Dos clases de problema:
 * - rotos: el destino ya no existe, da error o no responde. No hay duda: hay que cambiarlo.
 * - avisos: abre, pero quizá no como se espera (pide iniciar sesión, formulario cerrado). El dueño puede darlo por
 *   bueno: un documento compartido solo dentro del centro, por ejemplo, es correcto si el enlace es para alumnos.
 *
 * No se comprueban direcciones de la red interna (localhost, 10.x, 192.168.x…): el servidor no debe hacer de puente
 * hacia sus propios servicios.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export type Codigo = 'no-existe' | 'no-responde' | 'error' | 'pide-sesion' | 'formulario-cerrado';
export type Problema = { codigo: Codigo; detalle: string };

export const AVISOS: ReadonlySet<Codigo> = new Set(['pide-sesion', 'formulario-cerrado']);
export const esAviso = (codigo: string | null) => !!codigo && AVISOS.has(codigo as Codigo);

export type Opciones = {
  fetch?: typeof fetch;
  /** Direcciones IP de un nombre; por defecto, el DNS del sistema. */
  resolver?: (host: string) => Promise<string[]>;
  /** Solo para pruebas con un servidor local. */
  permitirRedInterna?: boolean;
  /** Milisegundos de espera por petición. */
  espera?: number;
};

const INTERNAS = new net.BlockList();
for (const red of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16']) {
  const [ip, bits] = red.split('/');
  INTERNAS.addSubnet(ip, Number(bits), 'ipv4');
}
// Ojo: no añadir aquí ::ffff:0:0/96. BlockList compara cualquier IPv4 también como IPv4 dentro de IPv6, y ese rango
// la daría siempre por interna. Las direcciones IPv4 escritas en forma IPv6 se convierten antes de comprobarlas.
for (const red of ['::1/128', 'fc00::/7', 'fe80::/10']) {
  const [ip, bits] = red.split('/');
  INTERNAS.addSubnet(ip, Number(bits), 'ipv6');
}

export function esIpInterna(ip: string): boolean {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return INTERNAS.check(v4, 'ipv4');
  return INTERNAS.check(ip, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

async function esRedInterna(host: string, op: Opciones): Promise<boolean> {
  if (op.permitirRedInterna) return false;
  const limpio = host.replace(/^\[|\]$/g, '');
  const ips = net.isIP(limpio) ? [limpio]
    : await (op.resolver ?? (async h => (await dns.lookup(h, { all: true })).map(a => a.address)))(limpio).catch(() => []);
  return ips.some(esIpInterna);
}

// Un navegador corriente: hay webs que rechazan las peticiones que no parecen de un navegador.
const CABECERAS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'es-ES,es;q=0.9',
};

async function pedir(url: string, metodo: 'HEAD' | 'GET', op: Opciones): Promise<Response> {
  const r = await (op.fetch ?? fetch)(url, { method: metodo, redirect: 'manual', headers: CABECERAS, signal: AbortSignal.timeout(op.espera ?? 15_000) });
  await r.body?.cancel().catch(() => {});  // solo importan el código y la cabecera Location
  return r;
}

/** Identificador de un vídeo de YouTube, si el enlace es de uno. */
export function videoDeYoutube(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
  return m ? m[2] : null;
}

/**
 * YouTube responde «bien» aunque el vídeo ya no exista, así que se pregunta a su servicio oEmbed. Un 400 o un 404
 * quieren decir que el vídeo no está. Un 401 o 403 no se marca: lo dan también los vídeos que solo prohíben verse
 * dentro de otras webs, que son muchos (los de música, sobre todo) y se ven bien al abrir el enlace.
 */
async function comprobarVideo(id: string, op: Opciones): Promise<Problema | null> {
  try {
    const r = await pedir(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, 'GET', op);
    if (r.status === 400 || r.status === 404) return { codigo: 'no-existe', detalle: 'El vídeo ya no está en YouTube (o es privado).' };
    return null;
  } catch {
    return { codigo: 'no-responde', detalle: 'YouTube no responde.' };
  }
}

/** Qué ha pasado cuando ni siquiera hay respuesta: el dominio no existe, no contesta o su certificado está mal. */
export function problemaDeConexion(e: unknown): Problema {
  if ((e as Error)?.name === 'TimeoutError') return { codigo: 'no-responde', detalle: 'La web tarda demasiado en responder.' };
  const codigo = String((e as { cause?: { code?: string } })?.cause?.code ?? '');
  if (codigo === 'ENOTFOUND') return { codigo: 'no-responde', detalle: 'El dominio ya no existe.' };
  if (/CERT|SELF_SIGNED|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY/.test(codigo)) {
    return { codigo: 'error', detalle: 'La web tiene mal su certificado de seguridad: el navegador avisará de que no es segura.' };
  }
  return { codigo: 'no-responde', detalle: 'La web no responde.' };
}

function veredicto(final: URL, estado: number): Problema | null {
  if (final.hostname === 'accounts.google.com' || /^\/(ServiceLogin|signin|v3\/signin)/.test(final.pathname)) {
    return { codigo: 'pide-sesion', detalle: 'Pide iniciar sesión con una cuenta de Google: puede que ya no esté compartido con todo el mundo.' };
  }
  if (final.pathname.endsWith('/closedform')) return { codigo: 'formulario-cerrado', detalle: 'El formulario ya no acepta respuestas.' };
  if (estado === 404 || estado === 410) return { codigo: 'no-existe', detalle: `La página ya no existe (error ${estado}).` };
  // 401 y 403: muchas webs (museos, prensa, Canva…) los dan a cualquier programa que no sea un navegador, aunque se vean
  // bien al abrirlas. No se marcan: sería un aviso falso casi siempre.
  if (estado === 401 || estado === 403) return null;
  if (estado === 429) return { codigo: 'error', detalle: 'La web pide que se espere (429): se volverá a mirar.' };
  if (estado >= 400) return { codigo: 'error', detalle: `La web da un error (${estado}).` };
  return null;
}

export async function comprobarDestino(url: string, op: Opciones = {}): Promise<Problema | null> {
  const video = videoDeYoutube(url);
  if (video) return comprobarVideo(video, op);
  let actual = url;
  for (let salto = 0; salto < 8; salto++) {
    const u = new URL(actual);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (await esRedInterna(u.hostname, op)) return null;
    let r: Response;
    try {
      r = await pedir(actual, 'HEAD', op);
      // Hay webs que no contestan bien a HEAD: entonces, la petición normal.
      if (r.status === 405 || r.status === 501 || r.status === 400 || r.status === 403 || r.status === 404) r = await pedir(actual, 'GET', op);
    } catch (e) {
      return problemaDeConexion(e);
    }
    const destino = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && destino) {
      actual = new URL(destino, actual).href;
      continue;
    }
    return veredicto(new URL(actual), r.status);
  }
  return { codigo: 'error', detalle: 'Demasiadas redirecciones.' };
}
