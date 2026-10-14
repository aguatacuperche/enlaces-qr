/**
 * Quién puede entrar: solo cuentas del dominio de correo del centro y, de ellas, ninguna que coincida con el patrón
 * de cuentas excluidas. En un colegio sirve para dejar fuera a los alumnos: si sus correos llevan cifras (el año, el
 * grupo) y los de los profesores no, basta con CORREOS_EXCLUIDOS=\d.
 */

export type Reglas = { dominio: string; excluidos: RegExp | null };

export type Veredicto = { ok: true } | { ok: false; motivo: 'otro-dominio' | 'excluido' };

/** Reglas a partir de las variables DOMINIO_CORREO y CORREOS_EXCLUIDOS. */
export function reglasDelEntorno(entorno: NodeJS.ProcessEnv = process.env): Reglas {
  const dominio = entorno.DOMINIO_CORREO?.trim().toLowerCase().replace(/^@/, '');
  if (!dominio) throw new Error('Falta la variable DOMINIO_CORREO (el dominio de las cuentas del centro, ver .env.example)');
  const patron = entorno.CORREOS_EXCLUIDOS?.trim();
  return { dominio, excluidos: patron ? new RegExp(patron) : null };
}

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Si la parte del correo antes de la @ coincide con el patrón de cuentas excluidas. */
export function esExcluido(correo: string, reglas: Reglas): boolean {
  const [usuario] = normalizarCorreo(correo).split('@');
  return !!reglas.excluidos?.test(usuario);
}

export function puedeEntrar(correo: string, reglas: Reglas): Veredicto {
  const limpio = normalizarCorreo(correo);
  if (!limpio.endsWith('@' + reglas.dominio) || limpio.split('@').length !== 2) return { ok: false, motivo: 'otro-dominio' };
  if (esExcluido(limpio, reglas)) return { ok: false, motivo: 'excluido' };
  return { ok: true };
}
