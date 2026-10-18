import { describe, expect, it } from 'vitest';
import { componerInforme, momento, type Contexto, type Destinatario } from '../src/informe.ts';
import { cargarMarca } from '../src/marca.ts';

describe('cuándo sale el informe', () => {
  // Noviembre de 2026 empieza en domingo: el primer lunes es el día 2. Diciembre empieza en martes: el 7.
  const en = (iso: string) => momento(new Date(iso), 'Europe/Lisbon');
  it('el primer lunes de mes, desde las 8:00 hora del centro', () => {
    expect(en('2026-11-01T10:00:00Z')).toEqual({ mes: '2026-11', toca: false });
    expect(en('2026-11-02T07:59:00Z').toca).toBe(false);
    expect(en('2026-11-02T08:00:00Z').toca).toBe(true);
    expect(en('2026-12-06T12:00:00Z').toca).toBe(false);
    expect(en('2026-12-07T08:30:00Z')).toEqual({ mes: '2026-12', toca: true });
  });
  it('si el servidor estaba parado ese lunes, sale en cuanto vuelve, pero solo esa misma semana', () => {
    expect(en('2026-11-05T03:00:00Z')).toEqual({ mes: '2026-11', toca: true });
    expect(en('2026-11-08T23:00:00Z').toca).toBe(true);
    // Instalarla a mitad de mes no dispara el informe de ese mes.
    expect(en('2026-11-09T09:00:00Z').toca).toBe(false);
    expect(en('2026-10-18T09:00:00Z').toca).toBe(false);
  });
  it('usa la hora del centro, no la del servidor', () => {
    // A las 7:30 en Lisboa (horario de verano, UTC+1) ya son las 8:30 en Madrid.
    expect(momento(new Date('2026-10-05T06:30:00Z'), 'Europe/Lisbon').toca).toBe(false);
    expect(momento(new Date('2026-10-05T06:30:00Z'), 'Europe/Madrid').toca).toBe(true);
  });
});

describe('el correo', () => {
  const cx: Contexto = { dominio: 'enlaces.colegio.example', urlPublica: 'https://enlaces.colegio.example', pie: 'Colegio Ejemplo', colores: cargarMarca().colores, conLogo: true };
  const enlace = (id: number, titulo: string, problema: string, detalle: string) =>
    ({ id, tipo: 'enlace' as const, nombre: `n${id}`, titulo, visitas: 1371, problema, problema_detalle: detalle, elementos: [] });
  const ana: Destinatario = { id: 1, correo: 'ana@colegio.example', nombre: 'Ana Pérez', enlaces: [
    enlace(10, 'Matrícula <3.º ESO>', 'no-existe', 'La página ya no existe (error 404).'),
    { id: 11, tipo: 'pagina', nombre: '3primaria', titulo: '3.º de Primaria', visitas: 5, problema: null, problema_detalle: null,
      elementos: [{ titulo: 'Libros', problema_detalle: 'El dominio ya no existe.' }] },
    enlace(12, 'Comedor profesores', 'formulario-cerrado', 'El formulario ya no acepta respuestas.'),
  ] };

  it('dice cuántos son, saluda por el nombre y separa lo roto de lo que hay que revisar', () => {
    const c = componerInforme(ana, cx);
    expect(c.para).toBe('ana@colegio.example');
    expect(c.asunto).toBe('3 enlaces tuyos de enlaces.colegio.example necesitan revisión');
    expect(c.texto).toMatch(/^Hola, Ana:/);
    expect(c.texto).toContain('NO ABREN (2)');
    expect(c.texto).toContain('PARA REVISAR (1)');
    expect(c.html).toContain('https://enlaces.colegio.example/panel/enlaces/10');
    expect(c.html).toContain('Libros');
    expect(c.html).toContain('cid:isotipo');
  });

  it('lleva el dibujo tenue de fondo en la cabecera cuando hay dirección para él', () => {
    expect(componerInforme(ana, { ...cx, fondo: 'https://enlaces.colegio.example/marca/fondo-informe.png' }).html)
      .toContain("background-image:url('https://enlaces.colegio.example/marca/fondo-informe.png')");
    expect(componerInforme(ana, cx).html).not.toContain('background-image');
  });

  it('marca lo nuevo solo si ya había recibido algún informe, y lo pone primero', () => {
    const con = { ...ana, yaRecibio: true, enlaces: ana.enlaces.map(e => ({ ...e, nuevo: e.id === 10 })) };
    const c = componerInforme(con, cx);
    expect(c.html).toContain('NUEVO');
    expect(c.texto).toContain('[NUEVO] Matrícula <3.º ESO>');
    expect(c.texto).toContain('ha aparecido uno nuevo');
    expect(componerInforme({ ...con, yaRecibio: false }, cx).html).not.toContain('NUEVO');
    expect(c.html).toContain('solo si tienes algo nuevo que revisar');
  });

  it('escapa lo que escriben los profesores', () => {
    const c = componerInforme(ana, cx);
    expect(c.html).toContain('Matrícula &lt;3.º ESO&gt;');
    expect(c.html).not.toContain('<3.º ESO>');
  });

  it('en singular cuando es uno, y marca la prueba en el asunto', () => {
    const uno = { ...ana, enlaces: [ana.enlaces[0]] };
    expect(componerInforme(uno, cx).asunto).toBe('Un enlace tuyo de enlaces.colegio.example necesita revisión');
    expect(componerInforme(uno, cx, true).asunto).toMatch(/^\[Prueba\] /);
    expect(componerInforme(uno, cx).texto).not.toContain('PARA REVISAR');
  });
});
