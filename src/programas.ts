/**
 * Programas que crean enlaces por la API (src/api.ts): cada uno con su llave, los dominios hacia los que puede crear
 * enlaces y un tope de peticiones por minuto. Los crean los administradores en el panel.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Bd } from './db.ts';
import { enlacePorId, ErrorDeFormulario, type Enlace } from './enlaces.ts';
import { hoy } from './fechas.ts';
import { clave } from './nombres.ts';

export type Programa = {
  id: number; nombre: string; dominios: string[]; por_minuto: number; activo: boolean;
  creado: Date; creado_por: string | null; ultimo_uso: Date | null; enlaces: number;
};

export type ProgramaActivo = Pick<Programa, 'id' | 'nombre' | 'dominios' | 'por_minuto'>;

export type DatosPrograma = { nombre: string; dominios: string; por_minuto: string };

/** 32 bytes al azar: no se puede adivinar, así que basta con guardar su huella. */
const llaveNueva = () => randomBytes(32).toString('base64url');
const huella = (llave: string) => createHash('sha256').update(llave).digest('hex');

/** «aula.colegio.example, https://otro.example/algo» → ['aula.colegio.example', 'otro.example']. */
export function leerDominios(texto: string): string[] {
  const dominios = new Set<string>();
  for (const parte of texto.split(/[\s,;]+/).filter(Boolean)) {
    let servidor = '';
    try { servidor = new URL(parte.includes('://') ? parte : `https://${parte}`).hostname.toLowerCase(); } catch { /* abajo */ }
    if (!servidor.includes('.')) throw new ErrorDeFormulario('dominios', `«${parte}» no parece un dominio.`);
    dominios.add(servidor);
  }
  if (!dominios.size) throw new ErrorDeFormulario('dominios', 'Escribe al menos un dominio, por ejemplo aula.colegio.example.');
  return [...dominios];
}

function validar(d: DatosPrograma) {
  const nombre = d.nombre.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!nombre) throw new ErrorDeFormulario('nombre', 'Escribe el nombre del programa.');
  const dominios = leerDominios(d.dominios);
  const porMinuto = d.por_minuto.trim() === '' ? 60 : Number(d.por_minuto);
  if (!Number.isInteger(porMinuto) || porMinuto < 1 || porMinuto > 600) throw new ErrorDeFormulario('por_minuto', 'Entre 1 y 600 peticiones por minuto.');
  return { nombre, dominios, porMinuto };
}

const nombreRepetido = (e: unknown, nombre: string) => (e as { code?: string }).code === '23505'
  ? new ErrorDeFormulario('nombre', `Ya hay un programa que se llama «${nombre}».`) : e;

/** Devuelve la llave: es la única vez que se puede ver. */
export async function crearPrograma(bd: Bd, usuarioId: number, d: DatosPrograma): Promise<{ id: number; llave: string }> {
  const v = validar(d), llave = llaveNueva();
  try {
    const { rows } = await bd.query<{ id: number }>(
      'insert into programas (nombre, llave, dominios, por_minuto, creado_por) values ($1, $2, $3, $4, $5) returning id',
      [v.nombre, huella(llave), v.dominios, v.porMinuto, usuarioId]);
    olvidarLlaves();
    return { id: rows[0].id, llave };
  } catch (e) {
    throw nombreRepetido(e, v.nombre);
  }
}

export async function cambiarPrograma(bd: Bd, id: number, d: DatosPrograma): Promise<void> {
  const v = validar(d);
  try {
    await bd.query('update programas set nombre = $2, dominios = $3, por_minuto = $4 where id = $1', [id, v.nombre, v.dominios, v.porMinuto]);
    olvidarLlaves();
  } catch (e) {
    throw nombreRepetido(e, v.nombre);
  }
}

/** Llave nueva: la anterior deja de valer al momento. Si el programa estaba retirado, vuelve a estar activo. */
export async function cambiarLlave(bd: Bd, id: number): Promise<string> {
  const llave = llaveNueva();
  await bd.query('update programas set llave = $2, activo = true where id = $1', [id, huella(llave)]);
  olvidarLlaves();
  return llave;
}

/** Su llave deja de valer; sus enlaces siguen funcionando y se pueden pasar a un profesor. */
export async function retirarPrograma(bd: Bd, id: number): Promise<void> {
  await bd.query('update programas set activo = false where id = $1', [id]);
  olvidarLlaves();
}

export async function listarProgramas(bd: Bd): Promise<Programa[]> {
  return (await bd.query<Programa>(
    `select p.id, p.nombre, p.dominios, p.por_minuto, p.activo, p.creado, u.nombre as creado_por, p.ultimo_uso,
            (select count(*)::int from enlaces e where e.programa_id = p.id) as enlaces
     from programas p left join usuarios u on u.id = p.creado_por
     order by p.activo desc, lower(p.nombre)`)).rows;
}

export async function programaPorId(bd: Bd, id: number): Promise<Programa | undefined> {
  return (await listarProgramas(bd)).find(p => p.id === id);
}

/**
 * Las llaves de los programas activos (por su huella), en memoria: así una llave mala no llega a la base, por muchas
 * que se prueben. Se vuelven a leer cada minuto y en cuanto un administrador cambia algo de un programa.
 */
let llaves: { leidas: number; porHuella: Map<string, ProgramaActivo> } | null = null;
const olvidarLlaves = () => { llaves = null; };

export async function programaPorLlave(bd: Bd, llave: string): Promise<ProgramaActivo | undefined> {
  if (!llave) return undefined;
  if (!llaves || Date.now() - llaves.leidas > 60_000) {
    const { rows } = await bd.query<ProgramaActivo & { llave: string }>('select id, nombre, dominios, por_minuto, llave from programas where activo');
    llaves = { leidas: Date.now(), porHuella: new Map(rows.map(({ llave: h, ...p }) => [h, p])) };
  }
  return llaves.porHuella.get(huella(llave));
}

/** Cuántos enlaces tiene ya un programa (tienen un tope: ver api.ts). */
export async function enlacesDelPrograma(bd: Bd, id: number): Promise<number> {
  return (await bd.query<{ n: number }>('select count(*)::int as n from enlaces where programa_id = $1', [id])).rows[0].n;
}

export async function apuntarUso(bd: Bd, id: number): Promise<void> {
  await bd.query('update programas set ultimo_uso = now() where id = $1', [id]);
}

/** Un enlace de este programa por su nombre (los de los profesores no los ve). */
export async function enlaceDelPrograma(bd: Bd, programaId: number, nombre: string): Promise<Enlace | undefined> {
  const { rows } = await bd.query<{ id: number }>('select id from enlaces where lower(nombre) = $1 and programa_id = $2', [clave(nombre), programaId]);
  return rows[0] ? enlacePorId(bd, rows[0].id) : undefined;
}

/** El enlace más reciente de este programa hacia ese destino, si ya tiene uno. */
export async function enlaceDelProgramaHacia(bd: Bd, programaId: number, destino: string): Promise<Enlace | undefined> {
  // Solo uno que funcione: uno en pausa o caducado llevaría a la página de «no disponible».
  const { rows } = await bd.query<{ id: number }>(
    `select id from enlaces where programa_id = $1 and destino = $2 and activo and (caduca is null or caduca >= $3::date)
     order by id desc limit 1`, [programaId, destino, hoy()]);
  return rows[0] ? enlacePorId(bd, rows[0].id) : undefined;
}
