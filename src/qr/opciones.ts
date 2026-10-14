/**
 * Opciones del creador de QR. Llegan por la dirección (?color=segundo&puntos=circulos…) y se validan aquí.
 * Los colores son los de la marca del centro (ver src/marca.ts); «marca» combina varios.
 */

const VALORES = {
  color: ['marca', 'principal', 'segundo', 'tercero', 'oscuro'],
  puntos: ['redondeados', 'circulos', 'cuadrados'],
  esquinas: ['redondeadas', 'circulo', 'cuadradas'],
  centro: ['logo', 'nada'],
  marco: ['escaneame', 'nombre', 'libre', 'no'],
  fondo: ['blanco', 'transparente'],
  tamano: ['pegatina', 'folio', 'cartel', 'pantalla'],
} as const;

type Valores = typeof VALORES;
export type Opciones = { [K in keyof Valores]: Valores[K][number] } & { texto: string };

export const POR_DEFECTO: Opciones = {
  color: 'marca', puntos: 'redondeados', esquinas: 'redondeadas', centro: 'logo', marco: 'escaneame',
  fondo: 'blanco', tamano: 'pegatina', texto: '',
};

/** Tamaños de descarga: lado del QR en centímetros (a 300 ppp) o en píxeles para pantalla. */
export const TAMANOS = {
  pegatina: { cm: 5, nombre: 'Pegatina' },
  folio: { cm: 15, nombre: 'Folio A4' },
  cartel: { cm: 25, nombre: 'Cartel A3' },
  pantalla: { px: 1024, nombre: 'Pantalla' },
} as const;

export const LARGO_TEXTO = 28;

export function pixelesDe(tamano: Opciones['tamano']): number {
  const t = TAMANOS[tamano];
  return 'px' in t ? t.px : Math.round(t.cm / 2.54 * 300);
}

export function leerOpciones(entrada: Record<string, unknown>, base: Opciones = POR_DEFECTO): Opciones {
  const o = { ...base };
  for (const k of Object.keys(VALORES) as (keyof Valores)[]) {
    const v = entrada[k];
    if (typeof v === 'string' && (VALORES[k] as readonly string[]).includes(v)) (o as Record<string, string>)[k] = v;
  }
  if (typeof entrada.texto === 'string') o.texto = entrada.texto.replace(/\s+/g, ' ').trim().slice(0, LARGO_TEXTO);
  return o;
}

export function aConsulta(o: Opciones): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '') p.set(k, v);
  return p.toString();
}
