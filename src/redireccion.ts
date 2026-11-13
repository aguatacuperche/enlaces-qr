/**
 * <dominio>/<nombre> → destino. Es lo más importante de la app: hay carteles y QR impresos.
 *
 * Los enlaces se guardan en memoria, así que redirigir no espera a la base. Cada cambio del panel o de la API
 * actualiza solo ese enlace, y cada minuto se recarga todo por si algo cambió por otro lado. La redirección es
 * temporal (302): si el profesor cambia el destino, vale al momento.
 *
 * Las visitas se cuentan en memoria y se guardan juntas cada pocos segundos: una ráfaga (un QR en una pantalla grande,
 * un robot) no deja mil escrituras esperando su turno en la base.
 */
import type { Bd } from './db.ts';
import { estadoDe, type Estado } from './enlaces.ts';
import { hoy } from './fechas.ts';
import { clave, esAutomatico, parecido } from './nombres.ts';

type Fila = { id: number; tipo: 'enlace' | 'pagina'; nombre: string; destino: string | null; activo: boolean; caduca: string | null };
type EnMemoria = Fila & { clave: string };

let enlaces = new Map<string, EnMemoria>();
/** Clave de cada id, para quitar el nombre viejo cuando se cambia. */
let claves = new Map<number, string>();
/** Sube con cada cambio: una recarga entera que empezó antes de un cambio no lo pisa con datos viejos. */
let version = 0;

const COLUMNAS = 'id, tipo, nombre, destino, activo, caduca';

export async function recargar(bd: Bd): Promise<void> {
  const empezada = ++version;
  const { rows } = await bd.query<Fila>(`select ${COLUMNAS} from enlaces`);
  // Mientras se leía, otro cambio ya tocó la memoria: esta foto es más vieja. La siguiente recarga la pondrá al día.
  if (empezada !== version) return;
  enlaces = new Map(rows.map(e => [clave(e.nombre), { ...e, clave: clave(e.nombre) }]));
  claves = new Map(rows.map(e => [e.id, clave(e.nombre)]));
}

/** Pone al día en memoria un solo enlace (creado, cambiado o borrado). */
export async function refrescarEnlace(bd: Bd, id: number): Promise<void> {
  version++;
  const { rows: [e] } = await bd.query<Fila>(`select ${COLUMNAS} from enlaces where id = $1`, [id]);
  const vieja = claves.get(id);
  if (vieja !== undefined) enlaces.delete(vieja);
  claves.delete(id);
  if (!e) return;
  const k = clave(e.nombre);
  enlaces.set(k, { ...e, clave: k });
  claves.set(id, k);
}

export type Resultado =
  | { tipo: 'ir'; id: number; nombre: string; destino: string }
  | { tipo: 'pagina'; id: number; nombre: string }
  | { tipo: 'no-existe'; nombre: string; parecido: string | null }
  | { tipo: Exclude<Estado, 'activo'>; nombre: string; caduca: string | null };

/** Por encima de esto no se busca un nombre parecido: cada 404 lo compararía con todos. */
const MAX_PARA_PARECIDO = 20_000;

export function resolver(nombre: string): Resultado {
  const e = enlaces.get(clave(nombre));
  if (!e) return { tipo: 'no-existe', nombre, parecido: sugerencia(nombre) };
  const estado = estadoDe(e);
  if (estado === 'activo') {
    return e.tipo === 'pagina' ? { tipo: 'pagina', id: e.id, nombre: e.nombre } : { tipo: 'ir', id: e.id, nombre: e.nombre, destino: e.destino! };
  }
  return { tipo: estado, nombre: e.nombre, caduca: e.caduca };
}

/**
 * El enlace activo que se parece a lo que se ha escrito mal. Nunca uno automático (4 letras al azar): si no, pidiendo
 * nombres parecidos se podrían ir sacando todos, y llevan a documentos que solo conoce quien tiene el enlace. Tampoco
 * para lo que piden los robots (/wp-login.php, /.env…).
 */
function sugerencia(nombre: string): string | null {
  if (/[./]/.test(nombre) || enlaces.size > MAX_PARA_PARECIDO) return null;
  const dia = hoy();
  const candidatos: { nombre: string; clave: string }[] = [];
  for (const x of enlaces.values()) if (!esAutomatico(x.nombre) && estadoDe(x, dia) === 'activo') candidatos.push(x);
  return parecido(nombre, candidatos);
}

/** Lo que no es una persona: buscadores y las vistas previas de WhatsApp, Telegram, etc. No cuentan como visita. */
const ROBOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|python|headless/i;

export function cuentaComoVisita(metodo: string, agente: string | undefined): boolean {
  return metodo === 'GET' && !!agente && !ROBOT.test(agente);
}

/** Visitas aún sin guardar, por enlace y día («id|día» → cuántas). */
let pendientes = new Map<string, number>();

export function contarVisita(id: number): void {
  const k = `${id}|${hoy()}`;
  pendientes.set(k, (pendientes.get(k) ?? 0) + 1);
}

/** Guarda en la base las visitas contadas en memoria, todas en una sola consulta. */
export async function volcarVisitas(bd: Bd): Promise<void> {
  if (!pendientes.size) return;
  const lote = pendientes;
  pendientes = new Map();
  const ids: number[] = [], dias: string[] = [], totales: number[] = [];
  for (const [k, n] of lote) {
    const [id, dia] = k.split('|');
    ids.push(Number(id)); dias.push(dia); totales.push(n);
  }
  try {
    // Un enlace borrado mientras tanto se salta, en vez de tumbar el lote entero.
    await bd.query(
      `insert into visitas (enlace_id, dia, total)
       select v.id, v.dia, v.total from unnest($1::int[], $2::date[], $3::int[]) as v(id, dia, total)
       where exists (select 1 from enlaces e where e.id = v.id)
       on conflict (enlace_id, dia) do update set total = visitas.total + excluded.total`, [ids, dias, totales]);
  } catch (e) {
    // Si la base no está, se vuelven a sumar para la próxima vez.
    for (const [k, n] of lote) pendientes.set(k, (pendientes.get(k) ?? 0) + n);
    throw e;
  }
}

/** Cuántos enlaces hay en memoria (para pruebas y comprobaciones). */
export function cuantosEnMemoria(): number {
  return enlaces.size;
}
