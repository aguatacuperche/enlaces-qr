-- Comprobación de destinos, páginas con varios enlaces y ayuda de bienvenida.

alter table enlaces
  -- «enlace» redirige a su destino; «pagina» enseña una página con varios enlaces (tabla elementos).
  add column tipo text not null default 'enlace' check (tipo in ('enlace', 'pagina')),
  -- Texto de presentación de una página.
  add column descripcion text,
  -- Última comprobación del destino y lo que se encontró (null = abre bien). Ver src/comprobacion.ts.
  add column comprobado timestamptz,
  add column problema text,
  add column problema_detalle text,
  add column problema_desde timestamptz,
  -- El dueño ha visto el aviso y lo da por bueno (por ejemplo, un documento compartido solo dentro del centro).
  add column aviso_ignorado boolean not null default false;
alter table enlaces alter column destino drop not null;
alter table enlaces add constraint enlaces_destino_obligatorio check (tipo = 'pagina' or destino is not null);

-- Los enlaces de una página, en orden.
create table elementos (
  id               serial primary key,
  pagina_id        integer not null references enlaces (id) on delete cascade,
  posicion         integer not null,
  titulo           text not null,
  url              text not null,
  comprobado       timestamptz,
  problema         text,
  problema_detalle text
);
create index elementos_pagina on elementos (pagina_id, posicion);

-- Tarjeta de bienvenida del panel: se deja de enseñar cuando el profesor la cierra.
alter table usuarios add column ayuda_cerrada boolean not null default false;
