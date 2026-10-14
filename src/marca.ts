/**
 * La marca del centro: colores y logos. Vive en una carpeta aparte (variable MARCA), con:
 *   marca.json   los cinco colores con su nombre (ver marca-ejemplo/marca.json)
 *   logo.svg     el logo horizontal (pantalla de entrada)
 *   isotipo.svg  el logo cuadrado (centro del QR, icono de la pestaña, páginas pequeñas)
 * Sin MARCA se usa marca-ejemplo/, neutra.
 *
 * Papel de cada color: principal (botones, enlaces, QR), segundo (también «activo» y «bien»), tercero (también
 * avisos de error), acento (solo detalles: sobre blanco se lee mal) y oscuro (QR en un color sobrio).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ruta } from './raiz.ts';

export const PAPELES = ['principal', 'segundo', 'tercero', 'acento', 'oscuro'] as const;
export type Papel = typeof PAPELES[number];
export type Color = { nombre: string; valor: string };
export type Marca = { dir: string; colores: Record<Papel, Color> };

let marca: Marca | undefined;

export function cargarMarca(): Marca {
  if (marca) return marca;
  const dir = path.resolve(process.env.MARCA || ruta('marca-ejemplo'));
  const datos = JSON.parse(fs.readFileSync(path.join(dir, 'marca.json'), 'utf8')) as { colores?: Partial<Record<Papel, Color>> };
  for (const p of PAPELES) {
    const c = datos.colores?.[p];
    if (!c || !/^#[0-9a-f]{6}$/i.test(c.valor) || !c.nombre) throw new Error(`marca.json: falta el color «${p}» con nombre y valor #rrggbb`);
  }
  for (const f of ['logo.svg', 'isotipo.svg']) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`Falta ${f} en la carpeta de marca ${dir}`);
  }
  marca = { dir, colores: datos.colores as Record<Papel, Color> };
  return marca;
}

export function ficheroDeMarca(nombre: 'logo.svg' | 'isotipo.svg'): string {
  return path.join(cargarMarca().dir, nombre);
}

/** Variables CSS de la marca, con sus tonos claros. */
export function cssDeMarca(): string {
  const c = cargarMarca().colores;
  const claro = { principal: 10, segundo: 10, tercero: 9, acento: 16, oscuro: 8 };
  return ':root{' + PAPELES.map(p => `--${p}:${c[p].valor};--${p}-claro:color-mix(in srgb,var(--${p}) ${claro[p]}%,#fff);`).join('') + '}\n';
}
