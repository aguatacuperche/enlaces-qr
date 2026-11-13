import { describe, expect, it } from 'vitest';
import { codigo, dibujarQR, ladoDelLogo } from '../src/qr/dibujo.ts';
import { pdf, png, seLee } from '../src/qr/exportar.ts';
import { leerOpciones, POR_DEFECTO, type Opciones } from '../src/qr/opciones.ts';

const URL = 'https://enlaces.example/excursion-museo';

describe('el logo y las direcciones largas', () => {
  it('desde la versión 7 el QR sale sin logo, para no tapar el patrón del centro', async () => {
    const { admiteLogo } = await import('../src/qr/dibujo.ts');
    const larga = 'https://enlaces.ayuntamiento-de-ejemplo.example/inscripciones-campamento-de-verano';
    expect(admiteLogo('https://enlaces.example/MKQT')).toBe(true);
    expect(admiteLogo(larga)).toBe(false);
    const { dibujarQR: dibujar } = await import('../src/qr/dibujo.ts');
    const { POR_DEFECTO: base } = await import('../src/qr/opciones.ts');
    expect(dibujar(larga, { ...base, centro: 'logo' }, 'x').match(/<svg/g)?.length).toBe(1);
    expect(dibujar('https://enlaces.example/MKQT', { ...base, centro: 'logo' }, 'x').match(/<svg/g)!.length).toBeGreaterThan(1);
  });
});

describe('creador de QR', () => {
  // Dibuja y lee 240 QR: con la máquina ocupada pasa del minuto.
  it('todas las combinaciones de opciones se leen', { timeout: 240_000 }, () => {
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

  it('el logo deja libre menos en los códigos pequeños, para que les quede corrección', () => {
    const version = (url: string) => (codigo(url).M.length - 17) / 4;
    const corta = 'https://e.example/AbCd', media = 'https://enlaces.example/abc';
    expect([version(corta), version(media), version(URL)]).toEqual([3, 4, 5]);
    expect([2, 3, 4, 5, 6, 10].map(ladoDelLogo)).toEqual([5, 7, 7, 9, 9, 9]);
    // La placa blanca del logo mide el lado libre menos 0,6 módulos.
    const placa = (url: string) => Number(dibujarQR(url, { ...POR_DEFECTO, marco: 'no' }, 'x').match(/<path fill="#fff" d="M([\d.]+) /)?.[1]);
    const n = (url: string) => codigo(url).M.length;
    expect(placa(corta)).toBeCloseTo(4 + (n(corta) - 1) / 2 - 3 + 0.3 + 2, 3);
    expect(placa(URL)).toBeCloseTo(4 + (n(URL) - 1) / 2 - 4 + 0.3 + 2, 3);
    const fallos: string[] = [];
    for (const url of [corta, media])
      for (const puntos of ['redondeados', 'circulos', 'cuadrados'] as const)
        for (const marco of ['escaneame', 'no'] as const) {
          const o: Opciones = { ...POR_DEFECTO, puntos, marco };
          if (!seLee(dibujarQR(url, o, 'x'), url, 240)) fallos.push(`${url} ${puntos} ${marco}`);
        }
    expect(fallos).toEqual([]);
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
