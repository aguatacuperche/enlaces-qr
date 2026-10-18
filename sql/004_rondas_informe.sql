-- Una sola ronda de envío del informe al mes: hecha la ronda, no sale ningún informe más hasta el mes siguiente
-- (antes, quien tuviera un problema nuevo a mitad de mes lo recibía en la siguiente vuelta de la hora).
create table rondas_informe (
  mes text primary key check (mes ~ '^\d{4}-\d{2}$'),
  hecha timestamptz not null default now());

-- Los meses que ya tienen informes enviados cuentan como hechos.
insert into rondas_informe (mes, hecha) select mes, min(enviado) from informes group by mes;
