import { describe, expect, it } from 'vitest';
import { dibujarQR } from '../src/qr/dibujo.ts';
import { pdf, png, seLee } from '../src/qr/exportar.ts';
import { leerOpciones, POR_DEFECTO, type Opciones } from '../src/qr/opciones.ts';

const URL = 'https://enlaces.example/excursion-museo';

describe('creador de QR', () => {
  it('todas las combinaciones de opciones se leen', () => {
    const fallos: string[] = [];
    for (const color of ['marca', 'principal', 'segundo', 'tercero', 'oscuro'] as const)
      for (const puntos of ['redondeados', 'circulos', 'cuadrados'] as const)
        for (const esquinas of ['redondeadas', 'circulo', 'cuadradas'] as const)
          for (const centro of ['logo', 'nada'] as const)
            for (const marco of ['escaneame', 'nombre', 'libre', 'no'] as const) {
              const o: Opciones = { ...POR_DEFECTO, color, puntos, esquinas, centro, marco, texto: 'Autorización museo' };
              if (!seLee(dibujarQR(URL, o, 'excursion-museo'), URL, 240)) fallos.push(JSON.stringify(o));
            }
    expect(fallos).toEqual([]);
  });

  it('se lee también con un nombre largo y el fondo transparente', () => {
    const url = 'https://enlaces.example/jornada-de-puertas-abiertas-2026-infantil-y-primaria';
    const o = { ...POR_DEFECTO, marco: 'nombre' as const, fondo: 'transparente' as const };
    expect(seLee(dibujarQR(url, o, 'jornada-de-puertas-abiertas-2026-infantil-y-primaria'), url)).toBe(true);
  });

  it('el texto del marco va en trazos, sin depender de tipografías instaladas', () => {
    const svg = dibujarQR(URL, { ...POR_DEFECTO, marco: 'libre', texto: '¿Menú? <script>' }, 'x');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<script');
  });

  it('descarta valores que no existen y recorta el texto libre', () => {
    const o = leerOpciones({ color: 'acento', puntos: 'circulos', texto: 'x'.repeat(80) });
    expect(o.color).toBe('marca');
    expect(o.puntos).toBe('circulos');
    expect(o.texto).toHaveLength(28);
  });

  it('saca PNG y PDF', async () => {
    const svg = dibujarQR(URL, POR_DEFECTO, 'excursion-museo');
    const imagen = png(svg, 591);
    expect(imagen.subarray(1, 4).toString()).toBe('PNG');
    const doc = await pdf(svg, { ...POR_DEFECTO, tamano: 'cartel' }, 'enlaces.example/excursion-museo');
    expect(doc.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
