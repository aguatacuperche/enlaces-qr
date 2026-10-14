/** Conexión a PostgreSQL y migraciones del esquema (los ficheros de `sql/`, en orden, una sola vez cada uno). */
import fs from 'node:fs';
import pg from 'pg';
import { ruta } from './raiz.ts';

// Las fechas sin hora (caduca, dia) se quedan como texto AAAA-MM-DD: sin sorpresas de zona horaria.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export type Bd = pg.Pool;

export function conectar(url: string): Bd {
  return new pg.Pool({ connectionString: url, max: 5 });
}

export async function migrar(bd: Bd): Promise<string[]> {
  await bd.query('create table if not exists migraciones (nombre text primary key, aplicada timestamptz not null default now())');
  const hechas = new Set((await bd.query<{ nombre: string }>('select nombre from migraciones')).rows.map(r => r.nombre));
  const aplicadas: string[] = [];
  for (const fichero of fs.readdirSync(ruta('sql')).filter(f => f.endsWith('.sql')).sort()) {
    if (hechas.has(fichero)) continue;
    const cliente = await bd.connect();
    try {
      await cliente.query('begin');
      await cliente.query(fs.readFileSync(ruta('sql', fichero), 'utf8'));
      await cliente.query('insert into migraciones (nombre) values ($1)', [fichero]);
      await cliente.query('commit');
      aplicadas.push(fichero);
    } catch (e) {
      await cliente.query('rollback');
      throw e;
    } finally {
      cliente.release();
    }
  }
  return aplicadas;
}
