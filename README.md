# enlaces-qr

Enlaces cortos y códigos QR para colegios. Los profesores crean enlaces del tipo `enlaces.colegio.example/excursion`,
les sacan un QR con los colores del centro y ven cuántas visitas tienen.

## Qué hace

- **Redirige** `<dominio>/<nombre>` a su destino, sin distinguir mayúsculas y con redirección temporal (302), para que
  cambiar el destino valga al momento. Si el enlace no existe, está en pausa o ha caducado, enseña una página del
  centro que lo explica (404 o 410) y, si parece una errata, propone el enlace parecido.
- **Entrada solo con Google**, con cuentas del dominio del centro, y sin contraseñas propias. Se puede dejar fuera
  una parte de las cuentas con un patrón (por ejemplo, las de los alumnos si sus correos llevan cifras). Los profesores
  se dan de alta solos la primera vez que entran.
- **Panel**: crear enlaces (con un nombre automático de 4 letras, sin O, I ni L, o con uno propio), pausar, poner
  caducidad y etiquetas, buscar y filtrar, y ver las visitas por día y por semana. Los administradores ven todos los
  enlaces y los usuarios, y pueden pasar los enlaces de un profesor a otro.
- **Creador de QR** con los colores y el logo del centro, puntos y esquinas a elegir y un marco con texto. Se descarga
  en PNG (300 ppp), SVG y PDF a tamaño de pegatina, folio o cartel. Antes de la descarga, la app lee el QR para
  comprobar que funciona.
- **Cartel y pegatinas para imprimir**: un cartel A4 o A3 (logo, título, explicación, el QR y la dirección escrita) y
  hojas de pegatinas en los formatos A4 habituales o a medida, empezando en cualquier etiqueta de una hoja ya usada.
- **Páginas con varios enlaces**: un enlace corto que abre una página sencilla del centro con una lista de enlaces
  (los de una clase, una excursión…), detrás de un solo QR.
- **Aviso de enlaces que no abren**: una vez por semana se comprueba cada destino. Si ya no existe, da error o no
  responde, sale marcado en el panel; si pide iniciar sesión en Google o es un formulario cerrado, sale como aviso que
  el dueño puede dar por bueno. No se comprueban direcciones de la red interna.
- **Informe mensual por correo**: el primer lunes de cada mes, a cada profesor con enlaces que no abren le llega la
  lista de los suyos, con el motivo y el enlace a su ficha. Nunca dos veces el mismo mes; si el servidor estaba parado
  ese día, sale en cuanto vuelve. Por SMTP (por ejemplo, el de Google Workspace con una contraseña de aplicación).
- **Ayuda**: una tarjeta de bienvenida la primera vez y una página con las dudas frecuentes.
- **Visitas sin datos personales**: un contador por enlace y día, sin IP, sin cookies y sin nada de quien visita. No
  cuentan los robots ni las vistas previas de WhatsApp y similares.
- `/svg/<nombre>` y `/png/<nombre>` dan el QR de un enlace, por si alguien los tiene enlazados, y aceptan las opciones
  del creador por la consulta (colores, puntos, esquinas, logo, fondo transparente, marco). Ver «El QR de un enlace».
- **API para otros programas**, compatible con la de YOURLS: el aula virtual, una app de comedor o de biblioteca
  pueden crear sus enlaces cortos, cada uno con su llave. Cada llave solo crea enlaces hacia los dominios que se le
  digan y tiene un tope por minuto; sus enlaces salen en el panel a nombre del programa. Ver más abajo.

## Cómo está hecha

Node.js 24 con TypeScript (Node lo ejecuta directamente: no hay paso de compilación), Express 5, plantillas EJS y un
poco de JavaScript en el navegador. PostgreSQL 17 con SQL escrito a mano (`pg`). Sin servicios externos aparte de
la entrada con Google.

```
src/
  servidor.ts       arranque, seguridad y la redirección <dominio>/<nombre>
  redireccion.ts    enlaces en memoria, resolver un nombre, contar visitas
  entrada.ts        Google (OpenID Connect), sesiones y entrada de prueba
  panel.ts          rutas del panel, del creador de QR, de usuarios y de programas
  api.ts            la API para otros programas (compatible con YOURLS)
  enlaces.ts        consultas y reglas de los enlaces
  usuarios.ts       consultas de los usuarios
  programas.ts      los programas de la API: llaves, dominios y tope
  acceso.ts         quién puede entrar
  nombres.ts        reglas de los nombres de enlace
  marca.ts          colores y logos del centro
  comprobacion.ts   ¿sigue abriendo un destino?
  comprobador.ts    la ronda semanal de comprobaciones
  informe.ts        el informe mensual por correo (quién, qué y cuándo)
  correo.ts         envío por SMTP, o a una carpeta en desarrollo
  migracion.ts      qué se migra de la app anterior y cómo
  qr/               dibujo del QR (SVG), PNG, PDF, cartel, pegatinas y comprobación de lectura
vistas/             plantillas EJS
publico/            estilos y JavaScript del navegador
marca-ejemplo/      marca neutra de ejemplo
sql/                esquema de la base (se aplica solo al arrancar, una vez cada fichero)
scripts/            migración, comprobación de redirecciones y datos de prueba
test/               pruebas (Vitest)
```

## La marca del centro

Los colores y los logos van en una carpeta aparte, que se indica con `MARCA` (o con `MARCA_DIR` en Docker):

- `marca.json`: los cinco colores con su nombre, como en `marca-ejemplo/marca.json`. El principal se usa en los
  botones, los enlaces y el QR; el segundo, también para «activo»; el tercero, también para los avisos de error; el
  de acento, solo en detalles (sobre blanco se lee mal y no se ofrece para el QR); el oscuro, para un QR sobrio.
- `logo.svg`: el logo horizontal, para la pantalla de entrada.
- `isotipo.svg`: el logo cuadrado, para el centro del QR, el icono de la pestaña y las páginas pequeñas.

El nombre del centro, el dominio de correo, el patrón de cuentas excluidas, los enlaces a la web y al aula virtual y
la zona horaria van en `.env` (ver `.env.example`).

## API para otros programas

Compatible con la API de [YOURLS](https://yourls.org/) para acortar (`action=shorturl`) y con su complemento «edit
url» para cambiar el destino (`action=update`): vale cualquier cliente de YOURLS que llame por POST.

1. Un administrador entra en **Programas**, crea el programa (su nombre, los dominios hacia los que podrá crear
   enlaces y un tope de peticiones por minuto) y copia la llave. Solo se enseña esa vez. Si se pierde, «Sacar una
   llave nueva» la cambia y la anterior deja de valer al momento; «Retirar» la anula, y sus enlaces siguen funcionando.
2. El programa llama a `POST <URL_PUBLICA>/yourls-api.php` con los campos en `application/x-www-form-urlencoded`.
   La llave va en el cuerpo (`signature`), nunca en la dirección, porque ahí acabaría en los registros: por GET la API
   no contesta.

Crear un enlace (`title` y `keyword`, el nombre, son opcionales):

```sh
curl -s https://enlaces.colegio.example/yourls-api.php \
  -d action=shorturl -d format=json -d signature="$LLAVE" \
  --data-urlencode url='https://aula.colegio.example/menu.php?t=abc' \
  --data-urlencode title='Monitores · Turno 1'
```

```json
{"status":"success","message":"https://aula.colegio.example/menu.php?t=abc añadido","title":"Monitores · Turno 1",
 "shorturl":"https://enlaces.colegio.example/MKQT","statusCode":200,
 "url":{"keyword":"MKQT","url":"https://aula.colegio.example/menu.php?t=abc","title":"Monitores · Turno 1","date":"2026-11-07 10:30:00"}}
```

- Sin `keyword`, el nombre automático de 4 letras. Con `keyword`, las mismas reglas que en el panel (minúsculas,
  números y guiones); si ya existe o no vale: `error:keyword`.
- Si ese destino ya tiene un enlace del mismo programa, devuelve ese, como YOURLS: `"status":"fail"`,
  `"code":"error:url"` y el `shorturl` que ya había, con estado 200. Los enlaces de los profesores no cuentan.
- Hacia un dominio que no es del programa: `error:domain` (un subdominio tampoco vale si no está en la lista). Si
  falta la dirección o no vale: `error:nourl`.

Cambiar el destino de un enlace del programa (y su título, si se manda `title`):

```sh
curl -s https://enlaces.colegio.example/yourls-api.php \
  -d action=update -d format=json -d signature="$LLAVE" -d shorturl=MKQT \
  --data-urlencode url='https://aula.colegio.example/menu.php?t=def'
```

Contesta `"message":"success: updated"` (200), o `"error: not found"` (404) si no existe o no es de ese programa.
`shorturl` puede ser el nombre o el enlace corto entero.

Además:

- Las respuestas que llevan `shorturl` traen también `qrsvg` y `qrpng`, las direcciones del QR de ese enlace (ver «El
  QR de un enlace»). Un YOURLS normal no las trae: así el programa sabe si el acortador dibuja el QR o lo dibuja él.
- `format=simple` devuelve solo el enlace corto (o el mensaje de error), en texto.
- Los errores llevan `"status":"fail"`, un `code` y su estado HTTP: 403 si falta la llave o no vale (`error:auth`),
  405 por GET, 415 con `multipart/form-data`, 429 si se pasa del tope por minuto (`error:limit`).
- Los enlaces de un programa salen en **Todos**, con el programa como dueño, y desde Programas se ven solo los suyos.
  Se pueden pausar, editar o pasar a un profesor; pasado a un profesor, el programa ya no lo puede cambiar. No entran
  en el informe mensual por correo.
- Se comprueban cada semana, como los demás (con HEAD o GET y sin sesión): el destino tiene que aguantarlo sin
  cambiar nada. Si el programa renueva sus direcciones, mejor `update` que dejar la vieja sin servir, o saldrá como
  enlace que no abre.

### El QR de un enlace

`<URL_PUBLICA>/svg/<nombre>` y `<URL_PUBLICA>/png/<nombre>` dan el QR de un enlace, sin llave ni sesión.
Sin consulta salen como siempre: con los colores de la marca, sin marco y con fondo blanco. Con consulta, las mismas
opciones que el creador del panel:

| Opción | Valores (el primero, por defecto) |
|---|---|
| `color` | `marca` (los colores de la marca combinados), `principal`, `segundo`, `tercero`, `oscuro` |
| `puntos` | `redondeados`, `circulos`, `cuadrados` |
| `esquinas` | `redondeadas`, `circulo`, `cuadradas` |
| `centro` | `logo` (el isotipo del centro), `nada` |
| `fondo` | `blanco`, `transparente` |
| `marco` | `no`, `escaneame`, `nombre` (la dirección corta), `libre` (con `texto`, hasta 28 letras) |

```sh
curl -s 'https://enlaces.colegio.example/svg/MKQT?fondo=transparente&color=principal&centro=logo' -o qr.svg
```

- Un valor que no está en la lista se ignora y vale el de por defecto.
- El SVG no pide nada a la red: el logo va dentro y el texto del marco, en trazos. Se puede guardar y enseñar sin
  conexión, también en navegadores antiguos (es SVG 1.1). Mejor como imagen (`<img>`) que pegado dentro de otra página:
  el logo lleva sus propios estilos y podrían mezclarse con los de la página.
- El PNG sale siempre a 600 px de ancho; para pantallas grandes, mejor el SVG, que se ve nítido a cualquier tamaño.
- `fondo=transparente` solo vale sobre un fondo claro: sobre uno oscuro, los móviles no leen el código.

## Desarrollo en local

```sh
npm install
docker compose -f docker-compose.dev.yml up -d          # PostgreSQL 17 en el puerto 5433
cp .env.example .env                                     # y para desarrollo:
#   URL_PUBLICA=http://localhost:3000
#   DATABASE_URL=postgres://enlaces:enlaces@localhost:5433/enlaces
#   SECRETO_SESION=lo-que-sea
#   DOMINIO_CORREO=colegio.example
#   ENTRADA_DE_PRUEBA=si        (entrar escribiendo un correo, sin Google)
node --env-file=.env scripts/datos-de-prueba.ts         # datos inventados
npm run dev                                              # http://localhost:3000
```

Pruebas (necesitan la base de desarrollo y una base `enlaces_pruebas` vacía, que se borra entera en cada ejecución):

```sh
docker compose -f docker-compose.dev.yml exec bd psql -U enlaces -c "create database enlaces_pruebas"
npm test
npm run tipos
```

## Instalación

Una imagen Docker (`Dockerfile`) y un `docker-compose.yml` pensado para ir detrás de
[nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) con certificados automáticos.

1. Una base de datos PostgreSQL 17 vacía y su usuario. La app crea las tablas al arrancar.
2. Un cliente OAuth de Google Cloud, del Workspace del centro, tipo «Aplicación web», con la URI de redirección
   `https://<dominio>/auth/google/callback`.
3. `.env` a partir de `.env.example`, y la carpeta de marca. Mientras `VIRTUAL_HOST` y `LETSENCRYPT_HOST` estén
   comentadas, el proxy no publica la app: sirve para dejarla lista y comprobarla antes de abrirla.
4. `docker compose up -d --build`. La comprobación semanal de destinos necesita que el contenedor pueda salir a
   internet (como para la entrada con Google).

### Migración desde la app anterior

`scripts/migrar.ts` lee la exportación en CSV de las tablas `users` (`id,email,name,admin,inserted_at`) y `links`
(`id,slug,destiny,name,visits,enable,user_id,inserted_at,updated_at`) de la app anterior:

```sh
node scripts/migrar.ts --usuarios usuarios.csv --enlaces enlaces.csv --probar   # enseña el resultado sin guardar
node scripts/migrar.ts --usuarios usuarios.csv --enlaces enlaces.csv
```

Se puede repetir sin duplicar nada, porque actualiza lo ya migrado. Todo entra en una transacción y, al final,
comprueba los recuentos y que cada nombre lleva a su destino; si algo no cuadra, deshace. Reglas:

- Solo se migran los usuarios que hoy podrían entrar. Las cuentas excluidas **y sus enlaces** no se migran.
- Si dos enlaces tienen el mismo nombre sin distinguir mayúsculas, se queda el más reciente y se suman las visitas.
- Los nombres de la app anterior se respetan tal cual, aunque hoy no se permitirían (mayúsculas mezcladas, ñ, +).
- Las visitas de la app anterior no tenían fecha: se guardan como «visitas anteriores» y se suman al total.

`scripts/comprobar-redirecciones.ts` pide a la app cada nombre de esa exportación y comprueba adónde lleva (con
peticiones HEAD, que no cuentan como visita):

```sh
node scripts/comprobar-redirecciones.ts --url https://<dominio> --usuarios usuarios.csv --enlaces enlaces.csv
```

## Licencia

MIT, a nombre de Enrique Robredo (ver `LICENSE`). Tipografía Nunito, con licencia SIL Open Font License.
