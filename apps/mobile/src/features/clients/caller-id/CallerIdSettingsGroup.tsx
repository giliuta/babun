import { Linking } from "react-native";
import { PhoneIncoming, Settings } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SettingsGroup } from "@/features/clients/settings-page/SettingsGroup";
import { callerIdNative } from "./caller-id-native";
import { useCallerIdOn, useCallerIdStatus, useSetCallerIdOn } from "./caller-id-store";

// «ЗВОНКИ» в шестерёнке клиентов: имя клиента на экране входящего звонка.
//
// Настройка телефона, а не команды, — у всех чипов ленты одна и та же.
// Права не нужны свои: телефон подписывает ровно тех клиентов и те номера,
// что человеку уже отдаёт сервер (RLS клиентов и уровень «Телефоны»);
// скрытый номер в базу не попадает, потому что его нет в ответе.
//
// Включить мало: iOS спрашивает человека отдельно, в Настройках → Телефон →
// «Блокировка и идентификация вызовов». Пока там выключено, под строкой —
// дверь прямо на ту страницу Настроек. Сборка без расширения строку не
// показывает вовсе.

export function CallerIdSettingsGroup() {
  if (!callerIdNative) return null;
  return <CallerIdRows />;
}

function CallerIdRows() {
  const on = useCallerIdOn().data === true;
  const setOn = useSetCallerIdOn();
  const status = useCallerIdStatus().data;
  const needsSystem = on && status !== undefined && status !== "enabled";

  const openSystemSettings = () => {
    void (async () => {
      try {
        await callerIdNative?.openSettings();
      } catch {
        // iOS старше 13.4 или ссылка не открылась — хотя бы настройки Babun.
        await Linking.openSettings();
      }
    })();
  };

  return (
    <SettingsGroup
      title="Звонки"
      rows={[
        <SettingsRow
          key="caller-id"
          tile={SETTINGS_TILE.green}
          icon={PhoneIncoming}
          title="Имя клиента при звонке"
          sub={
            !on
              ? "Для номеров не из контактов"
              : needsSystem
                ? "Выключено в настройках iPhone"
                : "Включено на этом iPhone"
          }
          toggle={{ value: on, onChange: (value) => setOn.mutate(value) }}
        />,
        needsSystem ? (
          <SettingsRow
            key="caller-id-system"
            tile={SETTINGS_TILE.blue}
            icon={Settings}
            title="Включить в настройках iPhone"
            sub="Телефон → Блокировка и идентификация вызовов → Babun"
            stacked
            onPress={openSystemSettings}
          />
        ) : null,
      ]}
    />
  );
}
