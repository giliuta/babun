import { ObjectTypesScreen } from "@/features/clients/ObjectTypesScreen";
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";

// Типы объектов («Вилла», «Дом») — тот же экран, что в Кабинете, но ВНУТРИ
// таба «Клиенты»: справочники карточки настраиваются из
// настроек клиентов. Ссылка в чужой таб ломала возврат: «назад» уводил в
// Кабинет/Календарь, а не в настройки, откуда пришли.
//
// Здесь — за правом строки «Типы объектов» команды: партнёр
// с «Только видит» смотрит список, с «Видит и меняет» правит.
export default function ClientObjectTypesRoute() {
  return (
    <ClientSettingsRoute row="objects">
      <ObjectTypesScreen />
    </ClientSettingsRoute>
  );
}
