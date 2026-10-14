/** La app web: entrada, panel de los profesores y, sobre todo, la redirección <dominio>/<nombre>. */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createRequire } from 'node:module';
import path from 'node:path';
import { config, urlCorta } from './config.ts';
import { conectar, migrar, type Bd } from './db.ts';
import { ruta } from './raiz.ts';
import { ayudasVistas } from './ayudas-vistas.ts';
import { cargarUsuario, rutasDeEntrada, sesiones } from './entrada.ts';
import { rutasDelPanel } from './panel.ts';
import { contarVisita, cuentaComoVisita, recargar, resolver } from './redireccion.ts';
import { dibujarQR } from './qr/dibujo.ts';
import { png } from './qr/exportar.ts';
import { leerOpciones } from './qr/opciones.ts';
import { cssDeMarca, ficheroDeMarca } from './marca.ts';

const require = createRequire(import.meta.url);

/** Los formularios solo se aceptan si vienen de la propia app (además de la cookie SameSite=Lax). */
function mismoOrigen(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origen = req.get('origin') ?? req.get('referer');
  if (origen && URL.canParse(origen) && new URL(origen).host === new URL(config.urlPublica).host) return next();
  res.status(403).send('Petición rechazada.');
}

export function crearApp(bd: Bd) {
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
        'frame-ancestors': ["'none'"], 'upgrade-insecure-requests': config.produccion ? [] : null,
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
  app.get('/marca/marca.css', (_req, res) => res.type('text/css').set('Cache-Control', 'public, max-age=3600').send(cssMarca));
  app.get(['/marca/logo.svg', '/marca/isotipo.svg'], (req, res) =>
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').sendFile(ficheroDeMarca(req.path.endsWith('logo.svg') ? 'logo.svg' : 'isotipo.svg')));
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/marca/isotipo.svg'));
  app.get('/robots.txt', (_req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  // El QR decorativo de la pantalla de entrada.
  const qrEntrada = dibujarQR(config.urlPublica, leerOpciones({}), '');
  app.get('/marca/qr.svg', (_req, res) => res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(qrEntrada));
  app.get('/salud', async (_req, res) => { await bd.query('select 1'); res.type('text').send('ok'); });

  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(mismoOrigen);

  // La sesión solo hace falta en la entrada y en el panel; las redirecciones no tocan la tabla de sesiones.
  const conSesion = [sesiones(bd), cargarUsuario(bd)];
  app.use(['/entrar', '/auth', '/salir', '/panel'], conSesion);
  app.get('/', conSesion);
  app.use(rutasDeEntrada(bd));
  app.use('/panel', rutasDelPanel(bd));

  // Como en la app anterior: /svg/<nombre> y /png/<nombre> dan el QR, por si alguien los tiene enlazados.
  app.get(['/svg/:nombre', '/png/:nombre'], (req, res) => {
    const r = resolver(req.params.nombre as string);
    if (r.tipo === 'no-existe') return noEncontrado(res, r);
    const nombre = r.tipo === 'ir' ? (req.params.nombre as string) : r.nombre;
    const svg = dibujarQR(urlCorta(nombre), leerOpciones({ marco: 'no' }), nombre);
    res.set('Cache-Control', 'public, max-age=3600');
    if (req.path.startsWith('/svg/')) res.type('image/svg+xml').send(svg);
    else res.type('image/png').send(png(svg, 600));
  });

  // Lo principal: <dominio>/<nombre>.
  app.get('/:nombre', (req, res) => {
    const r = resolver(req.params.nombre as string);
    if (r.tipo !== 'ir') return noEncontrado(res, r);
    if (cuentaComoVisita(req.method, req.get('user-agent'))) {
      contarVisita(bd, r.id).catch(e => console.error('No se ha podido contar la visita:', e));
    }
    res.set('Cache-Control', 'private, no-store').redirect(302, r.destino);
  });

  app.use((_req, res) => noEncontrado(res, { tipo: 'no-existe', nombre: '', parecido: null }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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
  const servidor = crearApp(bd).listen(config.puerto, () => console.log(`Escuchando en el puerto ${config.puerto} (${config.urlPublica})`));
  const parar = () => servidor.close(() => bd.end().then(() => process.exit(0)));
  process.on('SIGTERM', parar);
  process.on('SIGINT', parar);
}

if (import.meta.url === `file://${process.argv[1]}`) await arrancar();
