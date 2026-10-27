-- «ОГРАНИЧЕНИЯ ЗАПИСЕЙ» ДЕРЖАТ И БОКОВЫЕ ДВЕРИ (аудит 035, cab/R-06).
--
-- Окно «Ограничения» (`calendar.window`: неделя, месяц…) прячет от мастера
-- записи старше окна: `member_appointment_update/copy` отвечают «не найдена»
-- (`member_record_hidden`). Но если номер записи у него остался (кэш, ссылка,
-- старая выдача), три двери работали мимо окна:
--   • заметка записи — `update_master_appointment_safe`;
--   • фото и видео записи — `current_user_can_mutate_appointment_photo`
--     (политики Storage и `appointment_photos`);
--   • SMS по записи — `sms_send_manual`.
-- Оплата — в `20261027225220_appointment_payment_clock_skew.sql` (та же
-- функция `record_appointment_payment`). Теперь все четыре отвечают мастеру
-- за окном так же, как основная дверь. Владельцу окно не применяется.
--
-- Тела правятся по якорям в живых определениях.

do $migration$
declare
  photo text := pg_get_functiondef('public.current_user_can_mutate_appointment_photo(uuid)'::regprocedure);
  photo_old constant text := E'         or (a.kind = ''work''\n             and a.team_id in (select unnest(public.access_calendars(''record.files'', ''write''))))\n';
  photo_new constant text := E'         or (a.kind = ''work''\n             and a.team_id in (select unnest(public.access_calendars(''record.files'', ''write'')))\n             and not public.member_record_hidden(a.kind, a.team_id, a.date))\n';
  note text := pg_get_functiondef('public.update_master_appointment_safe(uuid, jsonb)'::regprocedure);
  note_old constant text := E'     and a.team_id in (select unnest(public.access_calendars(''record.note'', ''write'')))\n   for update;\n';
  note_new constant text := E'     and a.team_id in (select unnest(public.access_calendars(''record.note'', ''write'')))\n     and not public.member_record_hidden(a.kind, a.team_id, a.date)\n   for update;\n';
  sms text := pg_get_functiondef('public.sms_send_manual(uuid, uuid, text, text, text, text)'::regprocedure);
  sms_old constant text := E'     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;\n';
  sms_new constant text := E'     where ap.id = p_appointment_id and ap.tenant_id = v_tenant\n       and (is_owner or not public.member_record_hidden(ap.kind, ap.team_id, ap.date));\n';
begin
  if (length(photo) - length(replace(photo, photo_old, ''))) / length(photo_old) <> 1 then
    raise exception 'current_user_can_mutate_appointment_photo: якорь не найден ровно один раз';
  end if;
  if (length(note) - length(replace(note, note_old, ''))) / length(note_old) <> 1 then
    raise exception 'update_master_appointment_safe: якорь не найден ровно один раз';
  end if;
  if (length(sms) - length(replace(sms, sms_old, ''))) / length(sms_old) <> 1 then
    raise exception 'sms_send_manual: якорь не найден ровно один раз';
  end if;
  execute replace(photo, photo_old, photo_new);
  execute replace(note, note_old, note_new);
  execute replace(sms, sms_old, sms_new);
end;
$migration$;
