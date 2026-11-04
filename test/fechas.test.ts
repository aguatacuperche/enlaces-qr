import { describe, expect, it, vi } from 'vitest';
import { hoy } from '../src/fechas.ts';

describe('hoy', () => {
  it('da la fecha en la zona del centro, no la del servidor', () => {
    expect(hoy(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05');
  });
  it('no crea un formateador en cada llamada: se llama por cada enlace en cada dirección que no existe', () => {
    const espia = vi.spyOn(Intl, 'DateTimeFormat');
    for (let i = 0; i < 100; i++) hoy();
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});
