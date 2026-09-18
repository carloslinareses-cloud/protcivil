-- =====================================================================
-- PROTECCIÓN CIVIL — CONTROL DE ASISTENCIA CON GPS
-- Esquema `protcivil` en el proyecto Supabase tfbzghjjfcaqmkzsxrrs.
--
-- Quién usa qué:
--   · El FUNCIONARIO, desde la app de Android. Entra con cédula y clave
--     y recibe una FICHA DE SESIÓN (token). Todo lo demás que hace el
--     teléfono pide esa ficha: con saber la cédula de alguien no alcanza
--     para marcarle la asistencia ni para ver su historial.
--   · El JEFE o el ADMINISTRADOR, desde el gestor web. Entra con su cuenta
--     de Supabase y la base comprueba quién es con su sesión (auth.uid()),
--     nunca con un dato que mande el navegador.
--
-- Candados que viven AQUÍ, en la base (la app y el navegador se pueden
-- saltar; esto no):
--   · Ninguna tabla se puede leer ni escribir desde afuera: el teléfono
--     solo llama funciones, y el gestor solo lee lo que su rol le deja.
--   · Las claves se guardan en huella (bcrypt), nunca legibles.
--   · 5 claves erradas seguidas bloquean esa cédula 15 minutos.
--   · Una cuenta, un teléfono: si alguien presta su clave, en otro
--     teléfono no entra. El jefe puede liberar el teléfono.
--   · La hora la pone el servidor. Los marcajes hechos sin señal quedan
--     anotados como tales y, si la hora del teléfono no es confiable,
--     quedan para revisión.
--   · La ubicación se compara contra las estaciones, tomando en cuenta el
--     margen de error que declara el propio GPS del teléfono.
--   · Si la app detecta GPS falso, el marcaje se rechaza y queda anotado.
--   · Nada de lo que pasa se borra: marcajes, libro de guardia y bitácora
--     solo crecen. Las correcciones son anotaciones nuevas.
--
-- Las funciones del teléfono NO lanzan errores por reglas de negocio:
-- devuelven {ok:false, codigo, mensaje}. Así el intento fallido (clave
-- errada, GPS falso, fuera de zona) sí queda anotado; con un error la base
-- desharía también la anotación.
--
-- Se puede correr varias veces (todo es "si no existe" / "reemplazar").
-- =====================================================================

begin;

create schema if not exists protcivil;
grant usage on schema protcivil to anon, authenticated;
-- Lo que se cree aquí en adelante NO queda abierto por omisión.
alter default privileges in schema protcivil revoke execute on functions from public;
alter default privileges in schema protcivil revoke all on tables from anon, authenticated;

-- =====================================================================
-- 1. TABLAS
-- =====================================================================

-- Configuración general (una sola fila).
create table if not exists protcivil.config (
  id                          smallint primary key default 1 check (id = 1),
  exigir_zona                 boolean  not null default true,
  precision_maxima_m          integer  not null default 80  check (precision_maxima_m between 10 and 1000),
  tolerancia_gps_m            integer  not null default 25  check (tolerancia_gps_m between 0 and 200),
  foto_obligatoria            boolean  not null default true,
  un_telefono_por_persona     boolean  not null default true,
  permitir_sin_conexion       boolean  not null default true,
  horas_maximas_sin_conexion  integer  not null default 48  check (horas_maximas_sin_conexion between 1 and 168),
  horas_maximas_servicio      integer  not null default 30  check (horas_maximas_servicio between 4 and 96),
  dias_sesion                 integer  not null default 30  check (dias_sesion between 1 and 180),
  dias_fotos                  integer  not null default 120 check (dias_fotos between 7 and 730),
  actualizado_en              timestamptz not null default now()
);
insert into protcivil.config (id) values (1) on conflict (id) do nothing;
-- Versión vigente de la app: la app la compara con la suya al abrir y, si
-- hay una más nueva, avisa con el enlace de descarga.
alter table protcivil.config add column if not exists app_version_codigo integer not null default 1;
alter table protcivil.config add column if not exists app_version_nombre text not null default '1.0.0';
alter table protcivil.config add column if not exists app_enlace text not null
  default 'https://protcivil.alcaldiadecharallave.com/app-asistencia.html';
alter table protcivil.config add column if not exists app_novedades text;

-- Estaciones: los sitios donde se puede marcar.
create table if not exists protcivil.estaciones (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique check (length(trim(nombre)) between 2 and 120),
  latitud   double precision not null check (latitud between -90 and 90),
  longitud  double precision not null check (longitud between -180 and 180),
  radio_m   integer not null default 80 check (radio_m between 10 and 2000),
  activa    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Tipos de guardia. Los crea el jefe (24x48, 24x72, oficina, 12x36…).
--   rotativa: X horas de servicio y Y de descanso, en ciclo, desde una hora.
--   semanal:  ciertos días de la semana, de una hora a otra.
create table if not exists protcivil.tipos_guardia (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique check (length(trim(nombre)) between 2 and 60),
  modalidad       text not null check (modalidad in ('rotativa', 'semanal')),
  horas_servicio  integer check (horas_servicio between 1 and 96),
  horas_descanso  integer check (horas_descanso between 0 and 336),
  dias_semana     smallint[],
  hora_inicio     time not null default '07:00',
  hora_fin        time,
  tolerancia_min  integer not null default 15 check (tolerancia_min between 0 and 240),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  constraint tipos_guardia_coherente check (
       (modalidad = 'rotativa' and horas_servicio is not null and horas_descanso is not null)
    or (modalidad = 'semanal' and dias_semana is not null and cardinality(dias_semana) > 0
        and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[] and hora_fin is not null))
);

-- Grupos de guardia (Guardia A, B, C…). En los rotativos, fecha_referencia
-- es un día en que ese grupo entró de guardia: de ahí sale el calendario.
create table if not exists protcivil.grupos (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null unique check (length(trim(nombre)) between 1 and 60),
  tipo_guardia_id   uuid not null references protcivil.tipos_guardia(id),
  estacion_id       uuid references protcivil.estaciones(id),
  fecha_referencia  date,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);

create table if not exists protcivil.funcionarios (
  id                      uuid primary key default gen_random_uuid(),
  cedula                  text not null unique check (cedula ~ '^[0-9]{5,9}$'),
  nombres                 text not null check (length(trim(nombres)) between 2 and 80),
  apellidos               text not null check (length(trim(apellidos)) between 2 and 80),
  cargo                   text check (length(cargo) <= 80),
  condicion               text not null default 'fijo' check (condicion in ('fijo', 'voluntario')),
  grupo_id                uuid references protcivil.grupos(id),
  estacion_id             uuid references protcivil.estaciones(id),
  telefono                text check (length(telefono) <= 30),
  clave_hash              text not null,
  debe_cambiar_clave      boolean not null default true,
  dispositivo_autorizado  text,
  dispositivo_nombre      text,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now()
);

-- Fichas de sesión del teléfono. Se guarda la HUELLA del token, nunca el
-- token: aunque alguien leyera esta tabla, no podría usarlas.
create table if not exists protcivil.sesiones (
  id              uuid primary key default gen_random_uuid(),
  funcionario_id  uuid not null references protcivil.funcionarios(id) on delete cascade,
  token_hash      bytea not null unique,
  dispositivo     text not null,
  creada_en       timestamptz not null default now(),
  ultima_vez      timestamptz not null default now(),
  expira_en       timestamptz not null,
  cerrada_en      timestamptz,
  motivo_cierre   text
);
create index if not exists sesiones_abiertas on protcivil.sesiones (funcionario_id) where cerrada_en is null;

create table if not exists protcivil.intentos_entrada (
  id           bigint generated always as identity primary key,
  cedula       text not null,
  dispositivo  text,
  exito        boolean not null,
  motivo       text,
  momento      timestamptz not null default now()
);
create index if not exists intentos_cedula_momento on protcivil.intentos_entrada (cedula, momento desc);

-- Cada guardia trabajada, de la entrada a la salida. Una guardia de 24
-- horas cruza la medianoche: por eso no se cuenta "por día".
create table if not exists protcivil.servicios (
  id              uuid primary key default gen_random_uuid(),
  funcionario_id  uuid not null references protcivil.funcionarios(id),
  inicio          timestamptz not null,
  fin             timestamptz,
  entrada_id      uuid,
  salida_id       uuid,
  cierre          text check (cierre in ('marcaje', 'automatico', 'manual')),
  estado          text not null default 'valido' check (estado in ('valido', 'por_revisar', 'anulado')),
  nota            text,
  revisado_por    uuid,
  revisado_en     timestamptz,
  creado_en       timestamptz not null default now(),
  constraint servicios_fin_despues check (fin is null or fin >= inicio)
);
-- Nadie puede tener dos guardias abiertas a la vez.
create unique index if not exists servicios_uno_abierto on protcivil.servicios (funcionario_id) where fin is null;
create index if not exists servicios_funcionario_inicio on protcivil.servicios (funcionario_id, inicio desc);
create index if not exists servicios_inicio on protcivil.servicios (inicio desc);

create table if not exists protcivil.marcajes (
  id              uuid primary key default gen_random_uuid(),
  id_local        uuid unique,
  funcionario_id  uuid not null references protcivil.funcionarios(id),
  servicio_id     uuid references protcivil.servicios(id),
  tipo            text not null check (tipo in ('entrada', 'salida')),
  momento         timestamptz not null,
  recibido_en     timestamptz not null default now(),
  sin_conexion    boolean not null default false,
  hora_confiable  boolean not null default true,
  latitud         double precision,
  longitud        double precision,
  precision_m     double precision,
  estacion_id     uuid references protcivil.estaciones(id),
  distancia_m     double precision,
  dentro          boolean,
  dispositivo     text,
  sesion_id       uuid references protcivil.sesiones(id),
  manual          boolean not null default false,
  registrado_por  uuid,
  motivo_manual   text,
  revision        text not null default 'ok' check (revision in ('ok', 'por_revisar'))
);
create index if not exists marcajes_funcionario_momento on protcivil.marcajes (funcionario_id, momento desc);
create index if not exists marcajes_momento on protcivil.marcajes (momento desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'servicios_entrada_fk') then
    alter table protcivil.servicios add constraint servicios_entrada_fk
      foreign key (entrada_id) references protcivil.marcajes(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'servicios_salida_fk') then
    alter table protcivil.servicios add constraint servicios_salida_fk
      foreign key (salida_id) references protcivil.marcajes(id);
  end if;
end $$;

-- Las fotos van aparte para que las listas no las descarguen.
create table if not exists protcivil.fotos (
  marcaje_id  uuid primary key references protcivil.marcajes(id) on delete cascade,
  datos       bytea not null check (octet_length(datos) <= 200000),
  creada_en   timestamptz not null default now()
);

-- Estado operativo durante la guardia.
create table if not exists protcivil.estados (
  id              uuid primary key default gen_random_uuid(),
  id_local        uuid unique,
  funcionario_id  uuid not null references protcivil.funcionarios(id),
  servicio_id     uuid not null references protcivil.servicios(id),
  estado          text not null check (estado in ('en_estacion', 'en_emergencia', 'en_comision')),
  momento         timestamptz not null default now(),
  latitud         double precision,
  longitud        double precision,
  precision_m     double precision,
  nota            text check (length(nota) <= 500)
);
create index if not exists estados_servicio_momento on protcivil.estados (servicio_id, momento desc);

-- Libro de guardia digital. No se edita ni se borra: una corrección es
-- una anotación nueva que dice a cuál corrige.
create table if not exists protcivil.libro_guardia (
  id            uuid primary key default gen_random_uuid(),
  estacion_id   uuid references protcivil.estaciones(id),
  momento       timestamptz not null default now(),
  tipo          text not null default 'novedad'
                check (tipo in ('novedad', 'servicio', 'salida_unidad', 'entrega_guardia', 'correccion')),
  texto         text not null check (length(trim(texto)) between 3 and 4000),
  autor_id      uuid not null,
  autor_nombre  text not null,
  corrige_id    uuid references protcivil.libro_guardia(id)
);
create index if not exists libro_momento on protcivil.libro_guardia (momento desc);

-- Quién entra al gestor web, y con qué rol.
--   admin: todo, incluidos los catálogos, el personal y los gestores.
--   jefe:  el día a día (ver, revisar guardias, libro, liberar teléfonos).
create table if not exists protcivil.gestores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  rol        text not null default 'jefe' check (rol in ('admin', 'jefe')),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
-- La cuenta PUENTE es la que usa el servicio de Cloudflare (pc-api) para
-- que el panel de Protección Civil (que entra con Firebase) llegue aquí
-- sin una segunda clave. Solo ese servicio conoce su clave. Cuando la
-- llamada viene por ella, el nombre de la persona real lo pone el servicio
-- en la cabecera x-pc-actor, y es el que queda en la bitácora.
alter table protcivil.gestores add column if not exists es_puente boolean not null default false;

create table if not exists protcivil.bitacora (
  id            bigint generated always as identity primary key,
  momento       timestamptz not null default now(),
  actor_tipo    text not null check (actor_tipo in ('gestor', 'funcionario', 'sistema')),
  actor_id      uuid,
  actor_nombre  text,
  accion        text not null,
  detalle       jsonb
);
create index if not exists bitacora_momento on protcivil.bitacora (momento desc);

-- =====================================================================
-- 2. FUNCIONES DE APOYO (no se llaman desde afuera)
-- =====================================================================

create or replace function protcivil.es_gestor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from protcivil.gestores g where g.user_id = auth.uid() and g.activo);
$$;

create or replace function protcivil.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from protcivil.gestores g where g.user_id = auth.uid() and g.activo and g.rol = 'admin');
$$;

create or replace function protcivil.nombre_gestor()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_g     protcivil.gestores;
  v_actor text;
begin
  select * into v_g from protcivil.gestores g where g.user_id = auth.uid();
  if not found then
    return null;
  end if;
  /* Solo para la cuenta puente se lee la cabecera: a cualquier otra cuenta
     no le sirve de nada mandarla. */
  if v_g.es_puente then
    begin
      /* Viene en base64 (UTF-8): las cabeceras no llevan bien tildes ni ñ. */
      v_actor := left(nullif(trim(convert_from(decode(
                   (current_setting('request.headers', true))::json ->> 'x-pc-actor', 'base64'), 'UTF8')), ''), 150);
    exception when others then
      v_actor := null;
    end;
    return coalesce(v_actor, v_g.nombre);
  end if;
  return v_g.nombre;
end $$;

create or replace function protcivil.anotar(
  p_actor_tipo text, p_actor_id uuid, p_actor_nombre text, p_accion text, p_detalle jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into protcivil.bitacora (actor_tipo, actor_id, actor_nombre, accion, detalle)
  values (p_actor_tipo, p_actor_id, p_actor_nombre, p_accion, p_detalle);
$$;

create or replace function protcivil.fallo(p_codigo text, p_mensaje text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'codigo', p_codigo, 'mensaje', p_mensaje);
$$;

-- Distancia en metros entre dos puntos (haversine).
create or replace function protcivil.distancia_m(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 6371000 * acos(least(1.0, greatest(-1.0,
    cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
    + sin(radians(lat1)) * sin(radians(lat2)))));
$$;

-- EL CANDADO DE SITIO. Devuelve la estación más cercana, la distancia y si
-- quedó dentro; si no se puede marcar, llena o_codigo y o_mensaje.
--
-- Por qué no "distancia <= radio" a secas: el GPS no da un punto exacto,
-- da un punto más un margen de error que él mismo declara. Se acepta
-- cuando es PLAUSIBLE que esté dentro (distancia - margen <= radio), y ese
-- margen se recorta a tolerancia_gps_m para que un teléfono que declare un
-- error enorme no se vuelva barra libre. Si declara un error mayor que
-- precision_maxima_m, la lectura se rechaza: eso ya no es GPS.
create or replace function protcivil.verificar_sitio(
  p_lat double precision, p_lng double precision, p_precision double precision,
  out o_estacion_id uuid, out o_estacion text, out o_distancia double precision, out o_dentro boolean,
  out o_codigo text, out o_mensaje text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg    protcivil.config;
  v_radio  integer;
  v_gracia double precision;
begin
  select * into v_cfg from protcivil.config where id = 1;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    o_codigo := 'sin_gps';
    o_mensaje := 'No se pudo tomar tu ubicación. Activa el GPS y dale permiso de ubicación a la aplicación.';
    return;
  end if;
  if p_precision is not null and p_precision > v_cfg.precision_maxima_m then
    o_codigo := 'impreciso';
    o_mensaje := format('La ubicación llegó muy imprecisa (± %s metros). Sal a un sitio despejado, espera unos segundos y vuelve a intentar.',
                        round(p_precision::numeric));
    return;
  end if;

  select e.id, e.nombre, protcivil.distancia_m(p_lat, p_lng, e.latitud, e.longitud), e.radio_m
    into o_estacion_id, o_estacion, o_distancia, v_radio
    from protcivil.estaciones e
   where e.activa
   order by protcivil.distancia_m(p_lat, p_lng, e.latitud, e.longitud)
   limit 1;

  if o_estacion_id is null then
    if v_cfg.exigir_zona then
      o_codigo := 'sin_estaciones';
      o_mensaje := 'Todavía no hay estaciones cargadas en el sistema. Avísale al jefe de guardia.';
    end if;
    return;
  end if;

  v_gracia := least(coalesce(p_precision, 0), v_cfg.tolerancia_gps_m);
  o_dentro := (o_distancia - v_gracia) <= v_radio;

  if not o_dentro and v_cfg.exigir_zona then
    o_codigo := 'fuera_de_zona';
    o_mensaje := format('Estás a %s metros de %s. Solo se puede marcar dentro de la estación.',
                        round(o_distancia::numeric), o_estacion);
  end if;
end $$;

-- Abre la sesión del teléfono a partir del token. Si no sirve, devuelve
-- nulos. Alarga la sesión con el uso (como mucho una escritura por hora).
create or replace function protcivil.sesion_de(p_token text, out o_sesion_id uuid, out o_funcionario_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg protcivil.config;
  v_s   protcivil.sesiones;
  v_f   protcivil.funcionarios;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  select * into v_s from protcivil.sesiones s
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.cerrada_en is null and s.expira_en > now();
  if not found then
    return;
  end if;
  select * into v_f from protcivil.funcionarios f where f.id = v_s.funcionario_id and f.activo;
  if not found then
    return;
  end if;
  select * into v_cfg from protcivil.config where id = 1;
  -- Si el jefe liberó el teléfono o la cuenta pasó a otro, esta ficha ya no vale.
  if v_cfg.un_telefono_por_persona and v_f.dispositivo_autorizado is distinct from v_s.dispositivo then
    return;
  end if;
  if v_s.ultima_vez < now() - interval '1 hour' then
    update protcivil.sesiones
       set ultima_vez = now(), expira_en = now() + make_interval(days => v_cfg.dias_sesion)
     where id = v_s.id;
  end if;
  o_sesion_id := v_s.id;
  o_funcionario_id := v_f.id;
end $$;

-- Una clave aceptable: 6 a 64 caracteres, que no sea la cédula ni una de
-- las que todo el mundo prueba primero.
create or replace function protcivil.problema_clave(p_clave text, p_cedula text)
returns text language plpgsql immutable as $$
begin
  if p_clave is null or length(p_clave) < 6 then
    return 'La clave debe tener al menos 6 caracteres.';
  end if;
  if length(p_clave) > 64 then
    return 'La clave no puede tener más de 64 caracteres.';
  end if;
  if p_clave = p_cedula then
    return 'La clave no puede ser tu cédula.';
  end if;
  if p_clave ~ '^(.)\1+$' or p_clave in ('123456', '1234567', '12345678', '123456789', '654321', 'abcdef', 'qwerty', 'password', 'contraseña') then
    return 'Esa clave es muy fácil de adivinar. Escoge otra.';
  end if;
  return null;
end $$;

-- Deja la huella de una foto JPEG en base64 lista para guardar, o dice
-- por qué no sirve.
create or replace function protcivil.leer_foto(p_foto text, out o_bytes bytea, out o_mensaje text)
language plpgsql immutable as $$
begin
  if p_foto is null or p_foto = '' then
    return;
  end if;
  if length(p_foto) > 280000 then
    o_mensaje := 'La foto es muy grande. Actualiza la aplicación.';
    return;
  end if;
  begin
    o_bytes := decode(regexp_replace(p_foto, '^data:image/[a-zA-Z]+;base64,', ''), 'base64');
  exception when others then
    o_bytes := null;
    o_mensaje := 'La foto llegó dañada. Vuelve a tomarla.';
    return;
  end;
  if octet_length(o_bytes) > 200000 then
    o_bytes := null;
    o_mensaje := 'La foto es muy grande. Actualiza la aplicación.';
  elsif octet_length(o_bytes) < 500 or substring(o_bytes from 1 for 3) <> '\xffd8ff'::bytea then
    o_bytes := null;
    o_mensaje := 'La foto no es una imagen válida. Vuelve a tomarla.';
  end if;
end $$;

-- Registra un marcaje y abre o cierra la guardia. La usan el teléfono y
-- el marcaje manual del jefe: la regla es una sola.
create or replace function protcivil.registrar_marcaje(
  p_funcionario_id uuid, p_tipo text, p_momento timestamptz, p_revision text,
  p_sin_conexion boolean, p_hora_confiable boolean,
  p_lat double precision, p_lng double precision, p_precision double precision,
  p_estacion_id uuid, p_distancia double precision, p_dentro boolean,
  p_dispositivo text, p_sesion_id uuid, p_id_local uuid,
  p_manual boolean, p_registrado_por uuid, p_motivo_manual text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cfg     protcivil.config;
  v_serv    protcivil.servicios;
  v_m       protcivil.marcajes;
  v_ultimo  timestamptz;
begin
  select * into v_cfg from protcivil.config where id = 1;

  select max(m.momento) into v_ultimo from protcivil.marcajes m where m.funcionario_id = p_funcionario_id;
  if v_ultimo is not null and p_momento < v_ultimo then
    return protcivil.fallo('orden', format('Este marcaje (%s) es anterior al último que ya está registrado (%s).',
      to_char(p_momento at time zone 'America/Caracas', 'DD/MM/YYYY HH12:MI AM'),
      to_char(v_ultimo at time zone 'America/Caracas', 'DD/MM/YYYY HH12:MI AM')));
  end if;

  select * into v_serv from protcivil.servicios s where s.funcionario_id = p_funcionario_id and s.fin is null;

  if p_tipo = 'entrada' and v_serv.id is not null then
    if v_serv.inicio < p_momento - make_interval(hours => v_cfg.horas_maximas_servicio) then
      -- Olvidó marcar la salida. No se inventan horas: la guardia se cierra
      -- en su propio inicio (0 horas) y queda para que el jefe la corrija.
      update protcivil.servicios
         set fin = inicio, cierre = 'automatico', estado = 'por_revisar',
             nota = 'No marcó la salida. Se cerró sola al marcar la entrada siguiente.'
       where id = v_serv.id;
    else
      return protcivil.fallo('orden', format('Ya marcaste tu entrada el %s. Marca la salida antes de una nueva entrada.',
        to_char(v_serv.inicio at time zone 'America/Caracas', 'DD/MM/YYYY "a las" HH12:MI AM')));
    end if;
  end if;
  if p_tipo = 'salida' then
    if v_serv.id is null then
      return protcivil.fallo('orden', 'No tienes una entrada abierta. Marca primero la entrada.');
    end if;
    if p_momento < v_serv.inicio then
      return protcivil.fallo('orden', 'La salida no puede ser anterior a la entrada.');
    end if;
  end if;

  begin
    insert into protcivil.marcajes (
      id_local, funcionario_id, tipo, momento, sin_conexion, hora_confiable,
      latitud, longitud, precision_m, estacion_id, distancia_m, dentro,
      dispositivo, sesion_id, manual, registrado_por, motivo_manual, revision)
    values (
      p_id_local, p_funcionario_id, p_tipo, p_momento, coalesce(p_sin_conexion, false), coalesce(p_hora_confiable, true),
      p_lat, p_lng, p_precision, p_estacion_id, p_distancia, p_dentro,
      left(p_dispositivo, 200), p_sesion_id, coalesce(p_manual, false), p_registrado_por, p_motivo_manual,
      coalesce(p_revision, 'ok'))
    returning * into v_m;

    if p_tipo = 'entrada' then
      insert into protcivil.servicios (funcionario_id, inicio, entrada_id, estado)
      values (p_funcionario_id, p_momento, v_m.id, case when v_m.revision = 'ok' then 'valido' else 'por_revisar' end)
      returning * into v_serv;
    else
      update protcivil.servicios
         set fin = p_momento, salida_id = v_m.id,
             cierre = case when p_manual then 'manual' else 'marcaje' end,
             estado = case when estado = 'valido' and v_m.revision <> 'ok' then 'por_revisar' else estado end
       where id = v_serv.id
      returning * into v_serv;
    end if;
    update protcivil.marcajes set servicio_id = v_serv.id where id = v_m.id;
  exception when unique_violation then
    -- Dos marcajes al mismo tiempo (doble toque, reintento): gana el primero.
    return protcivil.fallo('orden', 'Ese marcaje ya se estaba registrando. Revisa tu estado antes de volver a marcar.');
  end;

  return jsonb_build_object('ok', true,
    'marcaje', jsonb_build_object('id', v_m.id, 'tipo', v_m.tipo, 'momento', v_m.momento,
                                  'dentro', v_m.dentro, 'distancia_m', round(v_m.distancia_m::numeric),
                                  'revision', v_m.revision, 'sin_conexion', v_m.sin_conexion),
    'servicio', jsonb_build_object('id', v_serv.id, 'inicio', v_serv.inicio, 'fin', v_serv.fin, 'estado', v_serv.estado));
end $$;

-- Guardias programadas de cada grupo entre dos fechas (hora de Venezuela).
create or replace function protcivil.guardias_programadas(p_desde date, p_hasta date)
returns table (grupo_id uuid, grupo text, tipo_guardia text, inicio timestamptz, fin timestamptz, tolerancia_min integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  g        record;
  v_ciclo  interval;
  v_base   timestamptz;
  v_desde  timestamptz := (p_desde::timestamp) at time zone 'America/Caracas';
  v_hasta  timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Caracas';
  v_k      bigint;
  v_ini    timestamptz;
  v_dia    date;
begin
  if p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'El rango de fechas debe ser de a lo sumo 400 días.';
  end if;
  for g in
    select gr.id, gr.nombre, gr.fecha_referencia, t.nombre as tipo, t.modalidad, t.horas_servicio,
           t.horas_descanso, t.dias_semana, t.hora_inicio, t.hora_fin, t.tolerancia_min
      from protcivil.grupos gr join protcivil.tipos_guardia t on t.id = gr.tipo_guardia_id
     where gr.activo and t.activo
  loop
    if g.modalidad = 'rotativa' then
      continue when g.fecha_referencia is null;
      v_ciclo := make_interval(hours => g.horas_servicio + g.horas_descanso);
      v_base := (g.fecha_referencia + g.hora_inicio) at time zone 'America/Caracas';
      -- primer ciclo que todavía está en curso al comienzo del rango
      v_k := floor(extract(epoch from (v_desde - make_interval(hours => g.horas_servicio) - v_base))
                   / extract(epoch from v_ciclo))::bigint;
      loop
        v_ini := v_base + v_ciclo * v_k;
        exit when v_ini >= v_hasta;
        if v_ini + make_interval(hours => g.horas_servicio) > v_desde then
          grupo_id := g.id; grupo := g.nombre; tipo_guardia := g.tipo;
          inicio := v_ini; fin := v_ini + make_interval(hours => g.horas_servicio);
          tolerancia_min := g.tolerancia_min;
          return next;
        end if;
        v_k := v_k + 1;
      end loop;
    else
      v_dia := p_desde;
      while v_dia <= p_hasta loop
        if extract(isodow from v_dia)::smallint = any (g.dias_semana) then
          grupo_id := g.id; grupo := g.nombre; tipo_guardia := g.tipo;
          inicio := (v_dia + g.hora_inicio) at time zone 'America/Caracas';
          fin := (case when g.hora_fin > g.hora_inicio then v_dia else v_dia + 1 end + g.hora_fin) at time zone 'America/Caracas';
          tolerancia_min := g.tolerancia_min;
          return next;
        end if;
        v_dia := v_dia + 1;
      end loop;
    end if;
  end loop;
end $$;

-- =====================================================================
-- 3. LO QUE LLAMA EL TELÉFONO (rol anon, sin cuenta de Supabase)
-- =====================================================================

create or replace function protcivil.pc_entrar(
  p_cedula text, p_clave text, p_dispositivo text, p_dispositivo_nombre text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cedula  text := regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g');
  v_disp    text := left(trim(coalesce(p_dispositivo, '')), 200);
  v_cfg     protcivil.config;
  v_f       protcivil.funcionarios;
  v_fallos  integer;
  v_token   text;
begin
  if v_cedula = '' or coalesce(p_clave, '') = '' then
    return protcivil.fallo('datos', 'Escribe tu cédula y tu clave.');
  end if;
  if v_disp = '' then
    return protcivil.fallo('datos', 'La aplicación no mandó la identificación del teléfono. Actualízala.');
  end if;
  select * into v_cfg from protcivil.config where id = 1;

  select count(*) into v_fallos from protcivil.intentos_entrada i
   where i.cedula = v_cedula and not i.exito and i.motivo in ('clave', 'bloqueado')
     and i.momento > now() - interval '15 minutes';
  if v_fallos >= 5 then
    insert into protcivil.intentos_entrada (cedula, dispositivo, exito, motivo) values (v_cedula, v_disp, false, 'bloqueado');
    return protcivil.fallo('bloqueado', 'Demasiados intentos fallidos con esta cédula. Espera 15 minutos y vuelve a intentar.');
  end if;

  select * into v_f from protcivil.funcionarios f where f.cedula = v_cedula and f.activo;
  if not found then
    -- Mismo trabajo que con una cédula real, para que el tiempo de
    -- respuesta no delate qué cédulas existen.
    perform extensions.crypt(p_clave, extensions.gen_salt('bf', 10));
    insert into protcivil.intentos_entrada (cedula, dispositivo, exito, motivo) values (v_cedula, v_disp, false, 'clave');
    return protcivil.fallo('clave', 'Cédula o clave incorrecta.');
  end if;
  if v_f.clave_hash <> extensions.crypt(p_clave, v_f.clave_hash) then
    insert into protcivil.intentos_entrada (cedula, dispositivo, exito, motivo) values (v_cedula, v_disp, false, 'clave');
    return protcivil.fallo('clave', 'Cédula o clave incorrecta.');
  end if;

  if v_cfg.un_telefono_por_persona then
    if v_f.dispositivo_autorizado is null then
      update protcivil.funcionarios
         set dispositivo_autorizado = v_disp, dispositivo_nombre = left(p_dispositivo_nombre, 120), actualizado_en = now()
       where id = v_f.id;
    elsif v_f.dispositivo_autorizado <> v_disp then
      insert into protcivil.intentos_entrada (cedula, dispositivo, exito, motivo) values (v_cedula, v_disp, false, 'otro_telefono');
      perform protcivil.anotar('funcionario', v_f.id, v_f.nombres || ' ' || v_f.apellidos, 'entrada_otro_telefono',
                               jsonb_build_object('telefono', left(p_dispositivo_nombre, 120)));
      return protcivil.fallo('otro_telefono',
        'Tu cuenta está registrada en otro teléfono. Pídele al jefe de guardia que libere tu teléfono para poder usar este.');
    end if;
  end if;

  update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'nueva_entrada'
   where funcionario_id = v_f.id and cerrada_en is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into protcivil.sesiones (funcionario_id, token_hash, dispositivo, expira_en)
  values (v_f.id, extensions.digest(v_token, 'sha256'), v_disp, now() + make_interval(days => v_cfg.dias_sesion));
  insert into protcivil.intentos_entrada (cedula, dispositivo, exito) values (v_cedula, v_disp, true);
  perform protcivil.anotar('funcionario', v_f.id, v_f.nombres || ' ' || v_f.apellidos, 'entro_app',
                           jsonb_build_object('telefono', left(p_dispositivo_nombre, 120)));

  return jsonb_build_object('ok', true, 'token', v_token, 'debe_cambiar_clave', v_f.debe_cambiar_clave,
    'funcionario', jsonb_build_object('cedula', v_f.cedula, 'nombres', v_f.nombres, 'apellidos', v_f.apellidos,
                                      'cargo', v_f.cargo, 'condicion', v_f.condicion));
end $$;

create or replace function protcivil.pc_cambiar_clave(p_token text, p_clave_actual text, p_clave_nueva text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ses      record;
  v_f        protcivil.funcionarios;
  v_problema text;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  select * into v_f from protcivil.funcionarios where id = v_ses.o_funcionario_id;
  if coalesce(p_clave_actual, '') = '' or v_f.clave_hash <> extensions.crypt(p_clave_actual, v_f.clave_hash) then
    return protcivil.fallo('clave', 'La clave actual no es correcta.');
  end if;
  v_problema := protcivil.problema_clave(p_clave_nueva, v_f.cedula);
  if v_problema is not null then
    return protcivil.fallo('clave_debil', v_problema);
  end if;
  if p_clave_nueva = p_clave_actual then
    return protcivil.fallo('clave_debil', 'La clave nueva tiene que ser distinta de la actual.');
  end if;
  update protcivil.funcionarios
     set clave_hash = extensions.crypt(p_clave_nueva, extensions.gen_salt('bf', 10)),
         debe_cambiar_clave = false, actualizado_en = now()
   where id = v_f.id;
  -- Cualquier otra sesión abierta queda cerrada: solo sigue esta.
  update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'cambio_clave'
   where funcionario_id = v_f.id and cerrada_en is null and id <> v_ses.o_sesion_id;
  perform protcivil.anotar('funcionario', v_f.id, v_f.nombres || ' ' || v_f.apellidos, 'cambio_clave');
  return jsonb_build_object('ok', true);
end $$;

create or replace function protcivil.pc_salir(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses record;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is not null then
    update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'salio' where id = v_ses.o_sesion_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Todo lo que la pantalla principal de la app necesita, en una llamada.
-- Trae la hora del servidor: la app la usa para calcular una hora
-- confiable cuando marca sin señal.
create or replace function protcivil.pc_estado(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ses   record;
  v_f     protcivil.funcionarios;
  v_cfg   protcivil.config;
  v_serv  protcivil.servicios;
  v_est   text;
  v_prox_inicio timestamptz;
  v_prox_fin    timestamptz;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  select * into v_f from protcivil.funcionarios where id = v_ses.o_funcionario_id;
  select * into v_cfg from protcivil.config where id = 1;
  select * into v_serv from protcivil.servicios s where s.funcionario_id = v_f.id and s.fin is null;
  if v_serv.id is not null then
    select e.estado into v_est from protcivil.estados e where e.servicio_id = v_serv.id order by e.momento desc limit 1;
  end if;
  -- Sin grupo asignado no hay próxima guardia (y no se toca la variable).
  if v_f.grupo_id is not null then
    select gp.inicio, gp.fin into v_prox_inicio, v_prox_fin
      from protcivil.guardias_programadas((now() at time zone 'America/Caracas')::date,
                                          (now() at time zone 'America/Caracas')::date + 14) gp
     where gp.grupo_id = v_f.grupo_id and gp.fin > now()
     order by gp.inicio limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ahora', now(),
    'ahora_ms', floor(extract(epoch from now()) * 1000)::bigint,
    'debe_cambiar_clave', v_f.debe_cambiar_clave,
    'funcionario', jsonb_build_object(
      'cedula', v_f.cedula, 'nombres', v_f.nombres, 'apellidos', v_f.apellidos, 'cargo', v_f.cargo,
      'condicion', v_f.condicion,
      'grupo', (select g.nombre from protcivil.grupos g where g.id = v_f.grupo_id),
      'estacion', (select e.nombre from protcivil.estaciones e where e.id = v_f.estacion_id)),
    'servicio', case when v_serv.id is null then null else jsonb_build_object(
      'id', v_serv.id, 'inicio', v_serv.inicio, 'estado_operativo', coalesce(v_est, 'en_estacion')) end,
    'proxima_guardia', case when v_prox_inicio is null then null
                            else jsonb_build_object('inicio', v_prox_inicio, 'fin', v_prox_fin) end,
    'ultimos', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'momento', m.momento, 'dentro', m.dentro,
                                          'sin_conexion', m.sin_conexion, 'revision', m.revision) order by m.momento desc)
        from (select * from protcivil.marcajes m where m.funcionario_id = v_f.id order by m.momento desc limit 6) m), '[]'::jsonb),
    'estaciones', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', e.nombre, 'latitud', e.latitud, 'longitud', e.longitud,
                                          'radio_m', e.radio_m) order by e.nombre)
        from protcivil.estaciones e where e.activa), '[]'::jsonb),
    'reglas', jsonb_build_object(
      'foto_obligatoria', v_cfg.foto_obligatoria, 'precision_maxima_m', v_cfg.precision_maxima_m,
      'permitir_sin_conexion', v_cfg.permitir_sin_conexion,
      'horas_maximas_sin_conexion', v_cfg.horas_maximas_sin_conexion, 'exigir_zona', v_cfg.exigir_zona,
      'tolerancia_gps_m', v_cfg.tolerancia_gps_m));
end $$;

-- Marcar entrada o salida.
--   p_id_local:      un UUID que inventa el teléfono para cada marcaje. Si
--                    reintenta porque se cayó la señal, no se duplica.
--   p_sin_conexion:  el marcaje se hizo sin señal y se manda después.
--   p_momento:       solo para marcajes sin señal: la hora en que se hizo,
--                    calculada por la app con la hora del servidor + el
--                    reloj interno del teléfono (no el reloj que se cambia).
--   p_hora_confiable: false si el teléfono se reinició entre medio y la
--                    app tuvo que usar el reloj normal: queda por revisar.
--   p_gps_simulado:  la app detectó una ubicación falsa.
create or replace function protcivil.pc_marcar(
  p_token text, p_tipo text,
  p_lat double precision default null, p_lng double precision default null, p_precision double precision default null,
  p_foto text default null, p_gps_simulado boolean default false, p_id_local uuid default null,
  p_sin_conexion boolean default false, p_momento timestamptz default null, p_hora_confiable boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ses       record;
  v_f         protcivil.funcionarios;
  v_cfg       protcivil.config;
  v_previo    protcivil.marcajes;
  v_momento   timestamptz;
  v_revision  text := 'ok';
  v_sitio     record;
  v_foto      record;
  v_res       jsonb;
  v_disp      text;
  v_nombre    text;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  select * into v_f from protcivil.funcionarios where id = v_ses.o_funcionario_id;
  v_nombre := v_f.nombres || ' ' || v_f.apellidos;
  select * into v_cfg from protcivil.config where id = 1;
  select s.dispositivo into v_disp from protcivil.sesiones s where s.id = v_ses.o_sesion_id;

  -- Reintento de un marcaje que ya llegó: se devuelve el mismo, sin duplicar.
  if p_id_local is not null then
    select * into v_previo from protcivil.marcajes m where m.id_local = p_id_local;
    if found then
      if v_previo.funcionario_id <> v_f.id then
        return protcivil.fallo('datos', 'Identificador de marcaje repetido. Actualiza la aplicación.');
      end if;
      return jsonb_build_object('ok', true, 'repetido', true,
        'marcaje', jsonb_build_object('id', v_previo.id, 'tipo', v_previo.tipo, 'momento', v_previo.momento,
                                      'dentro', v_previo.dentro, 'revision', v_previo.revision,
                                      'sin_conexion', v_previo.sin_conexion));
    end if;
  end if;

  if p_tipo is null or p_tipo not in ('entrada', 'salida') then
    return protcivil.fallo('datos', 'Tipo de marcaje desconocido. Actualiza la aplicación.');
  end if;

  if coalesce(p_gps_simulado, false) then
    perform protcivil.anotar('funcionario', v_f.id, v_nombre, 'gps_falso',
      jsonb_build_object('tipo', p_tipo, 'latitud', p_lat, 'longitud', p_lng));
    return protcivil.fallo('gps_falso',
      'El teléfono está usando una ubicación falsa (una aplicación de GPS falso). Desactívala para poder marcar. Este intento quedó anotado.');
  end if;

  if coalesce(p_sin_conexion, false) then
    if not v_cfg.permitir_sin_conexion then
      return protcivil.fallo('sin_conexion', 'No está permitido marcar sin señal. Marca cuando tengas conexión.');
    end if;
    if p_momento is null then
      return protcivil.fallo('datos', 'Al marcaje sin señal le falta la hora. Actualiza la aplicación.');
    end if;
    if p_momento > now() + interval '5 minutes' then
      return protcivil.fallo('hora', 'La hora de este marcaje está en el futuro. Revisa la hora del teléfono.');
    end if;
    if p_momento < now() - make_interval(hours => v_cfg.horas_maximas_sin_conexion) then
      return protcivil.fallo('hora', format(
        'Este marcaje se hizo hace más de %s horas y ya no se puede enviar. Pídele al jefe de guardia que lo registre a mano.',
        v_cfg.horas_maximas_sin_conexion));
    end if;
    v_momento := p_momento;
    if not coalesce(p_hora_confiable, false) then
      v_revision := 'por_revisar';
    end if;
  else
    v_momento := now();
  end if;

  select * into v_sitio from protcivil.verificar_sitio(p_lat, p_lng, p_precision);
  if v_sitio.o_codigo is not null then
    perform protcivil.anotar('funcionario', v_f.id, v_nombre, 'marcaje_rechazado',
      jsonb_build_object('tipo', p_tipo, 'motivo', v_sitio.o_codigo,
                         'distancia_m', round(v_sitio.o_distancia::numeric), 'estacion', v_sitio.o_estacion));
    return protcivil.fallo(v_sitio.o_codigo, v_sitio.o_mensaje);
  end if;

  select * into v_foto from protcivil.leer_foto(p_foto);
  if v_foto.o_mensaje is not null then
    return protcivil.fallo('foto', v_foto.o_mensaje);
  end if;
  if v_foto.o_bytes is null and v_cfg.foto_obligatoria then
    return protcivil.fallo('foto', 'Falta la foto. Tómate la foto al marcar.');
  end if;

  v_res := protcivil.registrar_marcaje(
    v_f.id, p_tipo, v_momento, v_revision, p_sin_conexion, p_hora_confiable,
    p_lat, p_lng, p_precision, v_sitio.o_estacion_id, v_sitio.o_distancia, v_sitio.o_dentro,
    v_disp, v_ses.o_sesion_id, p_id_local, false, null, null);

  if (v_res ->> 'ok')::boolean then
    if v_foto.o_bytes is not null then
      insert into protcivil.fotos (marcaje_id, datos) values (((v_res -> 'marcaje') ->> 'id')::uuid, v_foto.o_bytes);
    end if;
    perform protcivil.anotar('funcionario', v_f.id, v_nombre, 'marco_' || p_tipo,
      jsonb_build_object('estacion', v_sitio.o_estacion, 'distancia_m', round(v_sitio.o_distancia::numeric),
                         'sin_conexion', coalesce(p_sin_conexion, false), 'revision', v_revision));
  end if;
  return v_res;
end $$;

-- Cambiar el estado operativo durante la guardia.
create or replace function protcivil.pc_cambiar_estado(
  p_token text, p_estado text,
  p_lat double precision default null, p_lng double precision default null, p_precision double precision default null,
  p_nota text default null, p_id_local uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ses   record;
  v_f     protcivil.funcionarios;
  v_serv  protcivil.servicios;
  v_e     protcivil.estados;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  select * into v_f from protcivil.funcionarios where id = v_ses.o_funcionario_id;
  if p_estado is null or p_estado not in ('en_estacion', 'en_emergencia', 'en_comision') then
    return protcivil.fallo('datos', 'Estado desconocido. Actualiza la aplicación.');
  end if;
  if p_id_local is not null and exists (select 1 from protcivil.estados e where e.id_local = p_id_local and e.funcionario_id = v_f.id) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  select * into v_serv from protcivil.servicios s where s.funcionario_id = v_f.id and s.fin is null;
  if v_serv.id is null then
    return protcivil.fallo('orden', 'Primero marca tu entrada a la guardia.');
  end if;
  begin
    insert into protcivil.estados (id_local, funcionario_id, servicio_id, estado, latitud, longitud, precision_m, nota)
    values (p_id_local, v_f.id, v_serv.id, p_estado, p_lat, p_lng, p_precision, left(nullif(trim(p_nota), ''), 500))
    returning * into v_e;
  exception when unique_violation then
    return protcivil.fallo('datos', 'Identificador repetido. Actualiza la aplicación.');
  end;
  perform protcivil.anotar('funcionario', v_f.id, v_f.nombres || ' ' || v_f.apellidos, 'estado_' || p_estado,
                           jsonb_build_object('nota', left(p_nota, 200)));
  return jsonb_build_object('ok', true, 'estado', v_e.estado, 'momento', v_e.momento);
end $$;

-- "¿Puedo marcar desde aquí?" — no escribe nada. La app lo pregunta con la
-- mejor lectura del GPS para decir "estás a 40 m, acércate" ANTES de que la
-- persona toque el botón. Lo calcula la MISMA función que después decide de
-- verdad (verificar_sitio): lo que dice aquí es lo que va a pasar al marcar.
create or replace function protcivil.pc_donde_estoy(
  p_token text, p_lat double precision default null, p_lng double precision default null,
  p_precision double precision default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ses   record;
  v_sitio record;
  v_radio integer;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  select * into v_sitio from protcivil.verificar_sitio(p_lat, p_lng, p_precision);
  select e.radio_m into v_radio from protcivil.estaciones e where e.id = v_sitio.o_estacion_id;
  return jsonb_build_object('ok', true,
    'puede', v_sitio.o_codigo is null,
    'codigo', v_sitio.o_codigo,
    'mensaje', v_sitio.o_mensaje,
    'estacion', v_sitio.o_estacion,
    'distancia_m', round(v_sitio.o_distancia::numeric),
    'radio_m', v_radio,
    'dentro', v_sitio.o_dentro);
end $$;

-- La versión vigente de la app (no hace falta haber entrado).
create or replace function protcivil.pc_version_app()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('codigo', c.app_version_codigo, 'nombre', c.app_version_nombre,
                            'enlace', c.app_enlace, 'novedades', c.app_novedades)
    from protcivil.config c where c.id = 1;
$$;

create or replace function protcivil.pc_historial(p_token text, p_limite integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ses record;
begin
  select * into v_ses from protcivil.sesion_de(p_token);
  if v_ses.o_sesion_id is null then
    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');
  end if;
  return jsonb_build_object('ok', true, 'servicios', coalesce((
    select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fin', s.fin, 'estado', s.estado, 'cierre', s.cierre,
                                        'horas', round((extract(epoch from (s.fin - s.inicio)) / 3600)::numeric, 1))
                     order by s.inicio desc)
      from (select * from protcivil.servicios s
             where s.funcionario_id = v_ses.o_funcionario_id
             order by s.inicio desc limit least(greatest(coalesce(p_limite, 30), 1), 200)) s), '[]'::jsonb));
end $$;

-- =====================================================================
-- 4. LO QUE LLAMA EL GESTOR WEB (rol authenticated + ser gestor)
-- =====================================================================

create or replace function protcivil.pc_admin_guardar_funcionario(
  p_id uuid, p_cedula text, p_nombres text, p_apellidos text,
  p_cargo text default null, p_condicion text default 'fijo', p_grupo_id uuid default null,
  p_estacion_id uuid default null, p_telefono text default null, p_activo boolean default true,
  p_clave_inicial text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cedula   text := regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g');
  v_f        protcivil.funcionarios;
  v_antes    protcivil.funcionarios;
  v_problema text;
begin
  if not protcivil.es_admin() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if v_cedula !~ '^[0-9]{5,9}$' then
    raise exception 'La cédula debe tener entre 5 y 9 números.';
  end if;
  if p_id is null then
    v_problema := protcivil.problema_clave(p_clave_inicial, v_cedula);
    if v_problema is not null then
      raise exception 'Clave inicial: %', v_problema;
    end if;
    begin
      insert into protcivil.funcionarios (cedula, nombres, apellidos, cargo, condicion, grupo_id, estacion_id,
                                          telefono, activo, clave_hash, debe_cambiar_clave)
      values (v_cedula, trim(p_nombres), trim(p_apellidos), nullif(trim(p_cargo), ''), coalesce(p_condicion, 'fijo'),
              p_grupo_id, p_estacion_id, nullif(trim(p_telefono), ''), coalesce(p_activo, true),
              extensions.crypt(p_clave_inicial, extensions.gen_salt('bf', 10)), true)
      returning * into v_f;
    exception when unique_violation then
      raise exception 'Ya hay un funcionario con la cédula %.', v_cedula;
    end;
    perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'creo_funcionario',
      jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'cedula', v_f.cedula));
  else
    select * into v_antes from protcivil.funcionarios where id = p_id;
    if not found then
      raise exception 'Ese funcionario no existe.';
    end if;
    begin
      update protcivil.funcionarios
         set cedula = v_cedula, nombres = trim(p_nombres), apellidos = trim(p_apellidos),
             cargo = nullif(trim(p_cargo), ''), condicion = coalesce(p_condicion, 'fijo'),
             grupo_id = p_grupo_id, estacion_id = p_estacion_id, telefono = nullif(trim(p_telefono), ''),
             activo = coalesce(p_activo, true), actualizado_en = now()
       where id = p_id
      returning * into v_f;
    exception when unique_violation then
      raise exception 'Ya hay un funcionario con la cédula %.', v_cedula;
    end;
    if v_antes.activo and not v_f.activo then
      update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'desactivado'
       where funcionario_id = v_f.id and cerrada_en is null;
    end if;
    perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'edito_funcionario',
      jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'cedula', v_f.cedula,
                         'antes', jsonb_build_object('cedula', v_antes.cedula, 'nombres', v_antes.nombres,
                           'apellidos', v_antes.apellidos, 'cargo', v_antes.cargo, 'condicion', v_antes.condicion,
                           'grupo_id', v_antes.grupo_id, 'estacion_id', v_antes.estacion_id, 'activo', v_antes.activo)));
  end if;
  return jsonb_build_object('ok', true, 'id', v_f.id);
end $$;

create or replace function protcivil.pc_admin_resetear_clave(p_funcionario_id uuid, p_clave_nueva text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_f        protcivil.funcionarios;
  v_problema text;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  select * into v_f from protcivil.funcionarios where id = p_funcionario_id;
  if not found then
    raise exception 'Ese funcionario no existe.';
  end if;
  v_problema := protcivil.problema_clave(p_clave_nueva, v_f.cedula);
  if v_problema is not null then
    raise exception '%', v_problema;
  end if;
  update protcivil.funcionarios
     set clave_hash = extensions.crypt(p_clave_nueva, extensions.gen_salt('bf', 10)),
         debe_cambiar_clave = true, actualizado_en = now()
   where id = v_f.id;
  update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'clave_reseteada'
   where funcionario_id = v_f.id and cerrada_en is null;
  -- Si estaba bloqueado por claves erradas, el reseteo lo desbloquea.
  insert into protcivil.intentos_entrada (cedula, exito, motivo) values (v_f.cedula, true, 'reseteo');
  delete from protcivil.intentos_entrada
   where cedula = v_f.cedula and not exito and momento > now() - interval '15 minutes';
  perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'reseteo_clave',
    jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'cedula', v_f.cedula));
  return jsonb_build_object('ok', true);
end $$;

create or replace function protcivil.pc_admin_liberar_telefono(p_funcionario_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_f protcivil.funcionarios;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  update protcivil.funcionarios
     set dispositivo_autorizado = null, dispositivo_nombre = null, actualizado_en = now()
   where id = p_funcionario_id
  returning * into v_f;
  if not found then
    raise exception 'Ese funcionario no existe.';
  end if;
  update protcivil.sesiones set cerrada_en = now(), motivo_cierre = 'telefono_liberado'
   where funcionario_id = v_f.id and cerrada_en is null;
  perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'libero_telefono',
    jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'cedula', v_f.cedula));
  return jsonb_build_object('ok', true);
end $$;

-- Marcaje a mano (el teléfono se dañó, se quedó sin batería…). Queda
-- marcado como manual, con quién lo hizo y por qué.
create or replace function protcivil.pc_admin_marcaje_manual(
  p_funcionario_id uuid, p_tipo text, p_momento timestamptz, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_f   protcivil.funcionarios;
  v_res jsonb;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  select * into v_f from protcivil.funcionarios where id = p_funcionario_id;
  if not found then
    raise exception 'Ese funcionario no existe.';
  end if;
  if p_tipo is null or p_tipo not in ('entrada', 'salida') then
    raise exception 'El tipo debe ser entrada o salida.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe el motivo del marcaje a mano (al menos 5 letras).';
  end if;
  if p_momento is null or p_momento > now() + interval '5 minutes' then
    raise exception 'La hora del marcaje no puede estar en el futuro.';
  end if;
  v_res := protcivil.registrar_marcaje(
    v_f.id, p_tipo, p_momento, 'ok', false, true, null, null, null, null, null, null,
    null, null, null, true, auth.uid(), trim(p_motivo));
  if (v_res ->> 'ok')::boolean then
    perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'marcaje_manual',
      jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'tipo', p_tipo,
                         'momento', p_momento, 'motivo', trim(p_motivo)));
  end if;
  return v_res;
end $$;

-- Revisar una guardia: darla por buena, anularla, o ponerle la hora de
-- salida que faltaba. Siempre con una nota que explique.
create or replace function protcivil.pc_admin_revisar_servicio(
  p_servicio_id uuid, p_estado text, p_nota text, p_fin timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s     protcivil.servicios;
  v_antes protcivil.servicios;
  v_f     protcivil.funcionarios;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('valido', 'anulado') then
    raise exception 'El estado debe ser valido o anulado.';
  end if;
  if length(trim(coalesce(p_nota, ''))) < 5 then
    raise exception 'Escribe una nota que explique la revisión (al menos 5 letras).';
  end if;
  select * into v_antes from protcivil.servicios where id = p_servicio_id;
  if not found then
    raise exception 'Esa guardia no existe.';
  end if;
  if p_fin is not null and (p_fin < v_antes.inicio or p_fin > now() + interval '5 minutes') then
    raise exception 'La hora de salida tiene que estar entre la entrada y ahora.';
  end if;
  update protcivil.servicios
     set estado = p_estado,
         fin = coalesce(p_fin, fin, case when p_estado = 'anulado' then inicio end),
         cierre = case when p_fin is not null then 'manual' when fin is null and p_estado = 'anulado' then 'manual' else cierre end,
         nota = trim(p_nota), revisado_por = auth.uid(), revisado_en = now()
   where id = p_servicio_id
  returning * into v_s;
  select * into v_f from protcivil.funcionarios where id = v_s.funcionario_id;
  perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(), 'reviso_guardia',
    jsonb_build_object('funcionario', v_f.nombres || ' ' || v_f.apellidos, 'estado', p_estado,
                       'nota', trim(p_nota), 'fin_antes', v_antes.fin, 'fin_ahora', v_s.fin));
  return jsonb_build_object('ok', true);
end $$;

-- La foto de un marcaje, como imagen lista para mostrar.
create or replace function protcivil.pc_admin_foto(p_marcaje_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_datos bytea;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  select f.datos into v_datos from protcivil.fotos f where f.marcaje_id = p_marcaje_id;
  if v_datos is null then
    return null;
  end if;
  return 'data:image/jpeg;base64,' || replace(encode(v_datos, 'base64'), E'\n', '');
end $$;

create or replace function protcivil.pc_admin_anotar_libro(
  p_estacion_id uuid, p_tipo text, p_texto text, p_corrige_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  insert into protcivil.libro_guardia (estacion_id, tipo, texto, autor_id, autor_nombre, corrige_id)
  values (p_estacion_id, coalesce(p_tipo, 'novedad'), trim(p_texto), auth.uid(),
          coalesce(protcivil.nombre_gestor(), 'Gestor'), p_corrige_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Cumplimiento: cada guardia programada de cada funcionario contra lo que
-- de verdad marcó. estado: cumplio | tarde | falto | en_curso | programada.
create or replace function protcivil.pc_admin_cumplimiento(p_desde date, p_hasta date)
returns table (funcionario_id uuid, cedula text, funcionario text, condicion text, grupo text,
               inicio_programado timestamptz, fin_programado timestamptz,
               servicio_id uuid, entrada timestamptz, salida timestamptz, estado text, minutos_tarde integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  return query
  select f.id, f.cedula, f.nombres || ' ' || f.apellidos, f.condicion, gp.grupo, gp.inicio, gp.fin,
         s.id, s.inicio, s.fin,
         case
           when s.id is not null and s.inicio > gp.inicio + make_interval(mins => gp.tolerancia_min) then 'tarde'
           when s.id is not null then 'cumplio'
           when gp.inicio > now() then 'programada'
           when gp.fin > now() then 'en_curso'
           else 'falto'
         end,
         case when s.id is not null and s.inicio > gp.inicio + make_interval(mins => gp.tolerancia_min)
              then floor(extract(epoch from (s.inicio - gp.inicio)) / 60)::integer
              when s.id is not null then 0
              else null end
    from protcivil.guardias_programadas(p_desde, p_hasta) gp
    join protcivil.funcionarios f on f.grupo_id = gp.grupo_id and f.activo
    left join lateral (
      select sv.* from protcivil.servicios sv
       where sv.funcionario_id = f.id and sv.estado <> 'anulado'
         and sv.inicio between gp.inicio - interval '3 hours' and gp.fin
       order by sv.inicio limit 1) s on true
   order by gp.inicio, f.apellidos, f.nombres;
end $$;

-- El calendario de guardias, para el cuadrante del gestor.
create or replace function protcivil.pc_admin_cuadrante(p_desde date, p_hasta date)
returns table (grupo_id uuid, grupo text, tipo_guardia text, inicio timestamptz, fin timestamptz, tolerancia_min integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not protcivil.es_gestor() then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  return query select * from protcivil.guardias_programadas(p_desde, p_hasta);
end $$;

-- Limpieza diaria: fotos viejas, intentos de entrada y sesiones cerradas.
create or replace function protcivil.limpiar()
returns void language plpgsql security definer set search_path = '' as $$
declare v_cfg protcivil.config;
begin
  select * into v_cfg from protcivil.config where id = 1;
  delete from protcivil.fotos where creada_en < now() - make_interval(days => v_cfg.dias_fotos);
  delete from protcivil.intentos_entrada where momento < now() - interval '60 days';
  delete from protcivil.sesiones
   where (cerrada_en is not null and cerrada_en < now() - interval '90 days')
      or (cerrada_en is null and expira_en < now() - interval '90 days');
end $$;

-- =====================================================================
-- 5. CANDADOS DE ESCRITURA Y BITÁCORA DE LOS CATÁLOGOS
-- =====================================================================

-- Bitácora, libro de guardia y marcajes: no se editan ni se borran.
create or replace function protcivil.fn_no_modificar()
returns trigger language plpgsql as $$
begin
  raise exception 'Este registro no se puede % : es parte del historial.',
    case when tg_op = 'DELETE' then 'borrar' else 'modificar' end;
end $$;

drop trigger if exists tr_bitacora_inmutable on protcivil.bitacora;
create trigger tr_bitacora_inmutable before update or delete on protcivil.bitacora
  for each row execute function protcivil.fn_no_modificar();
drop trigger if exists tr_libro_inmutable on protcivil.libro_guardia;
create trigger tr_libro_inmutable before update or delete on protcivil.libro_guardia
  for each row execute function protcivil.fn_no_modificar();
drop trigger if exists tr_marcajes_inmutable on protcivil.marcajes;
create trigger tr_marcajes_inmutable before delete on protcivil.marcajes
  for each row execute function protcivil.fn_no_modificar();

-- Del marcaje solo puede cambiar a qué guardia pertenece (lo pone la base
-- al registrarlo). La hora, el lugar y todo lo demás quedan fijos.
create or replace function protcivil.fn_marcaje_fijo()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'servicio_id') is distinct from (to_jsonb(old) - 'servicio_id') then
    raise exception 'Un marcaje no se puede modificar: es parte del historial.';
  end if;
  return new;
end $$;
drop trigger if exists tr_marcajes_fijo on protcivil.marcajes;
create trigger tr_marcajes_fijo before update on protcivil.marcajes
  for each row execute function protcivil.fn_marcaje_fijo();

-- Lo que el administrador cambia en estaciones, tipos de guardia, grupos,
-- configuración y gestores queda en la bitácora con el antes y el después.
create or replace function protcivil.fn_bitacora_catalogo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform protcivil.anotar('gestor', auth.uid(), protcivil.nombre_gestor(),
    tg_table_name || '_' || lower(tg_op),
    jsonb_build_object('antes', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
                       'despues', case when tg_op = 'DELETE' then null else to_jsonb(new) end));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['estaciones', 'tipos_guardia', 'grupos', 'config', 'gestores'] loop
    execute format('drop trigger if exists tr_bitacora_%1$s on protcivil.%1$I', t);
    execute format('create trigger tr_bitacora_%1$s after insert or update or delete on protcivil.%1$I
                    for each row execute function protcivil.fn_bitacora_catalogo()', t);
  end loop;
end $$;

-- =====================================================================
-- 6. PERMISOS Y RLS
-- =====================================================================

-- Todas las tablas cerradas, con RLS, y nada abierto por omisión.
do $$
declare t text;
begin
  foreach t in array array['config', 'estaciones', 'tipos_guardia', 'grupos', 'funcionarios', 'sesiones',
                           'intentos_entrada', 'servicios', 'marcajes', 'fotos', 'estados', 'libro_guardia',
                           'gestores', 'bitacora'] loop
    execute format('alter table protcivil.%I enable row level security', t);
    execute format('revoke all on protcivil.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema protcivil from public, anon, authenticated;

-- El gestor LEE (nunca las fotos ni las sesiones: esas van por funciones).
grant select on protcivil.config, protcivil.estaciones, protcivil.tipos_guardia, protcivil.grupos,
                protcivil.servicios, protcivil.marcajes, protcivil.estados, protcivil.libro_guardia,
                protcivil.gestores, protcivil.bitacora, protcivil.intentos_entrada to authenticated;
-- De los funcionarios, todo menos la huella de la clave.
grant select (id, cedula, nombres, apellidos, cargo, condicion, grupo_id, estacion_id, telefono,
              debe_cambiar_clave, dispositivo_autorizado, dispositivo_nombre, activo, creado_en, actualizado_en)
  on protcivil.funcionarios to authenticated;
-- El administrador escribe los catálogos directamente (nunca borra: desactiva).
grant insert, update on protcivil.estaciones, protcivil.tipos_guardia, protcivil.grupos to authenticated;
grant update on protcivil.config to authenticated;
grant insert, update on protcivil.gestores to authenticated;

do $$
declare t text;
begin
  foreach t in array array['config', 'estaciones', 'tipos_guardia', 'grupos', 'funcionarios', 'servicios',
                           'marcajes', 'estados', 'libro_guardia', 'bitacora', 'intentos_entrada'] loop
    execute format('drop policy if exists gestor_lee on protcivil.%I', t);
    execute format('create policy gestor_lee on protcivil.%I for select to authenticated using (protcivil.es_gestor())', t);
  end loop;
  foreach t in array array['estaciones', 'tipos_guardia', 'grupos', 'config'] loop
    execute format('drop policy if exists admin_escribe on protcivil.%I', t);
    execute format('drop policy if exists admin_actualiza on protcivil.%I', t);
    if t <> 'config' then
      execute format('create policy admin_escribe on protcivil.%I for insert to authenticated with check (protcivil.es_admin())', t);
    end if;
    execute format('create policy admin_actualiza on protcivil.%I for update to authenticated using (protcivil.es_admin()) with check (protcivil.es_admin())', t);
  end loop;
end $$;

-- Gestores: cada uno se ve a sí mismo; el administrador ve y maneja a todos.
drop policy if exists gestor_lee on protcivil.gestores;
create policy gestor_lee on protcivil.gestores for select to authenticated
  using (user_id = auth.uid() or protcivil.es_admin());
drop policy if exists admin_escribe on protcivil.gestores;
create policy admin_escribe on protcivil.gestores for insert to authenticated with check (protcivil.es_admin());
drop policy if exists admin_actualiza on protcivil.gestores;
create policy admin_actualiza on protcivil.gestores for update to authenticated
  using (protcivil.es_admin()) with check (protcivil.es_admin());

-- Funciones: nada para nadie, y luego exactamente lo que hace falta.
revoke all on all functions in schema protcivil from public, anon, authenticated;
grant execute on function
  protcivil.pc_entrar(text, text, text, text),
  protcivil.pc_cambiar_clave(text, text, text),
  protcivil.pc_salir(text),
  protcivil.pc_estado(text),
  protcivil.pc_marcar(text, text, double precision, double precision, double precision, text, boolean, uuid, boolean, timestamptz, boolean),
  protcivil.pc_cambiar_estado(text, text, double precision, double precision, double precision, text, uuid),
  protcivil.pc_historial(text, integer),
  protcivil.pc_donde_estoy(text, double precision, double precision, double precision),
  protcivil.pc_version_app()
  to anon, authenticated;
grant execute on function
  protcivil.es_gestor(),
  protcivil.es_admin(),
  protcivil.pc_admin_guardar_funcionario(uuid, text, text, text, text, text, uuid, uuid, text, boolean, text),
  protcivil.pc_admin_resetear_clave(uuid, text),
  protcivil.pc_admin_liberar_telefono(uuid),
  protcivil.pc_admin_marcaje_manual(uuid, text, timestamptz, text),
  protcivil.pc_admin_revisar_servicio(uuid, text, text, timestamptz),
  protcivil.pc_admin_foto(uuid),
  protcivil.pc_admin_anotar_libro(uuid, text, text, uuid),
  protcivil.pc_admin_cumplimiento(date, date),
  protcivil.pc_admin_cuadrante(date, date)
  to authenticated;

-- =====================================================================
-- 7. TIEMPO REAL (tablero en vivo) Y LIMPIEZA DIARIA
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['marcajes', 'servicios', 'estados', 'libro_guardia'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'protcivil' and tablename = t) then
      execute format('alter publication supabase_realtime add table protcivil.%I', t);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'protcivil_limpieza';
    perform cron.schedule('protcivil_limpieza', '17 8 * * *', 'select protcivil.limpiar()');
  end if;
end $$;

-- =====================================================================
-- 8. EL PRIMER ADMINISTRADOR DEL GESTOR
-- =====================================================================
insert into protcivil.gestores (user_id, nombre, rol)
select u.id, 'Carlos Linares', 'admin' from auth.users u where lower(u.email) = 'carlos.linares.es@gmail.com'
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

commit;
