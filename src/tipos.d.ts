// opentype.js 2 no trae tipos; aquí solo lo que usa la app.
declare module 'opentype.js' {
  namespace opentype {
    interface Path { toPathData(decimales?: number): string }
    /** `index` 0 es el glifo vacío: la fuente no tiene esa letra. */
    interface Glyph { index: number; advanceWidth?: number; getPath(x: number, y: number, tam: number): Path }
    interface Font {
      unitsPerEm: number;
      tables: { os2?: { sCapHeight?: number } };
      charToGlyph(letra: string): Glyph;
      getKerningValue(izquierda: Glyph, derecha: Glyph): number;
    }
  }
  const opentype: { parse(datos: ArrayBuffer): opentype.Font };
  export default opentype;
}
