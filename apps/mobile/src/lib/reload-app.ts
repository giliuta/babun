import { DevSettings, Platform } from "react-native";
import * as Updates from "expo-updates";

// ПЕРЕЗАПУСК ПРИЛОЖЕНИЯ ПОСЛЕ СМЕНЫ ЯЗЫКА. Перевод вшит в каждую строку при
// сборке, а часть строк (дни недели, месяцы, подписи статусов) считается один
// раз при старте модуля — язык меняется только новым запуском кода.
//
// Сборка из магазина перезапускается через `expo-updates`; дев-клиент берёт
// код из Metro, и там это делает `DevSettings`; веб — перезагрузка страницы.
export function reloadApp(): void {
  if (Platform.OS === "web") {
    window.location.reload();
    return;
  }
  if (Updates.isEnabled && !__DEV__) {
    Updates.reloadAsync().catch(() => DevSettings.reload());
    return;
  }
  DevSettings.reload();
}
