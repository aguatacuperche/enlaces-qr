/** El QR en PNG y PDF, y la comprobación de que se lee. */
import { createRequire } from 'node:module';
import resvg from '@resvg/resvg-js';
import jsQRModulo from 'jsqr';
import PDFDocument from 'pdfkit';
import { TAMANOS, type Opciones } from './opciones.ts';
import { proporcion } from './dibujo.ts';

const require = createRequire(import.meta.url);
// jsqr es CommonJS con `exports.default`: así se llega a la función tanto en Node como en las pruebas.
const jsQR = ((jsQRModulo as unknown as { default?: typeof jsQRModulo }).default ?? jsQRModulo) as unknown as typeof import('jsqr').default;

export function png(svg: string, ancho: number): Buffer {
  return new resvg.Resvg(svg, { fitTo: { mode: 'width', value: ancho } }).render().asPng();
}

/**
 * Lee el QR como lo haría un móvil y dice si sale la dirección esperada.
 * Ojo: `pixels` copia la imagen entera cada vez que se lee; se lee una sola vez.
 */
export function seLee(svg: string, esperado: string, ancho = 360): boolean {
  const imagen = new resvg.Resvg(svg, { fitTo: { mode: 'width', value: ancho }, background: '#ffffff' }).render();
  const pixeles = imagen.pixels;
  const datos = new Uint8ClampedArray(pixeles.buffer, pixeles.byteOffset, pixeles.byteLength);
  return jsQR(datos, imagen.width, imagen.height, { inversionAttempts: 'dontInvert' })?.data === esperado;
}

const CM = 72 / 2.54;  // puntos de PDF por centímetro

/** PDF para imprimir: el QR a su tamaño real, centrado en un folio (o en un A3 si es para cartel). */
export function pdf(svg: string, o: Opciones, pie: string): Promise<Buffer> {
  const t = TAMANOS[o.tamano];
  const ladoCm = 'cm' in t ? t.cm : 15;
  const doc = new PDFDocument({ size: o.tamano === 'cartel' ? 'A3' : 'A4', margin: 0, info: { Title: pie, Creator: 'enlaces-qr' } });
  const partes: Buffer[] = [];
  doc.on('data', (p: Buffer) => partes.push(p));
  const fin = new Promise<Buffer>(ok => doc.on('end', () => ok(Buffer.concat(partes))));

  const ancho = ladoCm * CM, alto = ancho * proporcion(svg);
  const x = (doc.page.width - ancho) / 2, y = (doc.page.height - alto) / 2 - 20;
  doc.image(png(svg, Math.round(ladoCm / 2.54 * 300)), x, y, { width: ancho, height: alto });
  doc.font(require.resolve('@fontsource/nunito/files/nunito-latin-700-normal.woff')).fontSize(11).fillColor('#474c59')
    .text(pie, 0, y + alto + 16, { width: doc.page.width, align: 'center' });
  doc.end();
  return fin;
}
