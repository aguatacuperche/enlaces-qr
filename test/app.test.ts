/**
 * Pruebas de la app de verdad, con su base de datos (una base aparte, que se vacía al empezar).
 * Necesitan PostgreSQL: docker compose -f docker-compose.dev.yml up -d
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PUERTO = 3987;
const BASE = `http://localhost:${PUERTO}`;
process.env.URL_PUBLICA = BASE;
process.env.ENTRADA_DE_PRUEBA = 'si';
process.env.DOMINIO_CORREO = 'colegio.example';
process.env.CORREOS_EXCLUIDOS = '\\d';
process.env.DATABASE_URL = process.env.DATABASE_URL_PRUEBAS ?? 'postgres://enlaces:enlaces@localhost:5433/enlaces_pruebas';

const { conectar, migrar } = await import('../src/db.ts');
const { crearApp } = await import('../src/servidor.ts');
const { recargar } = await import('../src/redireccion.ts');

const bd = conectar(process.env.DATABASE_URL);
let servidor: Server;
const ids: Record<string, number> = {};

beforeAll(async () => {
  await bd.query('drop schema public cascade; create schema public');
  await migrar(bd);
  const u = async (correo: string, nombre: string, admin = false) =>
    (await bd.query<{ id: number }>('insert into usuarios (correo, nombre, admin) values ($1, $2, $3) returning id', [correo, nombre, admin])).rows[0].id;
  ids.ana = await u('ana.perez@colegio.example', 'Ana Pérez');
  ids.luis = await u('luis.gomez@colegio.example', 'Luis Gómez', true);
  const e = async (nombre: string, destino: string, extra: { activo?: boolean; caduca?: string; usuario?: number | null } = {}) =>
    (await bd.query<{ id: number }>('insert into enlaces (nombre, destino, titulo, activo, caduca, usuario_id) values ($1, $2, $1, $3, $4, $5) returning id',
      [nombre, destino, extra.activo ?? true, extra.caduca ?? null, extra.usuario === undefined ? ids.ana : extra.usuario])).rows[0].id;
  ids.museo = await e('excursion-museo', 'https://forms.example.com/museo');
  ids.qx7b = await e('Qx7b', 'https://maps.example.com/visita');
  ids.pana = await e('otoño', 'https://drive.example.com/audio');
  ids.info = await e('+DATOS', 'https://drive.example.com/tarifas', { usuario: ids.luis });
  ids.pausa = await e('KXRT', 'https://youtube.example.com/navidad', { activo: false });
  ids.caducado = await e('puertas-abiertas', 'https://colegio.example/pa', { caduca: '2020-01-01' });
  await recargar(bd);
  servidor = crearApp(bd).listen(PUERTO);
});

afterAll(async () => {
  await new Promise(ok => servidor?.close(ok));
  await bd.end();
});

const NAVEGADOR = 'Mozilla/5.0 (pruebas)';

async function pedir(ruta: string, op: { galleta?: string; cuerpo?: Record<string, string>; agente?: string; metodo?: string; origen?: string | null } = {}) {
  const headers: Record<string, string> = { 'user-agent': op.agente ?? NAVEGADOR };
  if (op.galleta) headers.cookie = op.galleta;
  if (op.cuerpo) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (op.cuerpo && op.origen !== null) headers.origin = op.origen ?? BASE;
  const r = await fetch(BASE + ruta, {
    method: op.metodo ?? (op.cuerpo ? 'POST' : 'GET'), headers, redirect: 'manual',
    body: op.cuerpo ? new URLSearchParams(op.cuerpo) : undefined,
  });
  return { estado: r.status, destino: r.headers.get('location'), tipo: r.headers.get('content-type') ?? '', texto: await r.text(), galleta: r.headers.get('set-cookie')?.split(';')[0] };
}

async function entrarComo(correo: string) {
  const r = await pedir('/entrar/prueba', { cuerpo: { correo } });
  expect(r.estado).toBe(302);
  return r.galleta!;
}

const visitas = async (id: number) => (await bd.query<{ n: number }>('select coalesce(sum(total), 0)::int as n from visitas where enlace_id = $1', [id])).rows[0].n;

describe('redirección', () => {
  it('lleva al destino sin distinguir mayúsculas', async () => {
    for (const ruta of ['/excursion-museo', '/EXCURSION-MUSEO', '/Excursion-Museo']) {
      const r = await pedir(ruta);
      expect(r.estado).toBe(302);
      expect(r.destino).toBe('https://forms.example.com/museo');
    }
  });

  it('respeta los nombres heredados: mayúsculas mezcladas, ñ y +', async () => {
    expect((await pedir('/Qx7b')).destino).toBe('https://maps.example.com/visita');
    expect((await pedir('/qx7b')).destino).toBe('https://maps.example.com/visita');
    expect((await pedir('/oto%C3%B1o')).destino).toBe('https://drive.example.com/audio');
    expect((await pedir('/oton%CC%83o')).destino).toBe('https://drive.example.com/audio');
    expect((await pedir('/+DATOS')).destino).toBe('https://drive.example.com/tarifas');
    expect((await pedir('/%2BDATOS')).destino).toBe('https://drive.example.com/tarifas');
  });

  it('enseña una página amable si no existe, está en pausa o ha caducado', async () => {
    const no = await pedir('/excursion-mueso');
    expect(no.estado).toBe(404);
    expect(no.texto).toContain('Este enlace no existe');
    expect(no.texto).toContain('¿Querías decir');
    expect(no.texto).toContain('/excursion-museo');
    const pausa = await pedir('/kxrt');
    expect(pausa.estado).toBe(404);
    expect(pausa.texto).toContain('está en pausa');
    const caducado = await pedir('/puertas-abiertas');
    expect(caducado.estado).toBe(410);
    expect(caducado.texto).toContain('1 de enero de 2020');
  });

  it('cuenta las visitas de personas, no las de robots ni las vistas previas', async () => {
    const antes = await visitas(ids.museo);
    await pedir('/excursion-museo');
    await pedir('/excursion-museo', { agente: 'WhatsApp/2.23' });
    await pedir('/excursion-museo', { agente: 'Googlebot/2.1' });
    await pedir('/excursion-museo', { metodo: 'HEAD' });
    await new Promise(r => setTimeout(r, 200));
    expect(await visitas(ids.museo)).toBe(antes + 1);
  });

  it('sigue dando el QR en /svg/ y /png/ como la app vieja', async () => {
    const svg = await pedir('/svg/excursion-museo');
    expect(svg.tipo).toContain('image/svg+xml');
    expect((await pedir('/png/Excursion-Museo')).tipo).toContain('image/png');
    expect((await pedir('/svg/no-existe')).estado).toBe(404);
  });
});

describe('entrada', () => {
  it('no deja entrar a cuentas excluidas (alumnos) ni de fuera', async () => {
    const alumno = await pedir('/entrar/prueba', { cuerpo: { correo: 'nombre2012a@colegio.example' } });
    expect(alumno.estado).toBe(403);
    expect(alumno.texto).toContain('Esta cuenta no tiene acceso');
    expect(alumno.galleta).toBeUndefined();
    const fuera = await pedir('/entrar/prueba', { cuerpo: { correo: 'alguien@gmail.com' } });
    expect(fuera.estado).toBe(403);
    expect(fuera.texto).toContain('no es del centro');
    expect((await bd.query("select 1 from usuarios where correo in ('nombre2012a@colegio.example', 'alguien@gmail.com')")).rowCount).toBe(0);
  });

  it('da de alta a un profesor nuevo la primera vez que entra', async () => {
    const g = await entrarComo('marta.diaz@colegio.example');
    expect((await pedir('/panel', { galleta: g })).estado).toBe(200);
    expect((await bd.query("select 1 from usuarios where correo = 'marta.diaz@colegio.example' and not admin")).rowCount).toBe(1);
  });

  it('el panel pide haber entrado', async () => {
    expect((await pedir('/panel')).destino).toBe('/');
  });

  it('rechaza formularios que no vienen de la propia app', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    const r = await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: 'https://example.com', nombre: 'otro-sitio' }, origen: 'https://malo.example.com' });
    expect(r.estado).toBe(403);
    expect((await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: 'https://example.com', nombre: 'sin-origen' }, origen: null })).estado).toBe(403);
  });
});

describe('panel', () => {
  it('crea un enlace con nombre automático o propio, y funciona al momento', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    const r = await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: 'https://example.com/menu', nombre: 'Menu-Octubre', titulo: 'Menú' } });
    expect(r.estado).toBe(302);
    expect((await pedir('/menu-octubre')).destino).toBe('https://example.com/menu');
    const auto = (await pedir('/panel/nombre?valor=', { galleta: g })).texto;
    expect(auto).toContain('problema');
  });

  it('no deja repetir nombres, ni con otras mayúsculas, ni usar nombres de la app', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    for (const nombre of ['excursion-museo', 'EXCURSION-MUSEO', 'qx7b', 'panel', 'con espacio']) {
      const r = await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: 'https://example.com', nombre } });
      expect(r.estado, nombre).toBe(422);
    }
    const mal = await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: 'javascript:alert(1)', nombre: 'malo' } });
    expect(mal.estado).toBe(422);
    const bucle = await pedir('/panel/enlaces', { galleta: g, cuerpo: { destino: `${BASE}/excursion-museo`, nombre: 'bucle' } });
    expect(bucle.estado).toBe(422);
    expect(JSON.parse((await pedir('/panel/nombre?valor=Excursion-Museo', { galleta: g })).texto).problema).toContain('ya existe');
  });

  it('cada profesor ve y toca solo lo suyo; el administrador, todo', async () => {
    const marta = await entrarComo('marta.diaz@colegio.example');
    expect((await pedir(`/panel/enlaces/${ids.museo}`, { galleta: marta })).estado).toBe(404);
    expect((await pedir(`/panel/enlaces/${ids.museo}/borrar`, { galleta: marta, cuerpo: {} })).estado).toBe(404);
    expect((await pedir('/panel/todos', { galleta: marta })).estado).toBe(404);
    const luis = await entrarComo('luis.gomez@colegio.example');
    expect((await pedir(`/panel/enlaces/${ids.museo}`, { galleta: luis })).estado).toBe(200);
    expect((await pedir('/panel/todos', { galleta: luis })).texto).toContain('excursion-museo');
  });

  it('pausar un enlace lo para al momento, y activarlo lo devuelve', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    await pedir(`/panel/enlaces/${ids.qx7b}/activo`, { galleta: g, cuerpo: {} });
    expect((await pedir('/Qx7b')).estado).toBe(404);
    await pedir(`/panel/enlaces/${ids.qx7b}/activo`, { galleta: g, cuerpo: {} });
    expect((await pedir('/Qx7b')).estado).toBe(302);
  });

  it('al editar se puede conservar un nombre heredado que hoy no se permitiría', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    const r = await pedir(`/panel/enlaces/${ids.pana}`, { galleta: g, cuerpo: { nombre: 'otoño', destino: 'https://drive.example.com/audio2', titulo: 'Audio', activo: 'si' } });
    expect(r.estado).toBe(302);
    expect((await pedir('/oto%C3%B1o')).destino).toBe('https://drive.example.com/audio2');
  });

  it('el creador de QR da SVG, PNG y PDF, y comprueba que se lee', async () => {
    const g = await entrarComo('ana.perez@colegio.example');
    const base = `/panel/enlaces/${ids.museo}/qr`;
    expect((await pedir(base, { galleta: g })).estado).toBe(200);
    expect((await pedir(`${base}.svg?color=verde&puntos=circulos`, { galleta: g })).tipo).toContain('image/svg+xml');
    expect((await pedir(`${base}.png?tamano=folio`, { galleta: g })).tipo).toContain('image/png');
    expect((await pedir(`${base}.pdf?tamano=cartel&descargar=1`, { galleta: g })).tipo).toContain('application/pdf');
    expect(JSON.parse((await pedir(`${base}.json?marco=nombre`, { galleta: g })).texto)).toEqual({ seLee: true });
    // La descarga guarda las opciones como preferidas.
    expect((await bd.query("select preferencias_qr->>'tamano' as t from usuarios where correo = 'ana.perez@colegio.example'")).rows[0].t).toBe('cartel');
  });

  it('el administrador puede pasar los enlaces de un profesor a otro', async () => {
    const luis = await entrarComo('luis.gomez@colegio.example');
    const r = await pedir('/panel/usuarios/pasar', { galleta: luis, cuerpo: { de: String(ids.luis), a: String(ids.ana) } });
    expect(r.destino).toBe('/panel/usuarios?hecho=1');
    expect((await bd.query('select usuario_id from enlaces where id = $1', [ids.info])).rows[0].usuario_id).toBe(ids.ana);
  });
});
