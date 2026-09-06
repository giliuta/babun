// Варианты сборки: dev-клиент живёт ПОД СВОИМ bundle id, чтобы установка
// боевого Babun из TestFlight (com.babun.crm) не перезаписывала стройку
// и обе иконки жили на телефоне рядом.
//   APP_VARIANT=development → «Babun Dev», com.babun.crm.dev, scheme babundev
//   без переменной         → боевой Babun как в app.json (релиз/TestFlight)
const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? "Babun Dev" : config.name,
  scheme: IS_DEV ? "babundev" : config.scheme,
  // Local appointment/client reminders need the native notifications module.
  // Keep the APNs entitlement aligned with the signing profile as well, so a
  // later mobile push transport cannot accidentally ship a development
  // entitlement in TestFlight.
  plugins: [
    ...(config.plugins ?? []),
    [
      "expo-notifications",
      { mode: IS_DEV ? "development" : "production" },
    ],
    // Сканер документов (STORY-070, этап 2): VisionKit на iOS. Плагин пишет
    // только текст разрешения камеры; сам модуль нативный — dev-клиент
    // пересобирается, а в JS он подключён через проверку наличия.
    [
      "react-native-document-scanner-plugin",
      { cameraPermission: "Babun использует камеру для фото объектов и сканирования документов" },
    ],
  ],
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV
      ? "com.babun.crm.dev"
      : config.ios?.bundleIdentifier,
  },
});
