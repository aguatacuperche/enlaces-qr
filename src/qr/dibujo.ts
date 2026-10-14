/**
 * Dibujo del QR en SVG: puntos, esquinas, el logo del centro en medio y el marco con texto.
 * Es la única pieza que dibuja: la vista previa, el SVG, el PNG y el PDF salen de aquí.
 */
import { createRequire } from 'node:module';
import QRCode from 'qrcode';
import type { Opciones } from './opciones.ts';
import { alturaMayusculas, anchoTexto, isotipoAnidado, trazoTexto } from './marca.ts';
import { cargarMarca } from '../marca.ts';

const require = createRequire(import.meta.url);
const alineacion: { getPositions(version: number): [number, number][] } = require('qrcode/lib/core/alignment-pattern');

/**
 * Matriz del código (true = módulo oscuro), con corrección de errores alta para que aguante el logo encima, y los
 * centros de los patrones de alineación (los cuadraditos que ayudan al lector a enderezar la imagen).
 */
export function codigo(texto: string): { M: boolean[][]; alineaciones: [number, number][] } {
  const { modules, version } = QRCode.create(texto, { errorCorrectionLevel: 'H' });
  const n = modules.size;
  const M = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => !!modules.get(y, x)));
  return { M, alineaciones: alineacion.getPositions(version) };
}

/** Rectángulo de esquinas redondeadas como trazo. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
    + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const f = (n: number) => +n.toFixed(3);

/** El color de acento no se usa para puntos ni esquinas: sobre blanco se lee mal. Solo va en el logo. */
export function dibujarQR(url: string, o: Opciones, nombreEnlace: string): string {
  const { M, alineaciones } = codigo(url), n = M.length;
  const c5 = cargarMarca().colores;
  const color = o.color === 'marca' ? c5.principal.valor : c5[o.color].valor;
  const ojos = o.color === 'marca' ? [c5.tercero.valor, c5.segundo.valor, c5.principal.valor] : [color, color, color];
  const conLogo = o.centro === 'logo';
  const marco = o.marco !== 'no';
  const B = 1.6, qz = marco ? 2.6 : 4;
  const W = n + 2 * qz + (marco ? 2 * B : 0), banda = marco ? 7 : 0, H = W + banda;
  const ox = (marco ? B : 0) + qz, oy = ox;
  const c = (n - 1) / 2;
  const tapado = (x: number, y: number) => conLogo && Math.abs(x - c) <= 4 && Math.abs(y - c) <= 4;
  // Los patrones de alineación se dibujan enteros, como las esquinas: con puntos sueltos, los lectores no los
  // reconocen a tamaño grande. Si alguno queda bajo el logo (códigos largos), lo tapa y la corrección lo suple.
  const visibles = alineaciones.filter(([fy, fx]) => !tapado(fx, fy));
  const enAlineacion = (x: number, y: number) => visibles.some(([fy, fx]) => Math.abs(x - fx) <= 2 && Math.abs(y - fy) <= 2);
  const esPatron = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7) || enAlineacion(x, y);
  const oscuro = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && M[y][x] && !esPatron(x, y) && !tapado(x, y);

  let d = '';
  const e = 0.03;  // solape mínimo entre módulos vecinos para que no se vean rayas finas al ampliar
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!oscuro(x, y)) continue;
    const px = ox + x, py = oy + y;
    if (o.puntos === 'circulos') {
      const r = 0.47;  // con 0,43 algunos lectores fallaban a tamaño pequeño
      d += `M${f(px + 0.5 - r)} ${f(py + 0.5)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
      continue;
    }
    const t = oscuro(x, y - 1), b = oscuro(x, y + 1), l = oscuro(x - 1, y), r = oscuro(x + 1, y);
    const R = o.puntos === 'redondeados' ? 0.5 : 0;
    const si = R && !t && !l, sd = R && !t && !r, id = R && !b && !r, ii = R && !b && !l;
    const x0 = f(px - (l ? e : 0)), x1 = f(px + 1 + (r ? e : 0)), y0 = f(py - (t ? e : 0)), y1 = f(py + 1 + (b ? e : 0));
    d += `M${si ? x0 + R : x0} ${y0}H${sd ? x1 - R : x1}` + (sd ? `A${R} ${R} 0 0 1 ${x1} ${y0 + R}` : '')
      + `V${id ? y1 - R : y1}` + (id ? `A${R} ${R} 0 0 1 ${x1 - R} ${y1}` : '')
      + `H${ii ? x0 + R : x0}` + (ii ? `A${R} ${R} 0 0 1 ${x0} ${y1 - R}` : '')
      + `V${si ? y0 + R : y0}` + (si ? `A${R} ${R} 0 0 1 ${x0 + R} ${y0}` : '') + 'Z';
  }

  const radios = { cuadradas: [0, 0, 0], redondeadas: [2.3, 1.5, 1], circulo: [3.5, 2.5, 1.5] }[o.esquinas];
  let esquinas = '';
  ([[0, 0], [n - 7, 0], [0, n - 7]] as const).forEach(([ex, ey], i) => {
    const X = ox + ex, Y = oy + ey;
    esquinas += `<path fill-rule="evenodd" fill="${ojos[i]}" d="${rr(X, Y, 7, 7, radios[0])}${rr(X + 1, Y + 1, 5, 5, radios[1])}"/>`
      + `<path fill="${ojos[i]}" d="${rr(X + 2, Y + 2, 3, 3, radios[2])}"/>`;
  });

  const ra = { cuadradas: [0, 0, 0], redondeadas: [1.6, 1, 0.5], circulo: [2.5, 1.5, 0.5] }[o.esquinas];
  for (const [fy, fx] of visibles) {
    const X = ox + fx - 2, Y = oy + fy - 2;
    esquinas += `<path fill-rule="evenodd" fill="${color}" d="${rr(X, Y, 5, 5, ra[0])}${rr(X + 1, Y + 1, 3, 3, ra[1])}"/>`
      + `<path fill="${color}" d="${rr(X + 2, Y + 2, 1, 1, ra[2])}"/>`;
  }

  let fondo = '';
  if (marco) fondo = `<path fill="${color}" d="${rr(0, 0, W, H, 3.2)}"/><path fill="#fff" d="${rr(B, B, W - 2 * B, W - 2 * B, 2.2)}"/>`;
  else if (o.fondo === 'blanco') fondo = `<rect width="${W}" height="${H}" fill="#fff"/>`;

  let centro = '';
  if (conLogo) {
    const lx = ox + c - 4 + 0.3, lado = 8.4;
    centro = `<path fill="#fff" d="${rr(lx, lx, lado, lado, 2)}"/>${isotipoAnidado(lx + 0.5, lx + 0.5, lado - 1)}`;
  }

  let texto = '';
  if (marco) {
    const t = o.marco === 'escaneame' ? 'ESCANÉAME' : o.marco === 'nombre' ? textoCorto(url) : o.texto;
    if (t) {
      const tam = Math.min(3.6, (W - 5) / anchoTexto(t));
      const x = (W - anchoTexto(t) * tam) / 2, y = W + banda / 2 + alturaMayusculas() * tam / 2 - 0.15;
      texto = `<path fill="#fff" d="${trazoTexto(t, x, y, tam)}"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}">`
    + `<title>${escaparXml(nombreEnlace ? textoCorto(url) : '')}</title>${fondo}<path fill="${color}" d="${d}"/>${esquinas}${centro}${texto}</svg>`;
}

/** «dominio/nombre»: la dirección corta sin https://, para el marco. */
function textoCorto(url: string): string {
  const u = new URL(url);
  return u.host + decodeURIComponent(u.pathname);
}

/** Proporción alto/ancho del dibujo (el marco añade la banda del texto). */
export function proporcion(svg: string): number {
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
  return h / w;
}

export function escaparXml(s: string): string {
  return s.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);
}
