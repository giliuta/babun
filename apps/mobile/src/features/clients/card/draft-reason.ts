// Why the draft's «Создать клиента» is off — in words, above the button.

/** ПРИЧИНА, ПО КОТОРОЙ КНОПКА ЧЕРНОВИКА ПОГАШЕНА — словами, над ней.
 *  Порядок тот же, что на экране: сперва имя, потом номер, потом дубль.
 *
 *  Имя дубля стоит ПОСЛЕ двоеточия, в именительном: «у Павла Иванова»
 *  требует склонять чужое имя, а склонять его нечем — «у Павел Иванов»
 *  читалось бы поломкой. */
export function draftReasonOf({
  isDraft,
  duplicate,
  fullName,
  e164,
  draftPhoneTyped,
}: {
  isDraft: boolean;
  duplicate: { full_name: string } | null;
  fullName: string;
  e164: string | null;
  draftPhoneTyped: boolean;
}): string | null {
  const duplicateName = duplicate?.full_name.trim() ?? "";
  return !isDraft
    ? null
    : // Номер занят — главная причина: имя дописывать бесполезно, создать
      // всё равно нельзя (дубль не даёт сдать).
      duplicate
      ? duplicateName
        ? `Такой номер уже есть: ${duplicateName}`
        : "Такой номер уже есть"
      : !fullName.trim()
      ? "Впишите имя"
      : e164 === null && draftPhoneTyped
        ? // Номер необязателен (`draftCanSave`), но начатый
          // и не разобранный — ошибка набора: проверка страны и длины
          // (номер должен хоть как-то проверяться).
          "Проверьте номер и код страны"
        : null;
}
