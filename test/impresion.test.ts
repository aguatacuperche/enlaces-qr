import { describe, expect, it } from 'vitest';
import { cartel, HOJAS, ladoQrPegatina, pegatinas, posiciones, problemaConHoja, type Hoja } from '../src/qr/impresion.ts';
import { dibujarQR } from '../src/qr/dibujo.ts';
import { POR_DEFECTO } from '../src/qr/opciones.ts';

const paginas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const svg = dibujarQR('https://enlaces.example/excursion-museo', { ...POR_DEFECTO, marco: 'no' }, 'excursion-museo');

describe('hojas de pegatinas', () => {
  it('todos los formatos habituales caben en un A4 y dejan un QR legible', () => {
    for (const [clave, h] of Object.entries(HOJAS)) {
      expect(problemaConHoja(h), clave).toBeNull();
      expect(ladoQrPegatina(h, 'titulo'), clave).toBeGreaterThanOrEqual(18);
    }
  });

  it('rechaza las medidas a medida que no caben o no tienen sentido', () => {
    const base: Hoja = { ...HOJAS['21-70x42'], nombre: 'A medida' };
    expect(problemaConHoja({ ...base, columnas: 5, ancho: 60 })).toMatch(/no caben/);
    expect(problemaConHoja({ ...base, alto: 10 })).toMatch(/15 × 15/);
    expect(problemaConHoja({ ...base, ancho: Number.NaN })).toMatch(/números/);
  });

  it('coloca las pegatinas en orden, empezando donde se diga y pasando a otra hoja si hace falta', () => {
    const h = HOJAS['21-63x38'];
    const p = posiciones(h, 1, 3);
    expect(p.map(x => x.x)).toEqual([7.21, 7.21 + 66.04, 7.21 + 2 * 66.04].map(n => expect.closeTo(n, 5)));
    expect(p.every(x => x.y === 15.15 && x.hoja === 0)).toBe(true);
    const desde20 = posiciones(h, 20, 4);
    expect(desde20.map(x => x.hoja)).toEqual([0, 0, 1, 1]);
    expect(desde20[2]).toMatchObject({ x: 7.21, y: 15.15 });
  });

  it('saca el PDF con las hojas necesarias', async () => {
    const una = await pegatinas(svg, 'enlaces.example/excursion-museo', 'Excursión al museo', { hoja: HOJAS['21-70x42'], empezar: 1, cuantas: 21, texto: 'titulo', bordes: true });
    expect(una.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(una)).toBe(1);
    const dos = await pegatinas(svg, 'enlaces.example/excursion-museo', '', { hoja: HOJAS['40-52x29'], empezar: 30, cuantas: 20, texto: 'direccion', bordes: false });
    expect(paginas(dos)).toBe(2);
  });
});

describe('cartel', () => {
  it('sale en A4 y en A3', async () => {
    for (const tamano of ['a4', 'a3'] as const) {
      const pdf = await cartel(svg, 'enlaces.example/excursion-museo', 'Colegio Ejemplo', { tamano, titulo: 'Excursión al museo: autorización', texto: 'Escanea para rellenar la autorización' });
      expect(paginas(pdf)).toBe(1);
      expect(pdf.toString('latin1')).toContain(tamano === 'a3' ? '841.89 1190.55' : '595.28 841.89');
    }
  });
});
