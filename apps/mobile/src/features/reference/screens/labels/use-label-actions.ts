import { useToast } from "@/components/ui/Toast";
import { useRenameLabelCascade } from "@/features/reference/label-cascade";
import {
  useCreateCity,
  useDeleteCity,
  useReorderCities,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { reviveIfGone, type Editing, type LabelDraft } from "./label-rules";

/** Writes of `LabelsScreen`: create, edit (with merge and rename cascade),
 *  deferred delete, hide/show/restore and reorder. */
export function useLabelActions({
  cities,
  teamId,
  usage,
  setEditing,
}: {
  cities: City[];
  teamId: string | null;
  usage: Map<string, number>;
  setEditing: (next: Editing | null) => void;
}) {
  const toast = useToast();
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();
  const reorder = useReorderCities();
  const cascade = useRenameLabelCascade();

  const alertError = (e: unknown) =>
    notify("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const add = async ({ name, color, weekdays, tintDay }: LabelDraft) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const existing = cities.find(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        // Уже в библиотеке — обновляем вид. Совпала СКРЫТАЯ или УДАЛЁННАЯ
        // (список держит и их) — возвращаем в живые тем же патчем, что
        // «Вернуть»: иначе тост «Метка добавлена», а метки нет ни в выборе
        // дня, ни среди живых.
        await updateCity.mutateAsync({
          id: existing.id,
          patch: { color, weekdays, tint_day: tintDay, ...reviveIfGone(existing) },
        });
      } else {
        if (!teamId) return;
        await createCity.mutateAsync({
          name: trimmed,
          color,
          weekdays,
          tintDay,
          teamId,
        });
      }
      setEditing(null);
      toast("Метка добавлена");
    } catch (e) {
      alertError(e); // шит остаётся открытым — ввод не теряется
    }
  };

  const edit = async (
    city: City,
    { name: newName, color, weekdays, tintDay }: LabelDraft,
  ) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const renamed = trimmed !== city.name;
      const collision =
        renamed && trimmed.toLowerCase() !== city.name.toLowerCase()
          ? cities.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
          : undefined;
      let target = trimmed;
      if (collision) {
        // Слияние с существующей меткой: цвет уходит в целевую, старая
        // запись скрывается, ссылки переезжают на целевое имя.
        target = collision.name;
        await updateCity.mutateAsync({
          id: collision.id,
          // Слились в удалённую — она возвращается: живая «А» уходит в
          // скрытые, и без возврата живой метки не оставалось вовсе.
          patch: { color, weekdays, tint_day: tintDay, ...reviveIfGone(collision) },
        });
        await deleteCity.mutateAsync(city.id);
      } else {
        await updateCity.mutateAsync({
          id: city.id,
          patch: { name: trimmed, color, weekdays, tint_day: tintDay },
        });
      }
      if (renamed) {
        const failures = teamId
          ? await cascade.run(teamId, city.name, target)
          : [];
        if (failures.length > 0) {
          notify(
            "Метка переименована частично",
            `Не удалось обновить: ${failures.join(", ")}. Проверьте сеть и повторите переименование.`,
          );
        }
      }
      setEditing(null);
      toast("Метка обновлена");
    } catch (e) {
      alertError(e);
    }
  };

  // УДАЛЕНИЕ ОТЛОЖЕНО НА 30 ДНЕЙ: метка уходит как удаление, и 30 дней должно пройти.
  //
  // Метка адресуется ИМЕНЕМ (`day_cities.city`, `clients.city`), связи с
  // таблицей нет — база удалению не мешает. Поэтому мгновенное «Удалить»
  // рвёт не ссылку, а СМЫСЛ: день остаётся с именем, у которого больше нет
  // ни цвета, ни строки в справочнике. Тридцать дней — окно, в котором
  // ошибку видно и она обратима (канон).
  const remove = (city: City) => {
    const used = (usage.get(city.name) ?? 0) > 0;
    confirmThen(
      "Удалить метку?",
      {
        message: used
          ? `«${city.name}» исчезнет из выбора. Дни, где она уже стоит, сохранят её имя. Совсем удалится через 30 дней — до тех пор можно вернуть.`
          : `«${city.name}» удалится совсем через 30 дней. До тех пор её можно вернуть.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await updateCity.mutateAsync({
            id: city.id,
            patch: { deleted_at: new Date().toISOString(), is_active: false },
          });
          toast("Метка удалена — вернуть можно 30 дней");
        } catch (e) {
          alertError(e);
        }
      },
    );
  };

  /** Left swipe edge: a deleted label comes back, a hidden one shows, a live
   *  one hides. */
  const toggleState = (city: City) => {
    const deleted = !!city.deleted_at;
    const hidden = !city.is_active && !deleted;
    updateCity.mutate(
      {
        id: city.id,
        patch: deleted
          ? { deleted_at: null, is_active: true }
          : { is_active: !hidden },
      },
      {
        onSuccess: () =>
          toast(
            deleted
              ? "Метка возвращена"
              : hidden
                ? "Метка показана"
                : "Метка скрыта",
          ),
        onError: alertError,
      },
    );
  };

  const reorderLabels = (ids: string[]) =>
    reorder.mutate(ids, {
      onError: alertError,
    });

  const busy =
    createCity.isPending ||
    updateCity.isPending ||
    deleteCity.isPending ||
    cascade.pending;

  return { add, edit, remove, toggleState, reorderLabels, busy };
}
