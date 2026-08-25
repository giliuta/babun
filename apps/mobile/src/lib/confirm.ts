import { chooseOption } from "@/lib/choose";

// ПОДТВЕРЖДЕНИЕ — ТЕМ ЖЕ НИЖНИМ ЛИСТОМ, ЧТО И ВЫБОР.
//
// Было: `Alert.alert(title, message, [Отмена, Удалить])`. На вебе это пустая
// функция (react-native-web: `static alert() {}`) — окно не появлялось, а
// `onPress` разрушительной кнопки не вызывался НИКОГДА. То есть «Удалить» и
// «Аннулировать» в браузере просто не работали, и выглядело это как сломанная
// кнопка, а не как отказ.
//
// Здесь ровно та же дорога, что у chooseOption: канонический нижний лист с
// «Отменой» внизу, а на iOS — запасной ActionSheetIOS, если хост не
// смонтирован. Экраны про платформу снова ничего не знают.
export async function confirmAction(
  title: string,
  opts: { message?: string; confirmLabel: string; destructive?: boolean },
): Promise<boolean> {
  const index = await chooseOption(
    title,
    [{ label: opts.confirmLabel, destructive: opts.destructive }],
    { message: opts.message, haptic: false },
  );
  return index === 0;
}

// «СПРОСИТЬ И СДЕЛАТЬ» — та же дорога, но без ответа на руках.
//
// Почти каждое место вызова выглядело одинаково: два пункта, «Отмена» ничего
// не делает, а второй запускает действие. Через confirmAction это каждый раз
// превращалось бы в `void confirmAction(...).then((ok) => { if (!ok) return;
// … })` — четыре служебные строки вокруг одной содержательной, сорок раз
// подряд. Здесь они написаны ОДИН раз.
//
// confirmAction остаётся для случаев, где ответ нужен самому вызывающему:
// когда «Отмена» тоже что-то делает или когда ждут решения внутри async-цепи.
export function confirmThen(
  title: string,
  opts: { message?: string; confirmLabel: string; destructive?: boolean },
  onConfirm: () => void | Promise<void>,
): void {
  void confirmAction(title, opts).then((ok) => {
    if (ok) return onConfirm();
  });
}
