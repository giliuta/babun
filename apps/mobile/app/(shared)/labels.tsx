// Метки, открытые из карточки клиента, которая сама лежит ПОВЕРХ записи или
// финансов (`/client`), — сиблинг карточки, а не маршрут вкладки: иначе
// «назад» уводит из записи и теряет набранное (см.
// `features/clients/reference-href.ts`). Экран тот же, права — по команде из
// адреса (`calendar.labels` внутри экрана).
export { LabelsScreen as default } from "@/features/reference/screens/LabelsScreen";
