/**
 * Migra usuarios y enlaces de la app anterior a partir de su exportación en CSV.
 *
 *   node --env-file=.env scripts/migrar.ts --usuarios usuarios.csv --enlaces enlaces.csv [--probar]
 *
 * - Se puede repetir: actualiza lo que ya migró (por el id de la app anterior) y no duplica nada.
 * - Todo va en una transacción: o entra entero o no entra nada.
 * - Al final comprueba los recuentos y que cada nombre lleva a su destino; si algo no cuadra, deshace.
 * - Con --probar hace lo mismo y deshace al final, para ver el resultado sin tocar la base.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';
import { conectar, migrar } from '../src/db.ts';
import { planificar, type FilaEnlace, type FilaUsuario } from '../src/migracion.ts';
import { reglasDelEntorno } from '../src/acceso.ts';

const { values: a } = parseArgs({ options: { usuarios: { type: 'string' }, enlaces: { type: 'string' }, probar: { type: 'boolean', default: false } } });
if (!a.usuarios || !a.enlaces) {
  console.error('Uso: node --env-file=.env scripts/migrar.ts --usuarios usuarios.csv --enlaces enlaces.csv [--probar]');
  process.exit(2);
}
const leer = <T>(f: string) => parse(fs.readFileSync(f, 'utf8'), { columns: true, skip_empty_lines: true }) as T[];
const filasUsuarios = leer<FilaUsuario>(a.usuarios), filasEnlaces = leer<FilaEnlace>(a.enlaces);
const plan = planificar(filasUsuarios, filasEnlaces, reglasDelEntorno());
const d = plan.descartes;

console.log(`Leídos: ${filasUsuarios.length} usuarios y ${filasEnlaces.length} enlaces.`);
console.log(`Se migran: ${plan.usuarios.length} usuarios (${plan.usuarios.filter(u => u.admin).length} administradores) y ${plan.enlaces.length} enlaces.`);
console.log(`No se migran: ${d.usuariosExcluidos.length} cuentas excluidas con ${d.enlacesDeExcluidos.length} enlaces `
  + `(${d.enlacesDeExcluidos.reduce((s, e) => s + e.visitas, 0)} visitas en total), ${d.usuariosOtroDominio.length} cuentas de otro dominio.`);
for (const e of plan.enlaces.filter(e => e.fundidos.length)) {
  console.log(`  Repetido «${e.nombre}»: se queda el ${e.idAntiguo} y se le suman las visitas de ${e.fundidos.join(', ')} (total ${e.visitasAnteriores}).`);
}
for (const e of d.nombresImposibles) console.log(`  Fuera, nombre que no puede ser dirección: ${e.id} «${e.nombre}»`);
for (const e of d.destinosNoValidos) console.log(`  Fuera, destino no válido: ${e.id} «${e.nombre}» → ${e.destino}`);
if (plan.choquesConRutas.length) {
  console.error(`Estos nombres chocan con rutas de la app: ${plan.choquesConRutas.join(', ')}. Hay que renombrarlos antes.`);
  process.exit(1);
}

const bd = conectar(process.env.DATABASE_URL!);
await migrar(bd);
const c = await bd.connect();
try {
  await c.query('begin');
  const idDe = new Map<string, number>();
  for (const u of plan.usuarios) {
    const { rows } = await c.query<{ id: number }>(
      `insert into usuarios (correo, nombre, admin) values ($1, $2, $3)
       on conflict (correo) do update set nombre = excluded.nombre, admin = usuarios.admin or excluded.admin
       returning id`, [u.correo, u.nombre, u.admin]);
    idDe.set(u.correo, rows[0].id);
  }
  for (const e of plan.enlaces) {
    try {
      await c.query(
        `insert into enlaces (id_antiguo, nombre, destino, titulo, activo, usuario_id, visitas_anteriores, creado, actualizado)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id_antiguo) do update set nombre = excluded.nombre, destino = excluded.destino, titulo = excluded.titulo,
           activo = excluded.activo, usuario_id = excluded.usuario_id, visitas_anteriores = excluded.visitas_anteriores,
           creado = excluded.creado, actualizado = excluded.actualizado`,
        [e.idAntiguo, e.nombre, e.destino, e.titulo, e.activo, e.correoDueno ? idDe.get(e.correoDueno) : null,
          e.visitasAnteriores, e.creado, e.actualizado]);
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      throw new Error(`El nombre «${e.nombre}» (id ${e.idAntiguo}) ya lo usa un enlace creado después en esta app. Hay que cambiar uno de los dos.`);
    }
  }

  // Comprobaciones: recuentos y que cada nombre lleva a su destino.
  const n = async (sql: string, p: unknown[]) => (await c.query<{ n: number }>(sql, p)).rows[0].n;
  const usuariosEnBase = await n('select count(*)::int as n from usuarios where correo = any($1)', [plan.usuarios.map(u => u.correo)]);
  const enlacesEnBase = await n('select count(*)::int as n from enlaces where id_antiguo = any($1)', [plan.enlaces.map(e => e.idAntiguo)]);
  const visitasEnBase = await n('select coalesce(sum(visitas_anteriores), 0)::int as n from enlaces where id_antiguo = any($1)', [plan.enlaces.map(e => e.idAntiguo)]);
  const visitasPlan = plan.enlaces.reduce((s, e) => s + e.visitasAnteriores, 0);
  const { rows } = await c.query<{ nombre: string; destino: string; activo: boolean }>('select nombre, destino, activo from enlaces');
  const enBase = new Map(rows.map(r => [r.nombre.normalize('NFC').toLowerCase(), r]));
  const mal = plan.enlaces.filter(e => {
    const r = enBase.get(e.nombre.toLowerCase());
    return !r || r.destino !== e.destino || r.activo !== e.activo;
  });
  console.log(`Comprobación: ${usuariosEnBase}/${plan.usuarios.length} usuarios, ${enlacesEnBase}/${plan.enlaces.length} enlaces, `
    + `${visitasEnBase}/${visitasPlan} visitas anteriores, ${plan.enlaces.length - mal.length}/${plan.enlaces.length} nombres con su destino.`);
  if (usuariosEnBase !== plan.usuarios.length || enlacesEnBase !== plan.enlaces.length || visitasEnBase !== visitasPlan || mal.length) {
    throw new Error(`Los recuentos no cuadran${mal.length ? `; mal: ${mal.map(e => e.nombre).join(', ')}` : ''}.`);
  }
  if (a.probar) {
    await c.query('rollback');
    console.log('Prueba terminada: no se ha guardado nada (sin --probar se guarda).');
  } else {
    await c.query('commit');
    console.log('Migración guardada.');
  }
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('Migración deshecha:', (e as Error).message);
  process.exitCode = 1;
} finally {
  c.release();
  await bd.end();
}
