/**
 * Pide a la app cada nombre de la exportación de la app anterior y comprueba adónde lleva.
 * Para usar antes de publicarla (contra su dirección interna) y otra vez después, contra la pública.
 *
 *   node scripts/comprobar-redirecciones.ts --url https://enlaces.ejemplo.es --usuarios usuarios.csv --enlaces enlaces.csv
 *
 * Usa peticiones HEAD, que no cuentan como visita.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';
import { planificar, type FilaEnlace, type FilaUsuario } from '../src/migracion.ts';
import { reglasDelEntorno } from '../src/acceso.ts';

const { values: a } = parseArgs({ options: { url: { type: 'string' }, usuarios: { type: 'string' }, enlaces: { type: 'string' } } });
if (!a.url || !a.usuarios || !a.enlaces) {
  console.error('Uso: node scripts/comprobar-redirecciones.ts --url https://… --usuarios usuarios.csv --enlaces enlaces.csv');
  process.exit(2);
}
const leer = <T>(f: string) => parse(fs.readFileSync(f, 'utf8'), { columns: true, skip_empty_lines: true }) as T[];
const plan = planificar(leer<FilaUsuario>(a.usuarios), leer<FilaEnlace>(a.enlaces), reglasDelEntorno());
const base = a.url.replace(/\/+$/, '');

async function pedir(nombre: string) {
  const r = await fetch(`${base}/${encodeURIComponent(nombre)}`, { method: 'HEAD', redirect: 'manual' });
  return { estado: r.status, destino: r.headers.get('location') };
}

const fallos: string[] = [];
let bien = 0;
for (const e of plan.enlaces) {
  const r = await pedir(e.nombre);
  const esperado = e.activo ? 302 : 404;
  if (r.estado === esperado && (!e.activo || r.destino === e.destino)) bien++;
  else fallos.push(`${e.nombre}: ${r.estado} ${r.destino ?? ''} (se esperaba ${esperado} ${e.activo ? e.destino : ''})`);
}
// Lo que no se migra tiene que dar la página de «no existe», salvo que su nombre lo use otro enlace migrado.
const migrados = new Set(plan.enlaces.map(e => e.nombre.toLowerCase()));
const fuera = [...plan.descartes.enlacesDeExcluidos, ...plan.descartes.destinosNoValidos].filter(e => !migrados.has(e.nombre.toLowerCase()));
let fueraBien = 0;
for (const e of fuera) {
  const r = await pedir(e.nombre);
  if (r.estado === 404) fueraBien++;
  else fallos.push(`${e.nombre} (no migrado): ${r.estado} ${r.destino ?? ''}`);
}
console.log(`Migrados: ${bien}/${plan.enlaces.length} llevan a su destino. No migrados: ${fueraBien}/${fuera.length} dan «no existe».`);
for (const f of fallos) console.log('  MAL', f);
process.exitCode = fallos.length ? 1 : 0;
