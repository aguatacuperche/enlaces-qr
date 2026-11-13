/**
 * Cuentas con colores #rrggbb: mezclas (lo que haría color-mix, que los navegadores de hace pocos años no entienden y
 * los programas de correo tampoco) y contraste según las pautas de accesibilidad (WCAG 2).
 */

type Rgb = [number, number, number];

export function rgb(hex: string): Rgb {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function aHex(c: Rgb): string {
  return '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

/** Como color-mix(in srgb, a p%, b): `p` va de 0 a 1. */
export function mezclar(a: string, b: string, p: number): string {
  const x = rgb(a), y = rgb(b);
  return aHex(x.map((v, i) => v * p + y[i] * (1 - p)) as Rgb);
}

export function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** El mismo color, oscurecido lo justo para que contraste `minimo` con `fondo` (si ya contrasta, igual). */
export function legibleSobre(hex: string, fondo = '#ffffff', minimo = 4.5): string {
  let c = hex.toLowerCase();
  for (let p = 1; p > 0 && contraste(c, fondo) < minimo; p -= 0.02) c = mezclar(hex, '#000000', p);
  return c;
}

/** Texto que va encima de un fondo de ese color: blanco o casi negro, el que más contraste. */
export function textoSobre(hex: string): string {
  return contraste('#ffffff', hex) >= contraste('#1d1d1f', hex) ? '#ffffff' : '#1d1d1f';
}
