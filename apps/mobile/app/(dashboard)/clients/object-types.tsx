import { ObjectTypesScreen } from "@/features/reference/screens/ObjectTypesScreen";
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";

// Типы объектов («Вилла», «Дом») — тот же экран, что в Кабинете, но ВНУТРИ
// таба «Клиенты» (владелец 2026-08-02: справочники карточки настраиваются из
// настроек клиентов). Ссылка в чужой таб ломала возврат: «назад» уводил в
// Кабинет/Календарь, а не в настройки, откуда пришли.
//
// Здесь — за правом строки «Типы объектов» команды (владелец 01.10): партнёр
// с «Только видит» смотрит список, с «Видит и меняет» правит.
export default function ClientObjectTypesRoute() {
  return (
    <ClientSettingsRoute row="objects">
      <ObjectTypesScreen />
    </ClientSettingsRoute>
  );
}
