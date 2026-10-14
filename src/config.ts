/** Configuración desde variables de entorno (ver `.env.example`). */
import { reglasDelEntorno } from './acceso.ts';

function leer(nombre: string, porDefecto?: string): string {
  const v = process.env[nombre] || porDefecto;
  if (v === undefined || v === '') throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return v;
}

const produccion = process.env.NODE_ENV === 'production';
const entradaDePrueba = process.env.ENTRADA_DE_PRUEBA === 'si';
if (produccion && entradaDePrueba) throw new Error('ENTRADA_DE_PRUEBA no se puede usar en producción');
const nombreCentro = process.env.NOMBRE_CENTRO || 'Mi centro';

export const config = {
  produccion,
  puerto: Number(process.env.PUERTO ?? 3000),
  /** Dirección pública, sin barra final: https://enlaces.ejemplo.es */
  urlPublica: leer('URL_PUBLICA', produccion ? undefined : 'http://localhost:3000').replace(/\/+$/, ''),
  baseDeDatos: leer('DATABASE_URL'),
  secretoSesion: leer('SECRETO_SESION', produccion ? undefined : 'solo-para-desarrollo'),
  /** Entrar sin Google, escribiendo un correo. Solo para desarrollo y pruebas. */
  entradaDePrueba,
  google: entradaDePrueba ? null : { id: leer('GOOGLE_CLIENT_ID'), secreto: leer('GOOGLE_CLIENT_SECRET') },
  /** Dominio de correo del centro y cuentas que no pueden entrar. */
  acceso: reglasDelEntorno(),
  centro: {
    nombre: nombreCentro,
    /** Texto del pie de las páginas públicas. */
    pie: process.env.PIE || nombreCentro,
    /** Adónde llevan los botones de la página de enlace no encontrado (el del aula, solo si se indica). */
    web: process.env.WEB_CENTRO || '',
    aulaVirtual: process.env.AULA_VIRTUAL || '',
  },
};

/** Dirección corta de un enlace, para mostrar y para el QR. */
export const urlCorta = (nombre: string) => `${config.urlPublica}/${encodeURIComponent(nombre)}`;
