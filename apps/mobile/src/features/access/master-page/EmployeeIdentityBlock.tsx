import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Check, MailCheck, Send, UserRound, type LucideIcon } from "lucide-react-native";

import { FieldRow } from "@/components/ui/card-rows";
import { Field } from "@/components/ui/Field";
import { NameColorField } from "@/components/ui/picker-fields";
import { SectionCard } from "@/components/ui/SectionCard";
import { GUTTER } from "@/components/ui/tokens";
import { IdentityCard } from "@/components/blocks/TeamLabelRow";
import { ClientExtraContacts } from "@/features/clients/ClientExtraContacts";
import type { ContactHolder } from "@/features/clients/contact-fields";
import { PERSON_COLUMN } from "@/features/clients/contact-column";
import { useDefaultCountry } from "@/features/reference/default-country";
import { usePhoneField } from "@/features/clients/use-phone-country";
import { useThemeColors } from "@/theme/colors";

import type { MasterCardViewProps } from "./MasterCardView";

// БЛОК «ПАРТНЁР». Как блок «Клиент»:
// имя с плиткой вида · номер со «Связаться» · почта · контакты и «Добавить
// контакт». Должности нет (она нигде
// не показывалась и путалась с «Набором прав»); строки «В CRM · с …» тоже
// нет. У мастера без аккаунта под блоком — плитка «Пригласить».
//
// Права блока (AGENTS п.10): меняет владелец — сервер держит правкой карточки
// (`masters_write_owner`) и профиля (`patch_master_profile`, только владелец).
// Без права строки только читаются, двери «Добавить контакт» нет.

/** Плитка «Доступ в CRM» — только у мастера БЕЗ аккаунта: зовёт пригласить
 *  или ведёт на отправленное приглашение. */
export interface EmployeeAccessLine {
  state: "pending" | "none";
  /** Вторая строка плитки вместо общей: почта приглашения. */
  sub?: string;
  onPress?: () => void;
}

const ACCESS_TILE: Record<
  EmployeeAccessLine["state"],
  { icon: LucideIcon; title: string; sub: string; hint: string }
> = {
  pending: { icon: MailCheck, title: "Ждёт ответа", sub: "приглашение", hint: "Открывает приглашение" },
  none: { icon: Send, title: "Пригласить", sub: "в CRM", hint: "Приглашает в CRM" },
};

export type EmployeeContacts = {
  holder: ContactHolder;
  update: (patch: Partial<ContactHolder>) => Promise<boolean>;
};

type IdentityProps = Pick<
  MasterCardViewProps,
  | "identity"
  | "live"
  | "editable"
  | "cardFieldsEditable"
  | "emailEditable"
  | "hideEmail"
  | "emailOnly"
  | "autoFocusName"
  | "emailState"
  | "refs"
  | "onNameChange"
  | "onNameCommit"
  | "onColorChange"
  | "onEmailChange"
  | "onEmailEditEnd"
  | "onPhoneChange"
  | "onPhoneEditEnd"
  | "phoneAction"
  | "accountSeen"
  | "access"
  | "contacts"
>;

const noop = () => {};

export function EmployeeIdentityBlock(p: IdentityProps) {
  const t = useThemeColors();
  const cardFields = p.editable && (p.cardFieldsEditable ?? true);
  const check = <Check color={t.success} size={18} strokeWidth={2.5} />;
  const danger = p.emailState === "invalid" ? t.danger : undefined;
  const access = p.access ? ACCESS_TILE[p.access.state] : null;
  // НОМЕР — КАК У КЛИЕНТА: «Телефон» колонкой слева, номер с кодом страны
  // целиком в поле, пустое начинается с кода команды. Тот же `usePhoneField`,
  // что у профиля. Черновик (live) печатает как раньше.
  const phoneField = usePhoneField({
    phone: p.identity.phone,
    home: useDefaultCountry(),
    onSave: (full) => p.onPhoneChange?.(full),
  });
  // НАБРАННОЕ ИМЯ НЕ ТЕРЯЕТСЯ НА УХОДЕ. Имя пишется на `onBlur`, а поле,
  // которое снимают с экрана в фокусе (стрелка «‹», жест «назад»), blur не
  // получает. Свежий `onNameCommit` держим в ref и зовём при снятии блока —
  // как имя календаря (`CalendarIdentityCard`). Карточки сами не пишут
  // пустое и неизменённое имя, так что лишней записи нет.
  const commitOnLeave = useRef(p.onNameCommit);
  commitOnLeave.current = p.onNameCommit;
  useEffect(() => () => commitOnLeave.current?.(), []);

  // Новый партнёр и ждущее приглашение — почта и, по желанию, имя;
  // телефон он ведёт сам в своём профиле.
  if (p.emailOnly) {
    return (
      <SectionCard title="Партнёр" padded={false}>
        {/* ПОЧТА — ПОЛЕ ФОРМЫ, А НЕ СТРОКА КАРТОЧКИ. Здесь её вводят с нуля,
            и строка `FieldRow` без рамки на вебе была голым вводом в 20px
            высотой: не видно, куда печатать. Поле — то же, что у пароля и
            почты аккаунта (`Field`, DS «Input 52»). */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Field
            label=""
            accessibilityLabel="Почта"
            placeholder="Почта"
            value={p.identity.email}
            editable={p.emailEditable}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="email"
            autoFocus={p.emailEditable && p.autoFocusName}
            inputRef={p.refs?.email}
            style={danger ? { color: danger } : undefined}
            trailing={p.emailState === "valid" ? check : null}
            onChangeText={p.onEmailChange ?? noop}
            onBlur={p.onEmailEditEnd}
          />
          {/* ИМЯ — ПО ЖЕЛАНИЮ, ЕСЛИ ЕГО МОЖНО ВПИСАТЬ. Без имени ждущее
              приглашение в списке называлось почтой; сервер имя принимает
              (`p_full_name`). Своё имя партнёр потом ведёт сам в профиле. */}
          {p.emailEditable && p.onNameChange ? (
            <Field
              label=""
              accessibilityLabel="Имя"
              placeholder="Имя"
              value={p.identity.name}
              autoCapitalize="words"
              onChangeText={p.onNameChange}
            />
          ) : null}
        </View>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard title="Партнёр" padded={false}>
        {p.editable ? (
          <NameColorField
            bare
            minHeight={52}
            colorReadOnly={!cardFields}
            label={null}
            name={p.identity.name}
            color={p.identity.color}
            onNameChange={p.onNameChange ?? noop}
            onColorChange={p.onColorChange ?? noop}
            onBlur={p.onNameCommit}
            fallback={UserRound}
            placeholder="Имя"
            autoCapitalize="words"
            autoFocus={p.autoFocusName}
            inputRef={p.refs?.name}
            // Галочка — подсказка черновика «имя есть»; у живого сотрудника
            // она ничего не говорит.
            trailing={p.live && p.identity.name.trim() ? check : null}
          />
        ) : (
          <FieldRow
            stacked
            hideLabel
            readOnly
            big
            label="Имя"
            placeholder="Имя"
            value={p.identity.name}
            onSave={noop}
          />
        )}

        {/* Пустое, которое нельзя заполнить, не показываем: строка без
            значения и без правки читалась бы сломанным полем. Номер — как у
            клиента: без подписи, крупно, «Связаться» в хвосте. */}
        {(p.editable || p.identity.phone) && !p.live ? (
          <FieldRow
            label="Телефон"
            column={PERSON_COLUMN}
            separated
            tabular
            seed={phoneField.seed}
            value={phoneField.value}
            placeholder="Номер"
            keyboardType="phone-pad"
            readOnly={!p.editable}
            inputRef={p.refs?.phone}
            onEditEnd={p.onPhoneEditEnd}
            onSave={phoneField.onSave}
            trailing={p.identity.phone ? p.phoneAction : undefined}
          />
        ) : p.editable || p.identity.phone ? (
          <FieldRow
            compact
            stacked
            hideLabel
            separated
            tabular
            big
            label="Телефон"
            placeholder="Телефон"
            value={p.identity.phone}
            keyboardType="phone-pad"
            live={p.live && p.editable}
            readOnly={!p.editable}
            inputRef={p.refs?.phone}
            onEditEnd={p.onPhoneEditEnd}
            onSave={p.onPhoneChange ?? noop}
            trailing={p.identity.phone ? p.phoneAction : undefined}
          />
        ) : null}

        {p.hideEmail ? null : (
          <FieldRow
            separated
            column={PERSON_COLUMN}
            label="Почта"
            placeholder="Почта"
            value={p.identity.email}
            live={p.emailEditable}
            readOnly={!p.emailEditable}
            keyboardType="email-address"
            autoCapitalize="none"
            inputRef={p.refs?.email}
            inputColor={danger}
            valueColor={danger}
            trailing={p.emailState === "valid" ? check : null}
            onEditEnd={p.onEmailEditEnd}
            onSave={p.onEmailChange ?? noop}
          />
        )}

        {/* Показание, а не дверь: когда он последний раз был в приложении —
            той же колонкой, что «Телефон» и «Почта». */}
        {p.accountSeen ? (
          <FieldRow
            label="Вход"
            column={PERSON_COLUMN}
            separated
            readOnly
            noCopy
            value={p.accountSeen}
            placeholder=""
            onSave={noop}
          />
        ) : null}

        {p.contacts ? (
          <ClientExtraContacts
            client={p.contacts.holder}
            update={p.contacts.update}
            draft={false}
            compact
            readOnly={!cardFields}
          />
        ) : null}
      </SectionCard>

      {access && p.access ? (
        <View style={{ flexDirection: "row", marginHorizontal: GUTTER, marginTop: 8 }}>
          <IdentityCard
            icon={access.icon}
            color={t.accent}
            title={access.title}
            sub={p.access.sub ?? access.sub}
            onPress={p.access.onPress}
            accessibilityLabel={`Доступ в CRM: ${access.title}`}
            accessibilityHint={p.access.onPress ? access.hint : ""}
          />
        </View>
      ) : null}
    </>
  );
}
