/**
 * Para imprimir: un cartel (A4 o A3) y hojas de pegatinas (etiquetas en hojas A4).
 * El texto va en vectorial con Nunito y el QR, en imagen a 300 ppp para su tamaño real.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import resvg from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';
import { png } from './exportar.ts';
import { proporcion } from './dibujo.ts';
import { subconjuntoDe } from './marca.ts';
import { cargarMarca, ficheroDeMarca } from '../marca.ts';

const require = createRequire(import.meta.url);
const MM = 72 / 25.4;  // puntos de PDF por milímetro
type Peso = 400 | 700 | 800 | 900;
const archivo = (peso: Peso, sub = 'latin') => require.resolve(`@fontsource/nunito/files/nunito-${sub}-${peso}-normal.woff`);
const fuente = (peso: Peso) => archivo(peso);
const GRIS = '#474c59', TENUE = '#6a6f7d';
/** Muchas impresoras no llegan a los últimos milímetros del folio: nada importante más cerca del borde. */
const BORDE_MM = 5;

type Doc = PDFKit.PDFDocument;

/** El texto partido en trozos según la parte de Nunito que tiene sus letras; las que no tiene ninguna, fuera. */
function trozos(texto: string): { sub: string; t: string }[] {
  const res: { sub: string; t: string }[] = [];
  for (const letra of texto) {
    const sub = /\s/.test(letra) ? (res.at(-1)?.sub ?? 'latin') : subconjuntoDe(letra);
    if (!sub) continue;
    if (res.at(-1)?.sub === sub) res.at(-1)!.t += letra;
    else res.push({ sub, t: letra });
  }
  return res;
}

/** Escribe un texto que puede llevar letras de otros alfabetos (ł, ş, cirílico…), cambiando de fuente donde haga falta. */
function escribir(doc: Doc, peso: Peso, texto: string, x: number, y: number, opciones: PDFKit.Mixins.TextOptions = {}): void {
  const ts = trozos(texto);
  if (ts.length <= 1) {
    doc.font(archivo(peso, ts[0]?.sub)).text(ts[0]?.t ?? '', x, y, opciones);
    return;
  }
  ts.forEach((tr, i) => {
    doc.font(archivo(peso, tr.sub));
    const seguir = { ...opciones, continued: i < ts.length - 1 };
    if (i === 0) doc.text(tr.t, x, y, seguir);
    else doc.text(tr.t, seguir);
  });
}

/** Tamaño de letra para que un texto quepa en una sola línea de `ancho` (sin partirlo nunca). */
function unaLinea(doc: Doc, texto: string, ancho: number, max: number, min: number): number {
  const w = doc.fontSize(1).widthOfString(texto);
  return Math.max(min, Math.min(max, w ? ancho / w : max));
}

function nuevoDocumento(tamano: 'A4' | 'A3', titulo: string): { doc: Doc; fin: Promise<Buffer> } {
  const doc = new PDFDocument({ size: tamano, margin: 0, info: { Title: titulo, Creator: 'enlaces-qr' } });
  const partes: Buffer[] = [];
  doc.on('data', (p: Buffer) => partes.push(p));
  return { doc, fin: new Promise<Buffer>(ok => doc.on('end', () => ok(Buffer.concat(partes)))) };
}

/** El mayor tamaño de letra (entre min y max) con el que el texto cabe en `lineas` líneas de `ancho`. */
function tamanoQueCabe(doc: Doc, texto: string, ancho: number, lineas: number, max: number, min: number): number {
  for (let t = max; t > min; t -= 0.5) {
    doc.fontSize(t);
    if (doc.heightOfString(texto, { width: ancho, lineGap: 0 }) <= lineas * t * 1.3) return t;
  }
  return min;
}

/** El QR a 300 ppp para el ancho que va a tener en el papel. */
const qrParaImprimir = (svg: string, anchoPt: number) => png(svg, Math.max(200, Math.round(anchoPt / 72 * 300)));

// ---------------------------------------------------------------- Cartel

export type OpcionesCartel = { tamano: 'a4' | 'a3'; titulo: string; texto: string };

export async function cartel(svgQr: string, direccion: string, pie: string, o: OpcionesCartel): Promise<Buffer> {
  const { doc, fin } = nuevoDocumento(o.tamano === 'a3' ? 'A3' : 'A4', o.titulo || direccion);
  const c = cargarMarca().colores;
  const k = o.tamano === 'a3' ? Math.SQRT2 : 1;
  const W = doc.page.width, H = doc.page.height, m = 46 * k, ancho = W - 2 * m;

  // Franja con los colores de la marca y logo arriba.
  const franja = [c.principal, c.segundo, c.tercero, c.acento];
  franja.forEach((col, i) => doc.rect(i * W / 4, 0, W / 4 + 0.5, 9 * k).fill(col.valor));
  const logo = new resvg.Resvg(fs.readFileSync(ficheroDeMarca('logo.svg'), 'utf8'), { fitTo: { mode: 'width', value: 1200 } }).render();
  const anchoLogo = 175 * k, altoLogo = anchoLogo * logo.height / logo.width;
  doc.image(logo.asPng(), (W - anchoLogo) / 2, 42 * k, { width: anchoLogo, height: altoLogo });
  let y = 42 * k + altoLogo + 30 * k;

  // Título y explicación.
  const titulo = o.titulo.trim();
  if (titulo) {
    doc.font(fuente(900)).fillColor(c.oscuro.valor);
    const t = tamanoQueCabe(doc, titulo, ancho, 3, 46 * k, 22 * k);
    doc.fontSize(t);
    escribir(doc, 900, titulo, m, y, { width: ancho, align: 'center', lineGap: 0 });
    y = doc.y + 10 * k;
  }
  const texto = o.texto.trim();
  if (texto) {
    doc.font(fuente(400)).fillColor(GRIS);
    const t = tamanoQueCabe(doc, texto, ancho * 0.9, 4, 19 * k, 13 * k);
    doc.fontSize(t);
    escribir(doc, 400, texto, m + ancho * 0.05, y, { width: ancho * 0.9, align: 'center', lineGap: 2 });
    y = doc.y + 8 * k;
  }

  // Dirección y pie abajo; el QR, lo más grande que quepa en medio.
  const altoAbajo = 98 * k;
  const libre = H - y - altoAbajo - 24 * k;
  const prop = proporcion(svgQr);
  const anchoQr = Math.max(120 * k, Math.min(340 * k, ancho, libre / prop));
  const altoQr = anchoQr * prop;
  const yQr = y + Math.max(12 * k, (libre - altoQr) / 2);
  doc.image(qrParaImprimir(svgQr, anchoQr), (W - anchoQr) / 2, yQr, { width: anchoQr, height: altoQr });

  let yAbajo = Math.max(yQr + altoQr + 18 * k, H - altoAbajo - 18 * k);
  doc.font(fuente(700)).fontSize(12 * k).fillColor(TENUE).text('Si no puedes escanearlo, escribe en el navegador:', m, yAbajo, { width: ancho, align: 'center' });
  yAbajo = doc.y + 4 * k;
  doc.font(fuente(900)).fillColor(c.principal.valor);
  doc.fontSize(tamanoQueCabe(doc, direccion, ancho, 1, 28 * k, 12 * k)).text(direccion, m, yAbajo, { width: ancho, align: 'center' });
  if (pie) {
    doc.font(fuente(700)).fontSize(10 * k).fillColor(TENUE);
    escribir(doc, 700, pie, m, H - 30 * k, { width: ancho, align: 'center', lineBreak: false });
  }

  doc.end();
  return fin;
}

// ---------------------------------------------------------------- Pegatinas

/** Hoja de etiquetas A4, en milímetros. */
export type Hoja = {
  nombre: string; columnas: number; filas: number; ancho: number; alto: number;
  margenSuperior: number; margenIzquierdo: number; separacionH: number; separacionV: number;
};

/** Formatos habituales. Las medidas vienen en la caja: etiquetas por hoja y tamaño de cada una. */
export const HOJAS: Record<string, Hoja> = {
  '21-70x42': { nombre: '21 por hoja · 70 × 42,4 mm (sin márgenes)', columnas: 3, filas: 7, ancho: 70, alto: 42.4, margenSuperior: 0.1, margenIzquierdo: 0, separacionH: 0, separacionV: 0 },
  '24-70x37': { nombre: '24 por hoja · 70 × 37 mm (sin márgenes)', columnas: 3, filas: 8, ancho: 70, alto: 37, margenSuperior: 0.5, margenIzquierdo: 0, separacionH: 0, separacionV: 0 },
  '21-63x38': { nombre: '21 por hoja · 63,5 × 38,1 mm (con márgenes)', columnas: 3, filas: 7, ancho: 63.5, alto: 38.1, margenSuperior: 15.15, margenIzquierdo: 7.21, separacionH: 2.54, separacionV: 0 },
  '14-99x38': { nombre: '14 por hoja · 99,1 × 38,1 mm (con márgenes)', columnas: 2, filas: 7, ancho: 99.1, alto: 38.1, margenSuperior: 15.15, margenIzquierdo: 4.65, separacionH: 2.5, separacionV: 0 },
  '40-52x29': { nombre: '40 por hoja · 52,5 × 29,7 mm (sin márgenes)', columnas: 4, filas: 10, ancho: 52.5, alto: 29.7, margenSuperior: 0, margenIzquierdo: 0, separacionH: 0, separacionV: 0 },
};

/** Lo mínimo que tiene que medir cada módulo (cuadradito) del QR impreso para que un móvil lo lea bien. */
export const MODULO_MINIMO_MM = 0.3;

/**
 * Si con esa hoja el QR saldría demasiado pequeño para leerse, por qué. `modulos` es el ancho del QR en módulos
 * (con su margen blanco): el ancho del viewBox del SVG.
 */
export function problemaConTamano(h: Hoja, texto: OpcionesPegatinas['texto'], modulos: number): string | null {
  const lado = ladoQrPegatina(h, texto);
  if (lado / modulos >= MODULO_MINIMO_MM) return null;
  const mm = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return `En estas etiquetas el QR saldría de ${mm(lado)} mm y muchos móviles no lo leerían. `
    + (texto === 'nada' ? 'Elige etiquetas más grandes.' : 'Elige etiquetas más grandes, o «Solo el QR» para que ocupe toda la etiqueta.');
}

/** Si una hoja a medida cabe en un A4 y tiene sentido; si no, por qué. */
export function problemaConHoja(h: Hoja): string | null {
  const nums = [h.columnas, h.filas, h.ancho, h.alto, h.margenSuperior, h.margenIzquierdo, h.separacionH, h.separacionV];
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return 'Revisa las medidas: tienen que ser números.';
  if (h.columnas < 1 || h.filas < 1 || h.columnas > 10 || h.filas > 20) return 'Entre 1 y 10 columnas, y entre 1 y 20 filas.';
  if (h.ancho < 15 || h.alto < 15) return 'Las etiquetas tienen que medir al menos 15 × 15 mm para que el QR se lea.';
  const ancho = h.margenIzquierdo + h.columnas * h.ancho + (h.columnas - 1) * h.separacionH;
  const alto = h.margenSuperior + h.filas * h.alto + (h.filas - 1) * h.separacionV;
  const mm = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  if (ancho > 210.5 || alto > 297.5) return `Con esas medidas no caben en un A4 (ocupan ${mm(ancho)} × ${mm(alto)} mm).`;
  return null;
}

/** Dónde va cada pegatina: hoja (desde 0) y esquina superior izquierda en mm. Se empieza en la etiqueta `empezar` (desde 1). */
export function posiciones(h: Hoja, empezar: number, cuantas: number): { hoja: number; x: number; y: number }[] {
  const porHoja = h.columnas * h.filas;
  const res = [];
  for (let n = 0; n < cuantas; n++) {
    const i = n + (empezar - 1), hoja = Math.floor(i / porHoja), j = i % porHoja;
    const fila = Math.floor(j / h.columnas), col = j % h.columnas;
    res.push({ hoja, x: h.margenIzquierdo + col * (h.ancho + h.separacionH), y: h.margenSuperior + fila * (h.alto + h.separacionV) });
  }
  return res;
}

export type OpcionesPegatinas = { hoja: Hoja; empezar: number; cuantas: number; texto: 'titulo' | 'direccion' | 'nada'; bordes: boolean };

/** Lado del QR en una etiqueta (o en la parte de ella que se puede imprimir), en mm. */
export function ladoQrPegatina(h: Hoja, texto: OpcionesPegatinas['texto'], margen = Math.min(3, h.alto * 0.08)): number {
  const p = margen;
  const apaisada = h.ancho >= h.alto * 1.15;
  if (texto === 'nada') return Math.min(h.ancho, h.alto) - 2 * p;
  // Apaisada: el QR deja al menos el 55 % del ancho para el texto.
  if (apaisada) return Math.min(h.alto - 2 * p, h.ancho * 0.45);
  return Math.min(h.ancho - 2 * p, h.alto - 2 * p - Math.min(9, h.alto * 0.2));
}

export async function pegatinas(svgQr: string, direccion: string, titulo: string, o: OpcionesPegatinas): Promise<Buffer> {
  const { doc, fin } = nuevoDocumento('A4', `Pegatinas · ${direccion}`);
  const c = cargarMarca().colores;
  const h = o.hoja;
  // Una sola imagen para todas las etiquetas (openImage existe en pdfkit, pero no en sus tipos).
  const imagen = (doc as unknown as { openImage(b: Buffer): Buffer }).openImage(qrParaImprimir(svgQr, ladoQrPegatina(h, o.texto) * MM));
  const [dominio, ...resto] = direccion.split('/');
  const nombre = resto.join('/');

  let hojaActual = 0;
  for (const pos of posiciones(h, o.empezar, o.cuantas)) {
    if (pos.hoja !== hojaActual) { doc.addPage({ size: 'A4', margin: 0 }); hojaActual = pos.hoja; }
    if (o.bordes) doc.roundedRect(pos.x * MM + 0.4, pos.y * MM + 0.4, h.ancho * MM - 0.8, h.alto * MM - 0.8, 2 * MM).lineWidth(0.4).strokeColor('#b5bac6').stroke();
    // Lo que se dibuja, dentro de la etiqueta pero a BORDE_MM del borde del folio: en las hojas sin márgenes, las
    // etiquetas de fuera llegan al borde y la impresora cortaría el QR.
    const zx0 = Math.max(pos.x, BORDE_MM), zy0 = Math.max(pos.y, BORDE_MM);
    const zx1 = Math.min(pos.x + h.ancho, 210 - BORDE_MM), zy1 = Math.min(pos.y + h.alto, 297 - BORDE_MM);
    const zona: Hoja = { ...h, ancho: zx1 - zx0, alto: zy1 - zy0 };
    const recortada = zona.ancho < h.ancho || zona.alto < h.alto;
    const p = recortada ? 1 : Math.min(3, zona.alto * 0.08);
    const lado = recortada ? ladoQrPegatina(zona, o.texto, 1) : ladoQrPegatina(h, o.texto);
    const apaisada = zona.ancho >= zona.alto * 1.15;
    const x = zx0 * MM, y = zy0 * MM, w = zona.ancho * MM, al = zona.alto * MM;

    if (o.texto === 'nada') {
      doc.image(imagen, x + (w - lado * MM) / 2, y + (al - lado * MM) / 2, { width: lado * MM, height: lado * MM });
    } else if (apaisada) {
      // QR a la izquierda y texto a la derecha, centrado en vertical: título, y la dirección en dos líneas
      // (el dominio pequeño y el nombre del enlace grande), que es lo que alguien tendría que teclear.
      doc.image(imagen, x + p * MM, y + (al - lado * MM) / 2, { width: lado * MM, height: lado * MM });
      const tx = x + (p * 2 + lado) * MM, ancho = w - (p * 3 + lado) * MM;
      const conTitulo = o.texto === 'titulo' && titulo.trim();
      doc.font(fuente(800));
      const tTit = conTitulo ? tamanoQueCabe(doc, titulo, ancho, 2, 10, 6) : 0;
      const altoTit = conTitulo ? doc.fontSize(tTit).heightOfString(titulo, { width: ancho }) : 0;
      // Dominio y nombre, cada uno en una sola línea: si no cabe, más pequeño, nunca partido (la segunda línea se
      // montaba encima del nombre).
      doc.font(fuente(700));
      const tDom = unaLinea(doc, dominio + '/', ancho, 7, 3.5);
      doc.font(fuente(900));
      const tNom = unaLinea(doc, nombre, ancho, conTitulo ? 11 : 14, 4);
      const altoDir = tDom * 1.25 + tNom * 1.2;
      let ty = y + (al - altoTit - altoDir - (conTitulo ? 3 : 0)) / 2;
      if (conTitulo) {
        doc.font(fuente(800)).fontSize(tTit).fillColor(c.oscuro.valor);
        escribir(doc, 800, titulo, tx, ty, { width: ancho, height: altoTit + 1, ellipsis: true });
        ty += altoTit + 3;
      }
      doc.font(fuente(700)).fontSize(tDom).fillColor(TENUE).text(dominio + '/', tx, ty, { lineBreak: false });
      doc.font(fuente(900)).fontSize(tNom).fillColor(c.principal.valor);
      escribir(doc, 900, nombre, tx, ty + tDom * 1.25, { lineBreak: false });
    } else {
      // Cuadrada o vertical: QR arriba y la dirección debajo, centrada y en una sola línea.
      const xq = x + (w - lado * MM) / 2, yq = y + p * MM;
      doc.image(imagen, xq, yq, { width: lado * MM, height: lado * MM });
      doc.font(fuente(900));
      const tDir = unaLinea(doc, direccion, w - 2 * p * MM, 9, 4);
      const anchoDir = doc.fontSize(tDir).widthOfString(direccion);
      doc.fillColor(c.principal.valor);
      escribir(doc, 900, direccion, x + (w - anchoDir) / 2, yq + lado * MM + 1.5 * MM, { lineBreak: false });
    }
  }
  doc.end();
  return fin;
}
