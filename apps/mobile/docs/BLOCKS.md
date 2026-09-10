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
| `ReferenceBlock` | `src/components/ui/ReferenceBlock.tsx` | БЛОК ВЫБОРА ИЗ СПРАВОЧНИКА целиком: шапка → дверь «Выбрать …» → выбранное значком, цветом и именем. Одно тело у категории и у типа события |
| `FieldRow` · `ChoiceRow` · `NavRow` · `ActionRow` · `ValueRow` | `src/components/ui/card-rows.tsx`, `src/components/ui/ValueRow.tsx` | Строки внутри блока |
| `SwipeRow` | `src/components/ui/SwipeRow.tsx` | Кромки закреплены за смыслом: ПРАВАЯ (`label`) — «Удалить»/«Убрать», ЛЕВАЯ (`leading`) — «Скрыть»/«Показать»/«Вернуть». Нечего удалять — правой кромки нет (`label` необязателен) |
| `SelectRow` · `SelectSearch` · `SelectList` | `src/components/ui/select-rows.tsx` | Строка, поиск и ритм ЛЮБОЙ шторки выбора |
| `BottomSheet` | `src/components/ui/BottomSheet.tsx` | Шторка: `title`, `subtitle`, `headerAction`, `footer`, `maxHeightRatio` |
| `TimeWheelPair` · `TimeRangePicker` | `src/components/ui/TimeWheel.tsx` | Время и длительность. Со страницы — листом (`HourRangeSheet`, `DateWheelSheet`), из шторки — раскрывашкой под строкой |
| `Button` · `GradientButton` | `src/components/ui/Button.tsx` | Кнопка. Один радиус, `variant="secondary"` — второй вид |

### 0.1 Геометрия — числа, которые и делают блок блоком

Копировать блок означает копировать ЭТИ числа. Все они прочитаны из кода, а не
названы на глаз; тест сторожит, что они не разъехались.

| Что | Число | Откуда |
|---|---|---|
| Боковое поле блока | **16** (`GUTTER`) | `src/components/ui/SectionCard.tsx` |
| Промежуток между блоками | **8** (`mt-2`) | `src/components/ui/SectionCard.tsx` |
| Радиус блока и любой поверхности | **10** (`t.radius.card`) | `src/theme/colors.ts` |
| Подпись блока: слева | **16** (`px-4`) | `src/components/ui/SectionCard.tsx:58` |
| Подпись блока: сверху / снизу | **10** / **2** (`pt-2.5` / `pb-0.5`) | там же |
| Подпись блока: кегль | **11 / 700**, трекинг **+0.6**, UPPERCASE, цвет `faint` | `src/components/ui/SectionCard.tsx:64` |
| Команда блока (иконка справа) | абсолютом `right: 16`, `top: 6`, между иконками **16**, `hitSlop 12`, размер **18** (`ICON.sm`) | `src/components/ui/SectionCard.tsx:82` |
| Тело блока с `padded` | **16** по краям, **8** сверху (`p-4 pt-2`) | `src/components/ui/SectionCard.tsx` |
| **Плотный случай** — форма в ШТОРКЕ (`dense` у `SectionCard`, `compact` у `ChooseRow`) | промежуток **6** (`mt-1.5`), подпись **6** сверху / **0** снизу, дверь `py-2`, кружок **30pt** | вторая сессия 2026-09-10 |

**Почему команда блока абсолютом.** В потоке её `minHeight: 44` задирал высоту
шапки, и подпись у блока с иконкой стояла на 6px ниже, чем у соседей (владелец
2026-09-08: «отступ от начала блока до слова должен быть одинаково — клиент,
объект, заметка, тип события, всё в одной архитектуре, по пикселям»). Высоту
шапки задаёт ТОЛЬКО подпись.

| Строка блока | Число |
|---|---|
| Дверь пустого блока `ChooseRow` | `px-4 py-3.5`; кружок `IconCircle` **34pt** на `accent14`, значок **18**; подпись **17 / 600** акцентом, отступ от кружка **12**; шеврон **18** цвета `chevron` |
| Строка выбранного (клиент) | `px-4 py-2.5`; имя **17 / 700**, история строкой, телефон **13** |
| Кнопка-орган справа в строке | круг **32×32** на `rowFill` |
| Заметка `InlineNoteField` | поля **12** по бокам, **2** сверху, **8** снизу; внутри **12 / 7**; кегль **13** |

| Шторка выбора | Число |
|---|---|
| Строка `SelectRow` | **52pt**, `paddingHorizontal: 14`, `gap: 12`, зазор между строками **8** |
| Кружок строки | **28pt**, `radius.pill`, значок **16** |
| Текст строки | имя **15 / 600** ink · подпись **13** sub · третья строка **13** faint · число справа **15 / 600** моноширинным |
| Выбранная строка | тонируется акцентом в 8%, справа галка **18**. Рамки не бывает |
| Поиск `SelectSearch` | **40pt**, поле `GUTTER`, снизу **10**, кегль **15**, значок **16** |
| Футер шторки | поле `GUTTER`, снизу `keyboardShown ? 12 : max(insets.bottom, 16)` |
| Кнопка | **52pt** min, радиус **10**, подпись **17 / 600** |

### 0.2 Иконки — одна сущность, одна иконка во всём продукте

| Сущность или действие | Иконка (lucide) |
|---|---|
| Клиент | `UserRound` |
| Объект, адрес, метка | `MapPin` |
| Точка на карте | `MapPinned` |
| Попросить адрес у клиента | `Send` |
| Услуга | `Briefcase` |
| Тег | `Tag` |
| Документ, инвойс, чек | `FileText` |
| **Настройки блока** — в шапке `SectionCard` | `Settings2` (два ползунка) |
| **Настройки списка** — в шапке шторки | `Settings2` (два ползунка) |
| Карточка сущности, «ещё» | `MoreHorizontal` |
| Дверь (шеврон) | `ChevronRight` |
| Выбрано | `Check` |
| Удалить | `Trash2` |
| Скрыть | `EyeOff` |

Размеры: в кружке блока **18** внутри 34pt · в кружке строки шторки **16**
внутри 28pt · шеврон и команды блока **18** (`ICON.sm`). Своих чисел не
заводить — только `ICON.lg/md/sm/xs` = 24/22/18/14.

ЗНАЧОК НАСТРОЙКИ ОДИН — `Settings2`, два ползунка. Здесь стояло правило о двух
ролях: ползунки правят настройки БЛОКА, шестерёнка ведёт на страницу СПИСКА.
Владелец снял его 2026-09-10, глядя на лист категорий: «не шестерёнка, а вот
эти маленькие тумблеры, две штуки — мы уже это использовали».

Правило и не держалось: обе двери ведут в одно и то же место — на страницу
справочника, — и различать их значком значило обещать разницу, которой нет.
Шестерёнки в продукте не осталось.

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
  onCreate={(prefill) => router.push({ pathname: "/client", params: { id: "new", ...prefill } })}
  onClear={() => setClient(null)}   // необязателен
  clearLabel="Убрать"
  onClose={() => setClientPickerOpen(false)}
  onExited={continueChain}
/>
```

Кнопка футера — **«Создать клиента»**. Создание всегда уходит карточкой
клиента (`/client` поверх позвавшего или `/clients/new`), быстрого создания
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
`clients/object-types.tsx`, `cabinet/object-types.tsx`, `(shared)/object-types.tsx`.

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
`/services`.

**Шторка «Итого»** — `src/features/appointments/TotalSheet.tsx`: таблица
Услуга/Кол-во/Цена/Сумма, скидка в одной строке с итогом.

**Страница услуг** — `app/(dashboard)/cabinet/services.tsx`, двери
`calendar/services.tsx`, `(shared)/services.tsx`. Цвета у услуги НЕТ (снят 2026-09-08).

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

**Канон:** `src/features/appointments/EventTypeBlock.tsx` — тот же
`ReferenceBlock`, что у блока категории (владелец 2026-09-10: «сделай его
точно таким же, как в категории в финансах… тип события выбирается точно так
же, как категория, вся архитектура как у категории»).

```tsx
<EventTypeBlock
  type={eventType}                       // выбранный тип либо null
  onPress={() => setEventTypeSheetOpen(true)}
/>

<PickerSheet
  visible={eventTypeSheetOpen}
  title="Тип события"
  selectedId={eventTypeId}
  // ТАП ПО ВЫБРАННОЙ СТРОКЕ СНИМАЕТ ВЫБОР — служебной строки «Без типа» нет
  items={eventTypes.map((type) => {
    const chosen = type.id === eventTypeId;
    return {
      id: type.id,
      label: type.label,
      icon: eventTypeIcon(type.icon),
      color: type.color,
      hint: chosen ? "Тап снимает тип" : `${durationLabel(type.defaultDuration)} по умолчанию`,
      onPress: chosen ? clearEventType : () => applyEventType(type.id),
    };
  })}
  onSettings={() => router.push("/event-types")}
  settingsLabel="Типы событий"
  onClose={() => setEventTypeSheetOpen(false)}
/>
```

**Чего здесь больше НЕТ и не заводить снова:** горизонтальной ленты плиток
(кружок 40pt, подпись 11pt в две строки), выбора повторным тапом и значка
ползунков в шапке блока. Это был второй диалект выбора: предмет в продукте
выбирают блоком со шапкой и шторкой. Дверь в справочник — значок настроек в шапке
ШТОРКИ; за край он не уезжает, поэтому прежняя причина держать его в блоке
исчезла вместе с лентой.

Тип по-прежнему красит событие и даёт длительность: цвет события — цвет типа,
длительность — стандарт, выбранное руками время сильнее. Живёт это в форме
(`applyEventType`), а не в блоке, и названо в шторке тихой подписью строки.

**Страница типов** — `src/features/reference/screens/EventTypesScreen.tsx` +
`src/features/reference/screens/EventTypeSheet.tsx` (имя с цветом, значок, «Весь день», длительность
барабаном). Двери: `cabinet/event-types.tsx`, `calendar/event-types.tsx`,
`(shared)/event-types.tsx`.

---

## 9. Метки, теги, категории, счета, команда

| Что | Блок / строка | Шторка | Кнопка |
|---|---|---|---|
| Метка записи и события | докет `TeamLabelRow` | `reference/LabelPickerSheet` | нет |
| Метка дня | тап по числу в календаре | `calendar/DayLabelSheet` (обёртка над той же) | нет |
| Метка клиента | строка в блоке «Личное» | `reference/LabelPickerSheet` | нет |
| Теги клиента | строка в блоке «Личное» | `clients/TagPickerSheet` | «Применить» |
| Категория операции | `finances/CategoryBlock` (в листе операции — плотная строка в общей карточке с суммой) | `ui/PickerSheet` | нет |
| Тип события | `appointments/EventTypeBlock` — тот же `ReferenceBlock`, что у категории | `ui/PickerSheet`; тап по выбранной строке снимает тип | нет |
| Счёт | `PaymentTiles` либо `ValueRow` | `ui/ValuePickerSheet` | нет |
| Клиент или заявка инвойса | `ValueRow` | `invoices/EntityPickerSheet` | нет |
| Команда и мастер | докет `TeamLabelRow` | `appointments/BookingSheets` → `TeamMasterSheet` | «Применить» |
| Действие («Добавить», «Как связаться») | строка-дверь | `ui/PickerSheet` | нет |

**Справочники** — все по рецепту «Метки»
(`src/features/reference/screens/LabelsScreen.tsx`): `BottomSheet`-редактор,
`GradientButton` внизу, `ReorderList`, `EmptyState`, `NameColorField`.

Кромки и тап у справочника — закон, а не вкус (владелец 2026-09-10):

| Место | Что там | Почему |
| --- | --- | --- |
| ПРАВАЯ кромка (`label`) | «Удалить» с подтверждением | разрушительное живёт на постоянном месте |
| ЛЕВАЯ кромка (`leading`) | «Скрыть» → «Показать» → «Вернуть»/«Открыть» | состояние строки, обратимое |
| Строки, которую нельзя удалить | правой кромки НЕТ вовсе | подсунуть под тот же палец скрытие — соврать мышечной памяти |
| ТАП по строке | ПРАВКА (имя, цвет) | «нажал — и оно скрылось» стоило владельцу стандартной категории |
| Скрытая строка | гаснет и падает в КОНЕЦ списка | исчезнувшая читалась бы как удалённая |
| Скрытая в листе выбора | её там нет — кроме уже выбранной в операции/шаблоне | иначе прошлая запись потеряет подпись |

Держит `src/components/ui/swipe-edge-contract.test.ts`.

---

## 9.1 Блоки карточки клиента

Все на `SectionCard` — той же архитектуры, что блоки записи (сведено
2026-09-10; до этого стояли на `RowGroup` с подписью НАД карточкой).

| Блок | Канон | Из чего |
|---|---|---|
| «Объекты» | `src/features/clients/blocks/ObjectsBlock.tsx:84` | `SwipeRow` («Удалить») вокруг `ObjectRow` · строка добавления · лист `ObjectSheet` |
| «Заметка клиента» | `src/features/clients/blocks/NotesBlock.tsx:99` | `InlineNoteField`, пишет в клиента через `useJsonArrayWriter` |
| «Личное» | `src/features/clients/blocks/PersonalBlock.tsx:164` | `NavRow` × 5: Метка · Теги · День рождения · Источник · Кто привёл — каждая открывает свою шторку |
| «Документация» | `src/features/clients/blocks/DocumentationBlock.tsx:71` | `NavRow` по датам визитов + «Все файлы» |

Шапка карточки (имя, телефоны, «Записать») — `src/features/clients/ClientHeader.tsx`.

## 9.2 Блоки листа операции (финансы)

**Канон:** `src/features/finances/OperationSheet.tsx`.

| Блок | Строка | Из чего |
|---|---|---|
| Команда · Дата · Время | `:647` | подпись команды + `ValueRow` даты и времени, барабан раскрывашкой ПОД строкой |
| «Категория» | `:746` | `ValueRow` → шторка `ValuePickerSheet` с шестерёнкой в справочник |
| «Сумма» | `:773` | `MoneyField` — символ валюты из `moneySymbol(currency)`, не литералом |
| «НДС» | `:809` | появляется, когда НДС включён у тенанта |
| «Счёт» | `:845` | выбор счёта; канон вкуса — плитки, тонированные цветом счёта (`PaymentTiles`) |
| «Заметка» | `:883` | `InlineNoteField` |
| «Документ» | `:900` | `FileText` + «Приложить документ» |

## 9.3 Расхождения, которые каталог знает и НЕ выдаёт за канон

Честно, чтобы никто не скопировал неправильное. Закрытые вычеркнуты.

| Где | Что не так | Как правильно |
|---|---|---|
| ~~`ObjectsBlock` — «Добавить объект»~~ | ~~`AddRow`~~ | закрыто 2026-09-10 |
| ~~`BookingSheets` — «Команда и мастер»~~ | ~~вне `select-rows`~~ | закрыто 2026-09-10 |
| ~~Теги, категории, лояльность~~ | ~~сырой лист, мусорка, два поля~~ | закрыто 2026-09-10 |
| ~~16 самописных залитых кнопок~~ | ~~своя `Pressable`~~ | пять закрыто, `variant="filled"` построен |
| `src/features/clients/ClientDraftNotice.tsx` | компактное действие внутри плашки: 44pt с радиусом числом | жанр канон не описывает — 52pt в строку плашки не встанет, а превращать в ссылку значит решать за владельца. **Ждёт его слова** |
| `src/features/clients/ClientRow.tsx` | свайп собран на сырой библиотеке; на ЛЕВОЙ кромке ДВЕ кнопки; ротор VoiceOver не видит ни один глагол | `SwipeRow`, одно действие на кромку, второе — в меню долгого нажатия |
| `app/(dashboard)/cabinet/`: `app/(dashboard)/cabinet/inventory.tsx`, `app/(dashboard)/cabinet/templates.tsx`, `app/(dashboard)/cabinet/sms-templates.tsx`, `app/(dashboard)/cabinet/recurring.tsx`, `app/(dashboard)/cabinet/masters/index.tsx`, `app/(dashboard)/cabinet/team-access.tsx`, `app/(dashboard)/cabinet/account.tsx` | сырой `Modal animationType="slide"` вместо `BottomSheet` | рецепт «Метки» |
| `app/(dashboard)/chats/[id].tsx` | два сырых листа: выбор клиента написан заново | `ClientPickerSheet` |
| `src/features/clients/BulkSmsSheet.tsx` · `src/features/clients/import/ImportWizardSheet.tsx` · `src/features/appointments/CrewAppointmentSheet.tsx` | сырые листы; у первого своя «✕» в шапке | `BottomSheet`, закрытие скримом |
| `app/(dashboard)/cabinet/recurring.tsx` — дата «Последнего ТО» | компактный нативный пикер | `DateWheelSheet`; **сперва экран должен уйти с сырого `Modal`** — лист в листе iOS не покажет |
| 9 мест | `borderRadius` числом (12, 20, 13, 15, 9, 36) | `t.radius.card` / `t.radius.pill` |
| 27 мест | `borderRadius: 999` литералом | `t.radius.pill` |

Полный список и порядок работ — `docs/audit/UNIFICATION-2026-09-10.md`
(в корне репозитория).

## 9.4 Блоки формы долга — на ветке другой сессии

Блоки «Клиент», «Категория» и «Время» формы долга собирает параллельная
сессия на ветке `feat/unified-expo-web` (коммиты «блок категории — свой, и
один на весь продукт», «блок времени — тот же, что в доходе»). После слияния
их карточки добавляются сюда тем же коммитом — иначе каталог опять начнёт
отставать от продукта.

## 10. Что ещё НЕ компонент (и потому копируется глазами)

Блоки «Клиент», «Объект» и «Услуги» живут разметкой внутри
`app/book/index.tsx` (3400 строк). Пока это так, «взять готовый блок» значит
«скопировать из указанной строки», а не «поставить один тег». Вынести их в
`BookClientBlock`, `BookObjectBlock`, `BookServicesBlock` — ближайший шаг:
тогда каждая карточка выше сократится до трёх строк, а этот файл перестанет
дублировать разметку.

Уже компоненты и копируются одним тегом: `ObjectFields`, `ClientPickerSheet`,
`ObjectPickerSheet`, `LabelPickerSheet`, `TagPickerSheet`, `ServicePicker`,
`ReferenceBlock`, `CategoryBlock`, `EventTypeBlock`, `PaymentBlock`,
`AppointmentFilesBlock`, `InlineNoteField`, `TeamLabelRow`, `WhenRow`,
`TotalRow`, `SelectRow`.
