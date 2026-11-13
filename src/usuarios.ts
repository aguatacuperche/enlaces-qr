/** Profesores y personal del centro. Se dan de alta solos la primera vez que entran con Google. */
import type { Bd } from './db.ts';
import { normalizarCorreo } from './acceso.ts';

export type Usuario = {
  id: number; correo: string; nombre: string; admin: boolean; preferencias_qr: Record<string, string> | null; ayuda_cerrada: boolean;
  /** Un administrador le ha quitado el acceso. */
  bloqueado: boolean;
};

export type UsuarioConEnlaces = Usuario & { enlaces: number; con_problemas: number; ultimo_informe: Date | null; ultima_entrada: Date | null };

const CAMPOS = 'id, correo, nombre, admin, preferencias_qr, ayuda_cerrada, bloqueado';

/**
 * Llamar solo después de comprobar `puedeEntrar`. Sin nombre, se conserva el que ya tenía (o se usa el correo).
 * Con `admin`, pasa a ser administrador (los de la variable ADMINISTRADORES); si no, se queda como estaba. A quien
 * tiene el acceso quitado no se le apunta la entrada: la rechaza quien llama.
 */
export async function registrarEntrada(bd: Bd, correo: string, nombre: string, admin = false): Promise<Usuario> {
  const { rows } = await bd.query<Usuario>(
    `insert into usuarios (correo, nombre, ultima_entrada, admin) values ($1, coalesce(nullif($2, ''), $1), now(), $3)
     on conflict (correo) do update set nombre = case when usuarios.bloqueado then usuarios.nombre else coalesce(nullif($2, ''), usuarios.nombre) end,
       ultima_entrada = case when usuarios.bloqueado then usuarios.ultima_entrada else now() end,
       admin = usuarios.admin or ($3 and not usuarios.bloqueado)
     returning ${CAMPOS}`, [normalizarCorreo(correo), nombre.trim(), admin]);
  return rows[0];
}

/** Quita o devuelve el acceso. Al quitarlo, deja de ser administrador y se cierran todas sus sesiones abiertas. */
export async function cambiarAcceso(bd: Bd, id: number, bloqueado: boolean): Promise<void> {
  await bd.query('update usuarios set bloqueado = $2, admin = admin and not $2 where id = $1', [id, bloqueado]);
  if (bloqueado) await bd.query(`delete from sesiones where (sess->>'usuarioId')::int = $1`, [id]);
}

export async function usuarioPorId(bd: Bd, id: number): Promise<Usuario | undefined> {
  return (await bd.query<Usuario>(`select ${CAMPOS} from usuarios where id = $1`, [id])).rows[0];
}

/** Con cuántos enlaces activos que necesitan revisión tiene cada uno y cuándo recibió el último informe. */
export async function listarUsuarios(bd: Bd): Promise<UsuarioConEnlaces[]> {
  return (await bd.query<UsuarioConEnlaces>(
    `select u.id, u.correo, u.nombre, u.admin, u.preferencias_qr, u.ultima_entrada, u.bloqueado,
            (select count(*)::int from enlaces e where e.usuario_id = u.id) as enlaces,
            (select count(*)::int from enlaces e where e.usuario_id = u.id and e.activo
               and ((e.problema is not null and not e.aviso_ignorado)
                    or exists (select 1 from elementos x where x.pagina_id = e.id and x.problema is not null and not x.aviso_ignorado))) as con_problemas,
            (select max(enviado) from informes i where i.usuario_id = u.id) as ultimo_informe
     from usuarios u order by lower(u.nombre)`)).rows;
}

export async function cambiarAdmin(bd: Bd, id: number, admin: boolean): Promise<void> {
  await bd.query('update usuarios set admin = $2 and not bloqueado where id = $1', [id, admin]);
}

/**
 * Pasa todos los enlaces de un usuario (o los que no tienen dueño, con `de = null`) a otro. Devuelve cuántos.
 * Los de los programas no cuentan como «sin dueño»: se pasan de uno en uno, desde su ficha.
 */
export async function pasarEnlaces(bd: Bd, de: number | null, a: number): Promise<number> {
  const r = await bd.query(
    `update enlaces set usuario_id = $2, actualizado = now(),
       dueno_desde = case when usuario_id is distinct from $2 then now() else dueno_desde end
     where usuario_id is not distinct from $1 and ($1::int is not null or programa_id is null)`, [de, a]);
  return r.rowCount ?? 0;
}

export async function cerrarAyuda(bd: Bd, id: number): Promise<void> {
  await bd.query('update usuarios set ayuda_cerrada = true where id = $1', [id]);
}

export async function guardarPreferenciasQR(bd: Bd, id: number, opciones: Record<string, string>): Promise<void> {
  await bd.query('update usuarios set preferencias_qr = $2 where id = $1', [id, opciones]);
}
