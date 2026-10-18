/** Enlaces y páginas: listar, crear, cambiar y borrar, con sus visitas y el resultado de la última comprobación. */
import type { Bd } from './db.ts';
import { hoy, sumarDias } from './fechas.ts';
import { clave, esAutomatico, generarAutomatico, problemaConNombre } from './nombres.ts';
import { config } from './config.ts';

const corta = (nombre: string) => `${new URL(config.urlPublica).host}/${nombre}`;

export type Estado = 'activo' | 'pausa' | 'caducado';

export type Enlace = {
  id: number; tipo: 'enlace' | 'pagina'; nombre: string; destino: string | null; titulo: string; descripcion: string | null;
  activo: boolean; caduca: string | null; etiqueta: string | null; usuario_id: number | null; dueno: string | null;
  visitas_anteriores: number; visitas: number; visitas_mes: number; creado: Date; actualizado: Date;
  comprobado: Date | null; problema: string | null; problema_detalle: string | null; aviso_ignorado: boolean;
  /** Solo páginas: cuántos enlaces tiene y cuántos no abren. */
  elementos: number; elementos_mal: number;
};

export type Elemento = { id: number; titulo: string; url: string; problema: string | null; problema_detalle: string | null };

export function estadoDe(e: { activo: boolean; caduca: string | null }, dia = hoy()): Estado {
  if (!e.activo) return 'pausa';
  if (e.caduca && e.caduca < dia) return 'caducado';
  return 'activo';
}

/** Error que se enseña tal cual en el formulario. */
export class ErrorDeFormulario extends Error {
  campo: string;
  constructor(campo: string, mensaje: string) {
    super(mensaje);
    this.campo = campo;
  }
}

const SELECT = `
  select e.id, e.tipo, e.nombre, e.destino, e.titulo, e.descripcion, e.activo, e.caduca, e.etiqueta, e.usuario_id,
         u.nombre as dueno, e.visitas_anteriores, e.visitas_anteriores + coalesce(v.total, 0) as visitas,
         coalesce(v.mes, 0) as visitas_mes, e.creado, e.actualizado,
         e.comprobado, e.problema, e.problema_detalle, e.aviso_ignorado, el.elementos, el.elementos_mal
  from enlaces e
  left join usuarios u on u.id = e.usuario_id
  left join lateral (
    select sum(total)::int as total, (sum(total) filter (where dia > $1::date - 30))::int as mes
    from visitas where enlace_id = e.id) v on true
  left join lateral (
    select count(*)::int as elementos, (count(*) filter (where problema is not null))::int as elementos_mal
    from elementos where pagina_id = e.id) el on true`;

/** Tiene algo que revisar: su destino no abre (y no se ha dado por bueno) o no abre alguno de sus enlaces. */
const CON_PROBLEMA = `((e.problema is not null and not e.aviso_ignorado)
  or exists (select 1 from elementos x where x.pagina_id = e.id and x.problema is not null))`;

export type Filtro = {
  /** Enlaces de este usuario; `null` = sin dueño; sin indicar = todos. */
  usuarioId?: number | null;
  q?: string; estado?: Estado | ''; etiqueta?: string; orden?: 'recientes' | 'visitas' | 'titulo';
  /** Solo los que tienen algo que revisar. */
  problemas?: boolean;
};

function condiciones(f: Filtro, params: unknown[]): string {
  const w: string[] = [];
  if (f.usuarioId === null) w.push('e.usuario_id is null');
  else if (f.usuarioId !== undefined) { params.push(f.usuarioId); w.push(`e.usuario_id = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
    const p = `$${params.length}`;
    w.push(`(e.titulo ilike ${p} or e.nombre ilike ${p} or e.destino ilike ${p} or e.etiqueta ilike ${p})`);
  }
  if (f.etiqueta) { params.push(f.etiqueta); w.push(`e.etiqueta = $${params.length}`); }
  if (f.estado === 'activo') w.push('e.activo and (e.caduca is null or e.caduca >= $1::date)');
  if (f.estado === 'pausa') w.push('not e.activo');
  if (f.estado === 'caducado') w.push('e.activo and e.caduca < $1::date');
  if (f.problemas) w.push(CON_PROBLEMA);
  return w.length ? ' where ' + w.join(' and ') : '';
}

export async function listarEnlaces(bd: Bd, f: Filtro): Promise<Enlace[]> {
  const params: unknown[] = [hoy()];
  const orden = { recientes: 'e.creado desc, e.id desc', visitas: 'visitas desc, e.id desc', titulo: 'lower(e.titulo), e.id' }[f.orden ?? 'recientes'];
  return (await bd.query<Enlace>(SELECT + condiciones(f, params) + ` order by ${orden}`, params)).rows;
}

/** Cuántos hay en cada estado, para los botones de filtro. */
export async function recuento(bd: Bd, f: Filtro): Promise<Record<Estado | 'todos' | 'problemas', number>> {
  const params: unknown[] = [hoy()];
  const { rows } = await bd.query<Record<Estado | 'todos' | 'problemas', number>>(
    `select count(*)::int as todos,
            (count(*) filter (where ${CON_PROBLEMA}))::int as problemas,
            (count(*) filter (where e.activo and (e.caduca is null or e.caduca >= $1::date)))::int as activo,
            (count(*) filter (where not e.activo))::int as pausa,
            (count(*) filter (where e.activo and e.caduca < $1::date))::int as caducado
     from enlaces e` + condiciones({ usuarioId: f.usuarioId }, params), params);
  return rows[0];
}

export async function etiquetas(bd: Bd, usuarioId?: number | null): Promise<string[]> {
  const { rows } = usuarioId === undefined
    ? await bd.query<{ etiqueta: string }>('select distinct etiqueta from enlaces where etiqueta is not null order by 1')
    : await bd.query<{ etiqueta: string }>(
      'select distinct etiqueta from enlaces where etiqueta is not null and usuario_id is not distinct from $1 order by 1', [usuarioId]);
  return rows.map(r => r.etiqueta);
}

export async function enlacePorId(bd: Bd, id: number): Promise<Enlace | undefined> {
  return (await bd.query<Enlace>(SELECT + ' where e.id = $2', [hoy(), id])).rows[0];
}

/** Visitas por día de los últimos `dias` días (el último es hoy), para los minigráficos. */
export async function seriesDiarias(bd: Bd, ids: number[], dias = 30): Promise<Map<number, number[]>> {
  const desde = sumarDias(hoy(), -(dias - 1));
  const series = new Map(ids.map(id => [id, new Array<number>(dias).fill(0)]));
  const { rows } = await bd.query<{ enlace_id: number; dia: string; total: number }>(
    'select enlace_id, dia, total from visitas where enlace_id = any($1) and dia >= $2', [ids, desde]);
  for (const r of rows) {
    const i = Math.round((Date.parse(r.dia) - Date.parse(desde)) / 864e5);
    const s = series.get(r.enlace_id);
    if (s && i >= 0 && i < dias) s[i] = r.total;
  }
  return series;
}

/** Visitas por semana (de lunes a domingo) de las últimas `semanas` semanas. */
export async function seriesSemanales(bd: Bd, id: number, semanas = 12): Promise<{ desde: string; total: number }[]> {
  const h = hoy(), diaSemana = (new Date(h + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const lunes = sumarDias(h, -diaSemana - 7 * (semanas - 1));
  const res = Array.from({ length: semanas }, (_, i) => ({ desde: sumarDias(lunes, 7 * i), total: 0 }));
  const { rows } = await bd.query<{ dia: string; total: number }>('select dia, total from visitas where enlace_id = $1 and dia >= $2', [id, lunes]);
  for (const r of rows) {
    const i = Math.floor((Date.parse(r.dia) - Date.parse(lunes)) / (7 * 864e5));
    if (i >= 0 && i < semanas) res[i].total += r.total;
  }
  return res;
}

export async function nombreLibre(bd: Bd, nombre: string, salvoId?: number): Promise<boolean> {
  const { rowCount } = await bd.query('select 1 from enlaces where lower(nombre) = $1 and id is distinct from $2', [clave(nombre), salvoId ?? null]);
  return rowCount === 0;
}

export async function nombreAutomaticoLibre(bd: Bd): Promise<string> {
  for (;;) {
    const n = generarAutomatico();
    if (await nombreLibre(bd, n)) return n;
  }
}

/** Escribe el nombre como se guarda: los automáticos en mayúsculas y el resto en minúsculas. */
export function limpiarNombre(nombre: string): string {
  const n = nombre.normalize('NFC').trim();
  return esAutomatico(n.toUpperCase()) && n === n.toUpperCase() ? n : n.toLowerCase();
}

export function problemaConDestino(destino: string): string | null {
  let u: URL;
  try { u = new URL(destino.trim()); } catch { return 'Pega una dirección completa, que empiece por https://'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Tiene que empezar por https:// o http://';
  if (!u.hostname.includes('.')) return 'Esa dirección no parece completa.';
  if (u.host === new URL(config.urlPublica).host) return 'No puede llevar a otro enlace de esta misma app.';
  return null;
}

export type DatosEnlace = { nombre: string; destino: string; titulo: string; etiqueta?: string; caduca?: string; activo?: boolean };

async function validar(bd: Bd, d: DatosEnlace, salvoId?: number, nombreAnterior?: string, esPagina = false): Promise<DatosEnlace> {
  const nombre = limpiarNombre(d.nombre);
  // Un nombre heredado de la app anterior (con ñ, +, mayúsculas…) se puede conservar al editar aunque hoy no se permita.
  if (nombre !== nombreAnterior && clave(nombre) !== clave(nombreAnterior ?? '')) {
    const p = problemaConNombre(nombre);
    if (p) throw new ErrorDeFormulario('nombre', p);
    if (!(await nombreLibre(bd, nombre, salvoId))) throw new ErrorDeFormulario('nombre', `${corta(nombre)} ya existe. Prueba con otro.`);
  }
  const destino = d.destino.trim();
  const pd = esPagina ? null : problemaConDestino(destino);
  if (pd) throw new ErrorDeFormulario('destino', pd);
  const caduca = d.caduca?.trim() || undefined;
  if (caduca && !/^\d{4}-\d{2}-\d{2}$/.test(caduca)) throw new ErrorDeFormulario('caduca', 'Fecha no válida.');
  return {
    nombre: nombreAnterior !== undefined && clave(nombre) === clave(nombreAnterior) ? nombreAnterior : nombre,
    destino, caduca, activo: d.activo,
    titulo: d.titulo.replace(/\s+/g, ' ').trim().slice(0, 120) || (esPagina ? 'Página sin título' : new URL(destino).hostname.replace(/^www\./, '')),
    etiqueta: d.etiqueta?.replace(/\s+/g, ' ').trim().slice(0, 30) || undefined,
  };
}

export async function crearEnlace(bd: Bd, usuarioId: number, d: DatosEnlace): Promise<number> {
  const v = await validar(bd, d);
  try {
    const { rows } = await bd.query<{ id: number }>(
      `insert into enlaces (nombre, destino, titulo, etiqueta, caduca, usuario_id) values ($1, $2, $3, $4, $5, $6) returning id`,
      [v.nombre, v.destino, v.titulo, v.etiqueta ?? null, v.caduca ?? null, usuarioId]);
    return rows[0].id;
  } catch (e) {
    // Dos profesores eligiendo el mismo nombre a la vez: lo para el índice único.
    if ((e as { code?: string }).code === '23505') throw new ErrorDeFormulario('nombre', `${corta(v.nombre)} ya existe. Prueba con otro.`);
    throw e;
  }
}

export async function actualizarEnlace(bd: Bd, id: number, d: DatosEnlace): Promise<void> {
  const actual = await enlacePorId(bd, id);
  if (!actual) throw new ErrorDeFormulario('nombre', 'Ese enlace ya no existe.');
  const v = await validar(bd, d, id, actual.nombre);
  try {
    // Si cambia el destino, lo que se sabía del anterior ya no vale: se vuelve a comprobar.
    await bd.query(
      `update enlaces set nombre = $2, destino = $3, titulo = $4, etiqueta = $5, caduca = $6, activo = $7, actualizado = now(),
         comprobado = case when destino is distinct from $3 then null else comprobado end,
         problema = case when destino is distinct from $3 then null else problema end,
         problema_detalle = case when destino is distinct from $3 then null else problema_detalle end,
         aviso_ignorado = case when destino is distinct from $3 then false else aviso_ignorado end
       where id = $1`, [id, v.nombre, v.destino, v.titulo, v.etiqueta ?? null, v.caduca ?? null, v.activo ?? actual.activo]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ErrorDeFormulario('nombre', `${corta(v.nombre)} ya existe. Prueba con otro.`);
    throw e;
  }
}

export async function cambiarActivo(bd: Bd, id: number, activo: boolean): Promise<void> {
  await bd.query('update enlaces set activo = $2, actualizado = now() where id = $1', [id, activo]);
}

export async function cambiarDueno(bd: Bd, id: number, usuarioId: number | null): Promise<void> {
  await bd.query(
    `update enlaces set usuario_id = $2, actualizado = now(),
       dueno_desde = case when usuario_id is distinct from $2 then now() else dueno_desde end
     where id = $1`, [id, usuarioId]);
}

export async function borrarEnlace(bd: Bd, id: number): Promise<void> {
  await bd.query('delete from enlaces where id = $1', [id]);
}

// ---------- Páginas con varios enlaces ----------

export const MAX_ELEMENTOS = 30;

export async function elementosDe(bd: Bd, paginaId: number): Promise<Elemento[]> {
  return (await bd.query<Elemento>(
    'select id, titulo, url, problema, problema_detalle from elementos where pagina_id = $1 order by posicion, id', [paginaId])).rows;
}

/** Página nueva, vacía y con nombre automático: se rellena en su ficha. */
export async function crearPagina(bd: Bd, usuarioId: number): Promise<number> {
  const { rows } = await bd.query<{ id: number }>(
    `insert into enlaces (tipo, nombre, titulo, usuario_id) values ('pagina', $1, 'Página nueva', $2) returning id`,
    [await nombreAutomaticoLibre(bd), usuarioId]);
  return rows[0].id;
}

export type DatosPagina = Omit<DatosEnlace, 'destino'> & { descripcion: string; elementos: { titulo: string; url: string }[] };

export async function actualizarPagina(bd: Bd, id: number, d: DatosPagina): Promise<void> {
  const actual = await enlacePorId(bd, id);
  if (!actual || actual.tipo !== 'pagina') throw new ErrorDeFormulario('nombre', 'Esa página ya no existe.');
  const v = await validar(bd, { ...d, destino: '' }, id, actual.nombre, true);
  const elementos = d.elementos
    .map(x => ({ titulo: x.titulo.replace(/\s+/g, ' ').trim().slice(0, 120), url: x.url.trim() }))
    .filter(x => x.titulo || x.url);
  if (elementos.length > MAX_ELEMENTOS) throw new ErrorDeFormulario('elementos', `Como mucho ${MAX_ELEMENTOS} enlaces por página.`);
  for (const [i, x] of elementos.entries()) {
    const p = problemaConDestino(x.url);
    if (p) throw new ErrorDeFormulario('elementos', `Enlace ${i + 1}${x.titulo ? ` («${x.titulo}»)` : ''}: ${p}`);
    if (!x.titulo) x.titulo = new URL(x.url).hostname.replace(/^www\./, '');
  }
  const c = await bd.connect();
  try {
    await c.query('begin');
    await c.query(
      `update enlaces set nombre = $2, titulo = $3, descripcion = $4, etiqueta = $5, caduca = $6, activo = $7, actualizado = now()
       where id = $1`, [id, v.nombre, v.titulo, d.descripcion.trim().slice(0, 600) || null, v.etiqueta ?? null, v.caduca ?? null, v.activo ?? actual.activo]);
    // Los enlaces que siguen igual conservan su última comprobación; los nuevos se comprobarán en la próxima ronda.
    const { rows: antes } = await c.query<{ url: string; comprobado: Date | null; problema: string | null; problema_detalle: string | null }>(
      'select url, comprobado, problema, problema_detalle from elementos where pagina_id = $1', [id]);
    const previos = new Map(antes.map(x => [x.url, x]));
    await c.query('delete from elementos where pagina_id = $1', [id]);
    for (const [i, x] of elementos.entries()) {
      const previo = previos.get(x.url);
      await c.query(
        `insert into elementos (pagina_id, posicion, titulo, url, comprobado, problema, problema_detalle)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, i, x.titulo, x.url, previo?.comprobado ?? null, previo?.problema ?? null, previo?.problema_detalle ?? null]);
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    if ((e as { code?: string }).code === '23505') throw new ErrorDeFormulario('nombre', `${corta(v.nombre)} ya existe. Prueba con otro.`);
    throw e;
  } finally {
    c.release();
  }
}

/** El dueño da por bueno el aviso (no vale para los enlaces rotos). Vuelve a salir si cambia el problema. */
export async function ignorarAviso(bd: Bd, id: number): Promise<void> {
  await bd.query("update enlaces set aviso_ignorado = true where id = $1 and problema in ('pide-sesion', 'formulario-cerrado')", [id]);
}
