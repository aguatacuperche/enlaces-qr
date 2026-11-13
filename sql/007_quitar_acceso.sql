-- Quitar el acceso a alguien (se va del centro, se ha equivocado de cuenta…): no puede entrar y sus sesiones se borran.
-- Sus enlaces siguen funcionando y se pueden pasar a otro desde Usuarios.
alter table usuarios add column bloqueado boolean not null default false;
