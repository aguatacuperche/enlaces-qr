import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { planificar, type FilaEnlace, type FilaUsuario } from '../src/migracion.ts';
import { reglasDelEntorno } from '../src/acceso.ts';

// Datos inventados con todos los casos raros de la exportación real.
const leer = <T>(f: string) => parse(fs.readFileSync(new URL(`datos/${f}`, import.meta.url), 'utf8'), { columns: true }) as T[];
const plan = planificar(leer<FilaUsuario>('usuarios.csv'), leer<FilaEnlace>('enlaces.csv'),
  reglasDelEntorno({ DOMINIO_CORREO: 'colegio.example', CORREOS_EXCLUIDOS: '\\d' }));
const enlace = (nombre: string) => plan.enlaces.find(e => e.nombre.toLowerCase() === nombre.toLowerCase());

describe('plan de migración', () => {
  it('migra solo a quien hoy podría entrar, con el correo en minúsculas', () => {
    expect(plan.usuarios.map(u => u.correo)).toEqual(['ana.perez@colegio.example', 'luis.gomez@colegio.example']);
    expect(plan.usuarios[0].admin).toBe(true);
    expect(plan.descartes.usuariosExcluidos).toEqual(['nombre2010b@colegio.example', 'otro08c@colegio.example']);
    expect(plan.descartes.usuariosOtroDominio).toEqual(['alguien@gmail.com']);
  });

  it('los enlaces de las cuentas excluidas no se migran, aunque estén repetidos', () => {
    expect(plan.descartes.enlacesDeExcluidos.map(e => e.id)).toEqual([40, 41, 42]);
    expect(enlace('WQTR')).toBeUndefined();
    expect(enlace('ZMBK')).toBeUndefined();
  });

  it('en los repetidos se queda el más reciente con las visitas sumadas', () => {
    expect(enlace('evaluacion')).toMatchObject({ idAntiguo: 21, destino: 'https://evaluacion.example.com/2024', visitasAnteriores: 512, fundidos: [20] });
    expect(enlace('inscripcion')).toMatchObject({ idAntiguo: 31, nombre: 'inscripcion', visitasAnteriores: 100, fundidos: [30] });
  });

  it('respeta los nombres heredados tal cual', () => {
    expect(enlace('Qx7b')?.nombre).toBe('Qx7b');
    expect(enlace('otoño')?.correoDueno).toBe('luis.gomez@colegio.example');
    expect(enlace('+DATOS')?.destino).toBe('https://drive.example.com/tarifas');
    expect(enlace('pausado')?.activo).toBe(false);
  });

  it('aparta lo que no puede funcionar y avisa', () => {
    expect(plan.descartes.nombresImposibles.map(e => e.id)).toEqual([50]);
    expect(plan.descartes.destinosNoValidos.map(e => e.id)).toEqual([51]);
    expect(enlace('huerfano')?.correoDueno).toBeNull();
    expect(plan.choquesConRutas).toEqual([]);
  });

  it('cuadran los recuentos', () => {
    // 15 filas − 3 de cuentas excluidas − 1 nombre imposible − 1 destino roto − 2 fundidos = 8
    expect(plan.enlaces).toHaveLength(8);
    expect(plan.enlaces[0].creado).toBe('2021-02-09T13:55:08Z');
  });
});
