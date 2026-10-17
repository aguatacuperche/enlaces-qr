import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comprobarDestino, esIpInterna, problemaDeConexion, videoDeYoutube } from '../src/comprobacion.ts';

// Un servidor local que imita los casos que se dan con los destinos reales.
let servidor: http.Server;
let base = '';
beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    const ruta = req.url ?? '/';
    const ir = (a: string) => { res.writeHead(302, { location: a }); res.end(); };
    if (ruta === '/bien') return res.end('ok');
    if (ruta === '/no-existe') { res.statusCode = 404; return res.end(); }
    if (ruta === '/retirada') { res.statusCode = 410; return res.end(); }
    if (ruta === '/roto') { res.statusCode = 500; return res.end(); }
    if (ruta === '/prohibido') { res.statusCode = 403; return res.end(); }
    if (ruta === '/espera') { res.statusCode = 429; return res.end(); }
    if (ruta === '/sin-head') { res.statusCode = req.method === 'HEAD' ? 405 : 200; return res.end(); }
    if (ruta === '/redirige') return ir('/bien');
    if (ruta === '/bucle') return ir('/bucle');
    if (ruta === '/documento-privado') return ir(`${base}/ServiceLogin?continue=x`);
    if (ruta.startsWith('/ServiceLogin')) return res.end('inicia sesión');
    if (ruta === '/formulario') return ir('/forms/d/e/abc/closedform');
    if (ruta.endsWith('/closedform')) return res.end('ya no acepta respuestas');
    if (ruta === '/lenta') return setTimeout(() => res.end('tarde'), 1500);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>(ok => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise(ok => servidor.close(ok)));

const local = { permitirRedInterna: true, espera: 800 };
const mirar = (ruta: string) => comprobarDestino(base + ruta, local);

describe('comprobación de destinos', () => {
  it('lo que abre, abre: también tras redirecciones o si la web no acepta HEAD', async () => {
    expect(await mirar('/bien')).toBeNull();
    expect(await mirar('/redirige')).toBeNull();
    expect(await mirar('/sin-head')).toBeNull();
  });

  it('marca como rotos los destinos que ya no existen, dan error o no responden', async () => {
    expect((await mirar('/no-existe'))?.codigo).toBe('no-existe');
    expect((await mirar('/retirada'))?.codigo).toBe('no-existe');
    expect((await mirar('/roto'))?.codigo).toBe('error');
    expect((await mirar('/espera'))?.codigo).toBe('error');
    expect((await mirar('/bucle'))?.detalle).toMatch(/redirecciones/);
    expect((await mirar('/lenta'))?.detalle).toMatch(/tarda demasiado/);
  });

  it('avisa cuando Google pide iniciar sesión o el formulario está cerrado', async () => {
    expect((await mirar('/documento-privado'))?.codigo).toBe('pide-sesion');
    expect((await mirar('/formulario'))?.codigo).toBe('formulario-cerrado');
  });

  it('no marca las webs que solo rechazan a los programas (403)', async () => {
    expect(await mirar('/prohibido')).toBeNull();
  });

  it('no comprueba direcciones de la red interna', async () => {
    let pedidas = 0;
    const contar: typeof fetch = async (...a) => { pedidas++; return fetch(...a); };
    expect(await comprobarDestino(base + '/no-existe', { fetch: contar })).toBeNull();
    expect(await comprobarDestino('http://interno.example/x', { fetch: contar, resolver: async () => ['10.0.0.5'] })).toBeNull();
    expect(pedidas).toBe(0);
  });

  it('distingue bien las direcciones internas de las públicas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1', '::ffff:10.0.0.1']) expect(esIpInterna(ip), ip).toBe(true);
    // Una IPv4 pública no puede salir como interna (pasó con el rango ::ffff:0:0/96 en la lista).
    for (const ip of ['8.8.8.8', '142.250.184.14', '2a00:1450:4003:80e::200e', '::ffff:8.8.8.8']) expect(esIpInterna(ip), ip).toBe(false);
  });

  it('explica los fallos de conexión', () => {
    const fallo = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
    expect(problemaDeConexion(fallo('ENOTFOUND')).detalle).toMatch(/dominio ya no existe/);
    expect(problemaDeConexion(fallo('DEPTH_ZERO_SELF_SIGNED_CERT')).detalle).toMatch(/certificado/);
    expect(problemaDeConexion(fallo('ECONNREFUSED')).codigo).toBe('no-responde');
  });
});

describe('vídeos de YouTube', () => {
  it('reconoce los enlaces de vídeo', () => {
    expect(videoDeYoutube('https://www.youtube.com/watch?v=abc123&t=20')).toBe('abc123');
    expect(videoDeYoutube('https://youtu.be/abc123?t=15')).toBe('abc123');
    expect(videoDeYoutube('https://youtube.com/shorts/abc123')).toBe('abc123');
    expect(videoDeYoutube('https://www.youtube.com/@canal')).toBeNull();
    expect(videoDeYoutube('https://ejemplo.com/watch?v=abc')).toBeNull();
  });

  it('pregunta a YouTube si el vídeo sigue ahí, sin dar por roto lo que solo no se puede insertar', async () => {
    const con = (estado: number): typeof fetch => async () => new Response(null, { status: estado });
    const url = 'https://youtu.be/abc123';
    expect((await comprobarDestino(url, { fetch: con(404) }))?.codigo).toBe('no-existe');
    expect((await comprobarDestino(url, { fetch: con(400) }))?.codigo).toBe('no-existe');
    expect(await comprobarDestino(url, { fetch: con(401) })).toBeNull();
    expect(await comprobarDestino(url, { fetch: con(200) })).toBeNull();
  });
});
