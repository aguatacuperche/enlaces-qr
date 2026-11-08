/**
 * La API para otros programas (compatible con YOURLS) y su página en el panel, con la app de verdad y su base.
 * Necesitan PostgreSQL: docker compose -f docker-compose.dev.yml up -d
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PUERTO = 3988;
const BASE = `http://localhost:${PUERTO}`;
process.env.URL_PUBLICA = BASE;
process.env.ENTRADA_DE_PRUEBA = 'si';
process.env.DOMINIO_CORREO = 'colegio.example';
process.env.CORREOS_EXCLUIDOS = '\\d';
process.env.COMPROBAR_ENLACES = 'no';
process.env.INFORME_MENSUAL = 'no';
process.env.DATABASE_URL = process.env.DATABASE_URL_PRUEBAS ?? 'postgres://enlaces:enlaces@localhost:5433/enlaces_pruebas';

const { conectar, migrar } = await import('../src/db.ts');
const { crearApp } = await import('../src/servidor.ts');
const { recargar } = await import('../src/redireccion.ts');
const { destinatarios } = await import('../src/informe.ts');

const bd = conectar(process.env.DATABASE_URL);
let servidor: Server;
const ids: Record<string, number> = {};
let admin = '', profe = '';

async function pedir(ruta: string, op: { galleta?: string; cuerpo?: Record<string, string>; metodo?: string; origen?: string | null; tipo?: string } = {}) {
  const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0 (pruebas)' };
  if (op.galleta) headers.cookie = op.galleta;
  if (op.cuerpo) headers['content-type'] = op.tipo ?? 'application/x-www-form-urlencoded';
  if (op.cuerpo && op.origen !== null) headers.origin = op.origen ?? BASE;
  const r = await fetch(BASE + ruta, {
    method: op.metodo ?? (op.cuerpo ? 'POST' : 'GET'), headers, redirect: 'manual',
    body: op.cuerpo ? new URLSearchParams(op.cuerpo) : undefined,
  });
  return { estado: r.status, destino: r.headers.get('location'), tipo: r.headers.get('content-type') ?? '', texto: await r.text(), galleta: r.headers.get('set-cookie')?.split(';')[0] };
}

/** Lo que manda un programa: sin cookie ni cabecera Origin. */
async function api(campos: Record<string, string>) {
  const r = await pedir('/yourls-api.php', { cuerpo: { format: 'json', ...campos }, origen: null });
  return { estado: r.estado, tipo: r.tipo, texto: r.texto, json: r.tipo.includes('json') ? JSON.parse(r.texto) : null };
}

async function entrarComo(correo: string) {
  const r = await pedir('/entrar/prueba', { cuerpo: { correo } });
  expect(r.estado).toBe(302);
  return r.galleta!;
}

/** Crea un programa desde el panel y devuelve la llave que enseña la página. */
async function nuevoPrograma(nombre: string, dominios: string, porMinuto = '60') {
  const r = await pedir('/panel/programas', { galleta: admin, cuerpo: { nombre, dominios, por_minuto: porMinuto } });
  expect(r.estado).toBe(200);
  const llave = r.texto.match(/<div class="llave"><code>([^<]+)<\/code>/)?.[1];
  expect(llave).toBeTruthy();
  const { rows } = await bd.query<{ id: number }>('select id from programas where nombre = $1', [nombre]);
  return { llave: llave!, id: rows[0].id };
}

const programaDe = async (nombre: string) =>
  (await bd.query<{ usuario_id: number | null; programa_id: number | null; destino: string }>(
    'select usuario_id, programa_id, destino from enlaces where lower(nombre) = lower($1)', [nombre])).rows[0];

let comedor: { llave: string; id: number };

beforeAll(async () => {
  await bd.query('drop schema public cascade; create schema public');
  await migrar(bd);
  const u = async (correo: string, nombre: string, esAdmin = false) =>
    (await bd.query<{ id: number }>('insert into usuarios (correo, nombre, admin) values ($1, $2, $3) returning id', [correo, nombre, esAdmin])).rows[0].id;
  ids.ana = await u('ana.perez@colegio.example', 'Ana Pérez');
  ids.luis = await u('luis.gomez@colegio.example', 'Luis Gómez', true);
  ids.museo = (await bd.query<{ id: number }>(
    "insert into enlaces (nombre, destino, titulo, usuario_id) values ('excursion-museo', 'https://aula.colegio.example/museo', 'Museo', $1) returning id", [ids.ana])).rows[0].id;
  await recargar(bd);
  servidor = crearApp(bd, null).listen(PUERTO);
  admin = await entrarComo('luis.gomez@colegio.example');
  profe = await entrarComo('ana.perez@colegio.example');
  comedor = await nuevoPrograma('Comedor', 'aula.colegio.example, https://otra.colegio.example/algo');
});

afterAll(async () => {
  await new Promise(ok => servidor?.close(ok));
  await bd.end();
});

describe('programas en el panel', () => {
  it('solo los ven los administradores', async () => {
    expect((await pedir('/panel/programas', { galleta: profe })).estado).toBe(404);
    const r = await pedir('/panel/programas', { galleta: admin });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('Comedor');
    expect(r.texto).toContain('aula.colegio.example, otra.colegio.example');
    expect(r.texto).toContain(`${BASE}/yourls-api.php`);
    // La llave solo se enseña al crearla: guardada, solo su huella.
    expect(r.texto).not.toContain(comedor.llave);
    const { rows } = await bd.query<{ llave: string }>('select llave from programas where id = $1', [comedor.id]);
    expect(rows[0].llave).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza un nombre repetido o un dominio que no lo es', async () => {
    const repetido = await pedir('/panel/programas', { galleta: admin, cuerpo: { nombre: 'comedor', dominios: 'aula.colegio.example', por_minuto: '60' } });
    expect(repetido.estado).toBe(422);
    expect(repetido.texto).toContain('Ya hay un programa que se llama');
    const sinPunto = await pedir('/panel/programas', { galleta: admin, cuerpo: { nombre: 'Biblioteca', dominios: 'localhost', por_minuto: '60' } });
    expect(sinPunto.estado).toBe(422);
    expect(sinPunto.texto).toContain('no parece un dominio');
  });
});

describe('API compatible con YOURLS', () => {
  it('pide POST, la llave en el cuerpo y una llave válida', async () => {
    const get = await pedir(`/yourls-api.php?action=shorturl&url=https://aula.colegio.example/x&format=json&signature=${comedor.llave}`);
    expect(get.estado).toBe(405);
    expect(JSON.parse(get.texto).code).toBe('error:method');
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/x' })).json.code).toBe('error:auth');
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/x', signature: 'no-es-la-llave' })).estado).toBe(403);
    const multipart = await pedir('/yourls-api.php', { cuerpo: { a: 'b' }, tipo: 'multipart/form-data; boundary=x', origen: null });
    expect(multipart.estado).toBe(415);
  });

  it('crea un enlace con nombre automático, a nombre del programa, que redirige', async () => {
    const r = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=uno', title: 'Monitores · Turno 1', signature: comedor.llave });
    expect(r.estado).toBe(200);
    expect(r.json.status).toBe('success');
    expect(r.json.shorturl).toMatch(new RegExp(`^${BASE}/[A-HJKMNP-Z]{4}$`));
    expect(r.json.url).toMatchObject({ url: 'https://aula.colegio.example/k.php?t=uno', title: 'Monitores · Turno 1' });
    const nombre = r.json.url.keyword;
    expect(await programaDe(nombre)).toMatchObject({ usuario_id: null, programa_id: comedor.id });
    const ir = await pedir('/' + nombre.toLowerCase());
    expect(ir.estado).toBe(302);
    expect(ir.destino).toBe('https://aula.colegio.example/k.php?t=uno');
  });

  it('da también las direcciones del QR del enlace, que admiten las opciones del creador', async () => {
    const r = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=qr', signature: comedor.llave });
    const nombre = r.json.url.keyword;
    expect(r.json).toMatchObject({ qrsvg: `${BASE}/svg/${nombre}`, qrpng: `${BASE}/png/${nombre}` });
    const svg = await pedir(`/svg/${nombre}?fondo=transparente&color=principal&centro=logo`);
    expect(svg.estado).toBe(200);
    expect(svg.tipo).toContain('image/svg+xml');
    expect((await pedir(new URL(r.json.qrpng).pathname)).tipo).toContain('image/png');
    // También al pedir otra vez el mismo destino y al cambiarlo.
    const otra = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=qr', signature: comedor.llave });
    expect(otra.json).toMatchObject({ code: 'error:url', qrsvg: r.json.qrsvg, qrpng: r.json.qrpng });
    const cambio = await api({ action: 'update', shorturl: nombre, url: 'https://aula.colegio.example/k.php?t=qr2', signature: comedor.llave });
    expect(cambio.json).toMatchObject({ status: 'success', qrsvg: r.json.qrsvg });
  });

  it('si el destino ya tiene enlace del programa, devuelve el mismo, como YOURLS', async () => {
    const primero = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=dos', signature: comedor.llave });
    const otra = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=dos', signature: comedor.llave });
    expect(otra.estado).toBe(200);
    expect(otra.json).toMatchObject({ status: 'fail', code: 'error:url', shorturl: primero.json.shorturl });
    // Uno de un profesor hacia el mismo sitio no cuenta: el programa no lo puede cambiar.
    const museo = await api({ action: 'shorturl', url: 'https://aula.colegio.example/museo', signature: comedor.llave });
    expect(museo.json.status).toBe('success');
    expect(museo.json.shorturl).not.toBe(`${BASE}/excursion-museo`);
  });

  it('acepta un nombre pedido y rechaza uno ocupado o que no vale', async () => {
    const r = await api({ action: 'shorturl', url: 'https://otra.colegio.example/menu', keyword: 'menu-semana', signature: comedor.llave });
    expect(r.json.shorturl).toBe(`${BASE}/menu-semana`);
    const ocupado = await api({ action: 'shorturl', url: 'https://aula.colegio.example/otro', keyword: 'Excursion-Museo', signature: comedor.llave });
    expect(ocupado.estado).toBe(400);
    expect(ocupado.json.code).toBe('error:keyword');
    const raro = await api({ action: 'shorturl', url: 'https://aula.colegio.example/otro2', keyword: 'con espacios', signature: comedor.llave });
    expect(raro.json.code).toBe('error:keyword');
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/otro3', keyword: 'panel', signature: comedor.llave })).json.code).toBe('error:keyword');
  });

  it('solo crea enlaces hacia los dominios del programa', async () => {
    const fuera = await api({ action: 'shorturl', url: 'https://malo.example/phishing', signature: comedor.llave });
    expect(fuera.estado).toBe(400);
    expect(fuera.json.code).toBe('error:domain');
    expect(fuera.json.message).toContain('aula.colegio.example');
    // Un subdominio no vale por estar debajo de uno permitido.
    expect((await api({ action: 'shorturl', url: 'https://x.aula.colegio.example/', signature: comedor.llave })).json.code).toBe('error:domain');
    expect((await api({ action: 'shorturl', url: 'no es una dirección', signature: comedor.llave })).json.code).toBe('error:nourl');
    expect((await api({ action: 'shorturl', signature: comedor.llave })).json.code).toBe('error:nourl');
    expect((await api({ action: 'otra', signature: comedor.llave })).json.code).toBe('error:action');
  });

  it('con format=simple devuelve solo el enlace corto', async () => {
    const r = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=tres', format: 'simple', signature: comedor.llave });
    expect(r.tipo).toContain('text/plain');
    expect(r.texto).toMatch(new RegExp(`^${BASE}/[A-Z]{4}$`));
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/x', format: 'xml', signature: comedor.llave })).estado).toBe(400);
  });

  it('cambia el destino de sus enlaces, no el de los demás (update, como «edit url»)', async () => {
    const r = await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=viejo', signature: comedor.llave });
    const cambio = await api({ action: 'update', shorturl: r.json.shorturl, url: 'https://aula.colegio.example/k.php?t=nuevo', signature: comedor.llave });
    expect(cambio.estado).toBe(200);
    expect(cambio.json).toMatchObject({ status: 'success', message: 'success: updated', shorturl: r.json.shorturl });
    expect((await pedir('/' + r.json.url.keyword)).destino).toBe('https://aula.colegio.example/k.php?t=nuevo');
    // También con el nombre solo, y conserva el título si no se manda otro.
    await api({ action: 'update', shorturl: r.json.url.keyword.toLowerCase(), url: 'https://aula.colegio.example/k.php?t=otra', signature: comedor.llave });
    expect((await programaDe(r.json.url.keyword)).destino).toBe('https://aula.colegio.example/k.php?t=otra');
    const ajeno = await api({ action: 'update', shorturl: 'excursion-museo', url: 'https://aula.colegio.example/robado', signature: comedor.llave });
    expect(ajeno.estado).toBe(404);
    expect((await pedir('/excursion-museo')).destino).toBe('https://aula.colegio.example/museo');
    const fuera = await api({ action: 'update', shorturl: r.json.shorturl, url: 'https://malo.example/', signature: comedor.llave });
    expect(fuera.json.code).toBe('error:domain');
    expect((await api({ action: 'update', url: 'https://aula.colegio.example/', signature: comedor.llave })).estado).toBe(400);
  });

  it('para al programa que pasa de su tope por minuto', async () => {
    const lento = await nuevoPrograma('Pantallas', 'aula.colegio.example', '3');
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) estados.push((await api({ action: 'shorturl', url: `https://aula.colegio.example/p${i}`, signature: lento.llave })).estado);
    // 7 peticiones con tope de 3: aunque justo cambie el minuto en medio, alguna se para.
    expect(estados.slice(0, 3)).toEqual([200, 200, 200]);
    expect(estados).toContain(429);
    // A los demás programas no les afecta.
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/k.php?t=cuatro', signature: comedor.llave })).estado).toBe(200);
  });

  it('retirado, su llave no vale; con una llave nueva, vale la nueva y no la vieja', async () => {
    const p = await nuevoPrograma('Carnés', 'aula.colegio.example');
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/c1', signature: p.llave })).estado).toBe(200);
    expect((await pedir(`/panel/programas/${p.id}/retirar`, { galleta: admin, cuerpo: {} })).estado).toBe(302);
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/c2', signature: p.llave })).estado).toBe(403);
    // Sus enlaces siguen funcionando.
    expect((await pedir('/' + (await bd.query<{ nombre: string }>('select nombre from enlaces where programa_id = $1', [p.id])).rows[0].nombre)).estado).toBe(302);
    const r = await pedir(`/panel/programas/${p.id}/llave`, { galleta: admin, cuerpo: {} });
    const nueva = r.texto.match(/<div class="llave"><code>([^<]+)<\/code>/)![1];
    expect(nueva).not.toBe(p.llave);
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/c3', signature: nueva })).estado).toBe(200);
    expect((await api({ action: 'shorturl', url: 'https://aula.colegio.example/c4', signature: p.llave })).estado).toBe(403);
  });

  it('cambiar los dominios vale para lo que cree a partir de entonces', async () => {
    const r = await pedir(`/panel/programas/${comedor.id}`, { galleta: admin, cuerpo: { nombre: 'Comedor', dominios: 'aula.colegio.example', por_minuto: '60' } });
    expect(r.destino).toBe('/panel/programas?guardado=1');
    expect((await api({ action: 'shorturl', url: 'https://otra.colegio.example/menu2', signature: comedor.llave })).json.code).toBe('error:domain');
    expect((await pedir('/menu-semana')).destino).toBe('https://otra.colegio.example/menu');
  });
});

describe('los enlaces de un programa en el panel', () => {
  it('salen en Todos a su nombre, y no como «sin dueño» ni en el informe', async () => {
    const todos = await pedir('/panel/todos', { galleta: admin });
    expect(todos.texto).toContain('<td>Comedor</td>');
    const sinDueno = await pedir('/panel/todos?dueno=sin', { galleta: admin });
    expect(sinDueno.texto).not.toContain('<td>Comedor</td>');
    const suyos = await pedir(`/panel/todos?programa=${comedor.id}`, { galleta: admin });
    expect(suyos.texto).toContain('Enlaces de Comedor');
    expect(suyos.texto).toContain('menu-semana');
    expect(suyos.texto).not.toContain('excursion-museo');
    // Ni pasar «los sin dueño» a un profesor se los lleva, ni el informe mensual los cuenta.
    expect((await pedir('/panel/usuarios/pasar', { galleta: admin, cuerpo: { de: 'sin', a: String(ids.ana) } })).destino).toBe('/panel/usuarios?hecho=0');
    await bd.query("update enlaces set problema = 'no-existe', problema_desde = now() where programa_id = $1", [comedor.id]);
    expect((await destinatarios(bd)).flatMap(d => d.enlaces).some(e => e.nombre === 'menu-semana')).toBe(false);
    await bd.query('update enlaces set problema = null, problema_desde = null where programa_id = $1', [comedor.id]);
  });

  it('un administrador se lo puede pasar a un profesor, y entonces el programa ya no lo cambia', async () => {
    const { rows: [e] } = await bd.query<{ id: number }>("select id from enlaces where nombre = 'menu-semana'");
    const ficha = await pedir(`/panel/enlaces/${e.id}`, { galleta: admin });
    expect(ficha.texto).toContain('por el programa Comedor');
    expect(ficha.texto).toContain('<option value="programa" selected>El programa Comedor</option>');
    // Sin tocar la lista, se queda como estaba.
    await pedir(`/panel/enlaces/${e.id}/dueno`, { galleta: admin, cuerpo: { usuario: 'programa' } });
    expect(await programaDe('menu-semana')).toMatchObject({ programa_id: comedor.id });
    await pedir(`/panel/enlaces/${e.id}/dueno`, { galleta: admin, cuerpo: { usuario: String(ids.ana) } });
    expect(await programaDe('menu-semana')).toMatchObject({ usuario_id: ids.ana, programa_id: null });
    const cambio = await api({ action: 'update', shorturl: 'menu-semana', url: 'https://aula.colegio.example/otra-vez', signature: comedor.llave });
    expect(cambio.estado).toBe(404);
  });
});
