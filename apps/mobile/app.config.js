// Варианты сборки: dev-клиент живёт ПОД СВОИМ bundle id, чтобы установка
// боевого Babun из TestFlight (com.babun.crm) не перезаписывала стройку
// и обе иконки жили на телефоне рядом.
//   APP_VARIANT=development → «Babun Dev», com.babun.crm.dev, scheme babundev
//   без переменной         → боевой Babun как в app.json (релиз/TestFlight)
const IS_DEV = process.env.APP_VARIANT === "development";

// ССЫЛКИ НА babun.app ОТКРЫВАЮТ ПРИЛОЖЕНИЕ (04.10, выпуск в магазины).
// Кнопки писем Babun и приглашения партнёру ведут на https://babun.app —
// на телефоне с Babun такие адреса открываются сразу в приложении, без
// браузера. Только эти пути: оплата (/pay) и страницы для клиентов (/r, /l)
// остаются сайтом. Пара на сайте — public/.well-known (apple-app-site-
// association, assetlinks.json); dev-клиент живёт под другим bundle id и
// домен не берёт.
const APP_LINK_PATHS = ["/invite", "/reset-password", "/login"];

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
    // Android draws the notification icon as a white silhouette, tinted
    // with `color`; iOS uses the app icon.
    [
      "expo-notifications",
      {
        mode: IS_DEV ? "development" : "production",
        icon: "./assets/notification-icon.png",
        color: "#2c5be0",
      },
    ],
    // Сканер документов (STORY-070, этап 2): VisionKit на iOS. Плагин пишет
    // только текст разрешения камеры; сам модуль нативный — dev-клиент
    // пересобирается, а в JS он подключён через проверку наличия.
    [
      "react-native-document-scanner-plugin",
      { cameraPermission: "Babun использует камеру для фото объектов и сканирования документов" },
    ],
  ],
  // КАРТА НА ANDROID (выпуск в Google Play, 04.10): там у react-native-maps
  // один провайдер — Google, и без ключа карта точки объекта пустая. Ключ —
  // переменная окружения EAS (`GOOGLE_MAPS_ANDROID_API_KEY`, окружение
  // production), а не строка в git. На iOS карта по-прежнему Apple: ключ туда
  // намеренно не кладём — `ios.config.googleMapsApiKey` переключил бы
  // MapPicker на провайдер Google без его SDK в сборке.
  android: {
    ...config.android,
    ...(IS_DEV
      ? null
      : {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              data: APP_LINK_PATHS.map((pathPrefix) => ({
                scheme: "https",
                host: "babun.app",
                pathPrefix,
              })),
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }),
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? { config: { ...config.android?.config, googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } } }
      : null),
  },
  ios: {
    ...config.ios,
    ...(IS_DEV ? null : { associatedDomains: ["applinks:babun.app"] }),
    bundleIdentifier: IS_DEV
      ? "com.babun.crm.dev"
      : config.ios?.bundleIdentifier,
  },
});
