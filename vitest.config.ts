import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pocos hilos: las pruebas del QR dibujan imágenes y la máquina se comparte.
    maxWorkers: 2,
    testTimeout: 60_000,
    // Las pruebas con base de datos comparten una base: de una en una.
    fileParallelism: false,
  },
});
