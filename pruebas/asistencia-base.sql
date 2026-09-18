-- =====================================================================
-- PRUEBAS DE LA BASE DE ASISTENCIA DE PROTECCIÓN CIVIL
--
-- Las corre pruebas/asistencia-base.mjs DENTRO de la misma transacción
-- que aplica sql/asistencia.sql, y terminan SIEMPRE con un error a
-- propósito: así la base deshace todo y no queda ni un dato de prueba en
-- producción. El error trae el resultado, una línea por prueba.
--
-- Cada prueba se hace con el MISMO rol que en la vida real:
--   anon           = el teléfono (sin cuenta de Supabase)
--   authenticated  = el gestor web (con la sesión de Carlos) o un
--                    intruso que tiene cuenta pero no es gestor
-- Así se prueban también los permisos, no solo la lógica.
--
-- Todo lo de prueba lleva cédulas 99000001… y nombres "ZZ": no choca con
-- el personal real. Las coordenadas están en el mar, lejos de cualquier
-- estación real, para que ninguna interfiera.
-- =====================================================================
do $pruebas$
declare
  v_res       text[] := '{}';
  v_carlos    uuid;
  v_intruso   uuid := '00000000-0000-0000-0000-00000000abcd';
  v_est       uuid;
  v_tipo      uuid;
  v_tipo_sem  uuid;
  v_grupo     uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  r           jsonb;
  v_token     text;
  v_token_c   text;
  v_token_d   text;
  v_n         integer;
  v_txt       text;
  v_id1       uuid := gen_random_uuid();
  v_serv      uuid;
  v_serv_viejo uuid;
  v_marc      uuid;
  v_ini_local timestamp;
  v_foto      text := encode('\xffd8ffe000104a464946'::bytea || decode(repeat('00', 700), 'hex'), 'base64');
  v_lat       double precision := 11.5;
  v_lng       double precision := -64.5;
  i           integer;
begin
  -- ================================================================
  -- Preparación (como dueño de la base)
  -- ================================================================
  select id into v_carlos from auth.users where lower(email) = 'carlos.linares.es@gmail.com';
  insert into protcivil.estaciones (nombre, latitud, longitud, radio_m)
  values ('ZZ Estación de prueba', v_lat, v_lng, 80) returning id into v_est;

  -- Una guardia 24x48 que empezó hace 2 horas (hora de Venezuela).
  v_ini_local := date_trunc('minute', (now() at time zone 'America/Caracas') - interval '2 hours');
  insert into protcivil.tipos_guardia (nombre, modalidad, horas_servicio, horas_descanso, hora_inicio, tolerancia_min)
  values ('ZZ 24x48', 'rotativa', 24, 48, v_ini_local::time, 15) returning id into v_tipo;
  insert into protcivil.tipos_guardia (nombre, modalidad, dias_semana, hora_inicio, hora_fin)
  values ('ZZ Oficina', 'semanal', array[1,2,3,4,5]::smallint[], '08:00', '16:00') returning id into v_tipo_sem;
  insert into protcivil.grupos (nombre, tipo_guardia_id, estacion_id, fecha_referencia)
  values ('ZZ Guardia A', v_tipo, v_est, v_ini_local::date) returning id into v_grupo;
  insert into protcivil.grupos (nombre, tipo_guardia_id) values ('ZZ Oficina', v_tipo_sem);

  -- ================================================================
  -- El GESTOR (Carlos, con su sesión) crea al personal
  -- ================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_res := v_res || case when protcivil.es_admin() then 'OK Carlos es administrador del gestor'
                         else 'FALLA Carlos no quedó como administrador del gestor' end;

  r := protcivil.pc_admin_guardar_funcionario(null, '99000001', 'Prueba', 'Uno', 'O.P.C. I', 'fijo', v_grupo, v_est, null, true, 'Inicial#01');
  v_a := (r ->> 'id')::uuid;
  r := protcivil.pc_admin_guardar_funcionario(null, 'V-99.000.002', 'Prueba', 'Dos', null, 'fijo', v_grupo, v_est, null, true, 'Inicial#02');
  v_b := (r ->> 'id')::uuid;
  r := protcivil.pc_admin_guardar_funcionario(null, '99000003', 'Prueba', 'Tres', null, 'voluntario', null, v_est, null, true, 'Inicial#03');
  v_c := (r ->> 'id')::uuid;
  r := protcivil.pc_admin_guardar_funcionario(null, '99000004', 'Prueba', 'Cuatro', null, 'fijo', null, v_est, null, true, 'Inicial#04');
  v_d := (r ->> 'id')::uuid;
  v_res := v_res || case when v_a is not null and v_b is not null and v_c is not null and v_d is not null
                         then 'OK el gestor crea funcionarios (y limpia la cédula V-99.000.002)'
                         else 'FALLA el gestor no pudo crear funcionarios' end;

  begin
    r := protcivil.pc_admin_guardar_funcionario(null, '99000009', 'Prueba', 'Nueve', null, 'fijo', null, null, null, true, '123456');
    v_res := v_res || text 'FALLA el gestor pudo poner 123456 como clave inicial';
  exception when others then
    v_res := v_res || text 'OK una clave inicial fácil (123456) se rechaza';
  end;
  begin
    r := protcivil.pc_admin_guardar_funcionario(null, '99000001', 'Otra', 'Persona', null, 'fijo', null, null, null, true, 'Inicial#99');
    v_res := v_res || text 'FALLA se pudo crear dos veces la misma cédula';
  exception when others then
    v_res := v_res || text 'OK no se puede crear dos veces la misma cédula';
  end;

  select count(*) into v_n from protcivil.funcionarios where cedula like '9900000_';
  v_res := v_res || case when v_n = 4 then 'OK el gestor ve al personal'
                         else format('FALLA el gestor ve %s funcionarios de prueba, esperaba 4', v_n) end;
  begin
    select count(clave_hash) into v_n from protcivil.funcionarios;
    v_res := v_res || text 'FALLA el gestor puede leer la huella de las claves';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el gestor no puede leer la huella de las claves';
  end;
  begin
    select count(*) into v_n from protcivil.sesiones;
    v_res := v_res || text 'FALLA el gestor puede leer las fichas de sesión';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el gestor no puede leer las fichas de sesión';
  end;

  -- ================================================================
  -- Un INTRUSO con cuenta de Supabase que no es gestor
  -- ================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruso, 'role', 'authenticated')::text, true);
  select count(*) into v_n from protcivil.funcionarios;
  v_res := v_res || case when v_n = 0 then 'OK una cuenta que no es gestor no ve a nadie'
                         else format('FALLA una cuenta que no es gestor ve %s funcionarios', v_n) end;
  select count(*) into v_n from protcivil.bitacora;
  v_res := v_res || case when v_n = 0 then 'OK una cuenta que no es gestor no ve la bitácora'
                         else 'FALLA una cuenta que no es gestor ve la bitácora' end;
  begin
    perform protcivil.pc_admin_liberar_telefono(v_a);
    v_res := v_res || text 'FALLA una cuenta que no es gestor pudo liberar un teléfono';
  exception when others then
    v_res := v_res || text 'OK una cuenta que no es gestor no puede liberar teléfonos';
  end;
  begin
    perform protcivil.pc_admin_resetear_clave(v_a, 'Robada#123');
    v_res := v_res || text 'FALLA una cuenta que no es gestor pudo resetear una clave';
  exception when others then
    v_res := v_res || text 'OK una cuenta que no es gestor no puede resetear claves';
  end;
  begin
    insert into protcivil.estaciones (nombre, latitud, longitud) values ('ZZ Intrusa', 0, 0);
    v_res := v_res || text 'FALLA una cuenta que no es gestor pudo crear una estación';
  exception when others then
    v_res := v_res || text 'OK una cuenta que no es gestor no puede crear estaciones';
  end;

  -- ================================================================
  -- El TELÉFONO (anon): lo que NO puede hacer
  -- ================================================================
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into v_n from protcivil.marcajes;
    v_res := v_res || text 'FALLA el teléfono puede leer la tabla de marcajes';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el teléfono no puede leer tablas';
  end;
  begin
    select count(*) into v_n from protcivil.funcionarios;
    v_res := v_res || text 'FALLA el teléfono puede leer la tabla de funcionarios';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el teléfono no puede leer la tabla de funcionarios';
  end;
  begin
    perform protcivil.pc_admin_guardar_funcionario(null, '99000008', 'X', 'Y', null, 'fijo', null, null, null, true, 'Inicial#08');
    v_res := v_res || text 'FALLA el teléfono pudo crear un funcionario';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el teléfono no puede llamar funciones del gestor';
  end;
  begin
    perform protcivil.registrar_marcaje(v_a, 'entrada', now(), 'ok', false, true, null, null, null, null, null, null,
                                        null, null, null, false, null, null);
    v_res := v_res || text 'FALLA el teléfono pudo llamar registrar_marcaje directo, saltándose los candados';
  exception when insufficient_privilege then
    v_res := v_res || text 'OK el teléfono no puede saltarse los candados llamando funciones internas';
  end;

  -- ================================================================
  -- Entrar
  -- ================================================================
  r := protcivil.pc_entrar('99000001', 'mala', 'tel-A', 'Teléfono A');
  v_res := v_res || case when r ->> 'codigo' = 'clave' then 'OK clave errada: no entra'
                         else 'FALLA clave errada: ' || r::text end;
  r := protcivil.pc_entrar('99999999', 'loquesea', 'tel-Z', null);
  v_res := v_res || case when r ->> 'codigo' = 'clave' and r ->> 'mensaje' = 'Cédula o clave incorrecta.'
                         then 'OK cédula que no existe: mismo mensaje que clave errada'
                         else 'FALLA cédula que no existe: ' || r::text end;
  r := protcivil.pc_entrar('V-99.000.001', 'Inicial#01', 'tel-A', 'Teléfono A');
  v_token := r ->> 'token';
  v_res := v_res || case when (r ->> 'ok')::boolean and v_token ~ '^[0-9a-f]{64}$' and (r ->> 'debe_cambiar_clave')::boolean
                         then 'OK entra con la clave correcta, recibe su ficha y se le pide cambiar la clave'
                         else 'FALLA no entra con la clave correcta: ' || r::text end;
  r := protcivil.pc_entrar('99000001', 'Inicial#01', 'tel-OTRO', 'Teléfono prestado');
  v_res := v_res || case when r ->> 'codigo' = 'otro_telefono' then 'OK con la clave correcta pero en otro teléfono, no entra'
                         else 'FALLA entró desde otro teléfono: ' || r::text end;
  for i in 1..5 loop
    perform protcivil.pc_entrar('99000002', 'mala' || i, 'tel-B', null);
  end loop;
  r := protcivil.pc_entrar('99000002', 'Inicial#02', 'tel-B', null);
  v_res := v_res || case when r ->> 'codigo' = 'bloqueado' then 'OK tras 5 claves erradas se bloquea, aunque luego ponga la buena'
                         else 'FALLA no se bloqueó tras 5 claves erradas: ' || r::text end;

  r := protcivil.pc_estado('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK una ficha inventada no sirve'
                         else 'FALLA una ficha inventada sirvió: ' || r::text end;
  r := protcivil.pc_estado(v_token);
  v_res := v_res || case when (r ->> 'ok')::boolean and r -> 'servicio' = 'null'::jsonb
                              and (r -> 'estaciones') @> '[{"nombre": "ZZ Estación de prueba"}]'::jsonb
                              and (r ->> 'ahora_ms')::bigint > 0
                         then 'OK el estado trae estaciones, hora del servidor y ninguna guardia abierta'
                         else 'FALLA estado: ' || r::text end;

  -- ================================================================
  -- Marcar: los candados
  -- ================================================================
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat + 0.01, v_lng, 10, v_foto);
  v_res := v_res || case when r ->> 'codigo' = 'fuera_de_zona' then 'OK a 1 km de la estación no deja marcar'
                         else 'FALLA marcó lejos de la estación: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 500, v_foto);
  v_res := v_res || case when r ->> 'codigo' = 'impreciso' then 'OK un GPS con ± 500 m no sirve para marcar'
                         else 'FALLA marcó con un GPS de ± 500 m: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 10, v_foto, true);
  v_res := v_res || case when r ->> 'codigo' = 'gps_falso' then 'OK con GPS falso no deja marcar'
                         else 'FALLA marcó con GPS falso: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', null, null, null, v_foto);
  v_res := v_res || case when r ->> 'codigo' = 'sin_gps' then 'OK sin ubicación no deja marcar'
                         else 'FALLA marcó sin ubicación: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 10, null);
  v_res := v_res || case when r ->> 'codigo' = 'foto' then 'OK sin foto no deja marcar'
                         else 'FALLA marcó sin foto: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 10, encode(convert_to(repeat('esto no es una foto ', 60), 'UTF8'), 'base64'));
  v_res := v_res || case when r ->> 'codigo' = 'foto' then 'OK algo que no es una foto se rechaza'
                         else 'FALLA aceptó algo que no es una foto: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'descanso', v_lat, v_lng, 10, v_foto);
  v_res := v_res || case when r ->> 'codigo' = 'datos' then 'OK un tipo de marcaje inventado se rechaza'
                         else 'FALLA aceptó un tipo de marcaje inventado: ' || r::text end;

  -- ================================================================
  -- Marcar: la guardia completa
  -- ================================================================
  -- A 90 m del centro, con un radio de 80 m y un GPS de ± 20 m: es
  -- plausible que esté dentro, así que marca.
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat + 0.00081, v_lng, 20, v_foto, false, v_id1);
  v_marc := ((r -> 'marcaje') ->> 'id')::uuid;
  v_res := v_res || case when (r ->> 'ok')::boolean and ((r -> 'marcaje') ->> 'dentro')::boolean
                         then 'OK marca la entrada en el borde, tomando en cuenta el margen del GPS'
                         else 'FALLA no marcó la entrada en el borde: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 10, v_foto, false, v_id1);
  v_res := v_res || case when (r ->> 'ok')::boolean and (r ->> 'repetido')::boolean and ((r -> 'marcaje') ->> 'id')::uuid = v_marc
                         then 'OK si el teléfono reintenta el mismo marcaje, no se duplica'
                         else 'FALLA reintento: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid());
  v_res := v_res || case when r ->> 'codigo' = 'orden' then 'OK no deja marcar dos entradas seguidas'
                         else 'FALLA dejó marcar dos entradas: ' || r::text end;
  r := protcivil.pc_cambiar_estado(v_token, 'en_emergencia', v_lat, v_lng, 10, 'Choque en la vía', gen_random_uuid());
  v_res := v_res || case when (r ->> 'ok')::boolean then 'OK cambia su estado a "en emergencia"'
                         else 'FALLA cambiar estado: ' || r::text end;
  r := protcivil.pc_estado(v_token);
  v_res := v_res || case when (r -> 'servicio') ->> 'estado_operativo' = 'en_emergencia'
                         then 'OK el estado muestra la guardia abierta y "en emergencia"'
                         else 'FALLA estado tras la emergencia: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'salida', v_lat, v_lng, 10, v_foto, false, gen_random_uuid());
  v_res := v_res || case when (r ->> 'ok')::boolean and (r -> 'servicio') ->> 'fin' is not null
                         then 'OK marca la salida y la guardia queda cerrada'
                         else 'FALLA salida: ' || r::text end;
  r := protcivil.pc_marcar(v_token, 'salida', v_lat, v_lng, 10, v_foto, false, gen_random_uuid());
  v_res := v_res || case when r ->> 'codigo' = 'orden' then 'OK no deja marcar salida sin entrada'
                         else 'FALLA dejó marcar salida sin entrada: ' || r::text end;
  r := protcivil.pc_cambiar_estado(v_token, 'en_emergencia', null, null, null, null, gen_random_uuid());
  v_res := v_res || case when r ->> 'codigo' = 'orden' then 'OK fuera de guardia no puede cambiar su estado'
                         else 'FALLA cambió su estado fuera de guardia: ' || r::text end;
  r := protcivil.pc_historial(v_token);
  v_res := v_res || case when jsonb_array_length(r -> 'servicios') = 1 then 'OK el historial trae su guardia'
                         else 'FALLA historial: ' || r::text end;

  -- ================================================================
  -- Sin señal (funcionario C)
  -- ================================================================
  r := protcivil.pc_entrar('99000003', 'Inicial#03', 'tel-C', null);
  v_token_c := r ->> 'token';
  r := protcivil.pc_estado(v_token_c);
  v_res := v_res || case when (r ->> 'ok')::boolean and r -> 'proxima_guardia' = 'null'::jsonb
                         then 'OK el estado funciona para quien todavía no tiene grupo de guardia'
                         else 'FALLA estado sin grupo de guardia: ' || r::text end;
  r := protcivil.pc_marcar(v_token_c, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid(), true, now() + interval '1 hour', true);
  v_res := v_res || case when r ->> 'codigo' = 'hora' then 'OK sin señal: una hora en el futuro se rechaza'
                         else 'FALLA sin señal, hora futura: ' || r::text end;
  r := protcivil.pc_marcar(v_token_c, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid(), true, now() - interval '50 hours', true);
  v_res := v_res || case when r ->> 'codigo' = 'hora' then 'OK sin señal: un marcaje de hace 50 horas ya no se acepta'
                         else 'FALLA sin señal, marcaje viejo: ' || r::text end;
  r := protcivil.pc_marcar(v_token_c, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid(), true, null, true);
  v_res := v_res || case when r ->> 'codigo' = 'datos' then 'OK sin señal y sin hora se rechaza'
                         else 'FALLA sin señal y sin hora: ' || r::text end;
  r := protcivil.pc_marcar(v_token_c, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid(), true, now() - interval '2 hours', false);
  v_res := v_res || case when (r ->> 'ok')::boolean and (r -> 'marcaje') ->> 'revision' = 'por_revisar'
                              and (r -> 'servicio') ->> 'estado' = 'por_revisar'
                              and ((r -> 'marcaje') ->> 'momento')::timestamptz < now() - interval '119 minutes'
                         then 'OK sin señal y con hora dudosa: se acepta con su hora, pero queda por revisar'
                         else 'FALLA sin señal con hora dudosa: ' || r::text end;
  r := protcivil.pc_marcar(v_token_c, 'salida', v_lat, v_lng, 10, v_foto, false, gen_random_uuid(), true, now() - interval '3 hours', true);
  v_res := v_res || case when r ->> 'codigo' = 'orden' then 'OK una salida anterior a la entrada se rechaza'
                         else 'FALLA salida anterior a la entrada: ' || r::text end;

  -- ================================================================
  -- Cambiar la clave
  -- ================================================================
  r := protcivil.pc_cambiar_clave(v_token_c, 'mala', 'NuevaClave#9');
  v_res := v_res || case when r ->> 'codigo' = 'clave' then 'OK para cambiar la clave hay que saber la actual'
                         else 'FALLA cambió la clave sin la actual: ' || r::text end;
  r := protcivil.pc_cambiar_clave(v_token_c, 'Inicial#03', '123456');
  v_res := v_res || case when r ->> 'codigo' = 'clave_debil' then 'OK no acepta 123456 como clave nueva'
                         else 'FALLA aceptó 123456: ' || r::text end;
  r := protcivil.pc_cambiar_clave(v_token_c, 'Inicial#03', '99000003');
  v_res := v_res || case when r ->> 'codigo' = 'clave_debil' then 'OK no acepta la cédula como clave'
                         else 'FALLA aceptó la cédula como clave: ' || r::text end;
  r := protcivil.pc_cambiar_clave(v_token_c, 'Inicial#03', 'NuevaClave#9');
  v_res := v_res || case when (r ->> 'ok')::boolean then 'OK cambia la clave'
                         else 'FALLA no cambió la clave: ' || r::text end;
  r := protcivil.pc_entrar('99000003', 'Inicial#03', 'tel-C', null);
  v_res := v_res || case when r ->> 'codigo' = 'clave' then 'OK la clave vieja ya no sirve'
                         else 'FALLA la clave vieja sigue sirviendo: ' || r::text end;
  r := protcivil.pc_entrar('99000003', 'NuevaClave#9', 'tel-C', null);
  v_res := v_res || case when (r ->> 'ok')::boolean and not (r ->> 'debe_cambiar_clave')::boolean
                         then 'OK entra con la clave nueva y ya no se le pide cambiarla'
                         else 'FALLA con la clave nueva: ' || r::text end;
  v_txt := v_token_c;
  v_token_c := r ->> 'token';
  r := protcivil.pc_estado(v_txt);
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK al entrar de nuevo, la ficha anterior deja de servir'
                         else 'FALLA la ficha anterior sigue sirviendo: ' || r::text end;

  -- Candado de respaldo: si el teléfono autorizado cambia por cualquier
  -- camino (hoy solo lo cambia el jefe, que además cierra las sesiones),
  -- la ficha del teléfono anterior deja de valer igual.
  perform set_config('role', 'postgres', true);
  update protcivil.funcionarios set dispositivo_autorizado = 'otro-telefono' where id = v_c;
  perform set_config('role', 'anon', true);
  r := protcivil.pc_estado(v_token_c);
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK si cambia el teléfono autorizado, la ficha del anterior no sirve'
                         else 'FALLA la ficha sirvió con otro teléfono autorizado: ' || r::text end;
  perform set_config('role', 'postgres', true);
  update protcivil.funcionarios set dispositivo_autorizado = 'tel-C' where id = v_c;
  perform set_config('role', 'anon', true);

  -- ================================================================
  -- Lo que hace el JEFE desde el gestor
  -- ================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  r := protcivil.pc_admin_liberar_telefono(v_a);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  r := protcivil.pc_estado(v_token);
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK al liberar el teléfono, la ficha de ese teléfono deja de servir'
                         else 'FALLA la ficha sigue sirviendo tras liberar el teléfono: ' || r::text end;
  r := protcivil.pc_entrar('99000001', 'Inicial#01', 'tel-NUEVO', 'Teléfono nuevo');
  v_res := v_res || case when (r ->> 'ok')::boolean then 'OK con el teléfono liberado, entra desde uno nuevo'
                         else 'FALLA no entra desde el teléfono nuevo: ' || r::text end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  r := protcivil.pc_admin_resetear_clave(v_c, 'Temporal#77');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  r := protcivil.pc_estado(v_token_c);
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK al resetear la clave se cierra la sesión del teléfono'
                         else 'FALLA la sesión siguió abierta tras resetear la clave: ' || r::text end;
  r := protcivil.pc_entrar('99000003', 'Temporal#77', 'tel-C', null);
  v_res := v_res || case when (r ->> 'ok')::boolean and (r ->> 'debe_cambiar_clave')::boolean
                         then 'OK entra con la clave que puso el jefe y se le pide cambiarla'
                         else 'FALLA tras el reseteo: ' || r::text end;

  -- Marcaje a mano de hace 40 horas: el funcionario olvidó la salida.
  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    r := protcivil.pc_admin_marcaje_manual(v_d, 'entrada', now() - interval '40 hours', 'x');
    v_res := v_res || text 'FALLA un marcaje a mano sin motivo se aceptó';
  exception when others then
    v_res := v_res || text 'OK un marcaje a mano exige motivo';
  end;
  r := protcivil.pc_admin_marcaje_manual(v_d, 'entrada', now() - interval '40 hours', 'Se le dañó el teléfono');
  v_serv_viejo := ((r -> 'servicio') ->> 'id')::uuid;
  v_res := v_res || case when (r ->> 'ok')::boolean then 'OK el jefe registra una entrada a mano'
                         else 'FALLA marcaje a mano: ' || r::text end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  r := protcivil.pc_entrar('99000004', 'Inicial#04', 'tel-D', null);
  v_token_d := r ->> 'token';
  r := protcivil.pc_marcar(v_token_d, 'entrada', v_lat, v_lng, 10, v_foto, false, gen_random_uuid());
  v_res := v_res || case when (r ->> 'ok')::boolean
                         then 'OK con una guardia olvidada de hace 40 horas, deja marcar la entrada nueva'
                         else 'FALLA la guardia olvidada bloquea la entrada nueva: ' || r::text end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from protcivil.servicios s
   where s.id = v_serv_viejo and s.cierre = 'automatico' and s.estado = 'por_revisar' and s.fin = s.inicio;
  v_res := v_res || case when v_n = 1 then 'OK la guardia olvidada se cierra sola en 0 horas y queda por revisar (no se inventan horas)'
                         else 'FALLA la guardia olvidada no quedó como se esperaba' end;
  r := protcivil.pc_admin_revisar_servicio(v_serv_viejo, 'valido', 'Salió a las 7 am, según el libro de guardia',
                                           now() - interval '16 hours');
  select count(*) into v_n from protcivil.servicios s
   where s.id = v_serv_viejo and s.cierre = 'manual' and s.estado = 'valido' and s.fin > s.inicio;
  v_res := v_res || case when v_n = 1 then 'OK el jefe corrige la hora de salida con una nota'
                         else 'FALLA la corrección del jefe no quedó' end;

  v_txt := protcivil.pc_admin_foto(v_marc);
  v_res := v_res || case when v_txt like 'data:image/jpeg;base64,%' then 'OK el jefe ve la foto del marcaje'
                         else 'FALLA la foto no se puede ver' end;
  r := protcivil.pc_admin_anotar_libro(v_est, 'novedad', 'Sin novedad en la guardia');
  v_res := v_res || case when (r ->> 'ok')::boolean then 'OK el jefe anota en el libro de guardia'
                         else 'FALLA libro de guardia' end;
  select count(*) into v_n from protcivil.bitacora where accion = 'gps_falso' and actor_id = v_a;
  v_res := v_res || case when v_n = 1 then 'OK el intento con GPS falso quedó en la bitácora aunque se rechazó'
                         else format('FALLA intentos con GPS falso en la bitácora: %s', v_n) end;
  select count(*) into v_n from protcivil.bitacora where accion = 'marcaje_rechazado' and actor_id = v_a;
  v_res := v_res || case when v_n >= 3 then 'OK los marcajes rechazados quedan en la bitácora'
                         else format('FALLA marcajes rechazados en la bitácora: %s', v_n) end;
  select count(*) into v_n from protcivil.intentos_entrada where cedula = '99000002' and not exito;
  v_res := v_res || case when v_n = 6 then 'OK los 5 intentos fallidos y el bloqueo quedaron anotados'
                         else format('FALLA intentos anotados de la cédula bloqueada: %s', v_n) end;

  -- Calendario: 24x48 → una guardia cada 72 horas.
  select count(*), min(extract(epoch from (siguiente - inicio)) / 3600)::integer into v_n, i
    from (select gp.inicio, lead(gp.inicio) over (order by gp.inicio) as siguiente
            from protcivil.pc_admin_cuadrante(v_ini_local::date, v_ini_local::date + 8) gp
           where gp.grupo = 'ZZ Guardia A') x;
  v_res := v_res || case when v_n = 3 and i = 72 then 'OK 24x48: tres guardias en 9 días, cada 72 horas'
                         else format('FALLA 24x48: %s guardias, separadas %s horas', v_n, i) end;
  select count(*) into v_n from protcivil.pc_admin_cuadrante(date '2026-09-21', date '2026-09-27') gp where gp.grupo = 'ZZ Oficina';
  v_res := v_res || case when v_n = 5 then 'OK horario de oficina: 5 días de lunes a viernes'
                         else format('FALLA horario de oficina: %s días', v_n) end;
  select count(*) into v_n from protcivil.pc_admin_cuadrante(date '2026-09-21', date '2026-09-27') gp
   where gp.grupo = 'ZZ Oficina' and to_char(gp.inicio at time zone 'America/Caracas', 'HH24:MI') = '08:00';
  v_res := v_res || case when v_n = 5 then 'OK horario de oficina: empieza a las 8:00 hora de Venezuela'
                         else 'FALLA horario de oficina: la hora de inicio no es 8:00 en Venezuela' end;

  -- Cumplimiento: la guardia empezó hace 2 horas; A marcó recién (tarde),
  -- B no ha marcado (la guardia sigue en curso).
  select c.estado || ':' || coalesce(c.minutos_tarde, -1) into v_txt
    from protcivil.pc_admin_cumplimiento(v_ini_local::date, (now() at time zone 'America/Caracas')::date) c
   where c.funcionario_id = v_a and c.inicio_programado = (v_ini_local at time zone 'America/Caracas');
  v_res := v_res || case when v_txt ~ '^tarde:1(1[5-9]|2[0-5])$' then 'OK cumplimiento: quien marcó 2 horas después sale "tarde", ~120 minutos'
                         else 'FALLA cumplimiento de A: ' || coalesce(v_txt, 'sin fila') end;
  select c.estado into v_txt
    from protcivil.pc_admin_cumplimiento(v_ini_local::date, (now() at time zone 'America/Caracas')::date) c
   where c.funcionario_id = v_b and c.inicio_programado = (v_ini_local at time zone 'America/Caracas');
  v_res := v_res || case when v_txt = 'en_curso' then 'OK cumplimiento: quien no ha marcado una guardia en curso sale "en curso"'
                         else 'FALLA cumplimiento de B: ' || coalesce(v_txt, 'sin fila') end;

  -- ================================================================
  -- La cuenta PUENTE del panel de Protección Civil
  -- ================================================================
  perform set_config('role', 'postgres', true);
  update protcivil.gestores set es_puente = true where user_id = v_carlos;
  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-pc-actor": "QW5hIEplZmEgTsO6w7FleiAoYW5hQHBjKQ=="}', true);
  perform set_config('role', 'authenticated', true);
  r := protcivil.pc_admin_anotar_libro(v_est, 'novedad', 'Anotación que llega por el puente');
  perform set_config('role', 'postgres', true);
  select autor_nombre into v_txt from protcivil.libro_guardia where texto = 'Anotación que llega por el puente';
  v_res := v_res || case when v_txt = 'Ana Jefa Núñez (ana@pc)' then 'OK por el puente, en el libro queda el nombre de la persona real'
                         else 'FALLA por el puente quedó: ' || coalesce(v_txt, 'nada') end;
  update protcivil.gestores set es_puente = false where user_id = v_carlos;
  perform set_config('role', 'authenticated', true);
  r := protcivil.pc_admin_anotar_libro(v_est, 'novedad', 'Anotación de una cuenta normal');
  perform set_config('role', 'postgres', true);
  select autor_nombre into v_txt from protcivil.libro_guardia where texto = 'Anotación de una cuenta normal';
  v_res := v_res || case when v_txt = 'Carlos Linares' then 'OK una cuenta que no es el puente no puede fingir otro nombre con la cabecera'
                         else 'FALLA una cuenta normal fingió el nombre: ' || coalesce(v_txt, 'nada') end;
  perform set_config('request.headers', '', true);

  -- ================================================================
  -- ¿Puedo marcar desde aquí? y la versión de la app (teléfono)
  -- ================================================================
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  r := protcivil.pc_donde_estoy(v_token_d, v_lat + 0.0002, v_lng, 10);
  v_res := v_res || case when (r ->> 'puede')::boolean and r ->> 'estacion' = 'ZZ Estación de prueba' and (r ->> 'radio_m')::int = 80
                         then 'OK "¿puedo marcar?" dentro de la estación dice que sí, con la estación y su radio'
                         else 'FALLA ¿puedo marcar? dentro: ' || r::text end;
  r := protcivil.pc_donde_estoy(v_token_d, v_lat + 0.01, v_lng, 10);
  v_res := v_res || case when not (r ->> 'puede')::boolean and r ->> 'codigo' = 'fuera_de_zona' and (r ->> 'distancia_m')::int between 1000 and 1200
                         then 'OK "¿puedo marcar?" a 1 km dice que no, y a cuántos metros está'
                         else 'FALLA ¿puedo marcar? lejos: ' || r::text end;
  r := protcivil.pc_donde_estoy('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', v_lat, v_lng, 10);
  v_res := v_res || case when r ->> 'codigo' = 'sesion' then 'OK "¿puedo marcar?" sin sesión no responde nada'
                         else 'FALLA ¿puedo marcar? sin sesión: ' || r::text end;
  r := protcivil.pc_version_app();
  v_res := v_res || case when (r ->> 'codigo')::int >= 1 and r ->> 'enlace' like 'https://%' then 'OK la versión de la app se consulta sin haber entrado'
                         else 'FALLA versión de la app: ' || coalesce(r::text, 'nada') end;
  r := protcivil.pc_estado(v_token_d);
  v_res := v_res || case when ((r -> 'reglas') ->> 'tolerancia_gps_m')::int = 25 then 'OK la app recibe el margen del GPS que usa la base'
                         else 'FALLA reglas de la app: ' || coalesce((r -> 'reglas')::text, 'nada') end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_carlos, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- ================================================================
  -- Lo que no se puede borrar ni cambiar (ni siquiera como dueño)
  -- ================================================================
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
  begin
    update protcivil.bitacora set accion = 'otra' where actor_id = v_a;
    v_res := v_res || text 'FALLA la bitácora se pudo modificar';
  exception when others then
    v_res := v_res || text 'OK la bitácora no se puede modificar';
  end;
  begin
    update protcivil.marcajes set momento = momento - interval '1 day' where funcionario_id = v_a;
    v_res := v_res || text 'FALLA la hora de un marcaje se pudo cambiar';
  exception when others then
    v_res := v_res || text 'OK la hora de un marcaje no se puede cambiar';
  end;
  begin
    delete from protcivil.marcajes where funcionario_id = v_a;
    v_res := v_res || text 'FALLA un marcaje se pudo borrar';
  exception when others then
    v_res := v_res || text 'OK un marcaje no se puede borrar';
  end;
  begin
    update protcivil.libro_guardia set texto = 'cambiado' where estacion_id = v_est;
    v_res := v_res || text 'FALLA el libro de guardia se pudo modificar';
  exception when others then
    v_res := v_res || text 'OK el libro de guardia no se puede modificar';
  end;
  select count(*) into v_n from protcivil.fotos f join protcivil.marcajes m on m.id = f.marcaje_id where m.funcionario_id = v_a;
  v_res := v_res || case when v_n = 2 then 'OK se guardaron las 2 fotos de A (entrada y salida)'
                         else format('FALLA fotos de A: %s', v_n) end;
  select count(*) into v_n from protcivil.sesiones where encode(token_hash, 'hex') = v_token or token_hash::text like '%' || v_token || '%';
  v_res := v_res || case when v_n = 0 then 'OK la ficha de sesión no se guarda tal cual, solo su huella'
                         else 'FALLA la ficha de sesión está guardada tal cual' end;
  select count(*) into v_n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'protcivil';
  v_res := v_res || case when v_n = 4 then 'OK el tablero en vivo recibe marcajes, guardias, estados y libro'
                         else format('FALLA tablas en tiempo real: %s', v_n) end;
  select count(*) into v_n from cron.job where jobname = 'protcivil_limpieza';
  v_res := v_res || case when v_n = 1 then 'OK la limpieza diaria de fotos viejas quedó programada'
                         else 'FALLA la limpieza diaria no quedó programada' end;

  raise exception 'RESULTADO_PRUEBAS%', E'\n' || array_to_string(v_res, E'\n');
end $pruebas$;
