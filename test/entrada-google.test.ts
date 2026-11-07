/**
 * La entrada con Google, sin salir a Google: openid-client simulado. Necesita PostgreSQL (la base de pruebas).
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('openid-client', async original => ({
  ...await original<typeof import('openid-client')>(),
  discovery: async () => ({}),
  buildAuthorizationUrl: () => new URL('https://accounts.google.com/o/oauth2/v2/auth?simulada=1'),
  authorizationCodeGrant: async () => ({
    claims: () => ({ email: 'ana.perez@colegio.example', email_verified: true, hd: 'colegio.example', name: 'Ana Pérez' }),
  }),
}));

const PUERTO = 3990;
const BASE = `http://localhost:${PUERTO}`;
process.env.URL_PUBLICA = BASE;
delete process.env.ENTRADA_DE_PRUEBA;
process.env.GOOGLE_CLIENT_ID = 'prueba.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'prueba';
process.env.DOMINIO_CORREO = 'colegio.example';
process.env.COMPROBAR_ENLACES = 'no';
process.env.INFORME_MENSUAL = 'no';
process.env.DATABASE_URL = process.env.DATABASE_URL_PRUEBAS ?? 'postgres://enlaces:enlaces@localhost:5433/enlaces_pruebas';

const { conectar, migrar } = await import('../src/db.ts');
const { crearApp } = await import('../src/servidor.ts');

const bd = conectar(process.env.DATABASE_URL);
let servidor: Server;

beforeAll(async () => {
  await bd.query('drop schema public cascade; create schema public');
  await migrar(bd);
  servidor = crearApp(bd, null).listen(PUERTO);
});

afterAll(async () => {
  await new Promise(ok => servidor?.close(ok));
  await bd.end();
});

describe('entrada con Google', () => {
  it('lleva a Google, y la sesión a medias que guarda caduca en 10 minutos, no en 30 días', async () => {
    const r = await fetch(`${BASE}/entrar`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('accounts.google.com');
    // Cualquiera puede abrir /entrar sin llegar a entrar: si cada vez quedara una sesión de 30 días, una ráfaga
    // llenaría la tabla. Las de quien no termina caducan pronto y las borra la limpieza de cada hora.
    const { rows } = await bd.query<{ segundos: number }>('select extract(epoch from (expire - localtimestamp))::int as segundos from sesiones');
    expect(rows).toHaveLength(1);
    expect(rows[0].segundos).toBeGreaterThan(0);
    // Unos segundos de margen por el redondeo y lo que tarda la petición.
    expect(rows[0].segundos).toBeLessThanOrEqual(10 * 60 + 5);
  });

  it('quien termina de entrar sigue con su sesión de 30 días', async () => {
    await bd.query('delete from sesiones');
    const ida = await fetch(`${BASE}/entrar`, { redirect: 'manual' });
    const galleta = ida.headers.get('set-cookie')!.split(';')[0];
    const vuelta = await fetch(`${BASE}/auth/google/callback?code=x&state=y`, { redirect: 'manual', headers: { cookie: galleta } });
    expect(vuelta.status).toBe(302);
    expect(vuelta.headers.get('location')).toBe('/panel');
    const { rows } = await bd.query<{ segundos: number }>(
      "select extract(epoch from (expire - localtimestamp))::int as segundos from sesiones where sess::text like '%usuarioId%'");
    expect(rows).toHaveLength(1);
    expect(rows[0].segundos).toBeGreaterThan(29 * 24 * 3600);
  });
});
