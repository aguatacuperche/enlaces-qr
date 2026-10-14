import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Carpeta raíz de la app (donde están `vistas/`, `publico/`, `sql/`…). */
export const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const ruta = (...partes: string[]) => path.join(RAIZ, ...partes);
