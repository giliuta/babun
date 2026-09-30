import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import type { DraftLinkParams } from "@/features/clients/useClientDraft";

// «РАЗДЕЛИТЬ КЛИЕНТА» — ЧИСТОЕ ЯДРО (STORY-086, сценарий ж «Сплит»).
//
// Владелец: «как сделать сплит людей». Случай: в карточке Павла лежит второй
// номер, а это на самом деле жена. Модель уже есть — каждый человек отдельный
// клиент, связь живёт у члена (`memberships`), — поэтому сплит не заводит
// ничего нового: номер уезжает черновиком нового клиента со связью «· Павел»,
// а после создания уходит из карточки Павла.
//
// Здесь только решения, без React и сети: какие номера можно вынести, что
// едет адресом в черновик и каким патчем номер уходит из исходной. Импорты —
// только типы, чтобы сторож (`split-client.test.ts`) звал функции в bun.

/** Номера, которые можно вынести отдельным человеком: дополнительные и не
 *  пустые. Пустая строка номера — недописанное поле, а не человек: вынести
 *  её значило бы завести клиента без номера под видом сплита. */
export function splittablePhones(client: Pick<Client, "phones"> | null | undefined): PhoneEntry[] {
  return (client?.phones ?? []).filter((p) => p.number.trim() !== "");
}

/** ЕСТЬ ЛИ ПУНКТ «Разделить клиента». Кнопок, которые ничего не делают, в
 *  продукте не бывает, поэтому пункт есть только там, где сплит доедет до
 *  конца: у сохранённой карточки (у черновика нет id, связь указать некуда),
 *  с правом менять (номер уходит из исходной) и правом связей (новый клиент
 *  встаёт человеком этой карточки) — и только если выносить есть что. */
export function canSplitClient(input: {
  client: Pick<Client, "phones" | "deleted_at"> | null | undefined;
  isDraft: boolean;
  canEdit: boolean;
  canLinks: boolean;
}): boolean {
  const { client, isDraft, canEdit, canLinks } = input;
  if (!client || isDraft || !canEdit || !canLinks) return false;
  // Карточка в архиве или корзине не правится — номер из неё не ушёл бы.
  if (client.deleted_at) return false;
  return splittablePhones(client).length > 0;
}

/** Что едет адресом из сплита: исходная карточка и запись номера в её
 *  `phones`. Одной строкой, потому что по отдельности они смысла не имеют. */
export interface SplitRef {
  sourceId: string;
  phoneId: string;
}

// Разделитель — «~»: его нет ни в uuid, ни в id номера (`randomUuid`), и
// expo-router не кодирует его в адресе, в отличие от «:» и «/».
const SPLIT_SEP = "~";

export function encodeSplit(ref: SplitRef): string {
  return `${ref.sourceId}${SPLIT_SEP}${ref.phoneId}`;
}

/** Обратный ход. Обрывок адреса — не сплит: удалять номер по половине
 *  ключа нельзя, поэтому любая кривизна даёт `null`, и черновик становится
 *  обычным черновиком со связью. */
export function parseSplit(value: string | string[] | undefined): SplitRef | null {
  if (typeof value !== "string") return null;
  const parts = value.split(SPLIT_SEP);
  if (parts.length !== 2) return null;
  const [sourceId, phoneId] = parts.map((p) => p.trim());
  if (!sourceId || !phoneId) return null;
  return { sourceId, phoneId };
}

/** Адрес черновика вынесенного человека. Номер встаёт ОСНОВНЫМ (он и есть
 *  ключ нового клиента), имя с номера — если его подписали («Жена · Мария»),
 *  связь — с исходной карточкой без роли: роль впишут словами под именем.
 *
 *  Ключи те же, что собирает `draftLinkParams` и разбирает
 *  `draftLinkFromParams` (`useClientDraft.ts`): сторож гоняет адрес через
 *  разбор черновика и сверяет связь. Пустое в адрес не кладётся — `?name=`
 *  читался бы набранным именем. */
export function splitDraftParams(
  sourceId: string,
  entry: PhoneEntry,
): DraftLinkParams & { split: string } {
  const params: DraftLinkParams & { split: string } = {
    linkGroup: sourceId,
    phone: entry.number.trim(),
    split: encodeSplit({ sourceId, phoneId: entry.id }),
  };
  const name = entry.name?.trim();
  if (name) params.name = name;
  return params;
}

/** Строка шторки «Кого выносим»: подпись номера (и имя на нём), под ней номер.
 *  Без подписи строка — сам номер: пустой заголовок не выберешь глазами. */
export function splitRowText(entry: PhoneEntry): { label: string; hint?: string } {
  const caption = [entry.label.trim(), entry.name?.trim() ?? ""].filter(Boolean).join(" · ");
  const number = entry.number.trim();
  return caption ? { label: caption, hint: number } : { label: number };
}

/** Шаг по исходной карточке после создания вынесенного клиента.
 *  • `patch` — номер убрать этим патчем;
 *  • `gone` — номера в исходной уже нет (убрали руками, пока шёл черновик):
 *    убирать нечего, и это не ошибка;
 *  • `changed` — в черновике набрали ДРУГОЙ номер: вынесен не он, и стирать
 *    его из исходной значило бы потерять живой номер.  */
export type SplitSourceStep =
  | { kind: "patch"; patch: Pick<Client, "phones"> }
  | { kind: "gone" }
  | { kind: "changed" };

/** Патч исходной без вынесенного номера — из СВЕЖЕЙ строки (кэш на момент
 *  создания), а не из замыкания: пока заполняли черновик, в исходной могли
 *  поправить другие номера, и патч от старого массива вернул бы их назад.
 *
 *  Номер сверяется по ключу (`keyOf` — разбор в E.164 тем же кодом страны),
 *  а не строкой: «99 123456» и «+35799123456» — один номер. */
export function splitSourceStep(
  fresh: Pick<Client, "phones">,
  phoneId: string,
  createdKey: string | null,
  keyOf: (number: string) => string | null,
): SplitSourceStep {
  const entry = fresh.phones.find((p) => p.id === phoneId);
  if (!entry) return { kind: "gone" };
  const movedKey = keyOf(entry.number.trim()) ?? entry.number.trim();
  if (!createdKey || movedKey !== createdKey) return { kind: "changed" };
  return { kind: "patch", patch: { phones: fresh.phones.filter((p) => p.id !== phoneId) } };
}
