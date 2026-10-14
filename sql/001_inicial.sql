-- Esquema inicial.

create table usuarios (
  id              serial primary key,
  correo          text not null unique check (correo = lower(correo)),
  nombre          text not null,
  admin           boolean not null default false,
  preferencias_qr jsonb,
  creado          timestamptz not null default now(),
  ultima_entrada  timestamptz
);

create table enlaces (
  id                 serial primary key,
  -- Lo que va detrás del dominio, tal como se escribió. Único sin distinguir mayúsculas (índice de abajo).
  nombre             text not null,
  destino            text not null,
  titulo             text not null,
  activo             boolean not null default true,
  caduca             date,
  etiqueta           text,
  -- Sin dueño (null) si su profesor ya no está; lo llevan los administradores.
  usuario_id         integer references usuarios (id) on delete set null,
  -- Visitas contadas por la app anterior, que no guardaba fechas.
  visitas_anteriores integer not null default 0,
  -- id en la app anterior, para que la migración se pueda repetir sin duplicar.
  id_antiguo         integer unique,
  creado             timestamptz not null default now(),
  actualizado        timestamptz not null default now()
);
create unique index enlaces_nombre_unico on enlaces (lower(nombre));
create index enlaces_usuario on enlaces (usuario_id);

-- Visitas por enlace y día. Sin IP, sin cookies, nada de quien visita.
create table visitas (
  enlace_id integer not null references enlaces (id) on delete cascade,
  dia       date not null,
  total     integer not null default 0,
  primary key (enlace_id, dia)
);

-- Sesiones de los profesores (las usa connect-pg-simple).
create table sesiones (
  sid    varchar not null primary key,
  sess   json not null,
  expire timestamp(6) not null
);
create index sesiones_caducan on sesiones (expire);
