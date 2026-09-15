import { useCallback } from "react";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
  type Href,
} from "expo-router";
import { financeAccountsHref } from "@/features/finances/accounts-sections";

// СПИСКА СЧЕТОВ БОЛЬШЕ НЕТ — СЧЕТА ЖИВУТ НА «ФИНАНСАХ» (владелец 2026-09-15:
// «справа сделай строчки. Я нажимаю на эти строчки — перекидывается именно на
// страницу»). Остатки, лента операций счёта, добавление и перевод — панель
// «Счета» на «Финансах»; порядок, скрытие, добавление и закрытые счета —
// страница «Счета» (`accounts/settings`) за ползунками панели и шестерёнкой
// «Финансов». Этот адрес по-прежнему ведёт на панель: так его помнят тосты.
//
// Файл остаётся ради НАВИГАЦИИ: старые адреса `/accounts` и `/accounts?team=`
// живут в тостах, уведомлениях и чужих сборках, и ни одна дверь не имеет
// права упереться в пустоту. Команда из адреса передаётся дальше — тост
// «календарю созданы счета» обязан открыть счета именно этой команды.
//
// НЕ `<Redirect>` (разбор 2026-09-15). Он делает `replace` в корневом стеке, а
// вкладки уже лежат под этой страницей: вместо «Финансов» на месте `accounts`
// рождалась ВТОРАЯ копия всех вкладок со всеми их запросами. Когда вкладки
// под нами есть — возвращаемся к ним (`dismissTo`), и адрес переключает уже
// смонтированные «Финансы». Холодная ссылка, вкладок под нами нет — тогда
// `replace`: страница-указатель не должна остаться в истории.
export default function AccountsRoute() {
  const router = useRouter();
  const navigation = useNavigation();
  const { team } = useLocalSearchParams<{ team?: string | string[] }>();
  const teamId = Array.isArray(team) ? team[0] : team;
  const href = financeAccountsHref(teamId) as Href;
  useFocusEffect(
    useCallback(() => {
      const tabsBelow = navigation
        .getState()
        ?.routes.some((route) => route.name === "(dashboard)");
      if (tabsBelow) router.dismissTo(href);
      else router.replace(href);
    }, [href, navigation, router]),
  );
  return null;
}
