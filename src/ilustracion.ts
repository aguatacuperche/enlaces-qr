/**
 * Dibujo de fondo de la cabecera del informe por correo: un eslabón partido, con tirita y cara de «ay», muy tenue,
 * como marca de agua. Se dibuja con los colores de la marca y se sirve como PNG (los programas de correo no aceptan
 * SVG ni imágenes de fondo incrustadas).
 */
import resvg from '@resvg/resvg-js';
import type { Color, Papel } from './marca.ts';

export function svgEslabonRoto(c: Record<Papel, Color>, opacidad = 0.16): string {
  const trazo = 'fill="none" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"';
  const cara = (x: number, y: number, gesto: 'ay' | 'pena') => `
    <circle cx="${x - 9}" cy="${y}" r="3.4" fill="${c.oscuro.valor}"/>
    <circle cx="${x + 9}" cy="${y}" r="3.4" fill="${c.oscuro.valor}"/>
    ${gesto === 'ay'
      ? `<path d="M${x - 8} ${y + 13} q8 -7 16 0" fill="none" stroke="${c.oscuro.valor}" stroke-width="3" stroke-linecap="round"/>`
      : `<path d="M${x - 7} ${y + 14} q7 -6 14 0" fill="none" stroke="${c.oscuro.valor}" stroke-width="3" stroke-linecap="round"/>
         <path d="M${x + 14} ${y - 6} q4 6 0 9 q-4 -3 0 -9z" fill="${c.principal.valor}"/>`}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="300" height="180">
  <g opacity="${opacidad}">
    <!-- Eslabón izquierdo, con su tirita -->
    <g transform="rotate(-18 92 92)">
      <rect x="32" y="62" width="120" height="60" rx="30" stroke="${c.principal.valor}" ${trazo}/>
      ${cara(84, 86, 'ay')}
      <g transform="rotate(52 120 70)">
        <rect x="98" y="60" width="46" height="20" rx="10" fill="${c.acento.valor}"/>
        <rect x="113" y="62" width="16" height="16" rx="3" fill="#ffffff" opacity=".6"/>
        <circle cx="105" cy="70" r="1.6" fill="#ffffff"/><circle cx="137" cy="70" r="1.6" fill="#ffffff"/>
      </g>
    </g>
    <!-- Eslabón derecho -->
    <g transform="rotate(-18 214 96)">
      <rect x="168" y="66" width="112" height="60" rx="30" stroke="${c.segundo.valor}" ${trazo}/>
      ${cara(232, 90, 'pena')}
    </g>
    <!-- El chispazo de la rotura -->
    <g stroke="${c.tercero.valor}" stroke-width="5" stroke-linecap="round">
      <path d="M160 52 l6 -16"/><path d="M172 60 l14 -9"/><path d="M150 138 l-5 15"/><path d="M162 132 l12 10"/>
    </g>
    <path d="M178 22 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3z" fill="${c.acento.valor}"/>
    <path d="M128 150 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z" fill="${c.tercero.valor}"/>
  </g>
</svg>`;
}

export function pngEslabonRoto(c: Record<Papel, Color>): Buffer {
  return new resvg.Resvg(svgEslabonRoto(c), { fitTo: { mode: 'width', value: 600 } }).render().asPng();
}
