-- Programas que crean enlaces por la API (compatible con YOURLS), cada uno con su llave. Ver src/api.ts.
create table programas (
  id          serial primary key,
  nombre      text not null,
  -- Huella SHA-256 de la llave: la llave solo se enseña una vez, al crearla.
  llave       text not null unique,
  -- Solo puede crear enlaces hacia estos servidores (aula.colegio.example), sin https:// ni ruta.
  dominios    text[] not null check (cardinality(dominios) > 0),
  por_minuto  integer not null default 60 check (por_minuto between 1 and 600),
  -- Retirado: su llave ya no vale, pero sus enlaces siguen funcionando.
  activo      boolean not null default true,
  creado_por  integer references usuarios (id) on delete set null,
  creado      timestamptz not null default now(),
  ultimo_uso  timestamptz
);
create unique index programas_nombre_unico on programas (lower(nombre));

-- Los enlaces que crea un programa son suyos (sin usuario) hasta que un administrador se los pasa a alguien.
alter table enlaces add column programa_id integer references programas (id);
alter table enlaces add constraint enlaces_un_dueno check (usuario_id is null or programa_id is null);
create index enlaces_programa on enlaces (programa_id) where programa_id is not null;
