import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");
const page = () => read("../../../app/(dashboard)/clients/[id].tsx");
// Люди карточки, жильцы и дверь связи вынесены со страницы (правило 400 строк):
// сторожа ниже смотрят туда, где этот код живёт теперь.
const people = () => read("ClientPeopleDoor.tsx");
const door = () => read("ClientLinkDoor.tsx");

// СТРАНИЦА КЛИЕНТА: ФУТЕР, ЛЮДИ КАРТОЧКИ, ЖИЛЬЦЫ (STORY-086, волна 2).
//
// Страница — сборщик: своей логики у неё почти нет, есть порядок и проводка.
// Именно такое ломается молча, «заодно», при следующей правке рядом, и ни
// одна чистая функция этого не покажет — поэтому сторож смотрит в исходники,
// как соседние `object-residents-contract` и `client-links`. Импортировать
// экран нельзя: за ним тянется react-native, которого в node:test нет.

describe("единственное действие черновика — внизу", () => {
  test("«Готово» из правого верхнего угла снесено целиком", () => {
    const chrome = read("ClientDetailChrome.tsx");
    // Ищется КНОПКА, а не слово: почему её нет, объяснено в самом файле
    // комментарием, и сторож по слову краснел бы на объяснении. Слово кнопки
    // в коде стоит в прямых кавычках, в комментариях — в «ёлочках».
    assert.doesNotMatch(chrome, /"Готово/, "в хроме снова кнопка «Готово»");
    assert.doesNotMatch(chrome, /onSave/, "хром снова сохраняет черновик сам");
    assert.doesNotMatch(page(), /onSave=/, "страница снова отдаёт хрому сохранение");
  });

  test("футер стоит внутри KeyboardAvoidingView, вне прокрутки, только у черновика", () => {
    const src = page();
    const scrollEnd = src.indexOf("</ScrollView>");
    const footer = src.indexOf("<ClientScreenFooter");
    const kavEnd = src.indexOf("</KeyboardAvoidingView>");
    assert.notEqual(footer, -1, "футер черновика пропал со страницы");
    assert.ok(
      scrollEnd < footer && footer < kavEnd,
      "футер уехал в прокрутку или за клавиатуру — кнопка уйдёт под неё ровно тогда, когда в неё целятся",
    );
    assert.match(
      src,
      /\{isDraft \? \(\s*<ClientScreenFooter/,
      "футер у сохранённой карточки — у контактной базы нет единственного действия",
    );
    assert.match(src, /label="Создать клиента"/);
  });

  test("клавиатура не закрывает нижние поля: отступ на высоту безопасной зоны", () => {
    assert.match(
      page(),
      /<KeyboardAvoidingView[\s\S]{0,200}?keyboardVerticalOffset=\{insets\.top\}/,
      "KAV снова меряет себя без верхней зоны — нижние поля уйдут под клавиатуру",
    );
  });
});

describe("люди карточки — только у сохранённой и только целиком", () => {
  test("блок людей гейтится черновиком, правом и ответом сервера", () => {
    assert.match(
      people(),
      /const showLinks =\s*!isDraft && caps\.links && !members\.unavailable && !members\.isLoading;/,
      "блок людей перестал спрашивать право, сервер или первый ответ — «видно, но не всё» либо «пусто, пока несут»",
    );
    assert.match(people(), /const peopleRows = showLinks \?/);
    assert.match(
      page(),
      // Между ними стоит слот заметки клиента (владелец 23.09).
      // «Люди и связи» — функция компании (STORY-088): выключена — ни людей,
      // ни «Входит в».
      /memberOf=\{peopleOn \? people\.memberOfRows : undefined\}[\s\S]{0,400}?people=\{/,
      "страница перестала ставить люди и строку «чей он» в шапку",
    );
  });

  // ЛЮДИ — СВОИМ БЛОКОМ (владелец 22.09: «давай сделаем отдельным блоком
  // добавления человека»). Блок «Люди» с дверью «Добавить человека» — тот же
  // язык, что «Объекты» и «Добавить объект»; в листе контактов людей нет.
  test("люди — отдельный блок с дверью «Добавить человека», по праву", () => {
    const src = page();
    assert.match(
      src,
      // Между строками и дверью стоит «Все люди · N» — перечень длиннее
      // трёх уезжает на свою страницу (владелец 22.09).
      /<SectionCard title="Люди">\s*\{people\.peopleRows\}[\s\S]{0,500}?\{people\.onAddPerson \? \(\s*<ChooseRow\s+compact\s+icon=\{UserPlus\}\s+label="Добавить человека"\s+onPress=\{people\.onAddPerson\}/,
      "людей снова нет своим блоком с дверью «Добавить человека»",
    );
    assert.match(
      people(),
      /const onAddPerson =\s*showLinks && caps\.edit && !members\.isError\s*\?\s*\(\) => askLink\(\{ title: "Кто это", role: "" \}\)\s*:\s*isDraft && caps\.edit && caps\.links\s*\?\s*onDraftAddPerson\s*:\s*undefined;/,
      "дверь людей видна без права или при упавшем перечне, предрешает роль — либо пропала из нового клиента",
    );
    // В НОВОМ КЛИЕНТЕ дверь сперва создаёт клиента гейтом футера и на карточке
    // сразу поднимает «Кто это».
    assert.match(src, /if \(!canSave\) \{[\s\S]{0,120}notify\(draftReason/, "черновик без имени или номера молча не создаётся — причина не названа");
    assert.match(src, /onDraftAddPerson: \(\) => onDraftDoor\("person"\)/, "дверь в черновике не создаёт клиента");
    assert.match(src, /void saveDraft\(\{ open \}\)/, "дверь черновика не создаёт клиента");
    assert.match(src, /openPersonOnArrive: !isDraft && openOnArrive === "person"/, "карточка после создания не поднимает «Кто это»");
    for (const file of ["AddContactSheet.tsx", "ClientExtraContacts.tsx"]) {
      assert.ok(!/onPerson|onAddPerson|label: "Человек"/.test(read(file)), `${file} снова прячет людей в лист контактов`);
    }
  });

  test("упавший перечень говорит словами, а не пустым блоком с дверью", () => {
    const src = people();
    const rows = src.indexOf("const peopleRows = showLinks ?");
    const words = src.indexOf("Люди карточки сейчас не загрузились");
    assert.ok(rows !== -1 && words > rows, "ошибка перечня снова молчит");
    assert.match(
      src.slice(rows, words),
      /members\.isError \? \(/,
      "ошибка перечня снова молчит — пустой блок читается как «людей нет»",
    );
    assert.match(
      src,
      /const canWriteLinks = showLinks && caps\.edit && !members\.isError;/,
      "писать связи можно при упавшем перечне",
    );
    assert.match(
      src,
      /onAddResident: canWriteLinks\s*\?/,
      "дверь жильца не спрашивает, приехал ли перечень",
    );
    assert.match(
      page(),
      /\{\.\.\.\(peopleOn \? people\.residents : \{\}\)\}/,
      "страница перестала отдавать блокам жильцов",
    );
  });

  test("люди — строками в одну линию, без аватара", () => {
    const src = people();
    const rows = src.indexOf("const peopleRows = showLinks ?");
    assert.match(
      src.slice(rows, rows + 2500),
      /<ClientLinkRows\s+items=\{shownMembers\}\s+compact/,
      "люди снова высокими строками — четыре жильца съедают экран",
    );
    assert.ok(
      !/getAvatarHue|getInitials/.test(read("LinkRow.tsx")),
      "у строки человека снова аватар — владелец 22.09: «аватар не нужен»",
    );
  });

});

describe("ключ связи собирает и разбирает только писатель", () => {
  test("кого открыть и где он живёт — разбором писателя", () => {
    const src = people();
    assert.match(
      src,
      /parseLinkKey\(item\.key\)\?\.memberId/,
      "тап по строке связи открывает не по разбору писателя",
    );
    assert.match(
      src,
      /parseLinkKey\(item\.key\)\?\.locationId/,
      "место жильца берётся не из разбора писателя",
    );
    for (const own of [".key.split(", ".key.slice(", ".key.indexOf("]) {
      for (const file of [page(), src, door()]) {
        assert.ok(
          !file.includes(own),
          `страница снова разбирает ключ связи сама (${own}) — второй разборщик разойдётся с писателем молча`,
        );
      }
    }
  });

  test("курсор ставится в ключ, собранный тем же построителем", () => {
    assert.match(
      people(),
      /setRoleFocusKey\(linkKeyOf\(\{ memberId: member\.id, groupId, locationId \}\)\)/,
      "ключ фокуса собран не построителем писателя — курсор не найдёт свою строку",
    );
  });
});

describe("жильцы объекта — по месту связи, не по имени", () => {
  test("перечень под виллой фильтруется по id объекта", () => {
    const src = people();
    assert.match(
      src,
      /linkPlaceId\(item\) === loc\.id/,
      "жильцы ищутся не по id места — две виллы «Дом» делили бы одних жильцов",
    );
    for (const file of [src, page()]) {
      assert.doesNotMatch(
        file,
        /\.place\s*===/,
        "жильцы сверяются по подписи места — у двух объектов «Дом» она одна",
      );
    }
  });

  test("дверь жильца несёт роль «жилец» и место объекта", () => {
    assert.match(
      people(),
      /role: "жилец",\s*locationId: loc\.id,/,
      "дверь жильца потеряла роль или место — «лишний этап» вернулся",
    );
  });
});

describe("шторка связи — по уходу окна, не по таймеру", () => {
  test("выбор применяется в onExited шторки", () => {
    const src = people();
    assert.match(src, /onExited=\{onDoorExited\}/);
    assert.match(door(), /onExited=\{onExited\}/, "шторка связи не сообщает, что ушла");
    assert.match(
      src,
      /const onDoorExited = \(\) => \{[\s\S]{0,160}?afterDoor\.current = null;[\s\S]{0,80}?run\?\.\(\);/,
      "выбор больше не ждёт ухода шторки — курсор встанет в поле под чужим окном",
    );
    for (const file of [src, page(), door()]) {
      assert.ok(!file.includes("setTimeout"), "на странице появился таймер: он мерит анимацию, а не снятие окна");
    }
  });
});

describe("строка «чей он» приходит готовой", () => {
  test("MemberOfLine ничего не собирает и не выдумывает имени", () => {
    const line = read("MemberOfLine.tsx");
    assert.doesNotMatch(
      line,
      /"Без имени"/,
      "у строки связи снова свой запасной вид — построитель такую связь не отдаёт вовсе",
    );
    assert.match(line, /\{line\}/, "строка перестала печатать готовый текст построителя");
  });

  test("строка списка зачитывает связь сразу за именем", () => {
    assert.match(
      read("ClientRow.tsx"),
      /client\.full_name \|\| "Без имени",[\s\S]{0,400}?link \?\? "",/,
      "VoiceOver называет Екатерину без «жена · Павел Иванов», а глазами это видно",
    );
  });
});

// ДО НАКАТА СВЯЗЕЙ — БЛОКА НЕТ, А НЕ СТРОКА ОШИБКИ (22.09). Функции
// `list_client_members` на сервере ещё не было, и КАЖДАЯ карточка клиента
// показывала «Люди карточки сейчас не загрузились». Отсутствующая функция —
// выключенная возможность, а не сбой.
describe("связи до наката миграции", () => {
  test("«функция не найдена» гасит блок, а не рисует ошибку", () => {
    const src = read("use-client-links.ts");
    assert.match(src, /new Set\(\["PGRST202", "42883"\]\)/, "не узнаём ответ «функции нет»");
    assert.match(
      src,
      /isError: !notOnServer && query\.isError && members === undefined,/,
      "отсутствующая функция снова читается ошибкой — строка «не загрузились» на каждой карточке",
    );
    assert.match(
      src,
      /unavailable: unavailable \|\| notOnServer,/,
      "без функции на сервере блок людей и двери связей остаются на странице",
    );
  });
});

// СЦЕНАРИЙ (г-б): ЧЕЛОВЕКА НЕТ — «СОЗДАТЬ КЛИЕНТА» ИЗ ШТОРКИ СВЯЗИ (STORY-086).
//
// Цепочка длинная: шторка → адрес черновика → параметры маршрута → черновик
// со связью → гейт по одному имени → одна запись → возврат к карточке-группе.
// Оборви любое звено — кнопка пропадёт, связь потеряется по дороге или
// черновик потребует номер, которого у жильца нет.

// Адрес собирает и разбирает чистое ядро черновика: его зовём, а не читаем.
type DraftCore = Pick<
  typeof import("./useClientDraft"),
  "draftLinkParams" | "draftLinkFromParams" | "draftCanSave"
>;
const draftCore = await (async (): Promise<DraftCore> => {
  const source = read("useClientDraft.ts");
  const begin = source.indexOf("// ─── ЧИСТОЕ ЯДРО: НАЧАЛО");
  const end = source.indexOf("// ─── ЧИСТОЕ ЯДРО: КОНЕЦ");
  assert.ok(begin >= 0 && end > begin, "useClientDraft.ts: метки чистого ядра потеряны");
  const dir = mkdtempSync(join(tmpdir(), "babun-page-core-"));
  const copy = join(dir, "useClientDraft.core.ts");
  writeFileSync(copy, source.slice(begin, end), "utf8");
  try {
    return (await import(pathToFileURL(copy).href)) as DraftCore;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe("сценарий г-б: новый человек со связью", () => {
  test("связь доезжает адресом до черновика и обратно без потерь", () => {
    const params = draftCore.draftLinkParams(
      "natalia",
      { role: " жилец ", locationId: "villa-5" },
      { name: "Иван", phone: "99123456" },
    );
    assert.deepEqual(params, {
      linkGroup: "natalia",
      linkRole: "жилец",
      linkPlace: "villa-5",
      name: "Иван",
      phone: "99123456",
    });
    assert.deepEqual(draftCore.draftLinkFromParams(params), {
      groupId: "natalia",
      role: "жилец",
      locationId: "villa-5",
    });
  });

  test("пустое в адрес не кладётся, а связь без места и роли законна", () => {
    const params = draftCore.draftLinkParams("pavel", { role: "  " }, { name: "  " });
    assert.deepEqual(params, { linkGroup: "pavel" }, "пустой `?phone=` читался бы набранным номером");
    assert.deepEqual(draftCore.draftLinkFromParams(params), {
      groupId: "pavel",
      role: "",
      locationId: null,
    });
    assert.equal(
      draftCore.draftLinkFromParams({ linkGroup: "pavel", linkPlace: "  " })?.locationId,
      null,
      "пустое место стало пустой строкой — «места нет» у связи это `null`, а не \"\"",
    );
    assert.equal(
      draftCore.draftLinkFromParams({ linkRole: "жилец", linkPlace: "villa-5" }),
      null,
      "роль и место без карточки-группы стали связью — привязывать не к чему",
    );
  });

  test("связь из адреса открывает гейт по одному имени", () => {
    const linked = draftCore.draftLinkFromParams({ linkGroup: "natalia" }) !== null;
    const gate = {
      active: true,
      nameFilled: true,
      e164: null,
      phoneTyped: false,
      linked,
      duplicate: false,
      saving: false,
    };
    assert.equal(draftCore.draftCanSave(gate), true, "жильца без номера не создать");
    assert.equal(
      draftCore.draftCanSave({ ...gate, linked: false }),
      false,
      "без связи номер снова необязателен",
    );
    // Звенья между адресом и гейтом — проводкой: страница разбирает адрес и
    // отдаёт связь черновику, черновик кладёт её в `memberships` и из них же
    // спрашивает гейт.
    assert.match(
      page(),
      /const draftLink = isDraft \? draftLinkFromParams\(linkParams\) : null;/,
      "страница не читает связь из адреса",
    );
    assert.match(page(), /link: draftLink,/, "страница не отдаёт связь черновику");
    const hook = read("useClientDraft.ts");
    assert.match(hook, /memberships: link\?\.groupId\s*\?\s*\[/, "черновик не кладёт связь в memberships");
    assert.match(hook, /const linked = \(draft\.memberships\?\.length \?\? 0\) > 0;/);
    assert.match(hook, /draftCanSave\(\{[^}]*\blinked,/, "гейт не спрашивает связь черновика");
  });

  test("в шторке связи есть «Создать клиента», и она открывает черновик со связью", () => {
    assert.match(door(), /onCreate=\{onCreate\}/, "шторка связи снова без «Создать клиента»");
    const src = people();
    assert.match(src, /onCreate=\{onCreateLinked\}/, "страница не отдаёт шторке создание");
    assert.match(
      src,
      /router\.push\(draftHref\(draftLinkParams\(c\.id, link, prefill\)\)\)/,
      "черновик открывается без связи или без набранного в поиске",
    );
    assert.match(
      src,
      /const onCreateLinked = \([\s\S]{0,200}?afterDoor\.current = null;\s*setDoor\(null\);/,
      "вопрос двери не снимается — шторка зовёт создание без своего onExited",
    );
  });

  test("черновик со связью не отдаётся звавшему и возвращается к карточке-группе", () => {
    assert.match(
      page(),
      /const handBack = isDraft && pathname === "\/client" && !draftLink;/,
      "жилец из шторки уедет в ящик записи и подставится ей клиентом",
    );
    const hook = read("useClientDraft.ts");
    const save = hook.indexOf("const save = async");
    assert.match(
      hook.slice(save),
      /const firstGroup = groupIds\[0\];\s*if \(firstGroup\) \{\s*if \(router\.canGoBack\(\)\) router\.back\(\);/,
      "черновик со связью открывает карточку нового клиента поверх группы",
    );
    assert.match(
      hook.slice(save),
      // `d` — свежий черновик из ссылки: поле, дописанное при снятии
      // фокуса, должно уехать вместе с клиентом (аудит 22.09).
      /const d = draftRef\.current;[\s\S]*\.\.\.d,/,
      "связь уезжает не той же записью, что клиент",
    );
  });

  test("связь в черновике снимается жестом, черновик остаётся (дыра 13)", () => {
    const src = people();
    assert.match(
      src,
      /isDraft \? \(\s*<SwipeRow[\s\S]{0,120}?label="Убрать"[\s\S]{0,120}?onAction=\{\(\) => removeDraftLink\(row\.groupId\)\}/,
      "связь черновика снова не снимается — ошиблись дверью, и остаётся только «Удалить черновик»",
    );
    assert.match(
      src,
      /onDraftLinks\(\s*\(c\.memberships \?\? \[\]\)\.filter\(\(m\) => m\.group_id !== groupId\),?\s*\)/,
      "снятие связи не правит черновик",
    );
    assert.match(
      page(),
      /onDraftLinks: \(memberships\) => updateDraft\(\{ memberships \}\)/,
      "страница не пускает снятие связи в черновик",
    );
  });

  test("причина под кнопкой не требует номер у черновика со связью", () => {
    assert.match(
      page(),
      /e164 === null && \(!draftLinked \|\| draftPhoneTyped\)/,
      "черновик жильца снова пишет «Нужен номер телефона» при яркой кнопке",
    );
  });
});

// ОБЪЕДИНИТЬ С ДУБЛЕМ — ПУНКТ «⋯» (кнопку из плашки убрали 22.09: внутри
// содержимого кнопок нет). Слияние необратимо, поэтому сторожится трижды:
// кто видит пункт, что стоит перед подтверждением и в каком порядке пишется.
describe("«Объединить с дублем» в «⋯» карточки", () => {
  const merge = () => read("use-merge-duplicate.ts");

  test("пункт есть только при дубле и праве управлять, не у черновика и не у архива", () => {
    const src = merge();
    assert.match(
      src,
      /const eligible =\s*!!client && !isDraft && !client\.deleted_at && canManage &&/,
      "пункт слияния перестал спрашивать черновик, архив или право управлять",
    );
    assert.match(
      src,
      /const dupId = useDuplicateOf\(eligible \? client : null\);/,
      "дубль ищется не тем же поиском, что у плашки, или без права",
    );
    assert.match(
      src,
      /if \(!eligible \|\| !client \|\| !dupId\) return undefined;/,
      "обработчик отдаётся без дубля или без права — пункт висит в меню впустую",
    );
    assert.match(
      page(),
      /useMergeDuplicate\(\{ client: c, isDraft, canManage: caps\.manage,/,
      "страница передаёт слиянию не то право",
    );
    assert.match(page(), /onMerge=\{onMerge\}/, "страница не ставит пункт в меню");
    assert.match(
      read("ClientDetailChrome.tsx"),
      /\.\.\.\(onMerge\s*\?\s*\[/,
      "хром рисует пункт без обработчика",
    );
  });

  test("перед подтверждением стоит mergeBlocker, с причиной — тост и стоп", () => {
    const src = merge();
    const handler = src.slice(src.indexOf("return () => {"));
    const blocker = handler.indexOf("mergeBlocker(primary, dup, peopleIdsOf(");
    const stop = handler.indexOf("if (blocker || !dup) {");
    const confirm = handler.indexOf("confirmThen(");
    assert.ok(blocker > -1, "слияние больше не спрашивает mergeBlocker");
    assert.ok(stop > blocker && confirm > stop, "подтверждение спрошено раньше, чем причина отказа");
    assert.match(
      handler.slice(stop, confirm),
      /toast\(blocker \?\? "Не удалось объединить", "error"\);\s*return;/,
      "причина отказа не сказана словами или слияние идёт дальше",
    );
    assert.match(
      src,
      /if \(members\.isLoading \|\| members\.isError\) return null;/,
      "люди дубля в пути или с ошибкой сошли за «людей нет»",
    );
  });

  test("порядок: патч основной → записи дубля → архив дубля", () => {
    const src = merge();
    const body = src.slice(src.indexOf("const merge = async"), src.indexOf("return () => {"));
    const patch = body.indexOf("await updateById.mutateAsync({ id: primary.id, patch })");
    const appts = body.indexOf("await updateAppt.mutateAsync({ id: a.id, patch: { client_id: primary.id } })");
    const archive = body.indexOf("await archive.mutateAsync({ ids: [dupRow.id] })");
    assert.ok(patch > -1 && appts > -1 && archive > -1, "шаг слияния пропал");
    assert.ok(patch < appts && appts < archive, "порядок слияния сломан");
    assert.match(
      body,
      /if \(res\.failed > 0 \|\| res\.archived === 0\) \{\s*throw new Error\("Карточка объединена, но дубль не ушёл в архив"\);/,
      "неудача архива снова сходит за успех",
    );
    assert.match(body, /if \(running\.current\) return;\s*running\.current = true;/, "двойной тап снова сливает дважды");
  });
});

// РАЗДЕЛИТЬ КЛИЕНТА — ПУНКТ «⋯» (STORY-086, сценарий ж «Сплит»). Номер жены
// уезжает из карточки Павла новым клиентом со связью. Три обещания, и каждое
// ломается молча: пункт без номеров — кнопка, которая ничего не делает;
// шторка в тот же кадр, что уходит меню, — на iOS её просто нет; номер,
// убранный ДО создания, — потерян, если создание не прошло.
describe("«Разделить клиента» в «⋯» карточки", () => {
  const hook = () => read("use-split-client.ts");
  const splitCore = () => read("split-client.ts");
  const draftHook = () => read("useClientDraft.ts");

  test("пункт есть только у сохранённой карточки с правами и дополнительными номерами", () => {
    assert.match(
      splitCore(),
      /if \(!client \|\| isDraft \|\| !canEdit \|\| !canLinks\) return false;/,
      "пункт сплита перестал спрашивать черновик или права",
    );
    assert.match(
      splitCore(),
      /return splittablePhones\(client\)\.length > 0;/,
      "пункт сплита больше не требует дополнительных номеров",
    );
    assert.match(
      hook(),
      /const eligible = canSplitClient\(\{ client, isDraft, canEdit, canLinks \}\);/,
    );
    assert.match(hook(), /const onSplit = eligible\s*\?/, "обработчик отдаётся без номеров — пункт висит впустую");
    assert.match(
      page(),
      /useSplitClient\(\{ client: c, isDraft, canEdit: caps\.edit, canLinks: caps\.links && peopleOn, menuOpen \}\)/,
      "страница передаёт сплиту не те права",
    );
    assert.match(page(), /onSplit=\{split\.onSplit\}/, "страница не ставит пункт в меню");
    assert.match(
      read("ClientDetailChrome.tsx"),
      /\.\.\.\(onSplit\s*\?\s*\[\s*\{\s*id: "split",\s*label: "Разделить клиента"/,
      "хром рисует пункт без обработчика",
    );
  });

  test("шторка «Кого выносим» поднимается после ухода меню, без таймера", () => {
    assert.match(read("ClientDetailChrome.tsx"), /onExited=\{onMenuExited\}/, "меню не сообщает, что ушло");
    assert.match(page(), /onMenuExited=\{split\.onMenuExited\}/);
    const src = hook();
    assert.match(
      src,
      /if \(menuGone\.current\) openPick\(\);\s*else afterMenu\.current = openPick;/,
      "шторка поднимается, не дождавшись ухода меню",
    );
    assert.match(src, /menuGone\.current = true;\s*const next = afterMenu\.current;/);
    assert.doesNotMatch(src, /setTimeout/, "сплит снова ждёт меню таймером");
    assert.match(src, /title: "Кого выносим"/);
  });

  test("номер уходит из исходной ПОСЛЕ создания и из свежей строки кэша", () => {
    const src = draftHook();
    const body = src.slice(src.indexOf("const save = async"));
    const created = body.indexOf("await create.mutateAsync(");
    const drop = body.indexOf("if (split) await dropSplitPhone(split, e164);");
    const leave = body.indexOf("if (forBooking) {");
    assert.ok(created > -1 && drop > -1, "шаг сплита пропал из сохранения черновика");
    assert.ok(created < drop, "номер убирается из исходной раньше, чем создан клиент");
    assert.ok(drop < leave, "номер убирается уже после ухода с черновика");
    assert.equal(src.split("dropSplitPhone(").length - 1, 1, "номер убирается ещё где-то, кроме сохранения");
    assert.match(
      src,
      /\.getQueriesData<Client \| null>\(\{ queryKey: \["client", ref\.sourceId\] \}\)/,
      "патч исходной снова собирается не из свежей строки",
    );
    assert.match(
      src,
      /catch \{\s*haptics\.warning\(\);\s*notify\("Номер остался и в исходной карточке — уберите его там вручную"\);/,
      "сбой патча исходной больше не сказан словами",
    );
  });

  test("адрес сплита — черновик со связью с исходной и без роли", async () => {
    const core = (await import("./split-client")) as typeof import("./split-client");
    const params = core.splitDraftParams("pavel", {
      id: "p-wife",
      number: "+357 99 123456",
      label: "Жена",
      name: "Мария",
    });
    assert.deepEqual(draftCore.draftLinkFromParams(params), {
      groupId: "pavel",
      role: "",
      locationId: null,
    });
    assert.deepEqual(core.parseSplit(params.split), { sourceId: "pavel", phoneId: "p-wife" });
  });
});

// ПРАВКА ЧЕЛОВЕКА ОБНОВЛЯЕТ ЧУЖИЕ БЛОКИ «ЛЮДИ» (22.09): номер Марии
// записался, а у Павла в «Людях» она осталась без трубки — владелец принял
// это за несохранение.
describe("правка клиента и блоки людей", () => {
  test("обе правки клиента сбрасывают перечни людей", () => {
    const q = read("queries.ts");
    const hits = q.match(/qc\.invalidateQueries\(\{ queryKey: \["client-members"\] \}\);/g) ?? [];
    assert.equal(hits.length, 2, "правка клиента не сбрасывает «Людей» других карточек");
  });
});

describe("первый блок карточки — с именем", () => {
  // Владелец 22.09 выбрал вариант 2: у первого блока, как у «Люди» и
  // «Объекты», своя шапка «КЛИЕНТ», безымянной карточки на странице нет.
  test("имя и номера стоят в блоке «Клиент»", () => {
    const header = read("ClientHeader.tsx");
    assert.match(header, /<SectionCard title="Клиент">/);
    assert.doesNotMatch(header, /<RowGroup>/);
  });
});

describe("блок «История»", () => {
  // Владелец 22.09: визиты и деньги — это история; тап — полный перечень.
  // Сводка и «Записать» — один блок с шапкой, а не две безымянные карточки.
  test("сводка и «Записать» стоят в блоке «История»", () => {
    const row = read("ClientContactRow.tsx");
    assert.match(row, /<SectionCard title="История">\s*<ClientSummaryCard/);
    assert.match(row, /label="Записать"/);
    assert.doesNotMatch(read("ClientHeader.tsx"), /<ClientSummaryCard/);
    assert.match(page(), /<ClientContactRow[\s\S]{0,600}onOpenHistory=\{/);
  });
});

describe("новый клиент — те же блоки", () => {
  // Владелец 22.09: «при создании — те же самые блоки, что у созданного».
  // Файл и запись живут у id карточки: дверь сперва создаёт её, потом
  // открывает нужное уже на ней.
  test("«Файлы» и «История» стоят и в черновике", () => {
    assert.match(read("ClientProfileBlocks.tsx"), /draft && showDocuments[^\n]*onDraftFiles \? \(\s*<SectionCard title="Файлы">/);
    assert.match(read("ClientContactRow.tsx"), /if \(draft\) \{\s*return onDraftBook \? \(\s*<SectionCard title="История">/);
  });
  test("двери черновика создают карточку и открывают своё", () => {
    assert.match(page(), /onDraftFiles=\{\(\) => onDraftDoor\("files"\)\}/);
    assert.match(page(), /onDraftBook=\{\(\) => onDraftDoor\("book"\)\}/);
    assert.match(page(), /openOnArrive === "files"/);
    assert.match(page(), /openOnArrive === "book"/);
  });
});
