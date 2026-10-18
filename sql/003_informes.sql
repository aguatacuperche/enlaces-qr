-- Informe mensual por correo: qué se ha enviado a quién cada mes, para no enviarlo nunca dos veces.
create table informes (
  usuario_id integer not null references usuarios (id) on delete cascade,
  mes        text not null check (mes ~ '^\d{4}-\d{2}$'),
  enlaces    integer not null,
  enviado    timestamptz not null default now(),
  primary key (usuario_id, mes)
);

-- Desde cuándo falla cada enlace de una página (como enlaces.problema_desde): el informe solo sale si hay algo nuevo.
alter table elementos add column problema_desde timestamptz;
