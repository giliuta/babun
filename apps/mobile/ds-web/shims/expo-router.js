// Навигация в Claude Design. Дизайн — статичная страница без маршрутов
// приложения, а блоки (шапка экрана, шторки) зовут useRouter/useFocusEffect.
// Настоящий expo-router без своего корня падал на «назад» («reading
// 'isReady'»), поэтому здесь безопасные пустышки: переходы ничего не делают,
// экран всегда «в фокусе». Включается только при BABUN_DS_WEB=1.
var R = window.React;
var noop = function () {};
var router = {
  back: noop,
  canGoBack: function () { return false; },
  push: noop,
  replace: noop,
  navigate: noop,
  dismiss: noop,
  dismissAll: noop,
  dismissTo: noop,
  setParams: noop,
};
exports.router = router;
exports.useRouter = function () { return router; };
exports.useFocusEffect = function (effect) {
  R.useEffect(function () { return effect(); }, [effect]);
};
exports.useIsFocused = function () { return true; };
exports.useLocalSearchParams = function () { return {}; };
exports.useGlobalSearchParams = function () { return {}; };
exports.usePathname = function () { return "/"; };
exports.useSegments = function () { return []; };
exports.useNavigation = function () {
  return { setOptions: noop, addListener: function () { return noop; }, goBack: noop, canGoBack: function () { return false; } };
};
exports.Link = function (props) { return props.children || null; };
exports.Redirect = function () { return null; };
