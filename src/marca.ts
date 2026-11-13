/**
 * La marca del centro: colores y logos. Vive en una carpeta aparte (variable MARCA), con:
 *   marca.json   los cinco colores con su nombre (ver marca-ejemplo/marca.json)
 *   logo.svg     el logo horizontal (pantalla de entrada)
 *   isotipo.svg  el logo cuadrado (centro del QR, icono de la pestaña, páginas pequeñas)
 * Sin MARCA se usa marca-ejemplo/, neutra.
 *
 * Papel de cada color: principal (botones, enlaces, QR), segundo (también «activo» y «bien»), tercero (también
 * avisos de error), acento (solo detalles: sobre blanco se lee mal) y oscuro (QR en un color sobrio).
 *
 * Los cuatro que van como texto, botón o QR tienen que leerse sobre blanco (contraste 4,5:1). Si la marca trae uno
 * más claro (un azul cielo, un naranja), se oscurece lo justo, en la pantalla, en el correo y en el QR, y se avisa al
 * arrancar. El de acento se deja tal cual: solo adorna.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ruta } from './raiz.ts';
import { legibleSobre, mezclar, rgb, textoSobre } from './colores.ts';

export const PAPELES = ['principal', 'segundo', 'tercero', 'acento', 'oscuro'] as const;
export type Papel = typeof PAPELES[number];
/** `valor`, el que se usa; `original`, el de marca.json si hubo que oscurecerlo. */
export type Color = { nombre: string; valor: string; original?: string };
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
  const colores = datos.colores as Record<Papel, Color>;
  for (const p of ['principal', 'segundo', 'tercero', 'oscuro'] as const) {
    const valor = legibleSobre(colores[p].valor);
    if (valor !== colores[p].valor.toLowerCase()) {
      console.warn(`Marca: el color ${p} (${colores[p].valor}) se lee mal sobre blanco; se usa ${valor}, algo más oscuro.`);
      colores[p] = { ...colores[p], valor, original: colores[p].valor };
    }
  }
  marca = { dir, colores };
  return marca;
}

export function ficheroDeMarca(nombre: 'logo.svg' | 'isotipo.svg'): string {
  return path.join(cargarMarca().dir, nombre);
}

/**
 * Variables CSS de la marca con todos sus tonos ya calculados (claros, oscuros, bordes, el texto que va encima), en
 * hexadecimal: color-mix() no lo entienden Chrome 109 (el último de Windows 7 y 8.1) ni los iPad con iPadOS 15, y con
 * él los botones se quedaban sin fondo al pasar el ratón.
 */
export function cssDeMarca(): string {
  const c = cargarMarca().colores;
  const v = (p: Papel) => c[p].valor;
  const blanco = '#ffffff', negro = '#000000';
  const claro = { principal: 0.10, segundo: 0.10, tercero: 0.09, acento: 0.16, oscuro: 0.08 };
  const vars: Record<string, string> = {};
  for (const p of PAPELES) {
    vars[p] = v(p);
    vars[`${p}-claro`] = mezclar(v(p), blanco, claro[p]);
    vars[`${p}-sobre`] = textoSobre(v(p));
  }
  Object.assign(vars, {
    'principal-hover': mezclar(v('principal'), negro, 0.8),
    'principal-suave': mezclar(v('principal'), blanco, 0.16),
    'principal-borde': mezclar(v('principal'), blanco, 0.28),
    'principal-medio': mezclar(v('principal'), blanco, 0.8),
    'principal-profundo': mezclar(v('principal'), negro, 0.7),
    'segundo-tinta': legibleSobre(mezclar(v('segundo'), negro, 0.55), vars['segundo-claro']),
    'tercero-tinta': legibleSobre(mezclar(v('tercero'), negro, 0.45), vars['tercero-claro']),
    'tercero-borde': mezclar(v('tercero'), blanco, 0.35),
    'tercero-tenue': mezclar(v('tercero'), blanco, 0.05),
    'tercero-hover': mezclar(v('tercero'), negro, 0.82),
    // El acento sobre blanco se lee mal: para texto, su versión oscura.
    'acento-tinta': legibleSobre(v('acento'), vars['acento-claro']),
    'acento-tenue': mezclar(v('acento'), blanco, 0.09),
    'acento-halo': `rgba(${rgb(v('acento')).join(',')},.28)`,
  });
  // Las etiquetas: cada una, con uno de los cuatro colores, en un fondo muy claro y con el texto que se lea.
  const etiquetas = (['principal', 'segundo', 'tercero', 'acento'] as const).map(p => {
    const fondo = mezclar(v(p), blanco, 0.12);
    return `.etiqueta.e-${p}{background:${fondo};color:${legibleSobre(mezclar(v(p), negro, 0.8), fondo)}}`;
  }).join('');
  return ':root{' + Object.entries(vars).map(([k, x]) => `--${k}:${x};`).join('') + '}\n' + etiquetas + '\n';
}
