/**
 * Carga datos inventados para probar en local (nunca en producción): dos profesores y una docena de enlaces con
 * visitas repartidas por días. Uso: node --env-file=.env scripts/datos-de-prueba.ts
 */
import { conectar, migrar } from '../src/db.ts';
import { hoy, sumarDias } from '../src/fechas.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Los datos de prueba no van en producción.');
const bd = conectar(process.env.DATABASE_URL!);
await migrar(bd);

const dominio = process.env.DOMINIO_CORREO || 'colegio.example';
const usuarios = [
  [`ana.perez@${dominio}`, 'Ana Pérez', true],
  [`luis.gomez@${dominio}`, 'Luis Gómez', false],
] as const;
const ids: number[] = [];
for (const [correo, nombre, admin] of usuarios) {
  const { rows } = await bd.query<{ id: number }>(
    `insert into usuarios (correo, nombre, admin) values ($1, $2, $3)
     on conflict (correo) do update set nombre = excluded.nombre, admin = excluded.admin returning id`, [correo, nombre, admin]);
  ids.push(rows[0].id);
}

const h = hoy();
// [nombre, título, destino, etiqueta, activo, caduca, dueño, visitas anteriores, visitas recientes por día (aprox.)]
const enlaces: [string, string, string, string | null, boolean, string | null, number | null, number, number][] = [
  ['excursion-museo', 'Excursión al museo: autorización', 'https://forms.example.com/excursion', 'Familias', true, '2027-06-30', 0, 0, 6],
  ['menu-octubre', 'Menú del comedor de octubre', 'https://drive.google.com/file/d/ejemploMenuOctubre/view', 'Comedor', true, null, 0, 0, 30],
  ['matricula', 'Matrícula 2027-28', 'https://colegio.example/matricula', 'Secretaría', true, null, 0, 2219, 3],
  ['KXRT', 'Función de Navidad (vídeo)', 'https://www.youtube.com/watch?v=ejemploNavidad', 'Eventos', false, null, 0, 87, 0],
  ['HPMW', 'Ficha de lectura 3.º Primaria', 'https://docs.google.com/document/d/ejemploLectura/edit', 'Primaria', true, null, 0, 0, 1],
  ['puertas-abiertas', 'Jornada de puertas abiertas', 'https://colegio.example/puertas-abiertas', 'Eventos', true, sumarDias(h, -14), 0, 618, 0],
  ['huerto', 'Diario del huerto escolar', 'https://sites.google.com/view/ejemplo-huerto', 'Primaria', true, null, 1, 140, 2],
  ['robotica', 'Taller de robótica', 'https://colegio.example/robotica', 'Extraescolares', true, null, 1, 512, 4],
  ['Qx7b', 'Visita virtual (nombre heredado)', 'https://www.google.com/maps/@10.5,-20.1,3a,82y', null, true, null, 1, 31, 0],
  ['otoño', 'Canciones de otoño (nombre con ñ)', 'https://drive.google.com/file/d/ejemploAudio/view', 'Infantil', true, null, 1, 19, 0],
  ['+DATOS', 'Tarifas (nombre heredado con +)', 'https://drive.google.com/file/d/ejemploTarifas/view', 'Secretaría', true, null, 1, 64, 1],
  ['notas', 'Notas de evaluación', 'https://notas.example.com', null, true, null, null, 5120, 5],
];
let n = 0;
for (const [nombre, titulo, destino, etiqueta, activo, caduca, dueno, anteriores, ritmo] of enlaces) {
  const { rows } = await bd.query<{ id: number }>(
    `insert into enlaces (nombre, titulo, destino, etiqueta, activo, caduca, usuario_id, visitas_anteriores, creado)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(days => $9))
     on conflict (lower(nombre)) do update set titulo = excluded.titulo, usuario_id = excluded.usuario_id returning id`,
    [nombre, titulo, destino, etiqueta, activo, caduca, dueno === null ? null : ids[dueno], anteriores, 90 - n * 6]);
  const id = rows[0].id;
  await bd.query('delete from visitas where enlace_id = $1', [id]);
  for (let d = 0; d < 84; d++) {
    // Visitas inventadas con forma: más entre semana, alguna semana con pico.
    const dia = sumarDias(h, -d), semana = new Date(dia).getUTCDay();
    const total = Math.round(ritmo * (semana === 0 || semana === 6 ? 0.2 : 1) * (1 + Math.sin(d / 5 + n)) * (d > 60 ? 0.3 : 1));
    if (total > 0) await bd.query('insert into visitas (enlace_id, dia, total) values ($1, $2, $3)', [id, dia, total]);
  }
  n++;
}
console.log(`Datos de prueba: ${usuarios.length} usuarios y ${enlaces.length} enlaces.`);
await bd.end();
