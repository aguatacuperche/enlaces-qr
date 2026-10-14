/** Funciones que usan las plantillas (vistas/*.ejs): formatos, colores de etiqueta y gráficos pequeños en SVG. */
import { estadoDe } from './enlaces.ts';
import { fechaCorta, fechaLarga, fechaSinAno, hoy } from './fechas.ts';
import { config, urlCorta } from './config.ts';
import { cargarMarca } from './marca.ts';

const numero = new Intl.NumberFormat('es-ES');
const PAPELES_ETIQUETA = ['principal', 'segundo', 'tercero', 'acento'] as const;

/** Cada etiqueta, siempre del mismo color de la marca. */
function colorEtiqueta(etiqueta: string): string {
  let h = 0;
  for (const ch of etiqueta.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--${PAPELES_ETIQUETA[h % PAPELES_ETIQUETA.length]})`;
}

/** Línea de visitas de los últimos días (una serie, sin leyenda: el número va al lado). */
function minigrafico(serie: number[], apagado: boolean): string {
  const w = 80, h = 30, max = Math.max(...serie, 1);
  const pts = serie.map((v, i) => [i * w / (serie.length - 1), h - 3 - v / max * (h - 6)]);
  const color = apagado ? '#b5bac6' : cargarMarca().colores.principal.valor;
  const [ux, uy] = pts[pts.length - 1];
  return `<svg class="mini" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>`
    + `<circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}

/** Barras de visitas por semana. Cada barra lleva su texto para la ayuda al pasar el ratón. */
function graficoSemanas(semanas: { desde: string; total: number }[]): string {
  const W = 560, H = 170, iz = 30, ab = 22, ar = 10;
  const max = Math.max(4, ...semanas.map(s => s.total));
  const paso = Math.ceil(max / 2), tope = paso * 2;
  const bw = (W - iz) / semanas.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitas por semana">`;
  for (const v of [0, paso, tope]) {
    const y = H - ab - v / tope * (H - ab - ar);
    s += `<line x1="${iz}" x2="${W}" y1="${y}" y2="${y}" stroke="${v ? '#eceef3' : '#c9cdd6'}"/>`
      + `<text x="${iz - 6}" y="${y + 4}" font-size="11" fill="#6a6f7d" text-anchor="end">${numero.format(v)}</text>`;
  }
  semanas.forEach((sem, i) => {
    const x = iz + i * bw + 2, w = bw - 4, h = sem.total / tope * (H - ab - ar), y = H - ab - h;
    const forma = h > 4
      ? `M${x} ${H - ab}V${y + 4}a4 4 0 0 1 4 -4h${w - 8}a4 4 0 0 1 4 4V${H - ab}Z`
      : `M${x} ${H - ab}V${y}h${w}V${H - ab}Z`;
    const ayuda = `Semana del ${fechaSinAno(sem.desde)}: ${numero.format(sem.total)} ${sem.total === 1 ? 'visita' : 'visitas'}`;
    s += `<g data-ayuda="${ayuda}" data-x="${(x + w / 2).toFixed(1)}" data-y="${y.toFixed(1)}">`
      + `<rect class="barra-zona" x="${iz + i * bw}" y="${ar}" width="${bw}" height="${H - ab - ar}"/>`
      + (sem.total ? `<path class="barra" d="${forma}"/>` : '') + '</g>';
    if (i % 3 === 0) s += `<text x="${x + w / 2}" y="${H - 6}" font-size="11" fill="#6a6f7d" text-anchor="middle">${fechaSinAno(sem.desde)}</text>`;
  });
  return s + '</svg>';
}

/** Dominio y ruta del destino, sin https:// ni www., para la lista. */
function destinoCorto(destino: string): string {
  return destino.replace(/^https?:\/\/(www\.)?/, '');
}

export const ayudasVistas = {
  numero: (n: number) => numero.format(n),
  fechaCorta, fechaLarga, hoy, estadoDe, colorEtiqueta, minigrafico, graficoSemanas, destinoCorto, urlCorta,
  /** «enlaces.ejemplo.es/excursion-museo»: la dirección corta sin https:// para mostrar. */
  corta: (nombre: string) => `${new URL(config.urlPublica).host}/${nombre}`,
  dominio: new URL(config.urlPublica).host,
  centro: config.centro,
  dominioCorreo: config.acceso.dominio,
  colores: cargarMarca().colores,
};
