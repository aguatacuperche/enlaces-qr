import { describe, expect, it } from 'vitest';
import { esExcluido, puedeEntrar, reglasDelEntorno } from '../src/acceso.ts';

const reglas = reglasDelEntorno({ DOMINIO_CORREO: 'colegio.example', CORREOS_EXCLUIDOS: '\\d' });
import { clave, distancia, esAutomatico, generarAutomatico, nombreDesdeTexto, parecido, problemaConNombre } from '../src/nombres.ts';

describe('quién puede entrar', () => {
  it('deja entrar a profesores y personal del centro', () => {
    expect(puedeEntrar('ana.perez@colegio.example', reglas)).toEqual({ ok: true });
    expect(puedeEntrar('  Secretaria@Colegio.example ', reglas)).toEqual({ ok: true });
  });
  it('deja fuera las cuentas excluidas (aquí, las de alumnos: llevan cifras antes de la @)', () => {
    for (const c of ['nombre2012a@colegio.example', 'nombre08c@colegio.example', '2012nombre@colegio.example', 'ana.2011b@colegio.example']) {
      expect(esExcluido(c, reglas)).toBe(true);
      expect(puedeEntrar(c, reglas)).toEqual({ ok: false, motivo: 'excluido' });
    }
  });
  it('deja fuera las cuentas de otros dominios, aunque se parezcan', () => {
    for (const c of ['ana@gmail.com', 'ana@colegio.example.es', 'ana@falsocolegio.example', 'ana@x@colegio.example']) {
      expect(puedeEntrar(c, reglas)).toEqual({ ok: false, motivo: 'otro-dominio' });
    }
  });
  it('sin patrón de exclusión entra cualquier cuenta del dominio', () => {
    const todas = reglasDelEntorno({ DOMINIO_CORREO: '@colegio.example' });
    expect(puedeEntrar('nombre2012a@colegio.example', todas)).toEqual({ ok: true });
    expect(() => reglasDelEntorno({})).toThrow(/DOMINIO_CORREO/);
  });
});

describe('nombres de enlace', () => {
  it('no distingue mayúsculas ni formas de escribir la ñ', () => {
    expect(clave('NOTAS')).toBe(clave('notas'));
    expect(clave('oton\u0303o')).toBe(clave('otoño'));
  });
  it('los automáticos son 4 mayúsculas sin letras que se confunden', () => {
    for (let i = 0; i < 200; i++) {
      const n = generarAutomatico();
      expect(n).toMatch(/^[A-Z]{4}$/);
      expect(n).not.toMatch(/[OIL]/);
      expect(esAutomatico(n)).toBe(true);
    }
  });
  it('valida los nombres escritos a mano', () => {
    expect(problemaConNombre('excursion-museo')).toBeNull();
    expect(problemaConNombre('matricula2027')).toBeNull();
    expect(problemaConNombre('KXRT')).toBeNull();
    expect(problemaConNombre('ab')).not.toBeNull();
    expect(problemaConNombre('Excursión')).not.toBeNull();
    expect(problemaConNombre('con espacio')).not.toBeNull();
    expect(problemaConNombre('-guion')).not.toBeNull();
    expect(problemaConNombre('panel')).not.toBeNull();
    expect(problemaConNombre('https://youtube.com/x')).not.toBeNull();
  });
  it('propone un nombre a partir del título', () => {
    expect(nombreDesdeTexto('Excursión al museo: autorización')).toBe('excursion-al-museo-autorizacion');
    expect(nombreDesdeTexto('  ¿Menú de octubre?  ')).toBe('menu-de-octubre');
  });
  it('encuentra el enlace parecido cuando hay una errata', () => {
    expect(distancia('excursion-mueso', 'excursion-museo')).toBe(2);
    expect(parecido('excursion-mueso', ['matricula', 'excursion-museo'])).toBe('excursion-museo');
    expect(parecido('notas', ['notas'])).toBeNull();
    expect(parecido('abc', ['abd'])).toBeNull();
    expect(parecido('zzzzzzz', ['matricula'])).toBeNull();
  });
});
