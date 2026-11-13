-- Los enlaces de una página también se pueden «dar por buenos» (un documento compartido solo dentro del centro).
alter table elementos add column aviso_ignorado boolean not null default false;

-- La ronda del informe se fija al empezar: si falla un envío, se reintenta solo a quien tocaba ese día, y no le llega
-- a mitad de semana a alguien que no estaba en la lista. Las rondas de antes ya estaban completas.
alter table rondas_informe
  add column destinatarios integer[],
  add column completa boolean not null default true;
