import { Text, View } from "react-native";
import { money } from "@babun/shared/common/utils/money";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { ValueOptionList } from "@/components/ui/ValuePickerSheet";
import { accountIcon } from "../account-ui";
import type { TransferView } from "./transfer-view";

// ─── Второй шаг: выбор счёта ─────────────────────────────────────────────

export function renderTransferAccountStep(v: TransferView) {
  const {
    visible, guard, title, setStep, groups, step, spansTeams, t, currency,
    fromId, toId, pickFrom, pickTo,
  } = v;
  return (
    <BottomSheet
    padded={false}
      visible={visible && !guard.hidden}
      // ШАГ ВЫБОРА ЗАКРЫВАЕТСЯ НАЗАД, К ФОРМЕ, а не весь перевод: свайп и тап
      // мимо — те же жесты, что у любой шторки выбора (AGENTS 5.2), лист
      // пружиной встаёт обратно уже формой. «‹ Назад» в теле был своей
      // вёрсткой шапки.
      onClose={() => setStep("form")}
      onExited={guard.onExited}
      title={title}
      scroll
      maxHeightRatio={0.8}
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 28 }}>
        {/* 0–1 счетов: выбирать нечего, и голый «Назад» без единого слова
            читался бы как поломка. Кнопки «завести счёт» тут нет нарочно:
            создание живёт листом на экране счетов, а второй лист поверх
            этого невозможен (BottomSheet — RN Modal). */}
        {groups.length === 0 ? (
          <EmptyState
            title={
              step === "from" ? "Переводить неоткуда" : "Переводить некуда"
            }
          />
        ) : null}
        {/* СНАЧАЛА НАЗВАНИЕ КОМАНДЫ, ПОТОМ ЕЁ СЧЕТА.
            Заголовок называет владельца один раз на группу, поэтому строка
            остаётся голым именем счёта: «Наличка», а не «Наличка · Команда 2».
            Гасить в списке больше нечего — любая пара счетов допустима. */}
        {groups.map((group) => (
          <View key={group.teamId ?? "orphans"} style={{ marginBottom: 12 }}>
            {/* Одна команда на все счета — заголовок называл бы то, из чего
                не выбирают; та же мера, что у имён. */}
            {spansTeams ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  marginBottom: 6,
                  marginHorizontal: 4,
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: t.faint,
                }}
              >
                {group.title}
              </Text>
            ) : null}
            <ValueOptionList
              options={group.accounts.map((account) => ({
                id: account.id,
                label: account.name,
                value: money(account.balance, currency),
                // ВИД СЧЁТА ЕДЕТ В ВЫБОР. В списке и в карточке счёт
                // узнаётся цветом и значком, а в шаге «куда уходят деньги»
                // он был голой строкой — единственное место, где вид терялся.
                color: account.color,
                icon: accountIcon(account),
              }))}
              selectedId={step === "from" ? fromId : toId}
              // «Ничего не выбрано» здесь не значение, а тупик: повторный тап
              // по уже выбранному счёту не должен его снимать.
              clearable={false}
              onPick={step === "from" ? pickFrom : pickTo}
            />
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}
