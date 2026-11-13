/** La app web: entrada, panel de los profesores y, sobre todo, la redirección <dominio>/<nombre>. */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { config, urlCorta } from './config.ts';
import { conectar, migrar, type Bd } from './db.ts';
import { ruta } from './raiz.ts';
import { ayudasVistas } from './ayudas-vistas.ts';
import { cargarUsuario, rutasDeEntrada, sesiones } from './entrada.ts';
import { rutasDelPanel } from './panel.ts';
import { rutasDeLaApi } from './api.ts';
import { iniciarComprobaciones } from './comprobador.ts';
import { crearCartero, type Cartero } from './correo.ts';
import { contexto, iniciarInformes } from './informe.ts';
import { elementosDe, enlacePorId } from './enlaces.ts';
import { contarVisita, cuentaComoVisita, recargar, resolver, volcarVisitas } from './redireccion.ts';
import { dibujarQR } from './qr/dibujo.ts';
import { pngAparte } from './qr/exportar.ts';
import { aConsulta, leerOpciones, POR_DEFECTO } from './qr/opciones.ts';
import { cargarMarca, cssDeMarca, ficheroDeMarca } from './marca.ts';
import { pngEslabonRoto } from './ilustracion.ts';

const require = createRequire(import.meta.url);

/** Los formularios solo se aceptan si vienen de la propia app (además de la cookie SameSite=Lax): esquema, servidor y puerto. */
function mismoOrigen(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origen = req.get('origin') ?? req.get('referer');
  if (origen && URL.canParse(origen) && new URL(origen).origin === new URL(config.urlPublica).origin) return next();
  res.status(403).render('error', { titulo: 'Petición rechazada', mensaje: 'Esta acción solo se puede hacer desde la propia página. Vuelve atrás, recarga y prueba otra vez.' });
}

/**
 * Los QR públicos (/svg y /png): los últimos que se han pedido se guardan ya hechos, y los PNG se dibujan fuera del
 * hilo principal y como mucho unos pocos a la vez. Un PNG cuesta una décima de segundo: sin esto, quien pidiera muchos
 * a la vez frenaría las redirecciones de los QR impresos.
 */
const QR_GUARDADOS = 100, PNG_EN_COLA = 4;
const qrHechos = new Map<string, Buffer | string>();
let pngDibujando = 0;
function qrGuardado(k: string): Buffer | string | undefined {
  const v = qrHechos.get(k);
  if (v !== undefined) { qrHechos.delete(k); qrHechos.set(k, v); }  // el más usado pasa al final: sale el último
  return v;
}
function guardarQr(k: string, v: Buffer | string) {
  qrHechos.set(k, v);
  if (qrHechos.size > QR_GUARDADOS) qrHechos.delete(qrHechos.keys().next().value!);
}

export function crearApp(bd: Bd, cartero: Cartero | null = crearCartero(process.env, new URL(config.urlPublica).host)) {
  const app = express();
  app.set('trust proxy', 1);
  app.set('views', ruta('vistas'));
  app.set('view engine', 'ejs');
  app.disable('x-powered-by');
  Object.assign(app.locals, ayudasVistas);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'], 'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], 'font-src': ["'self'"], 'form-action': ["'self'"],
        'frame-ancestors': ["'self'"], 'upgrade-insecure-requests': config.produccion ? [] : null,
      },
    },
    strictTransportSecurity: config.produccion,
    // Con «no-referrer» el navegador manda `Origin: null` en los formularios y mismoOrigen los rechazaría.
    referrerPolicy: { policy: 'same-origin' },
  }));

  app.use('/estaticos/fuentes', express.static(path.dirname(require.resolve('@fontsource/nunito/files/nunito-latin-400-normal.woff2')), { maxAge: '30d', immutable: true }));
  app.use('/estaticos', express.static(ruta('publico'), { maxAge: config.produccion ? '1d' : 0 }));
  // La marca del centro: colores y logos de la carpeta MARCA (ver src/marca.ts).
  const cssMarca = cssDeMarca();
  // Las páginas piden estilos y JavaScript con una huella de su contenido (estilos.css?v=…): tras una actualización
  // cambia la dirección y el navegador trae el fichero nuevo a la primera, sin que nadie tenga que recargar.
  const huella = (contenido: string | Buffer) => createHash('sha256').update(contenido).digest('hex').slice(0, 10);
  const huellas = new Map<string, string>([['marca.css', huella(cssMarca)]]);
  for (const f of ['estilos.css', 'panel.js', 'qr.js']) huellas.set(f, huella(fs.readFileSync(ruta('publico', f))));
  app.locals.recurso = (f: string) => `${f === 'marca.css' ? '/marca' : '/estaticos'}/${f}?v=${huellas.get(f) ?? ''}`;
  app.get('/marca/marca.css', (_req, res) => res.type('text/css').set('Cache-Control', 'public, max-age=3600').send(cssMarca));
  app.get(['/marca/logo.svg', '/marca/isotipo.svg'], (req, res) =>
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').sendFile(ficheroDeMarca(req.path.endsWith('logo.svg') ? 'logo.svg' : 'isotipo.svg')));
  // El dibujo tenue de la cabecera del informe por correo (eslabón partido), con los colores de la marca.
  const fondoInforme = pngEslabonRoto(cargarMarca().colores);
  app.get('/marca/fondo-informe.png', (_req, res) => res.type('image/png').set('Cache-Control', 'public, max-age=86400').send(fondoInforme));
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/marca/isotipo.svg'));
  app.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  // El QR decorativo de la pantalla de entrada.
  const qrEntrada = dibujarQR(config.urlPublica, leerOpciones({}), '');
  app.get('/marca/qr.svg', (_req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(qrEntrada));
  app.get('/salud', async (_req, res) => { await bd.query('select 1'); res.type('text').send('ok'); });

  // Sin cuerpos comprimidos: ningún navegador ni programa los manda, y descomprimirlos tumbaba la app con una sola
  // petición malintencionada (GHSA-27r3-jxmh-p828, body-parser < 2.4.0).
  app.use(express.urlencoded({ extended: false, limit: '20kb', inflate: false }));
  // La API para otros programas va con su llave, sin sesión: no viene de la propia app.
  app.use(rutasDeLaApi(bd));
  app.use(mismoOrigen);

  // La sesión solo hace falta en la entrada y en el panel; las redirecciones no tocan la tabla de sesiones.
  const conSesion = [sesiones(bd), cargarUsuario(bd)];
  app.use(['/entrar', '/auth', '/salir', '/panel'], conSesion);
  app.get('/', conSesion);
  app.use(rutasDeEntrada(bd));
  app.use('/panel', rutasDelPanel(bd, cartero));

  // Como en la app anterior: /svg/<nombre> y /png/<nombre> dan el QR, por si alguien los tiene enlazados. Aceptan las
  // opciones del creador por la consulta (?fondo=transparente&color=principal…), para los programas que pintan el QR
  // de sus enlaces; sin consulta, sin marco, como siempre. El PNG sale siempre a 600 px: es pública y sin sesión.
  // Otras webs pueden ponerlas en un <img>: helmet las dejaría solo para esta (Cross-Origin-Resource-Policy).
  app.get(['/svg/:nombre', '/png/:nombre'], async (req, res) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    const r = resolver(req.params.nombre as string);
    if (r.tipo === 'no-existe') return noEncontrado(res, r);
    // Siempre con el nombre guardado, no con lo que llega: /png/NOTAS y /png/notas%E3%80%80 son el mismo QR.
    const nombre = r.nombre;
    const opciones = leerOpciones(req.query, { ...POR_DEFECTO, marco: 'no' });
    const esSvg = req.path.startsWith('/svg/');
    const k = `${esSvg ? 'svg' : 'png'}|${nombre}|${aConsulta(opciones)}`;
    let hecho = qrGuardado(k);
    if (hecho === undefined) {
      const svg = dibujarQR(urlCorta(nombre), opciones, nombre);
      if (esSvg) hecho = svg;
      else {
        if (pngDibujando >= PNG_EN_COLA) return res.status(503).set('Retry-After', '5').type('text').send('Demasiadas peticiones: prueba dentro de unos segundos.');
        pngDibujando++;
        try { hecho = await pngAparte(svg, 600); } finally { pngDibujando--; }
      }
      guardarQr(k, hecho);
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type(esSvg ? 'image/svg+xml' : 'image/png').send(hecho);
  });

  // Lo principal: <dominio>/<nombre>.
  app.get('/:nombre', async (req, res) => {
    const r = resolver(req.params.nombre as string);
    if (r.tipo !== 'ir' && r.tipo !== 'pagina') return noEncontrado(res, r);
    if (cuentaComoVisita(req.method, req.get('user-agent'))) {
      contarVisita(r.id);
    }
    if (r.tipo === 'ir') return res.set('Cache-Control', 'private, no-store').redirect(302, r.destino);
    // Una página con varios enlaces: se enseña aquí mismo.
    const pagina = await enlacePorId(bd, r.id);
    if (!pagina) return noEncontrado(res, { tipo: 'no-existe', nombre: req.params.nombre as string, parecido: null });
    res.set('Cache-Control', 'private, no-store').render('pagina', { pagina, elementos: await elementosDe(bd, r.id) });
  });

  app.use((_req, res) => noEncontrado(res, { tipo: 'no-existe', nombre: '', parecido: null }));

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    // Lo que rechaza el lector de formularios (demasiado grande, comprimido, mal escrito) es culpa de la petición:
    // se contesta con su código y no llena el registro.
    if (err.status && err.status >= 400 && err.status < 500) {
      return res.status(err.status).render('error', { titulo: 'Petición rechazada', mensaje: 'No se ha podido leer lo que se ha enviado.' });
    }
    console.error(err);
    res.status(500).render('error', { titulo: 'Algo ha fallado', mensaje: 'Ha habido un error. Prueba otra vez dentro de un momento.' });
  });

  return app;
}

function noEncontrado(res: Response, r: Exclude<ReturnType<typeof resolver>, { tipo: 'ir' }>) {
  res.status(r.tipo === 'caducado' ? 410 : 404).set('Cache-Control', 'no-store').render('no-encontrado', { r });
}

/** Arranque: migra la base, carga los enlaces en memoria y escucha. */
export async function arrancar() {
  const bd = conectar(config.baseDeDatos);
  const aplicadas = await migrar(bd);
  if (aplicadas.length) console.log('Migraciones aplicadas:', aplicadas.join(', '));
  await recargar(bd);
  setInterval(() => recargar(bd).catch(e => console.error('Recarga de enlaces:', e)), 60_000).unref();
  setInterval(() => volcarVisitas(bd).catch(e => console.error('No se han podido guardar las visitas:', e)), 5_000).unref();
  iniciarComprobaciones(bd);
  const cartero = crearCartero(process.env, new URL(config.urlPublica).host);
  if (cartero) console.log(`Correo: ${cartero.descripcion}.`);
  iniciarInformes(bd, cartero, () => contexto(config.urlPublica, config.centro.pie));
  const servidor = crearApp(bd, cartero).listen(config.puerto, () => console.log(`Escuchando en el puerto ${config.puerto} (${config.urlPublica})`));
  // Al parar (una actualización, un reinicio), las visitas que aún estaban en memoria se guardan antes de cerrar.
  const parar = () => servidor.close(() => volcarVisitas(bd).catch(e => console.error('No se han podido guardar las visitas:', e))
    .finally(() => bd.end().then(() => process.exit(0))));
  process.on('SIGTERM', parar);
  process.on('SIGINT', parar);
}

if (import.meta.url === `file://${process.argv[1]}`) await arrancar();
