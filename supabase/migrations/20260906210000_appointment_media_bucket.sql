-- STORY-070, этап 2б: видео в файлах записи.
-- Бакет appointment-photos принимал только картинки до 5 МБ. Владелец
-- 2026-09-06: «фото-видео фиксация». Добавляем видео и поднимаем лимит:
-- минута с телефона в 1080p — 60–120 МБ, поэтому 50 МБ — потолок для
-- коротких роликов, длинные пусть жмут камерой. Политики доступа не меняются:
-- путь тот же (<tenant_id>/<appointment_id>/<id>.<ext>).

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime'
    ]
where id = 'appointment-photos';
