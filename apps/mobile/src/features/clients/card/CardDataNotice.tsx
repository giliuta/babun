import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import type { ClientCard } from "./use-client-card";

/** One notice for everything that did not load, with one «Повторить». */
export function CardDataNotice({ card }: { card: ClientCard }) {
  const {
    staleCopy,
    partFailed,
    isDraft,
    clientFailed,
    retryClient,
    retryAppointments,
    retryTags,
    retryServices,
    tagsRetrying,
    clientRetrying,
    appointmentsRetrying,
    servicesRetrying,
  } = card;
  return (
    <>
      {/* ОДНА ПЛАШКА, ОДНА КНОПКА. На молчащем сервере падают сразу и
          клиент, и история со справочниками — раньше вставали две плашки
          подряд с двумя синими кнопками («Загружаю…» и «Повторить»),
          делавшими одно и то же. Теперь одна: слова — про худшее из
          случившегося, «Повторить» — перечитывает всё упавшее разом. */}
      {staleCopy || partFailed ? (
        <ClientDataNotice
          title={staleCopy ? "Показана сохранённая копия" : "Часть данных не загрузилась"}
          message={
            staleCopy
              ? partFailed
                ? "Свежие изменения, история записей и справочники пока не загрузились. Карточка остаётся доступной."
                : "Свежие изменения пока не удалось получить. Карточка остаётся доступной."
              : isDraft
                ? "Каталог тегов пока недоступен. Остальные данные можно заполнить и сохранить."
                : "История записей, финансы или справочники могут быть неполными."
          }
          onRetry={() => {
            if (isDraft) void retryTags();
            else
              void Promise.all([
                ...(clientFailed ? [retryClient()] : []),
                retryAppointments(),
                retryTags(),
                retryServices(),
              ]);
          }}
          retrying={
            tagsRetrying ||
            (!isDraft && (clientRetrying || appointmentsRetrying || servicesRetrying))
          }
        />
      ) : null}
    </>
  );
}
