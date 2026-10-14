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

let fuente: opentype.Font | undefined;

function nunitoBlack(): opentype.Font {
  if (!fuente) {
    const b = fs.readFileSync(require.resolve('@fontsource/nunito/files/nunito-latin-900-normal.woff'));
    fuente = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
  return fuente;
}

/** Ancho del texto a tamaño 1. */
export function anchoTexto(texto: string): number {
  const f = nunitoBlack(), k = 1 / f.unitsPerEm;
  let ancho = 0, previo: opentype.Glyph | undefined;
  for (const letra of texto) {
    const g = f.charToGlyph(letra);
    if (previo) ancho += f.getKerningValue(previo, g) * k;
    ancho += (g.advanceWidth ?? 0) * k;
    previo = g;
  }
  return ancho;
}

/** Altura de las mayúsculas a tamaño 1, para centrar el texto en vertical. */
export function alturaMayusculas(): number {
  const f = nunitoBlack();
  return (f.tables.os2?.sCapHeight ?? f.unitsPerEm * 0.7) / f.unitsPerEm;
}

/**
 * Trazo SVG del texto con la línea base en (x, y). Coloca glifo a glifo: opentype.js 2 falla con las sustituciones
 * de Nunito para letras con tilde, y para texto latino basta con el interletraje.
 */
export function trazoTexto(texto: string, x: number, y: number, tam: number): string {
  const f = nunitoBlack(), k = tam / f.unitsPerEm;
  let cx = 0, d = '', previo: opentype.Glyph | undefined;
  for (const letra of texto) {
    const g = f.charToGlyph(letra);
    if (previo) cx += f.getKerningValue(previo, g) * k;
    d += g.getPath(x + cx, y, tam).toPathData(3);
    cx += (g.advanceWidth ?? 0) * k;
    previo = g;
  }
  return d;
}
