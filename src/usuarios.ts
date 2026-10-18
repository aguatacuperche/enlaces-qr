/** Profesores y personal del centro. Se dan de alta solos la primera vez que entran con Google. */
import type { Bd } from './db.ts';
import { normalizarCorreo } from './acceso.ts';

export type Usuario = { id: number; correo: string; nombre: string; admin: boolean; preferencias_qr: Record<string, string> | null; ayuda_cerrada: boolean };

export type UsuarioConEnlaces = Usuario & { enlaces: number; con_problemas: number; ultimo_informe: Date | null; ultima_entrada: Date | null };

const CAMPOS = 'id, correo, nombre, admin, preferencias_qr, ayuda_cerrada';

/** Llamar solo después de comprobar `puedeEntrar`. Sin nombre, se conserva el que ya tenía (o se usa el correo). */
export async function registrarEntrada(bd: Bd, correo: string, nombre: string): Promise<Usuario> {
  const { rows } = await bd.query<Usuario>(
    `insert into usuarios (correo, nombre, ultima_entrada) values ($1, coalesce(nullif($2, ''), $1), now())
     on conflict (correo) do update set nombre = coalesce(nullif($2, ''), usuarios.nombre), ultima_entrada = now()
     returning ${CAMPOS}`, [normalizarCorreo(correo), nombre.trim()]);
  return rows[0];
}

export async function usuarioPorId(bd: Bd, id: number): Promise<Usuario | undefined> {
  return (await bd.query<Usuario>(`select ${CAMPOS} from usuarios where id = $1`, [id])).rows[0];
}

/** Con cuántos enlaces activos que necesitan revisión tiene cada uno y cuándo recibió el último informe. */
export async function listarUsuarios(bd: Bd): Promise<UsuarioConEnlaces[]> {
  return (await bd.query<UsuarioConEnlaces>(
    `select u.id, u.correo, u.nombre, u.admin, u.preferencias_qr, u.ultima_entrada,
            (select count(*)::int from enlaces e where e.usuario_id = u.id) as enlaces,
            (select count(*)::int from enlaces e where e.usuario_id = u.id and e.activo
               and ((e.problema is not null and not e.aviso_ignorado)
                    or exists (select 1 from elementos x where x.pagina_id = e.id and x.problema is not null))) as con_problemas,
            (select max(enviado) from informes i where i.usuario_id = u.id) as ultimo_informe
     from usuarios u order by lower(u.nombre)`)).rows;
}

export async function cambiarAdmin(bd: Bd, id: number, admin: boolean): Promise<void> {
  await bd.query('update usuarios set admin = $2 where id = $1', [id, admin]);
}

/** Pasa todos los enlaces de un usuario (o los que no tienen dueño, con `de = null`) a otro. Devuelve cuántos. */
export async function pasarEnlaces(bd: Bd, de: number | null, a: number): Promise<number> {
  const r = await bd.query('update enlaces set usuario_id = $2, actualizado = now() where usuario_id is not distinct from $1', [de, a]);
  return r.rowCount ?? 0;
}

export async function cerrarAyuda(bd: Bd, id: number): Promise<void> {
  await bd.query('update usuarios set ayuda_cerrada = true where id = $1', [id]);
}

export async function guardarPreferenciasQR(bd: Bd, id: number, opciones: Record<string, string>): Promise<void> {
  await bd.query('update usuarios set preferencias_qr = $2 where id = $1', [id, opciones]);
}
