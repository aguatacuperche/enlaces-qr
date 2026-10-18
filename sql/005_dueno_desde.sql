-- Desde cuándo es de su dueño actual: un enlace que cambia de manos con un problema es nuevo para quien lo recibe,
-- aunque el anterior ya lo viera en su informe.
alter table enlaces add column dueno_desde timestamptz;

-- Hasta ahora los cambios de dueño no se apuntaban: los enlaces tocados después del último informe de su dueño
-- cuentan como nuevos para él (si alguno solo se editó y sigue fallando, se le volverá a marcar; no hace daño).
update enlaces e set dueno_desde = e.actualizado
from (select usuario_id, max(enviado) as ultimo from informes group by usuario_id) i
where i.usuario_id = e.usuario_id and e.actualizado > i.ultimo;
