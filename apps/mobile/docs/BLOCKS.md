# Библиотека блоков — готовый код, а не описание словами

> **Как этим пользоваться.** Владелец говорит «добавь блок клиента» или
> «посмотри в BLOCKS.md, как надо было» — открываешь нужную карточку ниже,
> берёшь **код оттуда** и ставишь туда, где он нужен. Ничего не придумывать,
> ничего не собирать заново: каждый блок в продукте уже существует ровно в
> одном виде, и здесь написано, в каком.
>
> **Если этот файл и код расходятся — прав КОД, а файл правится тем же
> коммитом.** Документ, который врёт, хуже отсутствующего: на этом проекте
> уже дважды «исправляли» верно работающий код обратно к устаревшему абзацу.
> Ссылки `file:line` сторожит тест `src/lib/blocks-catalog.test.ts` — он падает,
> если файл или символ, названный здесь, исчез.
>
> Правила, из которых это следует: `AGENTS.md` → **Canon Reuse** (пункты
> 5.1 время, 5.2 шторка, 6 ряд, 7 кнопка) и `docs/DESIGN-SYSTEM.md` §5.

---

## 0. Из чего собираются все блоки

| Примитив | Файл | Роль |
|---|---|---|
| `SectionCard` | `src/components/ui/SectionCard.tsx` | Блок с ИМЕНЕМ: капс-подпись внутри белой карточки, её команды — иконками справа в той же строке (`action`, до двух) |
| `RowGroup` | `src/components/ui/card-rows.tsx` | Секция с подытогом справа и пояснением под ней. **Только финансы.** Под именованный блок не брать |
| `ChooseRow` | `src/components/ui/ChooseRow.tsx` | Пустое состояние блока — дверь: кружок со значком, синяя подпись, серый хинт |
| `FieldRow` · `ChoiceRow` · `NavRow` · `ActionRow` · `ValueRow` | `src/components/ui/card-rows.tsx`, `src/components/ui/ValueRow.tsx` | Строки внутри блока |
| `SwipeRow` | `src/components/ui/SwipeRow.tsx` | Разрушительное на кромке: свайп влево «Удалить», `leading` «Скрыть» |
| `SelectRow` · `SelectSearch` · `SelectList` | `src/components/ui/select-rows.tsx` | Строка, поиск и ритм ЛЮБОЙ шторки выбора |
| `BottomSheet` | `src/components/ui/BottomSheet.tsx` | Шторка: `title`, `subtitle`, `headerAction`, `footer`, `maxHeightRatio` |
| `TimeWheelPair` · `TimeRangePicker` | `src/components/ui/TimeWheel.tsx` | Время и длительность. Со страницы — листом (`HourRangeSheet`, `DateWheelSheet`), из шторки — раскрывашкой под строкой |
| `Button` · `GradientButton` | `src/components/ui/Button.tsx` | Кнопка. Один радиус, `variant="secondary"` — второй вид |

**Слова кнопок — один смысл, одно слово во всём продукте:** «Применить» ·
«Создать N» · «Добавить N» · «Убрать». «Готово», «Сохранить», «Выбрать» в
роли кнопки шторки не бывает.

---

## 1. Блок «Клиент» + шторка выбора клиента

**Канон:** `app/book/index.tsx:2356` (запись), `app/book/index.tsx:2884` (событие).

Выбранный клиент: имя 17/700 → `ClientHistoryLine` (долг, визиты, деньги,
последний визит) → телефон 13. Справа `PhoneChannelButton` 32pt (тап звонит,
удержание — способы связи) и «…» 32pt в карточку клиента. Пустой — `ChooseRow`.
Под клиентом — его заметка мини-плашкой.

```tsx
<SectionCard title="Клиент">
  {client ? (
    <View className="flex-row items-center">
      <Pressable
        className="flex-1 flex-row items-center px-4 py-2.5"
        onPress={() => setClientPickerOpen(true)}
        accessibilityRole="button"
        accessibilityHint="Открывает выбор клиента"
      >
        <View className="flex-1">
          <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
            {client.full_name || "Без имени"}
          </Text>
          <ClientHistoryLine client={client} stats={clientStats} />
          <Text numberOfLines={1} style={{ fontSize: 13, marginTop: 2, color: client.phone ? t.sub : t.placeholder }}>
            {client.phone ?? "без телефона"}
          </Text>
        </View>
      </Pressable>
      {client.phone ? (
        <View className="mr-4 self-center">
          <PhoneChannelButton number={client.phone} telegramUsername={client.telegram_username} label={client.full_name || undefined} />
        </View>
      ) : null}
      <Pressable
        onPress={openClientCard}
        className="mr-4 items-center justify-center self-center rounded-full"
        style={{ width: 32, height: 32, backgroundColor: t.rowFill }}
        accessibilityRole="button"
        accessibilityLabel="Карточка клиента"
      >
        <MoreHorizontal color={t.body} size={ICON.sm} />
      </Pressable>
    </View>
  ) : (
    <ChooseRow
      icon={UserRound}
      label="Выбрать клиента"
      hint="Открывает поиск по имени или телефону"
      onPress={() => setClientPickerOpen(true)}
    />
  )}
  {client ? (
    <InlineNoteField note={clientNote} placeholder="Заметка клиента" accessibilityLabel="Заметка клиента" maxLength={500} />
  ) : null}
</SectionCard>
```

**Шторка** — `src/features/clients/ClientPickerSheet.tsx`, ОДНА на продукт:

```tsx
<ClientPickerSheet
  visible={clientPickerOpen}
  statsById={statsById}          // вводная о человеке в строке; без неё строка короче
  recentIds={recentClientIds}    // недавние наверх
  selectedId={client?.id}
  excludeId={self?.id}           // «кто привёл»: себя не предлагать
  onSelect={pickClient}
  onCreate={(prefill) => router.push({ pathname: "/book/client", params: { id: "new", ...prefill } })}
  onClear={() => setClient(null)}   // необязателен
  clearLabel="Убрать"
  onClose={() => setClientPickerOpen(false)}
  onExited={continueChain}
/>
```

Кнопка футера — **«Создать клиента»**. Создание всегда уходит карточкой
клиента (`/book/client` поверх записи или `/clients/new`), быстрого создания
одним тапом не бывает: заводило клиента с именем без телефона.

**Не делать:** второй шторки клиента (была, свели 2026-09-10); строки
«Добавить клиента» под выбранным; своего поля поиска.

---

## 2. Блок «Объект» + шторка + форма объекта

**Канон:** `app/book/index.tsx:2447` (запись), `2974` (событие),
`src/features/clients/blocks/ObjectsBlock.tsx:126` (`ObjectRow` — строка).

Строка объекта не копируется, а берётся та же: `ObjectRow`. В записи объект
ВЫБИРАЮТ, поэтому справа шеврон, а заметка объекта — своей плашкой под строкой.

```tsx
<SectionCard title="Объект">
  {client ? (
    selectedLocation ? (
      <ObjectRow loc={selectedLocation} showNote={false} onPress={() => setObjectPickerOpen(true)} />
    ) : clientLocations.length === 0 ? (
      <ChooseRow icon={MapPin} label="Добавить объект" hint="Первый объект клиента" onPress={() => setObjectSheet(true)} />
    ) : (
      <ChooseRow icon={MapPin} label="Выбрать объект" onPress={() => setObjectPickerOpen(true)} />
    )
  ) : (
    // Без клиента объект не заводится — блок говорит это словом, а не пустотой.
    <ChooseRow icon={MapPin} label="Добавить объект" disabled hint="Сначала выберите клиента" onPress={() => {}} />
  )}
</SectionCard>
```

**Шторка выбора** — `src/features/clients/ObjectPickerSheet.tsx`, кнопка
**«Добавить объект»** (поиска нет: объектов у клиента два-три).

**Форма объекта** — `src/features/clients/ObjectSheet.tsx` (новый) и
`src/features/clients/ObjectEditSheet.tsx` (правка), тело у обеих одно:
`src/features/clients/ObjectFields.tsx` — три карточки: «Тип объекта» (с
шестерёнкой в справочник), «Адрес» (главная строка + карта `MapPicker` +
«Точный адрес» ссылкой + иконка «попросить адрес у клиента»), «Заметка».
Создание пишет черновик одной кнопкой, правка — на уходе с каждого поля.

**Дополнительные страницы:** типы объектов —
`src/features/reference/screens/ObjectTypesScreen.tsx`, двери
`clients/object-types.tsx`, `cabinet/object-types.tsx`, `book/object-types.tsx`.

**Не делать:** второй формы объекта (была, свели 2026-09-10 — сторожит
`src/features/clients/client-persistence-contract.test.ts`); `AddRow` вместо `ChooseRow`; строки
«Добавить объект» под выбранным.

---

## 3. Блок «Услуги» + «Итого» + шторки

**Канон:** `app/book/index.tsx:2585`.

```tsx
<SectionCard title="Услуги">
  {serviceIds.length === 0 ? (
    <ChooseRow icon={Briefcase} label="Выбрать услугу" hint="Открывает список услуг" onPress={() => setServicePickerOpen(true)} />
  ) : (
    selectedServices.map((line, index) => (
      <View key={line.serviceId} style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: t.separator }}>
        {/* тап по строке открывает список услуг заново */}
      </View>
    ))
  )}
  <TotalRow
    total={effectiveTotal}
    custom={customTotal}
    discountAmount={discountAmount}
    discountReason={discountReason}
    onPress={() => setTotalSheetOpen(true)}
  />
</SectionCard>
```

**Шторка выбора** — `ServicePicker` в
`src/features/appointments/BookingPickers.tsx`: поиск, строки со значком
услуги, количество степпером у взятой, кнопка **«Применить · N · €сумма»**.
Пустой каталог не тупик: `EmptyState` с дверью «Добавить услугу» в
`/book/services`.

**Шторка «Итого»** — `src/features/appointments/TotalSheet.tsx`: таблица
Услуга/Кол-во/Цена/Сумма, скидка в одной строке с итогом.

**Страница услуг** — `app/(dashboard)/cabinet/services.tsx`, двери
`calendar/services.tsx`, `book/services.tsx`. Цвета у услуги НЕТ (снят 2026-09-08).

**Не делать:** «Добавить услугу» строкой под выбранными; дублировать
длительность в «Итого»; галку слева в строке шторки.

---

## 4. Блок «Оплата»

**Канон:** `app/book/index.tsx` → `<PaymentBlock>`,
`src/features/appointments/PaymentBlock.tsx`, плитки —
`src/features/appointments/PaymentTiles.tsx`.

Плитки счетов команды, тонированные цветом счёта; тап пишет деньги сразу.
Выключается в Кабинет → «Запись»: не всякий бизнес принимает деньги в записи.
Выбор счёта — плиткой, а не нейтральным чипом.

---

## 5. Блок «Заметка»

**Канон записи:** `app/book/index.tsx:2751` — `SectionCard title="Заметка"` +
`InlineNoteField`. **Канон события:** `3076` — большое поле, растёт под текст,
без подсказки-плейсхолдера (владелец: «мне на мозоли глаза»).

```tsx
<SectionCard title="Заметка">
  <InlineNoteField note={note} placeholder="Детали, пожелания, что взять с собой" accessibilityLabel="Заметка записи" maxLength={2000} />
</SectionCard>
```

Заметка клиента и заметка объекта — те же `InlineNoteField`, но пишут в свою
сущность; в карточке клиента блок называется «Заметка клиента».

---

## 6. Блок «Файлы»

**Канон:** `src/features/appointments/AppointmentFilesBlock.tsx` — один и тот
же блок у записи и у события.

```tsx
<AppointmentFilesBlock
  appointmentId={editing?.id}
  clientId={client?.id}
  locationId={locationId}
  canUpload={canUpload}
  pending={pendingFiles}
  onPendingChange={setPendingFiles}
/>
```

---

## 7. Докет «Команда · Метка» и блок «Время»

**Канон:** `src/features/appointments/BookingSummary.tsx:118` (`TeamLabelRow`),
`:273` (`WhenRow`).

```tsx
<TeamLabelRow
  teamName={teamName} teamColor={teamColor} masterName={masterName}
  label={effectiveLabel} labelColor={labelColor} labelFromDay={labelFromDay}
  showLabel labelIcon={MapPin} labelPlaceholder="Метка"
  onEditTeam={() => setTeamSheetOpen(true)}
  onEditLabel={() => setLabelSheetOpen(true)}
/>
<WhenRow date={date} start={start} end={end} duration={duration} warning={workWarning} onPress={() => setWhenOpen(true)} />
```

**Шторка времени** — `src/features/appointments/WhenSheet.tsx` (барабан,
«Применить»). **Шторка метки** — `src/features/reference/LabelPickerSheet.tsx`,
кнопки нет: тап выбирает и закрывает, тап по выбранной снимает.

---

## 8. Блок «Тип события» + страница типов

**Канон:** `src/features/appointments/EventTypeBlock.tsx`.

```tsx
<EventTypeBlock
  types={eventTypes}
  selectedId={eventTypeId}
  loading={eventTypesQuery.isLoading}
  onSelect={toggleEventType}      // повторный тап снимает тип
  onSettings={() => router.push("/book/event-types")}
/>
```

Лента плиток горизонтальная и компактная — тридцать типов не должны забивать
экран. Шестерёнка `Settings2` справа в шапке блока. Тип красит событие;
длительность типа — стандарт, выбранное руками время сильнее.

**Страница типов** — `src/features/reference/screens/EventTypesScreen.tsx` +
`src/features/reference/screens/EventTypeSheet.tsx` (имя с цветом, значок, «Весь день», длительность
барабаном). Двери: `cabinet/event-types.tsx`, `calendar/event-types.tsx`,
`book/event-types.tsx`.

---

## 9. Метки, теги, категории, счета, команда

| Что | Блок / строка | Шторка | Кнопка |
|---|---|---|---|
| Метка записи и события | докет `TeamLabelRow` | `reference/LabelPickerSheet` | нет |
| Метка дня | тап по числу в календаре | `calendar/DayLabelSheet` (обёртка над той же) | нет |
| Метка клиента | строка в блоке «Личное» | `reference/LabelPickerSheet` | нет |
| Теги клиента | строка в блоке «Личное» | `clients/TagPickerSheet` | «Применить» |
| Категория операции | `ValueRow` со значением | `ui/ValuePickerSheet` | нет |
| Счёт | `PaymentTiles` либо `ValueRow` | `ui/ValuePickerSheet` | нет |
| Клиент или заявка инвойса | `ValueRow` | `invoices/EntityPickerSheet` | нет |
| Команда и мастер | докет `TeamLabelRow` | `appointments/BookingSheets` → `TeamMasterSheet` | «Применить» |
| Действие («Добавить», «Как связаться») | строка-дверь | `ui/PickerSheet` | нет |

**Справочники** — все по рецепту «Метки»
(`src/features/reference/screens/LabelsScreen.tsx`): `BottomSheet`-редактор,
`GradientButton` внизу, `ReorderList`, свайп влево «Удалить» с
подтверждением, свайп вправо «Скрыть», `EmptyState`, `NameColorField`.

---

## 10. Что ещё НЕ компонент (и потому копируется глазами)

Блоки «Клиент», «Объект» и «Услуги» живут разметкой внутри
`app/book/index.tsx` (3400 строк). Пока это так, «взять готовый блок» значит
«скопировать из указанной строки», а не «поставить один тег». Вынести их в
`BookClientBlock`, `BookObjectBlock`, `BookServicesBlock` — ближайший шаг:
тогда каждая карточка выше сократится до трёх строк, а этот файл перестанет
дублировать разметку.

Уже компоненты и копируются одним тегом: `ObjectFields`, `ClientPickerSheet`,
`ObjectPickerSheet`, `LabelPickerSheet`, `TagPickerSheet`, `ServicePicker`,
`EventTypeBlock`, `PaymentBlock`, `AppointmentFilesBlock`, `InlineNoteField`,
`TeamLabelRow`, `WhenRow`, `TotalRow`, `SelectRow`.
