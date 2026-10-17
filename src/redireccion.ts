/**
 * <dominio>/<nombre> → destino. Es lo más importante de la app: hay carteles y QR impresos.
 *
 * Los enlaces se guardan en memoria (son unos cientos) y se recargan al cambiar alguno y cada minuto, así que
 * redirigir no espera a la base. La redirección es temporal (302): si el profesor cambia el destino, vale al momento.
 */
import type { Bd } from './db.ts';
import { estadoDe, type Estado } from './enlaces.ts';
import { hoy } from './fechas.ts';
import { clave, parecido } from './nombres.ts';

type EnMemoria = { id: number; tipo: 'enlace' | 'pagina'; nombre: string; destino: string | null; activo: boolean; caduca: string | null };

let enlaces = new Map<string, EnMemoria>();

export async function recargar(bd: Bd): Promise<void> {
  const { rows } = await bd.query<EnMemoria>('select id, tipo, nombre, destino, activo, caduca from enlaces');
  enlaces = new Map(rows.map(e => [clave(e.nombre), e]));
}

export type Resultado =
  | { tipo: 'ir'; id: number; destino: string }
  | { tipo: 'pagina'; id: number }
  | { tipo: 'no-existe'; nombre: string; parecido: string | null }
  | { tipo: Exclude<Estado, 'activo'>; nombre: string; caduca: string | null };

export function resolver(nombre: string): Resultado {
  const e = enlaces.get(clave(nombre));
  if (!e) {
    const activos = [...enlaces.values()].filter(x => estadoDe(x) === 'activo').map(x => x.nombre);
    return { tipo: 'no-existe', nombre, parecido: parecido(nombre, activos) };
  }
  const estado = estadoDe(e);
  if (estado === 'activo') return e.tipo === 'pagina' ? { tipo: 'pagina', id: e.id } : { tipo: 'ir', id: e.id, destino: e.destino! };
  return { tipo: estado, nombre: e.nombre, caduca: e.caduca };
}

/** Lo que no es una persona: buscadores y las vistas previas de WhatsApp, Telegram, etc. No cuentan como visita. */
const ROBOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|python|headless/i;

export function cuentaComoVisita(metodo: string, agente: string | undefined): boolean {
  return metodo === 'GET' && !!agente && !ROBOT.test(agente);
}

export async function contarVisita(bd: Bd, id: number): Promise<void> {
  await bd.query(
    `insert into visitas (enlace_id, dia, total) values ($1, $2, 1)
     on conflict (enlace_id, dia) do update set total = visitas.total + 1`, [id, hoy()]);
}

/** Nombres de todos los enlaces que hay en memoria (para pruebas y comprobaciones). */
export function cuantosEnMemoria(): number {
  return enlaces.size;
}
