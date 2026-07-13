// Варианты сборки: dev-клиент живёт ПОД СВОИМ bundle id, чтобы установка
// боевого Babun из TestFlight (com.babun.crm) не перезаписывала стройку
// и обе иконки жили на телефоне рядом.
//   APP_VARIANT=development → «Babun Dev», com.babun.crm.dev, scheme babundev
//   без переменной         → боевой Babun как в app.json (релиз/TestFlight)
const base = require("./app.json").expo;
const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = {
  ...base,
  name: IS_DEV ? "Babun Dev" : base.name,
  scheme: IS_DEV ? "babundev" : base.scheme,
  ios: {
    ...base.ios,
    bundleIdentifier: IS_DEV ? "com.babun.crm.dev" : base.ios.bundleIdentifier,
  },
};
