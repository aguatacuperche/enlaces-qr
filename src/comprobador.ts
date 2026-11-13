/**
 * Comprobación periódica de destinos: cada hora, un lote de los enlaces activos (y de los enlaces de las páginas)
 * que llevan más de una semana sin mirarse. Así todos pasan una vez por semana sin cargar el servidor de golpe.
 * Lo que falla por no responder se repite al final del lote, por si era un fallo pasajero.
 *
 * COMPROBAR_ENLACES=no lo desactiva (desarrollo, pruebas).
 */
import type { Bd } from './db.ts';
import { comprobarDestino, type Opciones, type Problema } from './comprobacion.ts';
import { hoy } from './fechas.ts';

/** Lo mínimo por hora; con muchos enlaces, los que hagan falta para que todos pasen en una semana (168 horas). */
const LOTE = 40;
const LOTE_MAXIMO = 800;
const PAUSA_MS = 1500;
const REPETIR_TRAS_MS = 60_000;
const CADA_MS = 3600_000;

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const pasajero = (p: Problema | null) => p?.codigo === 'no-responde' || p?.codigo === 'error';

export async function guardarResultado(bd: Bd, enlaceId: number, p: Problema | null): Promise<void> {
  // En un UPDATE, «problema» a la derecha es el valor de antes.
  await bd.query(
    `update enlaces set comprobado = now(), problema = $2, problema_detalle = $3,
       problema_desde = case when $2::text is null then null when problema is distinct from $2 then now() else problema_desde end,
       aviso_ignorado = case when problema is distinct from $2 then false else aviso_ignorado end
     where id = $1`, [enlaceId, p?.codigo ?? null, p?.detalle ?? null]);
}

export async function guardarResultadoElemento(bd: Bd, elementoId: number, p: Problema | null): Promise<void> {
  await bd.query(
    `update elementos set comprobado = now(), problema = $2, problema_detalle = $3,
       problema_desde = case when $2::text is null then null when problema is distinct from $2 then now() else problema_desde end,
       aviso_ignorado = case when problema is distinct from $2 then false else aviso_ignorado end
     where id = $1`, [elementoId, p?.codigo ?? null, p?.detalle ?? null]);
}

/** Comprueba ya un enlace (o todos los de una página). Para el botón «Comprobar ahora». */
export async function comprobarEnlace(bd: Bd, enlaceId: number, op: Opciones = {}): Promise<void> {
  const { rows: [e] } = await bd.query<{ tipo: string; destino: string | null }>('select tipo, destino from enlaces where id = $1', [enlaceId]);
  if (!e) return;
  if (e.tipo === 'enlace' && e.destino) {
    await guardarResultado(bd, enlaceId, await comprobarDestino(e.destino, op));
    return;
  }
  const { rows } = await bd.query<{ id: number; url: string }>('select id, url from elementos where pagina_id = $1', [enlaceId]);
  for (const x of rows) await guardarResultadoElemento(bd, x.id, await comprobarDestino(x.url, op));
  await bd.query('update enlaces set comprobado = now() where id = $1', [enlaceId]);
}

/** Un lote de la ronda semanal. Devuelve cuántos destinos ha mirado. */
export async function comprobarLote(bd: Bd, op: Opciones = {}, pausaMs = PAUSA_MS, repetirTrasMs = REPETIR_TRAS_MS): Promise<number> {
  const vigente = `e.activo and (e.caduca is null or e.caduca >= $1::date)`;
  const viejo = (t: string) => `(${t}.comprobado is null or ${t}.comprobado < now() - interval '7 days')`;
  const { rows: [cuantos] } = await bd.query<{ enlaces: number; elementos: number }>(
    `select (select count(*)::int from enlaces e where e.tipo = 'enlace' and ${vigente}) as enlaces,
            (select count(*)::int from elementos x join enlaces e on e.id = x.pagina_id where ${vigente}) as elementos`, [hoy()]);
  const lote = (n: number) => Math.min(LOTE_MAXIMO, Math.max(LOTE, Math.ceil(n / 168)));
  const { rows: enlaces } = await bd.query<{ id: number; url: string }>(
    `select e.id, e.destino as url from enlaces e where e.tipo = 'enlace' and ${vigente} and ${viejo('e')}
     order by e.comprobado nulls first, e.id limit $2`, [hoy(), lote(cuantos.enlaces)]);
  const { rows: elementos } = await bd.query<{ id: number; url: string }>(
    `select x.id, x.url from elementos x join enlaces e on e.id = x.pagina_id where ${vigente} and ${viejo('x')}
     order by x.comprobado nulls first, x.id limit $2`, [hoy(), lote(cuantos.elementos)]);

  const tareas = [
    ...enlaces.map(x => ({ url: x.url, guardar: (p: Problema | null) => guardarResultado(bd, x.id, p) })),
    ...elementos.map(x => ({ url: x.url, guardar: (p: Problema | null) => guardarResultadoElemento(bd, x.id, p) })),
  ];
  const repetir: typeof tareas = [];
  for (const t of tareas) {
    const p = await comprobarSinRomper(t.url, op);
    if (pasajero(p)) repetir.push(t);
    else await t.guardar(p);
    await espera(pausaMs);
  }
  if (repetir.length) {
    await espera(repetirTrasMs);
    for (const t of repetir) await t.guardar(await comprobarSinRomper(t.url, op));
  }
  return tareas.length;
}

/**
 * Un fallo inesperado con un destino no puede parar la ronda: ese enlace se quedaría el primero de la cola y la
 * pararía otra vez cada hora, sin que se comprobara nada más ni saliera el informe.
 */
async function comprobarSinRomper(url: string, op: Opciones): Promise<Problema | null> {
  try {
    return await comprobarDestino(url, op);
  } catch (e) {
    console.error(`Comprobación de ${url}:`, e);
    return { codigo: 'error', detalle: 'No se ha podido comprobar: la web contesta algo que no se entiende.' };
  }
}

let enMarcha = false;
const BLOQUEO_COMPROBADOR = 0x636f6d70;

export function iniciarComprobaciones(bd: Bd): void {
  if (process.env.COMPROBAR_ENLACES === 'no') return;
  const ronda = async () => {
    if (enMarcha) return;
    enMarcha = true;
    // Con dos copias de la app, solo una comprueba (cada destino una vez por semana, no dos).
    const conexion = await bd.connect().catch(() => null);
    try {
      if (!conexion || !(await conexion.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [BLOQUEO_COMPROBADOR])).rows[0].ok) return;
      try {
        const n = await comprobarLote(bd);
        if (n) console.log(`Comprobados ${n} destinos.`);
      } finally {
        await conexion.query('select pg_advisory_unlock($1)', [BLOQUEO_COMPROBADOR]);
      }
    } catch (e) {
      console.error('Comprobación de destinos:', e);
    } finally {
      conexion?.release();
      enMarcha = false;
    }
  };
  setTimeout(ronda, 120_000).unref();
  setInterval(ronda, CADA_MS).unref();
}
