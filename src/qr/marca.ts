/**
 * Material de marca para los QR: el isotipo del centro como SVG anidado y la tipografía Nunito para el texto del marco.
 * El texto se convierte en trazos, así el SVG descargado se ve igual en un ordenador que no tenga Nunito.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import { ficheroDeMarca } from '../marca.ts';

const require = createRequire(import.meta.url);

let isotipo: { atributos: string; contenido: string } | undefined;

/** El isotipo, colocado en (x, y) con lado `lado`, como <svg> anidado. */
export function isotipoAnidado(x: number, y: number, lado: number): string {
  if (!isotipo) {
    const svg = fs.readFileSync(ficheroDeMarca('isotipo.svg'), 'utf8')
      .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--.*?-->/gs, '')
      .replace(/<title>.*?<\/title>|<desc>.*?<\/desc>/gs, '');
    const raiz = svg.match(/<svg\b([^>]*)>/s);
    if (!raiz) throw new Error('isotipo.svg no es un SVG');
    let atributos = raiz[1];
    // Sin viewBox no se puede escalar: se saca del ancho y el alto originales.
    if (!/viewBox=/.test(atributos)) {
      const w = atributos.match(/\bwidth="([\d.]+)/)?.[1], h = atributos.match(/\bheight="([\d.]+)/)?.[1];
      if (!w || !h) throw new Error('isotipo.svg necesita viewBox (o ancho y alto)');
      atributos += ` viewBox="0 0 ${w} ${h}"`;
    }
    atributos = atributos.replace(/\s(?:x|y|width|height|role|aria-label|preserveAspectRatio)="[^"]*"/g, '');
    isotipo = { atributos, contenido: svg.slice(raiz.index! + raiz[0].length) };
  }
  return `<svg x="${x}" y="${y}" width="${lado}" height="${lado}"${isotipo.atributos}>${isotipo.contenido}`;
}

/**
 * Nunito viene partida por alfabetos: el latino básico, el resto de letras latinas (ł, ş, ő…), el cirílico y el
 * vietnamita. Cada letra se dibuja con la primera que la tenga; las que no tiene ninguna (los emoji) no se dibujan,
 * en vez de salir como un cuadro vacío.
 */
export const SUBCONJUNTOS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese'] as const;
let fuentes: opentype.Font[] | undefined;

function nunitoBlack(): opentype.Font[] {
  fuentes ??= SUBCONJUNTOS.map(s => {
    const b = fs.readFileSync(require.resolve(`@fontsource/nunito/files/nunito-${s}-900-normal.woff`));
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  });
  return fuentes;
}

/** De qué parte de Nunito es una letra ('latin', 'cyrillic'…), o null si no la tiene ninguna (un emoji). */
export function subconjuntoDe(letra: string): typeof SUBCONJUNTOS[number] | null {
  const i = nunitoBlack().findIndex(f => f.charToGlyph(letra).index !== 0);
  return i < 0 ? null : SUBCONJUNTOS[i];
}

/** Cada letra con la fuente que la tiene (sin las que no tiene ninguna). */
function glifos(texto: string): { f: opentype.Font; g: opentype.Glyph }[] {
  const res: { f: opentype.Font; g: opentype.Glyph }[] = [];
  for (const letra of texto) {
    for (const f of nunitoBlack()) {
      const g = f.charToGlyph(letra);
      if (g.index !== 0) { res.push({ f, g }); break; }
    }
  }
  return res;
}

/** Ancho del texto a tamaño 1. */
export function anchoTexto(texto: string): number {
  let ancho = 0, previo: { f: opentype.Font; g: opentype.Glyph } | undefined;
  for (const x of glifos(texto)) {
    const k = 1 / x.f.unitsPerEm;
    if (previo?.f === x.f) ancho += x.f.getKerningValue(previo.g, x.g) * k;
    ancho += (x.g.advanceWidth ?? 0) * k;
    previo = x;
  }
  return ancho;
}

/** Altura de las mayúsculas a tamaño 1, para centrar el texto en vertical. */
export function alturaMayusculas(): number {
  const f = nunitoBlack()[0];
  return (f.tables.os2?.sCapHeight ?? f.unitsPerEm * 0.7) / f.unitsPerEm;
}

/**
 * Trazo SVG del texto con la línea base en (x, y). Coloca glifo a glifo: opentype.js 2 falla con las sustituciones
 * de Nunito para letras con tilde, y para texto latino basta con el interletraje.
 */
export function trazoTexto(texto: string, x: number, y: number, tam: number): string {
  let cx = 0, d = '', previo: { f: opentype.Font; g: opentype.Glyph } | undefined;
  for (const l of glifos(texto)) {
    const k = tam / l.f.unitsPerEm;
    if (previo?.f === l.f) cx += l.f.getKerningValue(previo.g, l.g) * k;
    d += l.g.getPath(x + cx, y, tam).toPathData(3);
    cx += (l.g.advanceWidth ?? 0) * k;
    previo = l;
  }
  return d;
}
