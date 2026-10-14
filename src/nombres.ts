/**
 * Nombres de enlace (lo que va detrás del dominio: enlaces.ejemplo.es/<nombre>).
 *
 * - Únicos sin distinguir mayúsculas: /NOTAS y /notas son el mismo enlace.
 * - Los nombres nuevos escritos a mano: minúsculas, números y guiones.
 * - Los automáticos: 4 mayúsculas sin las que se confunden al leerlas (ni O, ni I, ni L).
 * - Los que vienen de la app anterior se respetan tal cual, aunque no cumplan lo anterior (con ñ, con +…).
 */
import { randomInt } from 'node:crypto';

/** Rutas de la propia app: no pueden ser nombres de enlace. */
export const RESERVADOS = new Set([
  'panel', 'entrar', 'salir', 'auth', 'estaticos', 'marca', 'svg', 'png', 'pdf', 'qr', 'salud', 'api',
  'favicon.ico', 'robots.txt', 'admin', 'login', 'logout',
]);

export const LETRAS_AUTOMATICAS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const LARGO_AUTOMATICO = 4;
export const LARGO_MAXIMO = 60;

/** Clave con la que se compara y se guarda la unicidad. */
export function clave(nombre: string): string {
  return nombre.normalize('NFC').trim().toLowerCase();
}

export function generarAutomatico(): string {
  let nombre = '';
  for (let i = 0; i < LARGO_AUTOMATICO; i++) nombre += LETRAS_AUTOMATICAS[randomInt(LETRAS_AUTOMATICAS.length)];
  return nombre;
}

export function esAutomatico(nombre: string): boolean {
  return new RegExp(`^[${LETRAS_AUTOMATICAS}]{${LARGO_AUTOMATICO}}$`).test(nombre);
}

/** Por qué un nombre nuevo no vale, o null si vale. No mira si ya existe: eso lo hace la base. */
export function problemaConNombre(nombre: string): string | null {
  const n = nombre.normalize('NFC').trim();
  if (!n) return 'Escribe un nombre.';
  if (esAutomatico(n)) return null;
  if (n.length < 3) return 'Tiene que tener al menos 3 caracteres.';
  if (n.length > LARGO_MAXIMO) return `Como mucho ${LARGO_MAXIMO} caracteres.`;
  if (!/^[a-z0-9-]+$/.test(n)) return 'Solo minúsculas sin tilde, números y guiones.';
  if (n.startsWith('-') || n.endsWith('-') || n.includes('--')) return 'Los guiones van entre letras o números.';
  if (RESERVADOS.has(n)) return 'Ese nombre lo usa la propia app.';
  return null;
}

/** Sugerencia de nombre a partir de un texto («Excursión al museo» → «excursion-al-museo»). */
export function nombreDesdeTexto(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LARGO_MAXIMO).replace(/-+$/, '');
}

/** Distancia de edición, para proponer el enlace correcto cuando alguien se equivoca en una o dos letras. */
export function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = actual;
  }
  return previa[b.length];
}

/** El nombre existente más parecido (a 1 o 2 letras), o null. */
export function parecido(buscado: string, existentes: Iterable<string>): string | null {
  const k = clave(buscado);
  if (k.length < 4) return null;
  let mejor: string | null = null, mejorD = 3;
  for (const e of existentes) {
    const d = distancia(k, clave(e));
    if (d > 0 && d < mejorD) { mejor = e; mejorD = d; }
  }
  return mejor;
}
