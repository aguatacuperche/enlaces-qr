/**
 * Migración desde la app anterior (exportación en CSV de sus tablas `users` y `links`). Aquí solo se decide qué pasa
 * con cada fila; escribir en la base lo hace scripts/migrar.ts.
 *
 * Reglas:
 * - Usuarios: solo los que hoy podrían entrar (ver acceso.ts). Las cuentas excluidas no se migran, y sus enlaces
 *   tampoco.
 * - Enlaces con el mismo nombre sin distinguir mayúsculas: se queda el más reciente (id mayor) y se suman las visitas.
 * - Enlaces cuyo nombre no puede funcionar como dirección (lleva / ? # o espacios) o con un destino que no es una
 *   dirección web: no se migran y se avisa.
 */
import { puedeEntrar, normalizarCorreo, type Reglas } from './acceso.ts';
import { clave, RESERVADOS } from './nombres.ts';

export type FilaUsuario = { id: string; email: string; name: string; admin: string };
export type FilaEnlace = { id: string; slug: string; destiny: string; name: string; visits: string; enable: string; user_id: string; inserted_at: string; updated_at: string };

export type UsuarioMigrado = { idAntiguo: number; correo: string; nombre: string; admin: boolean };
export type EnlaceMigrado = {
  idAntiguo: number; nombre: string; destino: string; titulo: string; activo: boolean; correoDueno: string | null;
  visitasAnteriores: number; creado: string; actualizado: string; fundidos: number[];
};

export type Plan = {
  usuarios: UsuarioMigrado[];
  enlaces: EnlaceMigrado[];
  descartes: {
    usuariosExcluidos: string[];
    usuariosOtroDominio: string[];
    enlacesDeExcluidos: { id: number; nombre: string; visitas: number }[];
    nombresImposibles: { id: number; nombre: string }[];
    destinosNoValidos: { id: number; nombre: string; destino: string }[];
  };
  /** Nombres de la app anterior que chocan con rutas de esta: si hay alguno, la migración no sigue. */
  choquesConRutas: string[];
};

const esVerdad = (v: string) => v === 't' || v === 'true' || v === '1';
const aFecha = (v: string) => (v.includes('T') ? v : v.replace(' ', 'T')) + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z');

function destinoValido(d: string): boolean {
  try {
    const u = new URL(d);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch { return false; }
}

export function planificar(filasUsuarios: FilaUsuario[], filasEnlaces: FilaEnlace[], reglas: Reglas): Plan {
  const plan: Plan = {
    usuarios: [], enlaces: [], choquesConRutas: [],
    descartes: { usuariosExcluidos: [], usuariosOtroDominio: [], enlacesDeExcluidos: [], nombresImposibles: [], destinosNoValidos: [] },
  };

  const correoDe = new Map<string, string>();
  const fuera = new Set<string>();
  for (const f of filasUsuarios) {
    const correo = normalizarCorreo(f.email);
    const v = puedeEntrar(correo, reglas);
    if (!v.ok) {
      fuera.add(f.id);
      (v.motivo === 'excluido' ? plan.descartes.usuariosExcluidos : plan.descartes.usuariosOtroDominio).push(correo);
      continue;
    }
    correoDe.set(f.id, correo);
    plan.usuarios.push({ idAntiguo: Number(f.id), correo, nombre: f.name.trim() || correo, admin: esVerdad(f.admin) });
  }

  const grupos = new Map<string, FilaEnlace[]>();
  for (const f of filasEnlaces) {
    const nombre = f.slug.normalize('NFC').trim();
    if (fuera.has(f.user_id)) {
      plan.descartes.enlacesDeExcluidos.push({ id: Number(f.id), nombre, visitas: Number(f.visits) || 0 });
      continue;
    }
    if (!nombre || /[/?#\s\\]/.test(nombre)) { plan.descartes.nombresImposibles.push({ id: Number(f.id), nombre }); continue; }
    if (!destinoValido(f.destiny.trim())) { plan.descartes.destinosNoValidos.push({ id: Number(f.id), nombre, destino: f.destiny }); continue; }
    if (RESERVADOS.has(clave(nombre))) plan.choquesConRutas.push(nombre);
    const g = grupos.get(clave(nombre)) ?? [];
    g.push({ ...f, slug: nombre });
    grupos.set(clave(nombre), g);
  }

  for (const g of grupos.values()) {
    g.sort((a, b) => Number(b.id) - Number(a.id));
    const [queda, ...otros] = g;
    plan.enlaces.push({
      idAntiguo: Number(queda.id),
      nombre: queda.slug,
      destino: queda.destiny.trim(),
      titulo: queda.name.replace(/\s+/g, ' ').trim().slice(0, 120) || queda.slug,
      activo: esVerdad(queda.enable),
      correoDueno: correoDe.get(queda.user_id) ?? null,
      visitasAnteriores: g.reduce((s, f) => s + (Number(f.visits) || 0), 0),
      creado: aFecha(queda.inserted_at),
      actualizado: aFecha(queda.updated_at),
      fundidos: otros.map(f => Number(f.id)),
    });
  }
  plan.enlaces.sort((a, b) => a.idAntiguo - b.idAntiguo);
  return plan;
}
