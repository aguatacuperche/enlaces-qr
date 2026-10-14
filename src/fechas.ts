/** Fechas en la zona horaria del centro (variable ZONA_HORARIA; por defecto, Europe/Madrid). */

const ZONA = process.env.ZONA_HORARIA || 'Europe/Madrid';

/** Hoy como AAAA-MM-DD. */
export function hoy(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(ahora);
}

/** Suma días a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const corta = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sinAno = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const larga = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const aFecha = (f: string | Date) => typeof f === 'string' ? new Date(f.slice(0, 10) + 'T12:00:00Z') : new Date(hoy(f) + 'T12:00:00Z');

/** «30 jun 2027» */
export const fechaCorta = (f: string | Date) => corta.format(aFecha(f)).replace('.', '');
/** «30 jun» */
export const fechaSinAno = (f: string | Date) => sinAno.format(aFecha(f)).replace('.', '');
/** «30 de junio de 2027» */
export const fechaLarga = (f: string | Date) => larga.format(aFecha(f));
