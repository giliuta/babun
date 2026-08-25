# Аудит страницы «Финансы» — 2026-08-16

13 линз × адверсарная сверка. Всего находок: 287, после дедупа: 208, подтверждено скептиками: 50, опровергнуто: 1, мелкие без сверки (P2-полировка/P3): 138.

Статусы проставляются по ходу починки: [ ] открыто · [x] починено · [~] частично · [-] отклонено.


## Подтверждённые находки

### [x] C0 · P0 · bug · `../../packages/shared/src/db/repositories/finance-transactions.ts:473`
**Правка операции не пересчитывает НДС: триггер только BEFORE INSERT, vat_amount остаётся от старой суммы/режима**

updateTransaction патчит amount и vat_mode (`if (patch.vat_mode !== undefined) update.vat_mode = patch.vat_mode;` стр. 473, amount стр. 463), но серверный триггер объявлен `create trigger trg_fill_transaction_vat before insert on public.finance_transactions` (../../apps/web/supabase/migrations/20260809110000_vat.sql:120-122; фикс 20260810170100 переопределяет только функцию, не событие). Правка дохода 480→600 (НДС 19%, vat_amount 76.64) оставляет vat_amount=76.64; смена режима на «Без НДС» в OperationSheet тоже не чистит снимок — summarizeVat, страница НДС и CSV-выгрузка (export.ts:83-91 читает tx.vat_amount) печатают неверный налог. Канон: «вся математика в applyTxVat», а тут в базе лежит налог, не согласованный с суммой.
[дубль линзы operations: Правка суммы/режима НДС не пересчитывает снимок налога — НДС-отчёт врёт]

**Фикс:** Пересоздать триггер как `before insert or update of amount, vat_mode, account_id, team_id`, при явном vat_mode='none' обнулять снимок и на update; до миграции — слать пересчитанные vat_rate/vat_amount из updateTransaction.

**Сверка (high):** Confirmed: trg_fill_transaction_vat is BEFORE INSERT only (20260809110000_vat.sql:119-122; 20260810170100 replaces just the function), updateTransaction patches amount/vat_mode without any VAT fields, and OperationSheet edit sends exactly that patch, so vat_rate/vat_amount stay stale and summarizeVat/export read the stale snapshot. Caveat on the fix: simply adding "or update" is not enough — on UPDATE, NEW.vat_amount inherits the old snapshot, so the function's "respect explicit snapshot" early-return would skip recompute; it must branch on TG_OP (recompute/clear on UPDATE) or the invoice-snapshot rule must be preserved another way.

### [x] C6 · P0 · bug · `src/features/finances/OperationSheet.tsx:351`
**Правка операции не пересчитывает НДС-снимок: vat_amount замирает при смене суммы и режима**

save() шлёт только amount (новый гросс) и vat_mode (OperationSheet.tsx:351-363, в draft нет vat_amount/vat_rate); updateTransaction пишет лишь vat_mode (../../packages/shared/src/db/repositories/finance-transactions.ts:462-473, в TransactionDraft:371-396 полей vat_rate/vat_amount нет), а в проде триггер trg_fill_transaction_vat объявлен BEFORE INSERT — на UPDATE налог не считает никто. Сценарий: доход 476 € (НДС 76, ставка 19) отредактировали до 119 € → строка: amount 119, vat_amount 76, vat_rate 19 — экспорт печатает «Без НДС» 43 €; переключение клавиши на «Без НДС» при правке оставляет vat_amount 76, и summarizeVat/CSV продолжают считать налог. У живого тенанта НДС включён (exclusive 19), ручные доходы редактируемы — путь боевой.
[дубль линзы money-math: Правка exclusive-операции пересчитывает валовую сумму по ТЕКУЩЕЙ ставке, а не по снимку операции]
[дубль линзы data-layer: Редактирование операции пересчитывает сумму по ТЕКУЩЕЙ ставке НДС, а не по снимку операции]
[дубль линзы tests: Правка старой операции «плюс НДС» после смены ставки молча меняет сумму на счёте]

**Фикс:** Навесить fill_transaction_vat также BEFORE UPDATE OF amount, vat_mode, account_id, team_id (со сбросом старого снимка перед пересчётом), либо при апдейте с клиента слать пересчитанный снимок и явно занулять vat_rate/vat_amount при vat_mode='none'.

**Сверка (high):** Подтверждено по коду: save() при правке шлёт только amount и vat_mode (OperationSheet.tsx:351-363), TransactionDraft/updateTransaction (finance-transactions.ts:371-396, 449-487) не имеют и не пишут vat_rate/vat_amount, а trg_fill_transaction_vat создаётся строго BEFORE INSERT (миграции 20260809110000_vat.sql:120-122 и прод-снимок PROD-SCHEMA-SNAPSHOT-2026-08-10.sql:873; единственный BEFORE UPDATE триггер — set_updated_at). summarizeVat читает сохранённый t.vat_amount (vat.ts:134), так что замерший снимок реально попадает в сводки/экспорт; перехвата выше или ниже нет, и это не задумка (комментарий в TransactionDraft прямо возлагает поддержание снимка на триггер). Предложенный фикс корректен; надёжнее серверный вариант (BEFORE INSERT OR UPDATE OF amount, vat_mode, account_id, team_id с обнулением снимка при vat_mode='none').

### [x] C15 · P0 · bug · `../web/supabase/migrations/20260727100001_shared_accounts.sql:884`
**Сервер до сих пор запрещает перевод между бригадами — весь новый лист перевода упирается в отказ**

record_account_transfer (последнее определение в репо): «if from_account.scope = 'team' and to_account.scope = 'team' and from_account.brigade_id <> to_account.brigade_id then raise exception 'Перевод между командами идёт через счёт компании'». Миграция 20260815150000_accounts_belong_to_one_team.sql перевела ВСЕ счета в scope='team' с разными brigade_id и обещает «убирая её, мы убираем и запрет», но ни одна миграция после 20260727100001 функцию не переопределяет (grep по всем *.sql: только 20260720210006 и 20260727100001). Клиент запрет снял: transferPairError (../../packages/shared/src/local/finance/integrity.ts:89-96) пропускает любую пару, тест transfer-options.test.ts:109-111 утверждает «ЛЮБАЯ пара допустима», UI группирует получателей по чужим командам. Итог: каждый межбригадный перевод проходит клиентскую валидацию, кнопка активна, а сервер отвечает «…через счёт компании» — про сущность, которой в продукте больше нет и которую нельзя создать.

**Фикс:** Миграцией переопределить record_account_transfer, удалив блок строк 884-887 (и заодно проверить list_payment_accounts_safe и прочие функции на тот же реликт). До выката миграции межбригадный перевод в проде не работает вовсе.

**Сверка (high):** Подтверждено: последнее определение record_account_transfer (20260727100001, стр. ~884) бросает исключение для пары team/team с разными brigade_id; миграция 20260815150000 перевела все счета в scope='team' и функцию не переопределила, а клиент (transferPairError, integrity.ts:89-96) запрет снял и зовёт RPC напрямую (finance-transactions.ts:596) — каждый межбригадный перевод падает на сервере. Предложенный фикс верен.

### [x] C1 · P1 · bug · `../../packages/shared/src/db/repositories/finance-transactions.ts:490`
**Доход с возвратами можно удалить: возвраты становятся сиротами, остаток счёта занижается**

deleteTransaction фильтрует только `.eq("source","manual").neq("type","transfer").is("invoice_id", null)` (стр. 494-500) — наличие возвратов не проверяется ни тут, ни в TransactionPopup (canDelete = `!isAppointmentLedger && !tx.invoice_id && tx.type !== "transfer"`, src/features/finances/TransactionPopup.tsx:124-125), ни на сервере (assert_finance_transaction_integrity на DELETE просто `return old`). FK объявлен `refund_of_id uuid references finance_transactions(id) on delete set null` (../../apps/web/supabase/migrations/20260528_002_finance_redesign.sql:54). Удаляем доход 100 с возвратом 100 → возврат остаётся и продолжает минусовать баланс (signedAmount), в «Разборе прибыли» вырастает ведро «Возвраты», а деньги на счёте занижены на 100.
[дубль линзы operations: Правка/удаление дохода с выданным чеком не трогает сам чек]

**Фикс:** Серверный guard: запрещать DELETE строки, на которую ссылаются type='refund' (raise exception), и в UI прятать «Удалить» при refundTotals.get(tx.id) > 0 с подсказкой «сначала удалите возвраты».

**Сверка (high):** Подтверждено по всем трём слоям: deleteTransaction (стр. 494-502) не проверяет возвраты, canDelete в TransactionPopup тоже, а на сервере DELETE-ветки assert_finance_transaction_integrity (актуальная версия в 20260727100001) и protect_invoice_payment_row пропускают ручной доход без инвойса; FK on delete set null оставляет возврат-сироту, который через signedAmount/listAccountBalanceDeltas продолжает минусовать баланс и падает в ведро «Возвраты» в breakdown.ts. Смягчение: сироту можно удалить вручную (она остаётся manual/без инвойса), т.е. состояние восстановимо — но молча врущий баланс в финансах оправдывает P1. Предложенный фикс корректен.

### [x] C2 · P1 · bug · `src/features/finances/OperationSheet.tsx:364`
**Правка суммы дохода вниз не проверяет уже сделанные возвраты — возвраты могут превысить доход**

Сохранение правки (`await update.mutateAsync({ id: transaction.id, patch: draft })`, стр. 364-365) не смотрит на refundedTotal — canSave (стр. 308-318) проверяет только сумму/счёт/дату. Серверный кап `if already_refunded + abs(new.amount) > greatest(original_income.amount, 0)` (../../apps/web/supabase/migrations/20260720210006_finance_integrity.sql:397) срабатывает ТОЛЬКО на строке возврата (`new.refund_of_id is not null`), а UPDATE самого дохода его не триггерит. Доход 100 с возвратом 80 правится на 50 → возвращено больше, чем получено; refundRemainingCents в попапе становится 0 задним числом, но леджер уже перекошен.

**Фикс:** На сервере в интегрити-триггере при UPDATE income с уменьшением amount проверять Σ существующих возвратов; в OperationSheet валидировать `amountNum >= refundedTotal` и называть причину словами.

**Сверка (high):** Подтверждено: кап Σвозвратов ≤ доход проверяется только в ветке `new.type='refund'` триггера (и в актуальной версии из 20260727100001_shared_accounts.sql:398 тоже), UPDATE самого manual-дохода проходит без него; клиентский updateTransaction и canSave/save в OperationSheet тоже не сверяют amount с refundedTotal (проп используется лишь чтобы спрятать «Создать возврат»). Сценарий 100→50 при возврате 80 реально проходит; предложенный фикс (серверная проверка в триггере + клиентская валидация amountNum >= refundedTotal) верен.

### [x] C3 · P1 · bug · `app/(dashboard)/finances/index.tsx:538`
**Возврат наследует НДС из текущих настроек счёта/команды, а не из исходного дохода**

handleRefund (стр. 538-550) копирует account_id/team_id/category_id/payment_method, но НЕ vat_mode. Триггер fill_transaction_vat для строки с пустыми vat-полями идёт в настройки «счёт → команда → компания» (../../apps/web/supabase/migrations/20260810170100_fill_transaction_vat_fix.sql:70-88) и извлекает налог из отрицательной суммы. Доход, записанный «Без НДС» (vat_mode='none'), при возврате получает vat_amount < 0 → summarizeVat.collected уменьшается на налог, которого не собирали; при сменившейся ставке (19→24) возврат уносит больше налога, чем пришло. Дубликат кода в app/accounts/[id]/index.tsx:315-332 ломается так же.
[дубль линзы vat: Возврат считает НДС по сегодняшним настройкам, а не по снимку исходного дохода]
[дубль линзы data-layer: Возврат создаётся без request_id — повтор после потерянного ответа задваивает возврат]
[дубль линзы tests: Ручной возврат не передаёт vat_mode — сервер навешивает на возврат чужой налог]

**Фикс:** Передавать в драфт возврата vat_mode исходной операции (tx.vat_mode ?? (tx.vat_amount ? "inclusive" : "none")); правильнее — научить триггер наследовать снимок оригинала по refund_of_id.

**Сверка (high):** Подтверждено по всей цепочке: оба handleRefund не передают vat_mode, insertTransaction шлёт vat_mode:null, триггер fill_transaction_vat для refund без vat-полей идёт в настройки счёт→команда→компания и извлекает налог из отрицательной суммы — возврат дохода «без НДС» получает vat_amount<0, а summarizeVat.collected/due занижаются на несобранный налог; перехвата нигде нет и это противоречит канону «три клавиши на операции». Поправка к фиксу: tx.vat_mode ?? … закрывает только случай 'none' — при налоговом доходе триггер всё равно пересчитает по СЕГОДНЯШНЕЙ ставке, поэтому надо дополнительно передавать пропорциональный снимок vat_amount (ветка «уважаем снимок») либо, как верно предложено, наследовать снимок в триггере по refund_of_id.

### [x] C4 · P1 · bug · `../../apps/web/supabase/migrations/20260727100001_shared_accounts.sql:1224`
**Оплата инвойса не переносит его НДС-снимок в проводку — чек и НДС-отчёт расходятся с инвойсом**

record_invoice_payment вставляет доход без vat-колонок (insert into finance_transactions (id, tenant_id, type, amount, currency, account_id, appointment_id, client_id, team_id, payment_method, notes, occurred_on, invoice_id, source), стр. 1224-1249) → fill_transaction_vat берёт режим счёта/команды, а не снимок инвойса (vat_percent/vat_amount на строке invoices). Инвойс с НДС 19% оплачен в кассу с vat_mode='none' → проводка и автогенерируемый чек (issue_receipt_for_income копирует new.vat_rate/new.vat_amount) выходят БЕЗ налога, summarizeVat не видит собранный НДС. Сам же vat-фикс декларирует «Явно переданный снимок уважаем: инвойс печатает свою ставку», но снимок никто не передаёт.

**Фикс:** В RPC проставлять vat_rate из инвойса и vat_amount пропорционально сумме платежа (amount × vat_amount/total), vat_mode — из режима инвойса; переводить наследование от счёта только для платежей без инвойса.

**Сверка (high):** Подтверждено чтением кода: record_invoice_payment (20260727100001, стр. 1224-1256) не пишет vat-колонки, клиент (invoice-payments.ts) их не передаёт, fill_transaction_vat при vat_amount is null наследует счёт→команда→компания, а issue_receipt_for_income копирует полученный vat в чек — снимок инвойса (invoices.vat_percent/vat_amount) игнорируется, чек и НДС-отчёт расходятся с инвойсом в обе стороны. Поправка к фиксу: у invoices НЕТ колонки vat_mode, брать «режим инвойса» неоткуда и не нужно — достаточно в RPC проставить vat_rate := invoice.vat_percent и vat_amount := round(amount × invoice.vat_amount / invoice.total, 2); ноль not null, ветка «уважаем снимок» триггера корректно отработает и для инвойса без НДС.

### [x] C5 · P2 · bug · `app/(dashboard)/finances/index.tsx:424`
**Плитка «Документы» считает отменённые (credit-noted) инвойсы как «ждут оплаты» и двоит их с «Долгами»**

invoiceSummary пропускает только `if (invoice.status === "void") continue;` (стр. 424), а calculateInvoiceSettlement для cancelled даёт remaining = max(0, total − paid) > 0 (invoice-ledger.ts:234-237 обнуляет remaining только у void). cancel_invoice ставит status='cancelled' именно у НЕоплаченного инвойса (20260809120000_receipts_and_credit_notes.sql:271) → отменённый инвойс попадает в openCount «ждут оплаты», хотя панель ниже показывает его серым «Отменён» (documents.ts:101,117). Одновременно invoicedAppointments (стр. 293-298) исключает cancelled → та же работа снова считается в «Долгах»: одни деньги в двух плитках, ровно то, что комментарий на стр. 277-288 запрещает.
[дубль линзы money-math: Плитка «Документы» выкидывает инвойсы без бригады, а панель показывает их в любом срезе — цифра и список расходятся]
[дубль линзы documents: Плитка «Документы» считает отменённые (cancelled) инвойсы как ждущие оплату]
[дубль линзы documents: Инвойс без бригады виден в панели в любом срезе, но никогда не попадает в счётчик плитки]
[дубль линзы period-scope: Плитка «Документы» считает сторнированные (cancelled) инвойсы как «ждут оплаты»]
[дубль линзы period-scope: Командный срез плитки «Документы» и панели расходится на инвойсах без бригады]

**Фикс:** В invoiceSummary пропускать и cancelled: `if (invoice.status === "void" || invoice.status === "cancelled") continue;` — симметрично множеству invoicedAppointments.

**Сверка (high):** Подтверждено: invoiceSummary (finances/index.tsx:424) пропускает только void, а calculateInvoiceSettlement обнуляет remaining лишь для void (invoice-ledger.ts:234-237); cancel_invoice ставит cancelled именно на неоплаченный инвойс, listInvoices его не фильтрует — отменённый инвойс попадает в openCount «ждут оплаты», хотя панель ниже показывает его как «Отменён». Фикс аудитора верен. Уточнение: возврат работы в «Долги» — задуманное поведение, а плитка «Документы» считает штуки, не деньги, так что суммы прибыли/долга не искажаются — врёт только счётчик, поэтому P2, а не P1.

### [x] C9 · P2 · bug · `src/features/finances/AccountCreateSheet.tsx:177`
**Создание счёта у тенанта без команд всегда падает с «Выберите команду счёта»**

Гейт формы: «teams.length > 0 && !teamId» — при нуле команд teamId=null пропускается, а комментарий уверяет «Счёт без бригады сервер принимает — это нормальный случай тенанта, у которого команд пока нет вовсе». Но submit шлёт scope:"team", brigade_id:null (строки 200-203), а общий репозиторий packages/shared/src/db/repositories/accounts.ts:157 в assertScopeConsistency бросает «Выберите команду счёта» при scope==='team' и пустой бригаде. Дверь реально открыта: app/accounts/settings.tsx:76 показывает «Добавить счёт» безусловно, teams там могут быть пустыми (onboarding с 2026-08-15 счета не заводит). Человек видит отказ про команду в форме, где вопроса о команде нет вовсе.

**Фикс:** Либо гасить кнопку с причиной «Сначала добавьте бригаду» (и дверью в /cabinet/teams) при teams.length===0, либо действительно позволить счёт без бригады: слать его с brigade_id null только если сервер такое принимает — сейчас клиентский assert в shared это режет до сети.

**Сверка (high):** Подтверждено по коду: гейт (AccountCreateSheet.tsx:179) пропускает teamId=null при teams.length===0, submit шлёт scope:"team", brigade_id:null, а клиентский assertScopeConsistency (packages/shared/src/db/repositories/accounts.ts:157) бросает «Выберите команду счёта» до сети — комментарий «сервер принимает» врёт, запрос до сервера не доходит. Дверь открыта: app/accounts/settings.tsx:76 показывает «Добавить счёт» без гейта на команды, а тенанты с 0 команд существуют. Верен только первый вариант фикса (гасить кнопку с «Сначала добавьте бригаду» + дверь в команды); второй (разрешить счёт без бригады) противоречит канону «счёт = одна бригада» 2026-08-15.

### [x] C10 · P2 · bug · `app/accounts/[id]/settings.tsx:273`
**Предусловие закрытия счёта всё ещё живёт по снесённому запрету перевода между бригадами**

hasTransferTarget исключает пары «team→team разных бригад»: «!(account.scope==="team" && b.scope==="team" && account.brigade_id !== b.brigade_id)». Но канон 2026-08-15 запрет снял: packages/shared/src/local/finance/integrity.ts:89-96 (transferPairError) прямо пишет «ЗАПРЕТА ПЕРЕВОДА МЕЖДУ БРИГАДАМИ БОЛЬШЕ НЕТ… недопустимых пар остаётся ровно две». Итог: у бригады с единственным счётом при закрытии с остатком accountNotEmptyAlert (строки 303-320) прячет кнопку «Перевести €N» и советует «заведите счёт, куда его перевести», хотя TransferSheet с этой же карточки переведёт деньги на счёт другой бригады без вопросов.
[дубль линзы transfers: Предусловие закрытия счёта живёт по отменённому правилу «между бригадами только через общий счёт»]
[дубль линзы edge-copy: Закрытие счёта: hasTransferTarget всё ещё запрещает перевод между бригадами]

**Фикс:** Заменить условие на зеркало transferPairError: цель есть, если существует другой активный счёт (b.id !== account.id && b.is_active). Спецветку про чужие бригады удалить.

**Сверка (high):** Подтверждено. settings.tsx:273-281 действительно исключает пары team→team разных бригад, тогда как канон 2026-08-15 (integrity.ts transferPairError:89-96 и transfer-options.ts, шапка «запрет ушёл целиком») разрешает любой другой активный счёт; TransferSheet с той же карточки покажет счета всех бригад и переведёт без вопросов. Значит у бригады с единственным счётом и остатком accountNotEmptyAlert прячет кнопку «Перевести €N» и печатает ложный совет «заведите счёт». Фикс аудитора верен: hasTransferTarget = activeAccounts.some(b => b.id !== account.id) (is_active в activeAccounts уже отфильтрован — проверить, но условие b.is_active безвредно). Бонус тем же заходом: в TransferSheet.tsx:233-236 остался мёртвый/лживый resetNotice «между бригадами перевод идёт через счёт, подключённый к обеим» — текст отменённого правила. Severity скорее P2: путь не заблокирован (перевод доступен с карточки), вред — спрятанная кнопка и врущий текст, не потеря денег.

### [x] C11 · P1 · copy · `src/features/finances/TransferSheet.tsx:234`
**Автосброс получателя в переводе объясняется снесённым правилом «через счёт, подключённый к обеим»**

pickFrom при transferPairError печатает и озвучивает: «Получатель сброшен: между бригадами перевод идёт через счёт, подключённый к обеим.» Правило удалено владельцем 2026-08-15 (сам файл на строках 317-321 пишет «ни запрета, ни общего счёта в продукте не осталось»), а transferPairError теперь срабатывает только на «тот же счёт» и «закрытый счёт». Ветка достижима: в шаге «Откуда» выбрать счёт, уже стоящий в «Куда», — и человек читает объяснение про сущность, которой в продукте нет.
[дубль линзы transfers: Автосброс получателя объясняется отменённым правилом про счёт, «подключённый к обеим» бригадам]
[дубль линзы edge-copy: Автосброс получателя в переводе печатает правило, которого больше нет]

**Фикс:** Печатать настоящую причину из transferPairError («Выберите разные счета» / «Перевод доступен только между активными счетами») вместо зашитого текста про общий счёт.

**Сверка (high):** Подтверждено: pickFrom (TransferSheet.tsx:227-238) печатает и озвучивает зашитый текст про «счёт, подключённый к обеим», хотя transferPairError (packages/shared/src/local/finance/integrity.ts:89-96) возвращает только «тот же счёт»/«неактивный счёт», а само правило снесено владельцем 2026-08-15 (комментарии в обоих файлах). Ветка достижима: список «Откуда» строится с from=null и не исключает счёт, уже стоящий в «Куда» (transfer-options.ts:74), так что один тап воспроизводит сценарий. Фикс аудитора верный — подставлять реальный текст из transferPairError(next, to).

### [x] C12 · P1 · ux · `app/accounts/[id]/index.tsx:627`
**На карточке счёта тап по проводке записи не открывает саму запись — нарушение канона**

onTxTap ленты: transfer→confirmDeleteTransfer, canEditTransaction→правка, иначе setPopupTx(tx). Ветки «tx.appointment_id → открыть запись» нет. На «Финансах» она есть и названа каноном: app/(dashboard)/finances/index.tsx:835-844 — «ДЕНЬГИ ПО ЗАПИСИ ОТКРЫВАЮТ САМУ ЗАПИСЬ (владелец 2026-08-15)… if (tx.appointment_id && openAppointment(tx.appointment_id)) return;». Авто-проводка (source==='auto') не проходит canEditTransaction (shared/local/finance/transaction.ts:113-118), поэтому на карточке счёта та же оплата открывает витрину-попап вместо записи.
[дубль линзы operations: На карточке счёта тап по проводке записи не открывает саму запись]

**Фикс:** Добавить ту же ветку через useInvoiceNavigation/openAppointment (с &from= для возврата), как на «Финансах», до проверки canEditTransaction.

**Сверка (high):** Confirmed: account-card onTxTap (app/accounts/[id]/index.tsx:627) lacks the appointment_id branch that Finances canonizes (finances/index.tsx:844); auto proводки fail canEditTransaction (transaction.ts:113-119) and land in TransactionPopup, which has no way to open the appointment — the local comment "та же дорога, что в «Финансах»" is stale. Fix correction: openAppointment is not in useInvoiceNavigation — it's a local helper in finances/index.tsx (line 566, pushOnce to /(dashboard)?appointmentId=…&from=finances); replicate it on the account card (appointments are already loaded) and pick a from= that returns to the account card, not the finances tab.

### [x] C13 · P2 · feature · `app/accounts/[id]/settings.tsx:388`
**Значок и цвет счёта нельзя изменить после создания — в настройках счёта их нет вовсе**

Группа «Основное» (строки 388-481) содержит Название/Вид/Остаток/Основной/Приём оплаты — ни строки про значок или цвет; grep по app/accounts и фичам не находит ни одного update.mutate с patch icon/color. При этом AccountCreateSheet.tsx:47 обещает «Правка существующего счёта живёт на странице его настроек», а значок/цвет — заявленный владельцем способ узнавать счёт (account-ui.ts:36-46, «добавь много иконок, чтоб можно было выбирать»). Счёт, созданный без значка (или с промахом по цвету), навсегда останется таким: колонки accounts.icon/color правятся только при создании.

**Фикс:** Добавить в «Основное» строки «Значок» и «Цвет» (та же сетка ACCOUNT_ICONS и общий ColorPicker, что в листе создания), пишущие update.mutate({patch:{icon}} / {color}).

**Сверка (high):** Подтверждено: в настройках счёта нет ни строки, ни мутации для icon/color; они пишутся только в AccountCreateSheet при создании, хотя её же комментарий (строка 47) обещает правку в настройках, а updateAccount в shared-репозитории уже принимает patch.icon/patch.color — фикс аудитора верен и дешёв. Единственная оговорка: пока icon=null, глиф косвенно меняется через «Вид» (KIND_ICON-фолбэк из 4 значков), но выбранный значок и цвет не правятся никак. Понижаю до P2: гэп чисто косметический, деньги/данные не затронуты.

### [x] C14 · P2 · design · `app/accounts/[id]/settings.tsx:489`
**Осиротевший счёт «Без бригады» невозможно отдать бригаде — обещанной двери нет**

Строка «Команда» с pickTeam рендерится только при account.scope==="team"; для legacy-счёта компании (brigade_id null, на проде это живой Revolut Business) группа «Команды» даёт лишь attach/detach по account_teams, которые владельца не меняют. При этом accounts-sections.ts:107-109 обещает: «как только владелец назначит им бригаду, чип исчезнет сам» — а назначить негде: pickTeam патчит только brigade_id и не трогает scope, да и для счёта с историей он погашен (hasHistory, строка 499). Деньги навечно застревают под чипом «Без бригады».

**Фикс:** Дать осиротевшему счёту строку «Передать бригаде»: патч {scope:'team', brigade_id} одной мутацией плюс серверное послабление guard_account_financial_history для случая brigade_id NULL→значение (перенос владельца, а не переписывание истории).

**Сверка (high):** Подтверждено: строка «Команда»/pickTeam есть только у scope="team" (settings.tsx:489,499), company-ветка даёт лишь attach/detach account_teams, которые чип не снимают (accountsTeamChips и accountServesTeam смотрят только brigade_id), а сторож guard_account_financial_history (20260811140000:52-61) блокирует и scope, и brigade_id при наличии операций — из-за него миграция 20260815150000 не смогла перенести живой Revolut Business (зафиксировано как незакрытый хвост, не канон). Преувеличено «деньги навечно застревают»: перевод между любыми счетами разрешён и hasTransferTarget для company-счёта пускает любой приёмник, так что остаток можно перевести и счёт закрыть — сломано обещание чипа, а не доступ к деньгам, поэтому P2. Фикс аудитора верный по направлению ({scope:'team', brigade_id} одной мутацией + послабление сторожа для brigade_id NULL→значение).

### [x] C16 · P1 · ux · `app/(dashboard)/finances/index.tsx:831`
**Тап по строке перевода в ленте открывает не витрину, а сразу диалог удаления**

onTxTap: «if (tx.type === "transfer") { confirmDeleteTransfer(tx); return; }» — то же на карточке счёта (app/accounts/[id]/index.tsx:628-631). Для всех остальных типов тап открывает правку или витрину; для перевода единственное действие тапа — Alert «Удалить перевод?» (account-alerts.ts:81-89), который не называет ни сумму, ни счета, ни дату. Человек, тапнувший «посмотреть, куда ушли €500», получает деструктивный вопрос без контекста; а перевод, задевающий закрытый счёт, вообще нельзя удалить (delete_account_transfer: «Один из счетов закрыт или недоступен») — тап всегда кончается ошибкой. Нарушает собственный закон экрана «тап открывает правку, а не витрину… витрина остаётся для того, что править нельзя» (строки 845-849).
[дубль линзы operations: Тап по переводу в ленте — сразу диалог удаления, деталей не посмотреть]
[дубль линзы ux-micro: Тап по переводу в ленте сразу открывает деструктивный алерт удаления]

**Фикс:** Для transfer открывать TransactionPopup (витрина уже умеет transfer: заголовок «Перевод», знак, canDelete его исключает) со строкой второй ноги и кнопкой «Удалить перевод» внутри. Alert оставить как подтверждение из попапа и добавить в message сумму и оба счёта.

**Сверка (high):** Подтверждено чтением кода: в обоих местах (finances/index.tsx:831-834 и accounts/[id]/index.tsx:628-631) onTxTap для type==="transfer" сразу вызывает confirmDeleteTransfer → Alert «Удалить перевод?» (account-alerts.ts deleteTransferAlert) без суммы/счетов/даты; TransactionsFeed ничего не перехватывает — строка перевода это обычный Pressable с onTxTap. Это противоречит собственному закону экрана строкой ниже («витрина остаётся для того, что править нельзя»), а TransactionPopup уже умеет transfer (знак на 107, canDelete исключает на 125) — то есть витрина готова, но недостижима. Также подтверждено: delete_account_transfer (shared_accounts.sql:988) кидает «Один из счетов закрыт или недоступен», так что тап по переводу с закрытым счётом всегда кончается ошибкой. Не задумка: комментарий рядом объясняет только почему удаление целиком, а не почему тап=удаление. Предложенный фикс корректен.

### [x] C19 · P1 · bug · `app/(dashboard)/finances/index.tsx:890`
**«Принять оплату» из вкладки «Чеки» никогда не рождает чек**

Кнопка (строки 890-896, комментарий обещает «кнопка делает то, ОТ ЧЕГО чек рождается») открывает OperationSheet доходом, но в форме вообще нет выбора клиента (draft на строках 352-363 не содержит client_id), а серверный триггер issue_receipt_for_income выходит сразу при client_id is null (проверено в проде). Пустое состояние DocumentsPanel.tsx:267 «Чек выписывается сам, как только вы примете оплату от клиента» для этой двери не исполняется никогда — доход запишется, чек не появится.
[дубль линзы documents: «Принять оплату» во вкладке «Чеки» создаёт доход без клиента — чек не рождается никогда]

**Фикс:** Добавить в OperationSheet необязательную строку «Клиент» (хотя бы для дохода) и класть client_id в draft; либо вести кнопку вкладки чеков в приём оплаты по записи, где клиент уже есть.

**Сверка (high):** Подтверждено по всей цепочке: кнопка «Принять оплату» (finances/index.tsx:886-896) открывает OperationSheet, чей draft (OperationSheet.tsx:352-363) не содержит client_id; insertTransaction кладёт client_id=null, а триггер issue_receipt_for_income (миграция 20260809120000, строка 71) выходит при client_id is null — чек с этой двери не рождается никогда, вопреки пустому состоянию вкладки. Это не задумка: канон требует чек на каждый приём денег ОТ КЛИЕНТА, а дверь клиента дать не может. Из двух предложенных фиксов правильнее второй — вести кнопку в приём оплаты по записи (клиент уже есть), а не добавлять пикер клиента в общую форму операции.

### [x] C20 · P1 · bug · `../../packages/shared/src/local/finance/transaction.ts:113`
**Операцию «Пересчёт кассы» можно отредактировать — сверка соврёт**

record_cash_count пишет коррекцию как source='manual' income/expense (prod), integrity-триггер автозаполняет ей team_id из счёта — значит canEditTransaction (строки 113-119) пускает её в OperationSheet, и сохранение проходит. Серверный guard_cash_count_transaction_delete закрывает только DELETE («сверка соврёт про разницу»), UPDATE свободен: изменил сумму коррекции — account_cash_counts.delta и леджер разъехались, история сверок врёт.
[дубль линзы vat: Приём оплаты в записи не даёт выбрать «Без НДС» — а auto-строку уже не исправить]
[дубль линзы documents: Правка и удаление дохода не трогают выданный чек — суммы документа и журнала расходятся]

**Фикс:** Расширить гвард на UPDATE (та же проверка exists account_cash_counts.transaction_id = old.id). На клиенте прятать правку таких строк — открывать витрину с текстом «создано пересчётом кассы».

**Сверка (high):** Подтверждено кодом и продом: коррекция пересчёта пишется как source='manual' income/expense без invoice_id, canEditTransaction её пускает, а в проде на finance_transactions гвард сверки висит только BEFORE DELETE (проверено pg_trigger; integrity-триггер про cash_counts не знает). Правка суммы до закрытия дня проходит, и account_cash_counts.delta расходится с леджером, который «Закрытие дня» читает как истину. Предложенный фикс верен (UPDATE-гвард + витрина вместо правки на клиенте).

### [x] C21 · P1 · bug · `src/features/finances/OperationSheet.tsx:260`
**Автовыбор счёта не выставляет способ оплаты — форма рождается с красной ошибкой**

Эффект умного дефолта (строки 260-265) делает setAccountId(def.id), но не setPayment — в отличие от ветки defaultAccountId (271-285) и ручного тапа по чипу (604-609). payment остаётся начальным 'cash', и если первый по position счёт команды не наличный, accountMismatch (238-243) истинен сразу: свежая форма показывает «Сохранённый счёт не подходит. Выберите доступный счёт заново» (725-727), а тап по подсвеченному чипу его ДЕСЕЛЕКТИТ (606-608), а не чинит.

**Фикс:** В эффекте дефолта звать setPayment(paymentMethodForAccountKind(def.kind)). Лучше — вообще убрать payment из состояния и выводить его из selectedAccount при сохранении: способ оплаты по канону выводится из счёта.

**Сверка (high):** Подтверждено чтением кода: эффект дефолта (OperationSheet.tsx:260-265) ставит только accountId, setPayment нигде не синхронизируется с выбранным счётом (единственные вызовы — гидрация 187/198, defaultAccountId-ветка 277, ручной тап 608), а isPaymentAccountCompatible — строгая биекция, поэтому при первом по position не-наличном счёте команды свежая форма сразу показывает красную ошибку 725-727, гасит canSave и тап по подсвеченному чипу деселектит (606-608). Это противоречит собственному канону файла («способ оплаты выводится из счёта»), т.е. баг, не задумка. Фикс аудитора верный; вариант с выводом payment из selectedAccount при сохранении лучше, но в edit-режиме надо сохранить приоритет payment_method существующей транзакции.

### [x] C22 · P1 · design · `src/features/finances/OperationSheet.tsx:401`
**OperationSheet — самописный Modal slide вместо канонического BottomSheet**

Строка 401: <Modal visible transparent animationType="slide"> с ручным скримом. Закон продукта (память bottom-sheet-canonical): все листы — единый BottomSheet (скрим fade на месте + пружина), «НЕ самописный Modal slide». Соседние финансовые листы уже мигрированы: TransferSheet.tsx:327, CashCountSheet.tsx:181, AccountCreateSheet.tsx:226 — OperationSheet единственный лист контура на старом примитиве.
[дубль линзы design-ds: OperationSheet — самодельный Modal-слайд вместо канонического BottomSheet]
[дубль линзы ux-micro: OperationSheet — самописный Modal slide вместо канонического BottomSheet]
[дубль линзы dead-code: OperationSheet, InvoicePaymentSheet и InvoiceRefundSheet — сырой Modal slide вместо канонического BottomSheet]
[дубль линзы edge-copy: Финансовые листы собраны самописными Modal вместо канонического BottomSheet]

**Фикс:** Пересадить OperationSheet на BottomSheet. Заодно уйдёт рассинхрон SHEET_EXIT_MS (см. находку про «Создать возврат»).

**Сверка (high):** Подтверждено: src/features/finances/OperationSheet.tsx:401 — сырой <Modal visible transparent animationType="slide"> с ручным скримом (th.scrim) и Pressable-подложкой, при этом все соседние финансовые листы (TransferSheet:327/459, CashCountSheet:181/262, AccountCreateSheet:226) уже на каноническом @/components/ui/BottomSheet (скрим fade + пружина, SHEET_EXIT_MS=260 экспортируется оттуда же). Это прямое нарушение закона «bottom-sheet-canonical», не задумка: лист по структуре тот же, что мигрированные соседи. Предложенный фикс верен; при пересадке учесть, что OperationSheet держит высоту 86% и KeyboardAvoidingView — проверить, что BottomSheet поддерживает фиксированную высоту/клавиатуру так же, как в TransferSheet.

### [x] C29 · P1 · bug · `../../packages/shared/src/db/repositories/invoice-payments.ts:129`
**Оплата инвойса и её автоматический чек берут НДС из настроек компании, а не из инвойса**

recordInvoicePayment передаёт в RPC только сумму/счёт/дату (invoice-payments.ts:129-140), record_invoice_payment в БД vat не трогает — строку дохода дозаполняет fill_transaction_vat по цепочке счёт→команда→компания. Инвойс, выставленный «Без НДС» или со ставкой 24%, оплачивается при настройке компании 19% → в леджере и в чеке RC-… (issue_receipt_for_income копирует vat из строки; печать «в т.ч. НДС» — src/features/documents/receipt-text.ts:38-40) появляется налог 19%, которого в инвойсе нет. Канон «оплачен → чек» даёт чек, противоречащий документу-основанию.

**Фикс:** В record_invoice_payment проставлять vat_rate из invoices.vat_percent и vat_amount пропорционально доле оплаты (mode — из режима инвойса); триггер уже уважает явно переданный снимок.

**Сверка (high):** Подтверждено: record_invoice_payment (20260727100001_shared_accounts.sql:1224) вставляет доход без vat_mode/vat_rate/vat_amount, поэтому BEFORE-триггер fill_transaction_vat (20260810170100) дозаполняет налог по цепочке счёт→команда→компания, игнорируя снимок инвойса (vat_percent/vat_amount в invoices есть); чек копирует vat из строки и печатает его (receipt-text.ts:38-40). Это не задумка — комментарий самого триггера требует уважать снимок инвойса, но RPC его не передаёт. Фикс аудитора верен; для инвойса «без НДС» передавать vat_mode='none' (одного vat_amount=null недостаточно — триггер уйдёт в настройки).

### [x] C30 · P1 · bug · `src/features/finances/vat-queries.ts:149`
**Тумблер «Работаем с НДС» не гасит налог, закреплённый за счётом или командой**

effectiveVatSettings: mode = accountMode ?? teamOverride?.mode ?? base.mode — «off» компании проигрывает пину счёта/команды, а ставка при выключении не зануляется (vat.tsx:108 пишет только mode:'off'). Для счёта с пином «НДС включён» vatVisible в OperationSheet:254 снова true — клавиши и налог живут при выключенном тумблере; серверный fill_transaction_vat делает то же: coalesce(a.vat_mode, s.vat_mode, t.vat_mode). При этом сам пин при выключенном НДС спрятан (app/accounts/[id]/settings.tsx:529 — vatOn ? ChoiceRow : дверь), снять его нельзя. Канон: тумблер гасит налог во всём продукте.
[дубль линзы edge-copy: Закреплённый на счёте/команде режим НДС воскрешает налог при глобальном «выключено»]

**Фикс:** При tenant.mode==='off' возвращать VAT_OFF независимо от пинов — и в effectiveVatSettings, и в SQL-функции (проверять t.vat_mode='off' до coalesce).

**Сверка (high):** Подтверждено чтением кода: vat-queries.ts:149 даёт пину счёта/команды победить tenant.mode='off', vat.tsx:108 не зануляет ставку при выключении, поэтому в OperationSheet:254 vatVisible=true и applyTxVat считает налог при выключенном тумблере — вопреки собственному комментарию на строке 253 и канону; при этом settings.tsx:529 прячет пин при vatOn=false, снять его нельзя. Фикс аудитора верен (при tenant.mode==='off' возвращать VAT_OFF до всех пинов); единственная оговорка — серверная fill_transaction_vat в репозитории отсутствует (живёт только в БД), эту половину проверить локально нельзя, но клиентская часть воспроизводится сама по себе.

### [x] C31 · P1 · bug · `src/features/finances/OperationSheet.tsx:175`
**Правка старой операции «Плюс НДС» после смены ставки молча меняет её сумму**

Гидрация показывает ввод по СТАРОЙ ставке (inputFromGross с tx.vat_rate, строки 175-183), а сохранение пересобирает гросс по ТЕКУЩЕЙ (applyTxVat с vat.rate, строка 351). Операция 476 € @19: подняли ставку до 24, открыли поправить заметку, нажали «Сохранить» → на счёт легло 496 €. Ломает обещание страницы НДС (vat.tsx:190-192 «если поднимете её завтра, прошлые отчёты не изменятся») и остаток счёта; vat_amount при этом ещё и не пересчитан (см. P0).
[дубль линзы edge-copy: Префилл денежных полей точкой («150.5») вместо формата продукта]

**Фикс:** При редактировании существующей операции считать applyTxVat по ставке из tx.vat_rate, пока оператор не менял клавиши/сумму; текущую ставку применять только к новым операциям.

**Сверка (high):** Подтверждено: гидрация считает поле по tx.vat_rate (OperationSheet.tsx:175-183), сохранение пересобирает гросс по текущей ставке (строка 351), updateTransaction пишет amount как есть, а триггер fill_transaction_vat висит только BEFORE INSERT — на счёт молча ложится 496 € вместо 476 при правке одной заметки, при этом vat_rate/vat_amount остаются старыми (снежный ком к P0). Ломает явное обещание vat.tsx:190-192. Затрагивает только режим «Плюс НДС» (для inclusive/none round-trip тождественен). Фикс аудитора верен по направлению; каноничнее: при isEdit передавать в applyTxVat ставку из tx.vat_rate (как триггер уважает сохранённый снимок), текущую vat.rate брать только для новых операций или после явного пере-нажатия клавиши НДС оператором.

### [x] C32 · P1 · bug · `app/invoices/new.tsx:106`
**Инвойс не знает ставку команды: греческая бригада получает кипрские 19%**

defaultVatMode/defaultVatPercent берутся только из useVatSettings компании (new.tsx:106-107); useTeamVatOverrides не читается, хотя prefill.teamId известен. Вся причина существования ставки на команду — «Кипр 19, Греция 24 одновременно» (vat-queries.ts:9-12) — для инвойсов не работает: счёт по записи греческой команды по умолчанию считается по 19%.

**Фикс:** Резолвить effectiveVatSettings по команде prefill/записи и передавать в InvoiceEditor; при смене команды в форме обновлять дефолт, пока ставку не трогали руками.

**Сверка (high):** Confirmed: new.tsx passes only tenant-level useVatSettings as defaultVatMode/Percent while prefill.teamId is known; InvoiceEditor seeds VAT once and ignores team, and no code path applies useTeamVatOverrides/effectiveVatSettings for invoices — although transactions (OperationSheet.tsx:247-248) and account settings do, so per-team VAT is established canon, not a deliberate invoice exception. Mitigation: VAT mode/percent are editable in the form, so it's a wrong default, not a hard lock. Fix as proposed, with two refinements: pass accountMode=null to effectiveVatSettings (invoices have no account), and the "update default on team change until touched" part must live inside InvoiceEditor (it owns the team picker), so overrides/resolver need to be passed down, not resolved only in new.tsx.

### [x] C36 · P1 · bug · `src/features/finances/queries.ts:129`
**Кэш чеков никогда не инвалидируется: новый чек не появляется после приёма оплаты**

invalidateLedger (queries.ts:129-133) сбрасывает только ["transactions"],["accounts"],["invoices"]; invalidateInvoices (src/features/invoices/queries.ts:75-78) и мутации оплаты/возврата инвойса (113-142), а также invalidateKeys календаря (src/features/calendar/mutations.ts:46-54) тоже не трогают ["receipts"] (ключ в src/features/documents/receipts-queries.ts:18). Сервер выписывает чек триггером в момент проводки, но открытая панель «Документы → Чеки» (staleTime 30с, src/lib/query-client.ts:52, SectionList без RefreshControl) не показывает его: человек жмёт «Принять оплату» прямо на вкладке чеков — и список не меняется. То же при гашении чека возвратом.

**Фикс:** Добавить qc.invalidateQueries({ queryKey: ["receipts"] }) в invalidateLedger, invalidateInvoices/мутации платежей и invalidateKeys календаря — везде, где журнал денег пишется.

**Сверка (high):** Подтверждено: ни один инвалидатор денежных мутаций (invalidateLedger, invalidateInvoices + payment/refund, calendar invalidateKeys) не сбрасывает ["receipts"], и нигде в приложении этот ключ не инвалидируется; чеки выписывает сервер при проводке, а открытая панель «Чеки» (SectionList без RefreshControl, staleTime 30с) остаётся смонтированной после «Принять оплату» и не обновляется — при том что её же empty state обещает «чек выписывается сам». Предложенный фикс верен; самолечение только через refocus приложения или ремоунт после 30с.

### [x] C37 · P1 · feature · `app/invoices/[id].tsx:452`
**Канонный флоу «отказ → credit note» недостижим: cancel_invoice никто не вызывает**

Единственная кнопка отказа — «Аннулировать инвойс» → updateInvoiceStatus → RPC void_invoice (../../packages/shared/src/db/repositories/invoices.ts:207-223, «void» жёстко). RPC cancel_invoice существует в базе (миграция 20260809120000:188-276) и встречается только в database.types.ts — grep по apps/mobile не находит ни одного вызова. Канон (ТЗ документов 2026-08-09): «кнопка отказа от инвойса создаёт credit note»; статус «Отменён» и метка INVOICE_STATUS_LABELS.cancelled есть, но получить их из приложения нельзя.

**Фикс:** Добавить на страницу инвойса действие «Отменить кредит-нотой» (вызов cancel_invoice) рядом с легаси-«Аннулировать», после починки серверного RPC (см. следующую находку).

**Сверка (high):** Подтверждено. Единственный отказной путь на странице инвойса — «Аннулировать инвойс» (app/invoices/[id].tsx:452) → updateInvoiceStatus, которая жёстко бросает исключение для любого статуса кроме "void" и зовёт RPC void_invoice (packages/shared/src/db/repositories/invoices.ts:207-223). RPC cancel_invoice (создаёт credit note, apps/web/supabase/migrations/20260809120000_receipts_and_credit_notes.sql:188) не вызывается нигде — ни в apps/mobile, ни в apps/web, ни в packages/shared (grep находит только database.types.ts). Статус "cancelled" есть в типе InvoiceStatus и в INVOICE_STATUS_LABELS (packages/shared/src/local/finance/invoice-ledger.ts:9,354), но из клиента недостижим. Канон ТЗ процитирован прямо в шапке миграции («кнопка отказа от инвойса создаёт credit note»), т.е. это не задумка, а невыполненный канон. Предложенный фикс корректен по направлению; уточнение: возможно вместо добавления второй кнопки рядом стоит заменить легаси-«Аннулировать» на cancel_invoice целиком, чтобы не плодить два конкурирующих отказных пути — решение за владельцем.

### [x] C38 · P1 · bug · `../web/supabase/migrations/20260809120000_receipts_and_credit_notes.sql:237`
**cancel_invoice упадёт на unique(tenant_id, year, seq): серия кредит-нот пересекается с инвойсами**

note_seq считается как max(seq) только по kind='credit_note' (строки 237-239), а вставка идёт в таблицу invoices с общим ключом unique (tenant_id, year, seq) (../web/supabase/migrations/20260528_002_finance_redesign.sql:137) — первая же CN получит seq=1 и столкнётся с инвойсом seq=1 того же года. Обратная асимметрия: next_invoice_number считает max(seq) БЕЗ фильтра kind (20260810120000:94-104), т.е. кредит-ноты пробивали бы дыры в серии инвойсов.

**Фикс:** Включить kind в уникальный ключ (unique (tenant_id, kind, year, seq)) и согласовать оба счётчика: инвойсный max(seq) фильтровать по kind='invoice'.

**Сверка (high):** Подтверждено: cancel_invoice считает seq только по kind='credit_note' (строки 237-239), а вставляет в invoices с живым unique (tenant_id, year, seq) — ни одна более поздняя миграция ключ не меняла, поэтому первая CN года получает seq=1 и падает на unique-violation, если в этом году есть хоть один инвойс (а он почти всегда есть — CN и создаётся для его отмены). Асимметрия с next_invoice_number (max(seq) без фильтра kind) тоже на месте. Фикс аудитора верен: unique (tenant_id, kind, year, seq) + фильтр kind='invoice' в next_invoice_number; заодно надо покрыть и «сквозную» ветку (yearly_reset=false) той же фильтрацией.

### [x] C39 · P2 · bug · `../web/supabase/migrations/20260809120000_receipts_and_credit_notes.sql:101`
**Номер чека обрезается lpad: тысячный чек года печатается дублем RC-YYYY-100**

'RC-' || year || '-' || lpad(receipt_seq::text, 3, '0') — lpad ПРИВОДИТ к длине: lpad('1000',3)='100', то есть чек seq=1000 печатается тем же номером, что seq=100 (уникальный индекс на (tenant,year,seq) вставку пропустит — дубль останется в печатной форме документа). Инвойсная нумерация этот капкан знает и обходит через greatest(...) (20260810120000:39-41,55); формула кредит-ноты на строке 248 страдает тем же.

**Фикс:** Заменить обе формулы на lpad(seq::text, greatest(3, length(seq::text)), '0') — как в format_invoice_number.

**Сверка (high):** Подтверждено: lpad в Postgres усекает до длины, уникальный индекс стоит на (tenant_id, year, seq), а не на number, поэтому seq=1000 молча печатается как RC-YYYY-100; ни одна поздняя миграция формулы чека (строка 101) и кредит-ноты (строка 248) не переопределяет, а миграция 20260810120000 сама документирует этот капкан и чинит его только для инвойсов. Предложенный фикс (greatest(3, length(seq::text))) верный. Severity понижаю до P2: баг латентный — проявляется лишь на 1000-м документе года у тенанта, seq в базе остаётся корректным, врёт только печатная строка.

### [x] C40 · P2 · bug · `src/features/invoices/InvoiceEditor.tsx:236`
**При редактировании инвойса вкладка «Документ» показывает старую версию, а не правки**

paperDoc для initial собирается из buildInvoiceDocument({ invoice: initial, … }) (236-252): изменённые строки, срок, налог и комментарий формы игнорируются — issuedDocument читает invoice.lines и снимки. При этом кнопка на «бумаге» показывает НОВЫЙ итог (actionLabel из totals, строка 339): человек «выставляет, глядя на документ», который не совпадает с тем, что уедет на сервер. Комментарий на 232-233 («Зеркало собирается из ТЕХ ЖЕ данных, что уедут на сервер») в edit-режиме неверен.

**Фикс:** В edit-режиме собирать draft-документ из состояния формы (номер и issued_on брать из initial), оставив issuedDocument только для витрины /invoices/[id].

**Сверка (high):** Подтверждено чтением: InvoiceEditor.tsx:234-252 при initial (edit-роут app/invoices/edit/[id].tsx:106 передаёт initial={invoice.data}) собирает paperDoc через issuedDocument, который читает только invoice.lines/totals/notes/snapshots (document.ts:115-203) — правки формы во вкладке «Документ» не видны, тогда как actionLabel (строка 339) считает итог из живых totals; комментарий «из ТЕХ ЖЕ данных» в edit-режиме ложен. Предложенный фикс верен по направлению, с оговоркой: draft-ветка берёт seller/recipient из tenant/client, а выставленный документ — из seller_snapshot/client_snapshot, поэтому при пересборке из формы надо сохранить снимки из initial, а не только номер и issued_on. Severity: данные на сервер уезжают правильные, врёт только превью до сохранения — это P2 (display bug), не P1.

### [x] C41 · P2 · design · `src/features/invoices/InvoicePaymentSheet.tsx:187`
**InvoicePaymentSheet — самодельный Modal-слайд на моменте рождения чека**

`<Modal visible={visible} transparent animationType="slide"...>` + строка 199 `rounded-t-3xl px-5 pb-8` — без грабера, без пружины, без useKeyboardShown-логики футера. Это лист «Подтвердить оплату» — по канону чек рождается именно здесь; список счетов внутри нарисован своей вёрсткой (строки на t.canvas с 1px бордером, строки 294-300) вместо ValueOptionList/PickerSheet — нарушение «один дизайн на все списки».
[дубль линзы documents: Оплата, возврат и пикеры инвойса — самописные Modal slide вместо канона BottomSheet/PickerSheet]

**Фикс:** Пересобрать на `BottomSheet` (title=«Оплата инвойса», scroll, avoidKeyboard, footer с кнопками) и заменить самодельный список счетов на `ValueOptionList` с группировкой, как в TransferSheet.

**Сверка (high):** Подтверждено: InvoicePaymentSheet.tsx:187-199 — самодельный Modal slide без грабера/пружины, а список счетов (строки 281-314) — своя вёрстка на t.canvas с 1px бордерами; канон рядом в TransferSheet.tsx (BottomSheet + ValueOptionList с группировкой), предложенный фикс верный. Нюанс: клавиатура обработана через KeyboardAvoidingView (не сломана, просто не канон), функциональных дефектов нет — это чистый долг консистентности, поэтому P2, а не P1.

### [x] C45 · P1 · design · `src/features/finances/UnclosedScreen.tsx:380`
**CancelReasonSheet в UnclosedScreen — самодельный Modal-слайд**

`<Modal visible={visible} transparent animationType="slide" onRequestClose={close}>` + строка 387 `rounded-t-3xl p-5 pb-8`. Заодно строка 424: у текстового поля причины `rounded-[10px]` вместо t.radius.input=14, строка 457 — `color: "#ffffff"` вместо t.onAccent.
[дубль линзы period-scope: CancelReasonSheet в «Не закрыто» — самописный Modal slide вместо канонического BottomSheet]

**Фикс:** Пересадить на BottomSheet (title=«Отменить визит», avoidKeyboard, footer с двумя кнопками), радиус поля — t.radius.input, цвет текста кнопки — t.onAccent.

**Сверка (high):** Confirmed: CancelReasonSheet (UnclosedScreen.tsx:380) is a hand-rolled Modal animationType="slide" — precisely the pattern the canonical BottomSheet's own doc comment forbids ("ЕДИНСТВЕННЫЙ способ… заменяет самописные Modal slide"); rounded-[10px] vs t.radius.input=14 and hardcoded "#ffffff" vs t.onAccent also verified in src/theme/colors.ts. Proposed fix is correct — BottomSheet supports title/footer/avoidKeyboard; add one caveat: the onConfirm path bypasses close() and any window opened after dismissal must wait SHEET_EXIT_MS.

### [x] C46 · P1 · design · `src/features/invoices/InvoiceRefundSheet.tsx:114`
**InvoiceRefundSheet — третий самодельный Modal-слайд**

`<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>` — та же запрещённая механика, что у InvoicePaymentSheet; внутри rounded-xl-литералы (строки 137, 157, 184) и вставки на t.canvas вместо t.fill.
[дубль линзы ux-micro: InvoiceRefundSheet — самописный Modal slide вместо BottomSheet]

**Фикс:** Пересадить на `BottomSheet` с title/scroll/avoidKeyboard/footer; радиусы взять из t.radius.

**Сверка (high):** Подтверждено: InvoiceRefundSheet.tsx:114 действительно `<Modal transparent animationType="slide">` с самописным скримом-Pressable и rounded-xl-литералами (137/157/184), тогда как канонический примитив src/components/ui/BottomSheet.tsx существует и поддерживает всё нужное (title/footer/avoidKeyboard/scroll) — это прямое нарушение зафиксированного канона «все листы = BottomSheet, не Modal slide», причём в свежем коде инвойсов, а не в легаси, ждущем миграции. Уточнение к фиксу: вставки в файле НЕ однородно на t.canvas — блок суммы (137, 184) на t.canvas, поле ввода (158) уже на t.fill; при пересадке выровнять инсеты по канону (t.fill для полей ввода, радиусы из t.radius), а список из ~20 других файлов с той же механикой (ClientActionsSheet, OperationSheet, AppointmentSheet и др.) — отдельный известный долг миграции, не часть этой находки.

### [x] C47 · P1 · design · `src/features/invoices/EntityPickerSheet.tsx:51`
**EntityPickerSheet — полноэкранный Modal-пикер вместо PickerSheet**

`<Modal visible={visible} animationType="slide" onRequestClose={close}>` — выбор клиента/заявки/команды в редакторе инвойса открывается непрозрачным полноэкранным модалом со своей шапкой (X + центрированный заголовок) и своими строками (PickerRow с 1px нижним бордером, строка 133). Закон «ОДИН ДИЗАЙН НА ВСЕ СПИСКИ»: новый экран-список не пишется с нуля, листы — только канонический BottomSheet.
[дубль линзы ux-micro: EntityPickerSheet — свой полноэкранный пикер вне канона списков]

**Фикс:** Собрать выбор из BottomSheet + ValueOptionList (или расширить ValuePickerSheet полем поиска — расширение существующего примитива по закону 2026-08-02) и применить ко всем трём пикерам редактора.

**Сверка (high):** Подтверждено: EntityPickerSheet.tsx:51 — непрозрачный полноэкранный Modal animationType="slide" со своей шапкой и строками, монтируется трижды в InvoiceEditor.tsx (513/521/535). Это прямое нарушение канона: ClientActionsSheet.tsx:30 фиксирует, что DS запрещает animationType="slide" дословно, а канонический примитив для «один из длинного списка» уже существует (ValuePickerSheet + ValueOptionList на BottomSheet). Предложенный фикс верен — расширить ValuePickerSheet полем поиска и применить ко всем трём пикерам; единственная оговорка: в базе есть ещё ~десяток аналогичных slide-модалов, ждущих миграции.

### [x] C48 · P3 · copy · `app/accounts/[id]/index.tsx:806`
**«Сдать выручку» на карточке счёта — снесённое понятие и вторая дверь в тот же лист**

Строки 806-821: NavRow «Сдать выручку» и NavRow «Перевести» обе делают `setTransferOpen(true)` с одним и тем же `presetFromId={account.id}` — поведение идентично до пикселя. При этом сам TransferSheet.tsx:75-77 фиксирует решение владельца 2026-08-15: «„СДАЧИ ВЫРУЧКИ" отдельным словом больше нет… Одно событие — одно слово: перевод», и transfer-options.ts:13 повторяет то же. Плюс `payoutTarget` (строка 456) считается через defaultTransferTarget только ради подписи строки — лист внутри считает цель сам.
[дубль линзы ux-micro: «Сдать выручку» на карточке счёта — снесённое понятие, дубль «Перевести» и врущий получатель]

**Фикс:** Удалить строку «Сдать выручку» и расчёт payoutTarget, оставить одну «Перевести». Заодно переименовать заголовок «Сдали выручку» в AccountTeamInflow.tsx:166 (слово из снесённого словаря) во что-то вроде «Переводы с касс».

**Сверка (high):** Частично подтверждено, но главный сценарий ложный: payoutTarget считается с remembered:null, а defaultTransferTarget при !remembered сразу возвращает null — строка «Сдать выручку» НИКОГДА не рендерится, «второй двери» в UI нет. Реально остаётся: мёртвый код (NavRow за вечно-ложным условием + расчёт payoutTarget + врущий комментарий на строках 450-460) и живой заголовок «Сдали выручку» в AccountTeamInflow.tsx:165 из снесённого словаря. Фикс аудитора верный (удалить строку, payoutTarget и комментарий 450-460, переименовать заголовок), но это уборка dead code + одна подпись, а не P1-дубль действия.

### [x] C7 · P3 · bug · `../../packages/shared/src/db/repositories/invoices.ts:97`
**Кредит-ноты приезжают в мобильные списки как «Инвойс CN-… · Оплачен» с отрицательной суммой**

listInvoices селектит `from("invoices").select("*")` без фильтра/маппинга kind (стр. 97-129; rowToInvoice поле kind не читает вовсе), а cancel_invoice создаёт строку kind='credit_note' с total = −original.total и status='issued' (20260809120000:241-269). В панели документов она отрисуется как `Инвойс CN-2026-001` (documents.ts:109) с суммой −€476 и состоянием «Оплачен» (для отрицательного total remaining=0 → isPaid=true). Канон: панель — только Инвойсы|Чеки, кредит-нота — отдельная сущность.

**Фикс:** Маппить kind в InvoiceLedger; в collectDocuments рисовать credit_note своим типом («Кредит-нота», состояние — ссылка на сторнированный номер) либо фильтровать из сегмента «Инвойсы», а в invoiceSummary исключать по kind, не полагаясь на отрицательный total.

**Сверка (high):** Механика подтверждена построчно: listInvoices селектит * без фильтра, rowToInvoice не маппит kind (InvoiceLedger в invoice-ledger.ts вообще не имеет поля kind), cancel_invoice (миграция 20260809120000) реально пишет строку kind='credit_note' с number 'CN-…', total=−original.total, status='issued'; в collectDocuments такая строка отрисуется как «Инвойс CN-…», а calculateInvoiceSettlement даёт paid=min(total,0)=−476 → remaining=max(0,total−paid)=0 → isPaid=true → «Оплачен», dead=false. НО: бага латентная — cancel_invoice не вызывается НИ ОДНИМ клиентским кодом во всём репо (mobile использует void_invoice), т.е. сегодня в продукте нет пути, создающего credit_note; строка появится только при ручном вызове RPC (он granted authenticated на проде) или когда доедет запланированный флоу «отказ→credit note». Предложенный фикс верен по направлению, но «invoiceSummary» — несуществующая функция (такого символа в коде нет); правильные точки: добавить kind в InvoiceLedger/rowToInvoice, в collectDocuments рисовать/исключать credit_note своим типом, и не полагаться на settlement для отрицательного total (клампы Math.max/Math.min в calculateInvoiceSettlement маскируют знак).

### [x] C8 · P2 · bug · `src/features/finances/TransactionPopup.tsx:155`
**Двойной тап «Возврат» может записать возврат дважды: нет синхронного гарда и request_id**

handleRefund: `if (!refundValid || busy) return; setBusy(true)` (стр. 155-158) — busy это state и обновится только после ре-рендера; сам проект фиксирует этот класс в OperationSheet: «Синхронный гард: isPending включается только после ре-рендера, сверхбыстрый двойной тап успевал бы дважды» (OperationSheet.tsx:322-324, savingRef + request_id). Драфт возврата (index.tsx:538-550) идёт без request_id — серверный дедуп по PK не работает, а интегрити-кап пропустит два частичных возврата по 50 от дохода 100.

**Фикс:** Добавить синхронный ref-гард в handleRefund и стабильный request_id в драфт возврата (тот же паттерн, что у OperationSheet).

**Сверка (high):** Подтверждено: гард busy — state (Pressable.disabled тоже), двойной тап до ре-рендера проходит дважды; драфт возврата без request_id, дедуп 23505 в insertTransaction неактивен; серверный триггер (for update + кап по сумме) режет только превышение остатка — два частичных по 50 от дохода 100 проходят оба. Предложенный фикс (savingRef + стабильный request_id, паттерн OperationSheet) верный.

### [x] C17 · P3 · bug · `src/features/finances/TransferSheet.tsx:269`
**Ключ request_id не включает дату и комментарий — смена «Когда» после потерянного ответа молча вернёт старый перевод**

const requestId = requestIdFor(`${from.id}|${to.id}|${amountCents}`); — комментарий выше (строки 216-218) декларирует «изменённая сумма — это уже другое намерение и другой ключ», но occurredOn и note в ключ не входят. Сценарий: перевод задним числом ушёл на сервер, ответ потерялся; человек по подсказке самого листа («Если день уже закрыт… проведите переводом на сегодня», строка 370-371) меняет дату и жмёт снова — request_id тот же, а сервер на совпавший id с другими параметрами отвечает «Запрос перевода уже использован с другими данными» (20260727100001:836-842) — тупик без объяснения, что перевод уже записан старой датой.

**Фикс:** Включить occurredOn и note в ключ намерения: requestIdFor(`${from.id}|${to.id}|${amountCents}|${occurredOn}|${note.trim()}`) — повтор без правок остаётся дедупом, любая правка честно становится новым намерением.

**Сверка (high):** Confirmed: key omits occurredOn/note and nothing resets intent.current on date/note edits, while the live RPC (20260727100001:836-842, same check in prod snapshot line 643) rejects a reused request_id with changed occurred_on/notes — after a lost response the user who follows the sheet's own hint to change the date hits a dead-end error that never says the transfer was already recorded. Fix is correct as proposed (add occurredOn and note.trim() to the key). Severity is slightly inflated: needs the rare lost-response-after-commit window plus a pre-retry edit, and the outcome is confusion, not money loss/duplication — P3.

### [x] C18 · P2 · bug · `../web/supabase/migrations/20260727100001_shared_accounts.sql:999`
**Отмена перевода, задевшего бывший общий счёт, падает как «Перевод повреждён» после миграции brigade_id**

delete_account_transfer сверяет каждую ногу: «team_id is not distinct from (select brigade_id from public.accounts where id = …)». Ноги перевода получают team_id = brigade_id счёта НА МОМЕНТ создания (строки 929-938: from_account.brigade_id / to_account.brigade_id); у общего счёта это был NULL. Миграция 20260815150000 (шаг 1) проставила такому счёту brigade_id живой команды — старые ноги с team_id=NULL перестали совпадать, и отмена любого их перевода теперь падает «Перевод повреждён; данные не изменены». На проде ровно такой счёт есть: «Revolut Business» тенанта Giliuta с тремя проводками (комментарий той же миграции).

**Фикс:** В следующей ревизии delete_account_transfer сверять team_id ноги со снапшотом в finance_transfer_requests.team_id (он писался при создании), а не с текущим brigade_id счёта; либо миграцией дообновить team_id старых transfer-ног вслед за сменой владельца счёта.

**Сверка (high):** Подтверждено кодом и продом: delete_account_transfer сверяет team_id ноги с ТЕКУЩИМ accounts.brigade_id, миграция 20260815150000 меняет brigade_id, не трогая ноги; на проде есть активный перевод с ногой team_id=NULL на «Revolut Business» (миграция туда ещё не доехала — сломается при накате). Но первая половина предложенного фикса неверна: finance_transfer_requests.team_id — один снапшот coalesce(from,to), а ноги обычного межкомандного перевода несут РАЗНЫЕ team_id, сверка с ним сломает отмену обычных переводов; правильный фикс — дообновить team_id transfer-ног миграцией вслед за сменой brigade_id (или убрать сверку team_id из проверки целостности).

### [x] C23 · P2 · bug · `src/features/finances/OperationSheet.tsx:110`
**Правка операции закрытого счёта — двойной тупик с враньём в тексте**

useAccountsWithBalances() (строка 110) берёт только активные счета (accounts.ts:102 includeInactive=false) → для операции архивного счёта selectedAccount не находится, accountMismatch=true, форма требует «Выберите доступный счёт заново». Но сервер запрещает ЛЮБОЙ update операции закрытого счёта («Сначала снова откройте финансовый счёт», assert_finance_transaction_integrity) — совет клиента невыполним. Вдобавок лента/попап теряют имя закрытого счёта, хотя для команд родитель нарочно берёт includeInactive (finances/index.tsx:147-149).

**Фикс:** Для таких операций открывать витрину, а не правку, с честным текстом «Счёт закрыт — откройте его снова, чтобы править операции». В ленты и попап передавать счета с includeInactive, как уже сделано с командами.

**Сверка (high):** Confirmed end-to-end: OperationSheet uses active-only accounts (accounts.ts includeInactive?:false), so an archived-account tx triggers accountMismatch and the advice "выберите счёт заново", while the live server trigger (20260727100001, lines 300-305, not superseded through 20260815150000) rejects ANY update/delete of a tx whose old account is inactive — the advice is unfulfillable and even "Удалить" in the same sheet fails; canEditTransaction doesn't gate this, and index.tsx passes allTeams (includeInactive) but active-only accounts to feed/popup, losing closed-account names. Proposed fix matches the product's own rule ("витрина — для того, что править нельзя"); additionally hide/route "Удалить" the same way, since delete is equally blocked.

### [x] C24 · P2 · bug · `app/(dashboard)/finances/index.tsx:966`
**«Создать возврат» из формы правки может молча не открыть попап**

onRefund закрывает OperationSheet и ждёт SHEET_EXIT_MS=260мс (строки 963-967; то же accounts/[id]/index.tsx:951-953). Но OperationSheet — RN Modal animationType="slide" высотой 86%, его системный dismiss дольше; собственный код признаёт это: OperationReceiptRow.tsx:58-62 — «240 мс листа не хватает», ждут 450мс, иначе iOS «молча не показывает ничего». Второй Modal (попап), показанный во время dismiss первого, может не открыться.

**Фикс:** Ждать onDismiss модалки (проп Modal.onDismiss), а не таймер BottomSheet; после пересадки OperationSheet на BottomSheet константа снова станет честной.

**Сверка (high):** Подтверждено: SHEET_EXIT_MS=260 откалиброван под BottomSheet (240мс JS-анимация + Modal animationType="none", т.е. мгновенный нативный dismiss), а OperationSheet — сырой Modal animationType="slide" (86%), чей системный dismiss ~300+мс; setPopupTx через 260мс монтирует второй Modal во время dismissal первого, и iOS молча его не показывает — механизм дважды задокументирован в собственных комментариях кода (BottomSheet.tsx:49, OperationReceiptRow.tsx). Перехвата/ретрая нет, попап просто не появляется. Предложенный фикс (ждать Modal.onDismiss) верен.

### [x] C25 · P2 · bug · `app/(dashboard)/finances/index.tsx:484`
**Поиск не находит сумму в том виде, в каком она напечатана в ленте**

Стог поиска содержит String(tx.amount) — «1234.5» с точкой (строка 484), а лента печатает money(): «€1 234,50» с запятой и разрядными пробелами. Ввод «1234,50» или «1 234» не совпадает через .includes — «искать по сумме» (плейсхолдер «Сумма, счёт, заметка», строка 646) работает только для целых без копеек.
[дубль линзы edge-copy: Поиск «по сумме» ищет по сырому float и не находит суммы в формате продукта]

**Фикс:** Нормализовать needle (запятая→точка, убрать пробелы/€) и/или добавить в стог форматированный вид money(tx.amount).

**Сверка (high):** Подтверждено: стог = String(tx.amount) («1234.5»), а лента печатает formatEURExact (запятая, неразрывный пробел U+00A0, префикс €) — ввод суммы «как на экране» не находится, при этом комментарий в коде прямо декларирует «ищем по тому, что человек видит». Фикс аудитора верен, с уточнением: при нормализации needle убирать и обычный пробел, и U+00A0 (лента вставляет именно неразрывный), запятую → точку, срезать символ валюты; либо добавить в стог formatEURExact(tx.amount) с той же нормализацией пробелов.

### [x] C26 · P2 · bug · `src/features/finances/OperationSheet.tsx:474`
**Операция без команды открывается в правку-тупик: сохранить нельзя, команду выбрать нечем**

Строка «Команда» — не контрол, а подпись (474-487), teamAccounts при teamId=null пуст (222-230), пустое состояние советует «Выберите команду наверху экрана» (619) — но наверху ЛИСТА команды нет, а canSave требует teamId (308-311). В проде есть 1 редактируемый manual-доход с team_id NULL (проверено запросом): тап по нему открывает форму, которую нельзя ни сохранить, ни починить. Сервер, кстати, сам умеет наследовать команду от счёта.

**Фикс:** Для операции без команды показать выбор команды в листе (или наследовать команду выбранного счёта, как integrity-триггер), а текст пустого состояния не должен отсылать к контролу другого экрана.

**Сверка (high):** Confirmed: edit hydration sets teamId=transaction.team_id??null (line 185) with no team control in the sheet, canSave requires teamId (308-311), and the NULL-team tx is reachable via the account-detail ledger (app/accounts/[id]/index.tsx fetches by accountIds without team filter, canEditTransaction passes) — though NOT via the main finances feed, which filters it out with q.in("team_id",…). The empty-state hint «Выберите команду наверху экрана» is doubly wrong on the account page, which has no team chip. Fix correction: since accounts are strictly per-team (2026-08-15), no picker is needed — inherit teamId from the transaction's account on hydration (as the server integrity trigger does) and fix the copy.

### [x] C27 · P2 · bug · `src/features/finances/OperationSheet.tsx:187`
**payment_method=null гидрируется в 'cash' и даёт ложное «Счёт не подходит»**

Строка 187: setPayment(transaction.payment_method ?? "cash"). Для существующей операции с payment_method NULL (в проде такая есть: 1 manual income) и не-наличным счётом accountMismatch (238-243) срабатывает сразу при открытии: «Сохранённый счёт не подходит. Выберите доступный счёт заново» — хотя с операцией всё в порядке.

**Фикс:** При гидрации выводить способ из вида счёта операции: paymentMethodForAccountKind(kind счёта по transaction.account_id), и только при неизвестном счёте падать в 'cash'.

**Сверка (high):** Подтверждено, опровергнуть не удалось: тип FinanceTransaction допускает payment_method: null (transaction.ts:60), гидрация (OperationSheet.tsx:187) подставляет "cash", и для не-наличного счёта isPaymentAccountCompatible("cash", kind) даёт false → accountMismatch (238–243) показывает красный баннер (строка 725) и гасит «Сохранить» (canSave:312) плюс Alert при попытке (342). Ничто не перехватывает: эффект вывода способа из счёта (271) явно пропускает isEdit, а канон в комментариях самого файла («способ оплаты выводится из вида счёта») подтверждает, что это баг, а не задумка. Фикс аудитора верный по направлению; одна оговорка — счета приезжают асинхронно, поэтому выводить kind надо не разовым сетом при гидрации, а эффектом/при известном selectedAccount (fallback "cash" только для неизвестного счёта). Наличие конкретной прод-строки с NULL не перепроверял — баг реален для любого такого ряда.

### [x] C28 · P2 · bug · `src/features/finances/OperationReceiptRow.tsx:95`
**Свежезагруженный документ остаётся сиротой в бакете при закрытии листа без сохранения**

Файл уходит в хранилище сразу при выборе (uploadOperationReceipt, строки 86-96), а чистка есть только у крестика строки (135-138). Закрытие всего OperationSheet тапом по скриму/X (OperationSheet.tsx:407, 410-418) не удаляет незакоммиченный файл — вопреки собственному комментарию строки 40-42 («каждая опечатка… оставляла бы мусор навсегда»), именно это и происходит при отмене формы.

**Фикс:** Поднять uploadedHere в OperationSheet (или колбэк onDiscard) и при закрытии листа без сохранения удалять все загруженные в этой сессии пути.

**Сверка (high):** Confirmed: upload fires immediately on pick (OperationReceiptRow.tsx:86-96), the only deleteOperationReceipt call in the app is the row's X (135-138), and OperationSheet's scrim/X (407, 411) call bare onClose() with no discard sweep — the ref-held uploadedHere set dies on unmount, orphaning the bucket object; no server-side cleanup cron exists for the receipts bucket. Not by design: the file's own comment (lines 40-42) states typo-uploads must not leave garbage. Proposed fix is right, with two additions: on close-without-save skip a path equal to the transaction's original receipt_url, and clear the tracked set on successful save so the committed file is never deleted.

### [x] C33 · P2 · bug · `app/invoices/new.tsx:60`
**Отказ запроса настроек НДС молча делает новый инвойс «Без НДС»**

error-гейт (строки 60-65) и retry (66-72) не включают vat-запрос: при его отказе loading=false (isLoading после ошибки гаснет), error=null, редактор монтируется с vat.data===undefined → defaultVatMode «off» и запоминает его навсегда — ровно тот баг, от которого защищается комментарий на строках 50-51 («смонтированный раньше ответа он навсегда оставался „Без НДС“»).
[дубль линзы documents: Ошибка загрузки услуг или настроек НДС молча пропускает редактор нового инвойса с пустыми данными]
[дубль линзы ux-micro: new.tsx: отказ services/vat не попадает в error и retry — редактор молча теряет названия услуг]
[дубль линзы data-layer: Гейт ошибок нового инвойса пропускает services и vat — редактор монтируется без названий услуг и с выключенным НДС]

**Фикс:** Добавить `(vat.data === undefined ? vat.error : null)` в error-гейт и vat.refetch() в retry.

**Сверка (high):** Подтверждено: useVatSettings — обычный react-query поверх Supabase и может завершиться ошибкой (status='error', isLoading=false, data=undefined); гейт в app/invoices/new.tsx:59-63 и retry (64-70) не включают vat (и services), а InvoiceEditor.tsx:173-177 берёт defaultVatMode/defaultVatPercent в useState один раз при монтировании — редактор молча рождается «Без НДС», ровно вопреки комментарию на строках 49-52. Фикс верный, но неполный: помимо vat в гейт и retry надо добавить и services (services.error / services.refetch) — та же дыра, отмеченная дублями линз; пользователь всё же может переключить НДС вручную в редакторе, так что P2 адекватна.

### [x] C34 · P2 · bug · `../../packages/shared/src/db/repositories/finance-transactions.ts:450`
**Чек не обновляется после правки дохода: печатает старую сумму и старый НДС**

updateTransaction (450-488) разрешает менять сумму ручного дохода без инвойса, а чек уже выписан триггером issue_receipt_for_income (AFTER INSERT) со снимком amount/vat_rate/vat_amount; триггера, гасящего или переиздающего чек на UPDATE, нет. Юридический документ «RC-…» расходится с леджером после первой же правки.

**Фикс:** Запретить правку суммы дохода с выданным чеком (как уже сделано для invoice_id) либо на апдейте гасить чек и выписывать новый с очередным номером.

**Сверка (high):** Подтверждено: trg_issue_receipt_for_income (AFTER INSERT) выписывает чек любому доходу с client_id, включая ручной без инвойса; updateTransaction гейтит только invoice_id, а assert_finance_transaction_integrity на UPDATE пропускает правку amount/vat_mode у manual-строк — ни один из 10 триггеров прода не трогает чек на UPDATE, чек навсегда остаётся со старой суммой/НДС. Хуже заявленного: trg_fill_transaction_vat тоже INSERT-only, так что после правки суммы vat_amount врёт и в самом леджере, и та же дыра есть в deleteTransaction (чек переживает удаление операции). Фикс аудитора верен по направлению, но клиентским .is()-фильтром «чек выдан» не выразить — нужен серверный guard в триггере (exists receipts where transaction_id=old.id and status='issued' → запрет или void+перевыпуск), плюс закрыть delete и пересчёт vat_amount на UPDATE.

### [x] C35 · P2 · bug · `../../packages/shared/src/local/finance/invoice-ledger.ts:145`
**Три реализации разложения НДС с разными правилами округления расходятся на цент**

splitVatInclusive округляет НЕТТО первым и round2 без Number.EPSILON (invoice-ledger.ts:145-152, 365-367); vat.ts округляет НАЛОГ первым и с EPSILON (vat.ts:84-98, 151-153); issue_invoice в SQL — третий вариант (numeric round налога). База 0,27 € при 20%: превью редактора покажет НДС 0,04/нетто 0,23, сервер сохранит 0,05/0,22 — документ на бумаге отличается от превью. Канон: «вся математика в applyTxVat».

**Фикс:** Свести клиентскую инвойс-математику к vatFromGross/netFromGross из vat.ts (налог первым, EPSILON) и выровнять с порядком округления SQL.

**Сверка (high):** Confirmed numerically: at half-cent-tie rates (20%, not 19/24) splitVatInclusive gives 0.04/0.23 for 0.27 gross while vat.ts and SQL issue_invoice both give 0.05/0.22; rate is user-editable so 20% is reachable. Impact is worse than stated: assertInvoiceControlRead (moneyEqual tol. 0.005, invoices.ts:299-301) throws AFTER the invoice is created server-side, so the user sees an error for an existing invoice. Correction to diagnosis: the ledger's vat is also tax-first (computed from unrounded net); the real culprit is the missing Number.EPSILON, which makes float dust at exact half-cent ties round down where SQL numeric rounds up. Proposed fix (reuse vatFromGross/netFromGross) is correct and matches SQL on all tested tie cases.

### [x] C42 · P2 · bug · `app/invoices/[id].tsx:259`
**Переход из инвойса в запись календаря без &from= — дорога назад потеряна**

`openLinkedAppointment` пушит `{ pathname: "/", params: { appointmentId, date, teamId } }` без `from`. Канон: вкладки таб-бара НЕ стек, переход на запись из денежной поверхности требует `&from=` (эталон — app/(dashboard)/finances/index.tsx:570-574, где явно дописывается `&from=finances» с комментарием владельца 2026-08-15).
[дубль линзы documents: Заявка, открытая со страницы инвойса, не имеет дороги назад к инвойсу]
[дубль линзы ux-micro: Открытие записи из инвойса без &from= — возврат не приведёт назад в инвойс]
[дубль линзы edge-copy: Переход из инвойса в заявку без &from= — назад в инвойс не вернуться]

**Фикс:** Добавить в params `from` (например, `from: "invoice:"+row.id` или существующий словарь from=), чтобы закрытие записи возвращало на страницу инвойса, а не бросало в календарь.

**Сверка (high):** Confirmed: openLinkedAppointment (app/invoices/[id].tsx:259) pushes appointmentId without from, and the calendar's return mechanism (app/(dashboard)/index.tsx:629 returnToRef) only fires when from is set — so closing the appointment sheet strands the user in the calendar, violating the documented owner canon (lines 353-358) that the money surface which opened the record must get the user back. Fix correction: passing from alone is insufficient — line 629 hard-codes only "finances", so the dictionary in app/(dashboard)/index.tsx must also be extended (e.g. from="invoice:<id>" → /invoices/<id>).

### [x] C43 · P2 · bug · `app/(dashboard)/finances/index.tsx:240`
**Деньги счёта без бригады (brigade_id=NULL) невидимы на вкладке «Финансы» целиком**

`scopedAccounts = accounts.filter((a) => accountServesTeam(a, scope))`, а accountServesTeam после «счёт = одна бригада» — это строгое `account.brigade_id === teamId` (packages/shared/src/local/finance/integrity.ts:49-54). Счёт-сирота из старой схемы общего счёта (на проде такой есть — Revolut Business, ждущий переноса) не совпадает ни с одним чипом, чипа «Все» на экране нет — его остаток не входит ни в Σ плитки «Счета», ни в AccountsPanel ни при каком выборе. Страница /accounts эту дыру закрывает явно: «ДЕНЬГИ БЕЗ ХОЗЯИНА ВСЁ РАВНО ВИДНЫ» — сиротский чип (src/features/finances/accounts-sections.ts:160-191). Вкладка «Финансы» — нет.

**Фикс:** Показать деньги без хозяина и на «Финансах»: либо добавить сиротский чип по тому же accountsTeamChips, либо хотя бы включать счета с brigade_id=NULL в miniCardAccounts каждой команды с пометкой (как минимум — до завершения переноса на проде).

**Сверка (high):** Подтверждено: scope на «Финансах» никогда не пуст (index.tsx:165-170), scopedAccounts (строка 240) фильтрует строгим brigade_id===scope (integrity.ts:49-54), и обе витрины (Σ плитки, строка 734, и AccountsPanel, строка 768) питаются только из этого набора — счёт с brigade_id=NULL невидим на вкладке целиком. Это не задумка: страница /accounts явно декларирует обратное и рисует сиротский чип «Без бригады» (accounts-sections.ts:163-190). Поправка к фиксу: вариант «включать NULL-счета в miniCardAccounts каждой команды» неверен — баланс сироты повторялся бы под каждым чипом (ровно от этого предостерегает комментарий index.tsx:243-244); правильный путь — только сиротский чип по образцу accountsTeamChips.

### [x] C44 · P2 · bug · `app/(dashboard)/finances/index.tsx:112`
**Пресет периода не перепривязывается после полуночи — «Сегодня» остаётся вчерашним**

`const [period, setPeriod] = useState<Period>(() => defaultPeriod(businessNow))` — диапазон пресета вычисляется один раз на маунте вкладки; эффект (строки 116-128) пересобирает его ТОЛЬКО при смене часового пояса. При этом `businessToday` (строка 107) пересчитывается на каждом рендере. Вкладка таба живёт весь сеанс: если при выбранном «Сегодня» перейти через полночь (или «Текущий месяц» через границу месяца), новая операция получает occurred_on нового дня (OperationSheet получает свежий businessToday), не попадает в окно `useTransactions(period.from, period.to)` и исчезает из ленты и итогов, хотя тост сказал «сохранено». Та же ловушка в src/features/finances/use-business-period.ts:37-50 для карточки счёта, оставленной открытой.
[дубль линзы period-scope: finances/index.tsx дублирует useBusinessPeriod вместо использования хука]

**Фикс:** Добавить в оба места эффект по businessToday: если period.preset !== "custom" и пресет, пересобранный от нового businessNow, отличается — setPeriod(makePeriod(preset, businessNow)). Ровно та же механика, что уже есть для смены таймзоны.

**Сверка (high):** Подтверждено: period фиксируется на маунте и пересобирается только при приходе таймзоны (index.tsx:112,116-128; use-business-period.ts:37-50); нигде нет rebase по фокусу/AppState/смене дня, useTransactions запрашивает строго [from,to], а OperationSheet при открытии гидрирует дату свежим businessToday — операция после полуночи получает occurred_on вне окна пресета и исчезает из ленты/итогов. Это не задумка: комментарий в хуке прямо объявляет цель «пресет по часам компании сейчас». Предложенный фикс (эффект по businessToday, пересборка не-custom пресетов) верен и повторяет существующую механику.

### [x] C49 · P2 · bug · `src/features/finances/FinanceOverview.tsx:215`
**Класс tabular-nums — задокументированный no-op — на денежных цифрах 30+ мест контура**

ДС §2: «className="tabular-nums" — чистый no-op… цифры продолжают прыгать при каждом тике». В контуре: FinanceOverview.tsx:215 (точные даты периода в шапке); TransactionsFeed.tsx:192,218 (суммы строк и итог дня); DebtorsList.tsx:208; ProfitBreakdown.tsx:98,144,174; IncomeShareDonut.tsx:155,179; TransactionPopup.tsx:247 (сумма 32pt),358; PeriodSheets.tsx:79,205,228; UnclosedScreen.tsx:202,299; InvoiceEditor.tsx:574; InvoiceLineEditor.tsx:97; InvoicePaymentSheet.tsx:201,231; InvoiceRefundSheet.tsx:130,145,170; app/invoices/index.tsx:277,323,327; app/invoices/[id].tsx:292,300,355,516,572.

**Фикс:** Перевести перечисленные на `style={{ fontVariant: ["tabular-nums"] }}` (не удалять — цифры обязаны быть моноширинными), как уже сделано в DocumentRow, TransferSheet и герое счетов.

**Сверка (high):** Подтверждено независимо: компилятор NativeWind v5 (react-native-css declarations.js) обрабатывает только font-variant-caps, а font-variant-numeric из tailwind-класса tabular-nums молча выбрасывает — все перечисленные строки существуют, класс на них ничего не делает. Это документированный долг ДС (§ от 2026-08-11), не задумка; предложенный фикс (style fontVariant, как в ClientRow/TransferSheet) верен.


## Мелкие находки без сверки (P2-полировка / P3)

### [x] U0 · P2 · ux · `app/(dashboard)/finances/index.tsx:330`
**Плитка «Расход» включает материалы записей, а лента под ней — только операции журнала: сумма строк не сходится с плиткой**

totals.expense = Σ операций + materialSummary.amount (`const expenseWithMaterials = expense + materialSummary.amount;`, стр. 330), но тап по «Расход» открывает TransactionsFeed с feedTx = только expense-транзакции (стр. 467-469) — синтетической строки «Материалы» там нет. В «Прибыли» она есть (ProfitBreakdown.tsx:52-62). Плитка €540, лента из строк на €400 — владелец не найдёт разницу пальцем.

**Фикс:** Добавить в ленту расходов синтетическую строку «Материалы · N записей» (тап → разбор прибыли), либо печатать под лентой сноску «+€X материалы записей».

### [x] U7 · P2 · ux · `app/(dashboard)/finances/vat.tsx:217`
**Строка «Своя ставка у команды» — дверь в Alert-заглушку**

SettingsRow с шевроном на каждую команду, onPress = `Alert.alert(team.name, "Отдельная ставка команды настраивается на её странице — она появится вместе с остальными настройками команды.")` — то есть функции нет. Закон строки: «Шеврон обязан куда-то вести: строки-двери в никуда не бывает». Пер-командный НДС при этом — принятое решение владельца (Кипр 19 / Греция 24), а настроить его негде.
[дубль линзы money-math: Ставка НДС команды показывается, но не настраивается — тупиковый Alert-обещание]
[дубль линзы ux-micro: Строки команд на странице НДС выглядят живыми, а ведут в алерт «появится позже»]

**Фикс:** Либо сделать выбор ставки/режима прямо здесь (ChoiceRow + поле ставки в листе строки), либо до готовности страницы команды печатать значения информационной строкой без шеврона и onPress.

### [x] U8 · P2 · copy · `app/accounts/index.tsx:100`
**Герой чипа «Без бригады» печатает «У бригады Без бригады на счетах»**

heroLabelFor строит «У бригады ${teamName} на счетах», если isSelfNamedTeam(name) ложно; регулярка accounts-sections.ts:219-221 ловит только /^(бригад|команд)/i. Чип NO_TEAM создаётся с name:"Без бригады" (accounts-sections.ts:184-189) — «без» под регулярку не попадает, и герой (строка 420) плюс озвучка selectTeam (строки 218-223) выдают «У бригады Без бригады на счетах: …».

**Фикс:** Спецветка для NO_TEAM: подпись вида «Без бригады на счетах» (или «На счетах без бригады») — по chip.id === NO_TEAM, а не по имени.

### [x] U9 · P2 · dead-code · `app/accounts/[id]/index.tsx:456`
**Строка «Сдать выручку» на карточке счёта мертва: defaultTransferTarget с remembered:null всегда null**

payoutTarget = defaultTransferTarget({accounts, from: account, remembered: null}), а transfer-options.ts:115 первым делом делает «if (!remembered) return null». Значит NavRow «Сдать выручку» (строки 806-814) не рендерится никогда, а комментарий над ней (строки 451-455) описывает счёт-получатель, которого не бывает. Канонично так и есть — «сдача выручки» снесена владельцем 2026-08-15 (TransferSheet.tsx:75-77), но труп остался в коде.
[дубль линзы transfers: Строка «Сдать выручку» на карточке счёта — мёртвый код: payoutTarget всегда null]
[дубль линзы edge-copy: «Сдать выручку» — мёртвая строка: defaultTransferTarget(remembered: null) всегда null]

**Фикс:** Удалить payoutTarget, ветку NavRow «Сдать выручку» и комментарий; «Перевести» уже покрывает сценарий.

### [x] U10 · P2 · ux · `app/accounts/index.tsx:505`
**⇄ в шапке счетов при одном счёте ведёт в тупиковый лист с пустым шагом «Куда»**

Комментарий обещает: «Иконка ⇄ рисуется ВСЕГДА — в том числе когда допустимой пары нет: тогда лист объясняет правило и предлагает завести счёт сразу нескольким бригадам» — но эта ветка из TransferSheet удалена (TransferSheet.tsx:317-321: «ВЕТКИ „НЕТ ДОПУСТИМОЙ ПАРЫ“ ЗДЕСЬ БОЛЬШЕ НЕТ… её гасит сама кнопка на экране счетов»). Гасится только кнопка на «Финансах» (finances/index.tsx: disabled={accounts.length < 2}); ⇄ на /accounts не гасится ничем. При единственном счёте: выбираешь его в «Откуда», шаг «Куда» пуст — transferGroups (transfer-options.ts:74) выкидывает источник, groups=[], остаётся голый «Назад».
[дубль линзы transfers: ⇄ на экране счетов открывает тупиковый лист при <2 счетах, а комментарий обещает удалённую ветку-объяснение]

**Фикс:** Гасить ⇄ при accounts.length < 2 (или вернуть в TransferSheet пустое состояние с дверью «Добавить счёт») и поправить оба разъехавшихся комментария.

### [x] U11 · P2 · design · `app/accounts/[id]/index.tsx:399`
**Герой карточки, архив и порядок счетов игнорируют выбранный значок и цвет счёта**

Карточка: «const Icon = KIND_ICON[account.kind]», комментарий на 685-686 врёт: «тот же голый глиф, что в строке списка» — строка списка рисует ВЫБРАННЫЙ значок с цветным диском (accounts/index.tsx:347-348: icon={accountIcon(a)}, tile={a.color ?? "neutral"}), панель «Финансов» тоже (AccountsPanel.tsx:89-90). Архив (archive.tsx:156) и «Порядок счетов» (order.tsx:204) также берут KIND_ICON. Значок заведён владельцем именно как узнавание счёта — а на его собственной странице счёт выглядит иначе, чем в списке.

**Фикс:** Везде брать accountIcon(account) (в герое — с диском цвета счёта), KIND_ICON оставить фолбэком внутри accountIcon.

### [x] U12 · P2 · dead-code · `src/features/finances/account-seeds.ts:37`
**COMPANY_ACCOUNT_SEEDS мёртв в проде, а комментарий в accounts.ts описывает несуществующий сид компании**

`COMPANY_ACCOUNT_SEEDS` (account-seeds.ts:37-41) используется только собственным тестом. В accounts.ts единственный вызов сидов — `useCreateTeamAccounts` (accounts.ts:319-321, TEAM_ACCOUNT_SEEDS); дока над useSeedAccounts (accounts.ts:261-279) обещает «компании — Наличные, Расчётный счёт и Карта со всеми активными командами» и «ДВА ЗАПРОСА НА СЧЁТ КОМПАНИИ… привязка команд пишутся раздельно», но сама функция (299-309) делает только insertAccount и никогда не вызывается со scope "company" — AccountCreateSheet тоже создаёт только scope:"team" (AccountCreateSheet.tsx:201).
[дубль линзы accounts: COMPANY_ACCOUNT_SEEDS и «компанийная» половина useSeedAccounts — мёртвый код после сноса счёта компании]

**Фикс:** Снести COMPANY_ACCOUNT_SEEDS вместе с company-ветками комментария (по канону 2026-08-15 счёт принадлежит ровно одной бригаде — сид компании больше не нужен) и переписать доку useSeedAccounts под реальное поведение.

### [x] U19 · P2 · ux · `src/features/finances/TransactionPopup.tsx:277`
**Ни попап, ни лента не показывают вторую сторону перевода — «куда/откуда» видно только в CSV**

Попап печатает только счёт своей ноги: «{account ? <MetaRow label="Счёт" value={account.name} /> : null}» — строки «Откуда/Куда» нет. В ленте ctx перевода — тоже только свой счёт и команда (TransactionsFeed.tsx:150-158), а в ленте одного счёта (contextMode="team") счёт вовсе скрыт. При этом выгрузка уже умеет находить корреспондента по transfer_group_id (export.ts:171-178: «Вторая нога перевода: та же группа, другой счёт»). В UI ответить на главный вопрос перевода «куда ушли деньги» негде.
[дубль линзы operations: Попап операции не показывает НДС]

**Фикс:** В попапе (и в ctx строки ленты) резолвить вторую ногу по transfer_group_id тем же приёмом, что correspondent() в export.ts, и печатать «Откуда → Куда» с именами счетов через accountOwnerLabel.

### [x] U20 · P2 · ux · `src/features/finances/TransferSheet.tsx:522`
**Обещанное «частичная сумма набирается поверх» не работает: у поля суммы нет selectTextOnFocus**

Шапка файла (строки 52-53): «сумма предзаполнена ВСЕМ остатком и выделена — …частичная сумма набирается поверх». Но TextInput (строки 522-546) имеет value/autoFocus/keyboardType и т.д., а selectTextOnFocus отсутствует — курсор встаёт в конец «640», и набор «50» даёт «64050». Чтобы перевести часть, надо вручную стирать предзаполненный остаток.

**Фикс:** Добавить selectTextOnFocus к TextInput суммы — предзаполненный остаток будет выделен, и первый же символ заменит его целиком, как и обещает комментарий.

### [ ] U27 · P2 · dead-code · `app/(dashboard)/cabinet/templates.tsx:49`
**Шаблоны операций настраиваются, но не применяются нигде**

Комментарий экрана (строки 49-54) обещает «чип-строку над формой + Доход/Расход» и ссылается на OperationSheet.tsx, но полоса шаблонов из OperationSheet снесена (OperationSheet.tsx:450-453: «Полосы шаблонов здесь больше нет… Шаблоны живут в настройках финансов»), и других потребителей useFinanceTemplates нет (грепом — только templates.tsx). Пользователь заводит шаблон в настройках — и тот не появляется ни в одной форме.

**Фикс:** Либо вернуть применение шаблонов в OperationSheet (ряд чипов или пункт в листе), либо убрать экран шаблонов из настроек, пока фича не вернулась.

### [x] U30 · P2 · ux · `src/features/finances/OperationSheet.tsx:423`
**OperationSheet: «Удалить» и скрим не гасятся во время сохранения**

Pressable «Удалить» (423–439) не имеет disabled={busy} — во время полёта update.mutateAsync можно запустить параллельный delete той же операции. Скрим-Pressable (407) тоже закрывает лист во время busy — ошибка сохранения (Alert из catch, 375) прилетит поверх уже закрытого листа, и набранное потеряно. Для сравнения InvoicePaymentSheet гейтит скрим: `onPress={submitting ? undefined : onClose}` (195).
[дубль линзы operations: «Удалить» в шапке правки не гасится во время сохранения]

**Фикс:** Дать обоим Pressable disabled по busy (и визуально пригасить «Удалить»), скрим — `onPress={busy ? undefined : onClose}`.

### [x] U34 · P2 · design · `app/accounts/[id]/settings.tsx:554`
**Пин счёта «Без НДС» прячет три клавиши вместо предустановки — подпись настроек лжёт**

Подпись обещает: «Значение подставляется в новую операцию… В самой операции его всегда можно переключить» (строка 554). Но пин «Без НДС» (vat_mode='off') делает effective mode 'off', и OperationSheet:254 (vatVisible) прячет секцию НДС целиком — переключить нельзя. Нарушен канон «три клавиши на каждой операции».

**Фикс:** Различать account-'off' и tenant-'off': при включённом «Работаем с НДС» показывать клавиши всегда, а пин счёта лишь предустанавливать клавишу «Без НДС».

### [x] U35 · P2 · design · `src/features/invoices/InvoiceEditor.tsx:461`
**Редактор инвойса показывает клавиши НДС при выключенном «Работаем с НДС»**

Карточка «Налог» с сегментом «Без НДС | НДС включён | Плюс НДС» видна всегда (строки 461-481), тогда как OperationSheet при выключенном тумблере не показывает слово «НДС» вовсе (OperationSheet.tsx:253-254 «Компания с выключенным налогом не должна видеть слово „НДС“ вообще»). Канон: тумблер гасит налог во всём продукте — инвойсы его игнорируют.

**Фикс:** При company mode 'off' сворачивать карточку «Налог» до строки-двери «Компания не работает с НДС → /finances/vat» (паттерн настроек счёта).

### [ ] U36 · P2 · design · `app/(dashboard)/finances/index.tsx:308`
**«Доход» и «Прибыль» обзора включают собранный НДС — прибыль завышена на налог**

totals.income суммирует полный signedAmount (строки 308-310), profit = income − expense; шапка vat.ts:3-7 прямо называет это ошибкой: «Если считать доходом все 480, прибыль завышена на 80». Владелец 2026-08-15 убрал только ПЛАШКУ «НДС к уплате» (комментарий index.tsx:331-333), решения «герой = гросс» не фиксировалось.

**Фикс:** Вычитать vat_amount из income (netIncome как в summarizeVat) либо явно согласовать с владельцем валовую прибыль и отразить это в подписи героя.

### [x] U37 · P2 · ux · `app/(dashboard)/finances/vat.tsx:218`
**«Своя ставка у команды» — тупик: строка ведёт в Alert «настроится когда-нибудь»**

onPress строки команды показывает Alert «Отдельная ставка команды настраивается на её странице — она появится вместе с остальными настройками команды» (строки 217-222); такой страницы нет. Секция обещает Кипр/Грецию, но задать переопределение из приложения невозможно ни одним путём.
[дубль линзы edge-copy: «Своя ставка у команды»: строки ведут в Alert-заглушку «появится вместе с остальными настройками»]

**Фикс:** Открывать отсюда лист выбора режима+ставки (PickerSheet, закон «один дизайн на все списки») с записью через уже готовый useSaveTeamVat — либо скрыть секцию до появления страницы команды.

### [x] U38 · P2 · dead-code · `src/features/finances/vat-queries.ts:97`
**useSaveTeamVat — мёртвый код: мутацию не вызывает ни один экран**

grep по src/ и app/ находит useSaveTeamVat только в месте определения (vat-queries.ts:97-132), включая логику «пустое переопределение = delete». Переопределения командам сегодня можно завести только SQL-ом (в проде team_finance_settings пуста). Правило владельца: после изменения вычищать мёртвый код.
[дубль линзы data-layer: useSaveTeamVat — мёртвый экспорт: командное переопределение НДС невозможно выставить из приложения]
[дубль линзы dead-code: useSaveTeamVat — единственный писатель team_finance_settings мёртв, ставка «на команду» нередактируема]

**Фикс:** Подключить мутацию к листу из предыдущей находки либо удалить вместе с ней до появления UI.

### [x] U39 · P2 · dead-code · `../../packages/shared/src/local/finance/vat.ts:77`
**vat_exemption_note нигде не вводится и не печатается — освобождение от НДС не работает**

Тип обещает «Текст освобождения для документов (печатается вместо ставки)» (vat.ts:77-78); vat-queries таскает поле из tenants и team_finance_settings (строки 33, 84), но на странице /finances/vat нет поля ввода, а document.ts (totalRows:258-285) и receipt-text.ts его не печатают. Освобождённая компания получает документы без обязательной оговорки.

**Фикс:** Добавить поле на страницу НДС и печатать примечание в totalRows/чеке при нулевой ставке — либо убрать поле из клиентского контура целиком.

### [x] U41 · P2 · design · `app/(dashboard)/finances/vat.tsx:158`
**Инлайн-математика НДС в примере настроек вместо общих функций**

Пример «вам останется…» для inclusive считается прямо в JSX: `EXAMPLE_PRICE - (EXAMPLE_PRICE * rate) / (100 + rate)` — без округления и мимо vat.ts, где для этого есть netFromGross/vatFromGross. Канон: «вся математика в applyTxVat» — дубликат формулы разойдётся при первой правке округления.
[дубль линзы vat: Пример «вам останется…» считает НДС четвёртой инлайн-формулой мимо vat.ts]

**Фикс:** Заменить выражение на `netFromGross(EXAMPLE_PRICE, rate)` (импорт уже есть — grossFromNet берётся из того же модуля строкой 15).

### [x] U46 · P2 · ux · `src/features/documents/ReceiptSheet.tsx:134`
**Чек → «Запись» открывается без &from=finances: закрыв запись, человек остаётся в календаре**

Навигация `/(dashboard)?appointmentId=…&date=…` без from (133-137), тогда как канонный переход из ленты денег добавляет "&from=finances" именно ради дороги назад (app/(dashboard)/finances/index.tsx:570-575; обработчик возврата — app/(dashboard)/index.tsx:629 понимает только этот параметр). Открыл чек в «Документах» → провалился в запись → закрыл — остался в календаре вместо панели документов. Канон: вкладки НЕ стек, нужен &from=.

**Фикс:** Добавить "&from=finances" к адресу записи в ReceiptSheet (лист живёт внутри вкладки «Финансы»).

### [x] U47 · P2 · design · `app/documents/index.tsx:77`
**Легаси-контур документов (/documents, /invoices, /documents/receipts) — свои вёрстки и красное «Просрочено»**

Хаб /documents (дверь из карточки клиента, ClientDocumentsRow.tsx:56) до сих пор считает Σ просрочки и красит её t.danger (77-82); список /invoices — свой трёхъячеечный саммари с красным «Просрочено» (app/invoices/index.tsx:191) и своя вёрстка строк. Это второй и третий диалект рядом с канонной панелью «Документы» (сегменты Инвойсы|Чеки) и прямо противоречит решению владельца 2026-08-15 «неоплаченный документ — не красить красным» (снятие красного задокументировано в DocumentsPanel.tsx:347-350 и index.tsx:416-420).

**Фикс:** Свести двери карточки клиента на канонную панель (/finances?clientId=… уже умеет режим клиента) либо перепаять легаси-экраны на общие строки и убрать красную просрочку.

### [x] U48 · P2 · ux · `src/features/documents/AppointmentDocuments.tsx:87`
**Строка «Чек …» в записи ведёт на общий список, где чек нельзя ни открыть, ни выслать**

Тап по конкретному чеку уводит на onOpen("/documents/receipts") — общий экран, где строки вообще не нажимаются (app/documents/receipts.tsx:65-110, renderItem без Pressable/onPress) и суммы печатаются formatEUR вместо валюты чека (receipts.tsx:99). Канон 2026-08-12: «чек открывается листом и высылается изнутри» — из записи это невозможно: ни листа, ни кнопки «Выслать».

**Фикс:** Открывать ReceiptSheet конкретного чека прямо из AppointmentDocuments (чеки записи уже загружены через useReceipts({appointmentId})).

### [x] U58 · P2 · ux · `app/accounts/[id]/index.tsx:882`
**Карточка счёта не даёт произвольный период «С–До» — выписка только по пресетам**

На карточке подключён только PeriodPresetModal (строки 882-888); PeriodWheelsModal из того же модуля не используется вовсе. «Выгрузить выписку» (строки 873-879) шлёт бухгалтеру ровно текущий период — то есть произвольные даты (1–15 число, квартал, «всё время») недоступны в единственном месте продукта, где выписка живёт. Вдобавок после «Показать июль» (preset=custom, period.ts:113-122) в открытом листе пресетов не отмечена ни одна строка и вернуться к этому месяцу после ухода с него нельзя.

**Фикс:** Подключить PeriodWheelsModal второй дверью (как на «Финансах»: имя периода — пресеты, значение-даты — барабаны) либо добавить строку «Свой период…» в PeriodPresetModal, открывающую барабаны.

### [~] U66 · P2 · design · `src/features/finances/FinanceOverview.tsx:94`
**Запрещённые классы rounded-xl/2xl/3xl и borderRadius-литералы по всему финансовому контуру**

Закон «ОДИН РАДИУС НА ВСЁ»: «Литералов borderRadius: 12/16/18/20 и классов rounded-xl/2xl/3xl в продукте быть не должно». Грепом: FinanceOverview.tsx:94; PeriodSheets.tsx:104,113,236; TransactionPopup.tsx:220 (rounded-3xl=24 у карточки-витрины — 24 зарезервированы за верхом листа),265,342; TransferSheet.tsx:717 (PartyCard borderRadius:18 — новая поверхность 2026-08-15); app/(dashboard)/finances/index.tsx:742 (rounded-2xl); vat.tsx:179; finances/invoices.tsx:333; InvoiceEditor.tsx:451,474; InvoiceLineEditor.tsx:44 (rounded-2xl); InvoicePaymentSheet.tsx:218,243,275,281; InvoiceRefundSheet.tsx:137,157,184; app/invoices/index.tsx:158,187; UnclosedScreen.tsx:424; close-day.tsx:446,450,508,547,588.
[дубль линзы ux-micro: Плитки сводки — 38pt, ниже минимального тап-таргета 44pt]

**Фикс:** Заменить все на `borderRadius: t.radius.card` / `t.radius.input` (оба = 14) через style, а классы rounded-* убрать. TransferSheet PartyCard: 18 → t.radius.card.

### [x] U67 · P2 · design · `src/features/finances/TransactionPopup.tsx:208`
**TransactionPopup — самодельный центрированный диалог, жанра нет в ДС**

`<Modal ... animationType="fade">` с центрированной карточкой rounded-3xl (строка 220) и собственными кнопками-пилюлями с 1px бордерами (строки 185-187: `borderColor: kind === "danger" ? t.danger + "66" : t.separator`). В ДС ровно два всплывающих жанра: BottomSheet и системный ActionSheetIOS; центрированной карточки-витрины нет, и она существует в единственном экземпляре на весь продукт. Строка 383 — `color: "#ffffff"` вместо t.onAccent.

**Фикс:** Перевести витрину операции на BottomSheet (title = тип операции, meta-строки, действия ActionRow), либо узаконить жанр в ДС; #ffffff → t.onAccent, радиусы → t.radius.

### [x] U68 · P2 · design · `src/features/finances/PeriodSheets.tsx:92`
**Листы периода не используют анатомию BottomSheet: title в теле, кнопка в прокрутке**

Закон 2026-08-10: «АНАТОМИЯ ЛИСТА — обязательна для любого листа с кнопкой: title → тело (scroll) → footer. Заголовок задаётся ПРОПОМ title и рисуется ВНУТРИ жеста грабера». Здесь `<BottomSheet visible onClose>` без title, заголовок «Период» — свой Text в теле (строки 94-101); у PeriodWheelsModal кнопка «Применить» лежит в теле (строка 260), а не в footer — пан-жест закрытия остаётся на одной полоске 36×5pt.

**Фикс:** Передавать `title="Период"` / `title="Свой период"` пропом, у Wheels вынести «Применить» в `footer`.

### [x] U69 · P2 · design · `app/accounts/[id]/settings.tsx:612`
**Лист «Подключить команды» без title-пропа и с кнопкой в теле**

`<BottomSheet visible={attachOpen} onClose=...>` — заголовок отдан RowGroup внутри тела (строка 614), GradientButton «Подключить» тоже в теле (631), а не в footer. Тот же закон анатомии листа с кнопкой, что и у PeriodSheets.

**Фикс:** `title="Подключить команды"` пропом, кнопку — в `footer` (получит правильный нижний отступ и не уедет под home-индикатор).

### [x] U70 · P2 · design · `app/invoices/index.tsx:191`
**Legacy-экран /invoices красит «Просрочено» красным и дублирует дизайн списка документов**

`<SummaryCell label="Просрочено" value={summary.overdue} color={t.danger} />` — а владелец 2026-08-15 (зафиксировано в FinanceOverview.tsx:250-253 и DocumentsPanel.tsx:347-350): «неоплаченный документ — ничего страшного, не надо выставлять его якобы красным»; из панели «Документы» красный и Σ просроченного вынесены. Экран доступен из карточки клиента (/documents → /invoices) и рисует инвойсы третьей вёрсткой (InvoiceRow с бейджем и шевроном) рядом с DocumentRow панели — «одинаковость карточек между экранами» нарушена.
[дубль линзы ux-micro: Красная «просрочка» в инвойсах противоречит решению владельца 2026-08-15]
[дубль линзы dead-code: «Просрочено» на странице инвойсов осталось красным вопреки решению владельца 2026-08-15]
[дубль линзы edge-copy: Красная сводка «Просрочено» на странице /invoices противоречит решению 2026-08-15]

**Фикс:** Снять красный/Σ просроченного по тому же решению и пересобрать строку инвойса в общий с DocumentsPanel компонент (или свести экран к DocumentRow), чтобы инвойс выглядел одинаково из обеих дверей.

### [x] U71 · P2 · design · `src/features/finances/PanelHeader.tsx:40`
**Капс-эйбрау набраны четырьмя разными чернилами по контуру**

Одна и та же роль «капс-подпись 11-12/700» покрашена по-разному: PanelHeader.tsx:40 — t.sub (0.74); герой счетов app/accounts/index.tsx:449 — t.caption (0.62, с обоснованием «описывающее — тише»); TransferSheet.tsx:407 заголовок группы счетов — t.faint (0.64); AccountTeamInflow.tsx:162 «Сдали выручку» — полный t.ink; InvoicePaymentSheet.tsx:214 и InvoiceLineEditor.tsx:47 — t.faint. В colors.ts:100-105 для этой роли заведён отдельный токен `caption` с измеренным обоснованием.

**Фикс:** Свести все капс-эйбрау денежных экранов на `t.caption` (кроме имён групп-строк, которым ДС оставляет полный ink), в идеале — одним компонентом SectionEyebrow/PanelHeader.

### [x] U72 · P2 · copy · `src/features/finances/OperationSheet.tsx:653`
**«Выставить счёт» в OperationSheet против «Выставить инвойс» везде — словарь двоится, «счёт» занят деньгами**

`label={transaction.invoice_id ? "Открыть счёт" : "Выставить счёт"}` — а в TransactionPopup.tsx:308 те же действия называются «Открыть инвойс / Выставить инвойс», и главная кнопка экрана — «Выставить инвойс» (finances/index.tsx:899). Хуже: в этой же форме секция «Счёт» (строка 589) означает денежный счёт — «Выставить счёт» читается как действие над кассой.
[дубль линзы edge-copy: Одно действие — два словаря: «Выставить счёт» в OperationSheet против «Выставить инвойс» в попапе]

**Фикс:** Переименовать в «Открыть инвойс» / «Выставить инвойс» — одно слово на одну сущность.

### [x] U73 · P2 · design · `src/features/invoices/InvoiceLineEditor.tsx:34`
**Поля позиций инвойса — белые с 1px бордером вместо канонической вставной заливки**

`inputStyle` = `borderWidth: 1, borderColor: t.separator, backgroundColor: t.surface` (строки 34-39), сама карточка позиции тоже с 1px бордером (строка 45). ДС: `fill` — «the ONE inset fill: … inset input», и «DON'T use 1px borders where a separator color works». Все остальные поля контура (поиск в шапке, ставка НДС, суммы) — заливка t.fill без бордера.

**Фикс:** Убрать бордеры, поля — `backgroundColor: t.fill`; карточку позиции — на card-shadow/сепараторы, radius t.radius.card.

### [x] U76 · P2 · ux · `src/features/finances/DebtorsList.tsx:184`
**Список должников не ведёт в саму запись, где долг закрывается**

`onPress={r.clientId ? () => router.push(`/clients/${r.clientId}`) : undefined}` — тап по должнику открывает карточку клиента. Канон владельца: «долг = бригадир не отметил оплату, закрывается в САМОЙ ЗАПИСИ»; id записи (r.id = appointment id) в строке есть, но дороги к записи нет — диспетчер идёт клиент → история → запись. Для записей без клиента (name из comment) строка вообще не нажимается.

**Фикс:** Тап по строке — открывать запись через тот же адрес с &from=, что в ленте операций (openAppointment в finances/index.tsx); клиента оставить второй дверью (long-press/кнопка).

### [x] U86 · P2 · ux · `app/(dashboard)/finances/index.tsx:813`
**На главном экране финансов нет pull-to-refresh ни в одной панели**

TransactionsFeed рендерит SectionList без refreshControl (TransactionsFeed.tsx:251–267), AccountsPanel (AccountsPanel.tsx:48) и DebtorsList (DebtorsList.tsx:149) — голые ScrollView, DocumentsPanel — SectionList без контрола. При этом страница счетов (app/accounts/index.tsx:619–625) и список инвойсов (app/invoices/index.tsx:217–225) pull-to-refresh имеют — главный денежный экран единственный без жеста обновления, refreshAll (строки 396–409) есть, но дотянуться до него можно только из состояния ошибки.

**Фикс:** Передать в панели refreshControl на базе usePullRefresh(refreshAll) — как это уже сделано на /accounts и /invoices.

### [x] U98 · P2 · feature · `packages/shared/src/db/repositories/invoice-payments.ts:37`
**listInvoicePayments тянет полный select * всех инвойсных проводок тенанта плюс серию чанк-запросов — и гейтит весь экран «Финансы»**

Функция читает ВСЕ income/refund с invoice_id за всю историю (select *, стр. 42-57), затем догружает легаси-возвраты последовательными чанками по 100 income-id (стр. 70-94) — при 500 оплаченных инвойсах это 5+ дополнительных запросов. useInvoicePayments вызывается на 5 экранах, включая деталь ОДНОГО инвойса (app/invoices/[id].tsx:71), и стоит в полном гейте загрузки финансов (finances/index.tsx:376) — первый рендер вкладки ждёт скан всей истории.

**Фикс:** Добавить перегрузку по invoice_id (для детали/редактора) и периодное окно для панели документов; чанки легаси-возвратов слить в один запрос .in() по большему батчу или закрыть миграцией, дописавшей invoice_id старым возвратам.

### [x] U99 · P2 · ux · `app/(dashboard)/finances/index.tsx:222`
**Вкладка «Финансы» не обновляется ни по фокусу, ни жестом — чужие правки видны только после сворачивания приложения**

Realtime-мост покрывает только clients/appointments/tags (src/lib/sync-bridge.ts:39-43) — финансовые таблицы не подписаны. На вкладке нет ни RefreshControl/usePullRefresh (grep по index.tsx, TransactionsFeed, AccountsPanel, DocumentsPanel — пусто), ни useFocusEffect-рефетча (есть только в UnclosedScreen.tsx:87). Экран таба остаётся смонтированным, focusManager реагирует лишь на AppState: владелец, вернувшийся на вкладку через час работы в календаре, читает утренние остатки без какого-либо признака несвежести. Контраст: страница счетов имеет pull-refresh (app/accounts/index.tsx:242).

**Фикс:** Добавить usePullRefresh на TransactionsFeed/DocumentsPanel (SectionList уже есть) и лёгкий useFocusEffect-инвалидейт ["transactions"]/["accounts"] по возврату на таб.

### [x] U103 · P2 · dead-code · `src/features/finances/vat-queries.ts:15`
**document_language гоняется в обе стороны, но не имеет ни UI, ни потребителя**

`TenantVatSettings.documentLanguage` читается (vat-queries.ts:33,41) и умеет сохраняться (vat-queries.ts:61-63), но grep по документам ноль: ни vat.tsx, ни document.ts/pdf.ts/InvoicePaper его не используют — PDF печатает захардкоженный русский («В назначении платежа укажите…», pdf.ts:156). Экран при этом называется «НДС и страна» (vat.tsx:93), хотя никакой «страны» на странице нет.

**Фикс:** Либо подключить: селектор языка документов на странице НДС и подстановка documentLanguage в buildInvoiceDocument/pdf; либо выкинуть поле из select/update и переименовать экран в просто «НДС».

### [x] U104 · P2 · design · `app/invoices/index.tsx:86`
**Сводка по инвойсам (открытые/к оплате/просрочено) считается тремя независимыми циклами**

Один и тот же проход invoices×payments через calculateInvoiceSettlement написан трижды: app/invoices/index.tsx:86-105 (outstanding/overdue/paid), app/(dashboard)/finances/index.tsx:421-434 (openCount, свои фильтры scope), app/documents/index.tsx:42-64 (openCount/outstanding/overdue, свой clientId-фильтр). Правила уже разъехались: finances-версия по решению владельца 2026-08-15 не считает overdue вовсе (комментарий index.tsx:416-420), а две другие считают и красят.

**Фикс:** Один селектор в src/features/invoices (например summarizeInvoiceSettlements(invoices, payments, {clientId, teamId, today})) с тестом, все три экрана — только его вызовы. Разночтения политики (считать ли overdue) станут одним параметром, а не тремя копиями.

### [x] U105 · P2 · design · `src/features/invoices/format.ts:30`
**Два парсера денежного ввода: инвойсы через свой parseMoneyAmount, финансы через shared parseMoneyInputToCents**

Все финансовые листы (OperationSheet.tsx:303, TransferSheet.tsx:191, CashCountSheet.tsx:121, AccountCreateSheet.tsx:145, TransactionPopup.tsx:128) парсят суммы shared-функцией parseMoneyInputToCents (точные центы, отсечка MAX_MONEY_CENTS/numeric(12,2)). Весь инвойсный контур (InvoicePaymentSheet.tsx:159, InvoiceEditor.tsx:221, InvoiceLineEditor.tsx:29, InvoiceRefundSheet.tsx:84) — своим parseMoneyAmount (format.ts:30-35): float без верхней границы, т.е. сумма, которую операция честно отклонит, в оплате инвойса проходит клиентскую проверку и падает уже на сервере/теряет точность.

**Фикс:** Перевести инвойсные листы на parseMoneyInputToCents (или тонкую обёртку над ним для float-API), parseMoneyAmount удалить; parseDecimal оставить только для qty.

### [x] U118 · P2 · copy · `app/accounts/index.tsx:103`
**Герой экрана счетов: «У бригады Без бригады на счетах»**

heroLabelFor приклеивает «У бригады …» ко всем именам, не начинающимся с «бригад/команд» (isSelfNamedTeam). Псевдо-чип NO_TEAM зовётся «Без бригады» (accounts-sections.ts:184-189) → герой и VoiceOver-объявление (строка 219) печатают «У бригады Без бригады на счетах». Кейс живой: в проде есть тенант со счетами без brigade_id (комментарий accounts-sections.ts:119-124).

**Фикс:** В heroLabelFor обработать спец-чипы: для NO_TEAM печатать «Счета без бригады», для «Команда удалена» — имя как есть. Проще всего — проверять chip.orphan/NO_TEAM в вызывающем коде и передавать готовую фразу.

### [x] U119 · P2 · ux · `src/features/finances/TransferSheet.tsx:395`
**Перевод при 0–1 счетах: иконка ⇄ активна, а шаг выбора счёта — пустой лист без единого слова**

Шаги "from"/"to" рендерят только groups.map — при нулевых группах остаётся голый «Назад» без объяснения. На экране счетов иконка ⇄ активна всегда (app/accounts/index.tsx:509), причём комментарий 505-508 обещает «лист объясняет правило и предлагает завести счёт» — этой ветки в TransferSheet больше нет. На «Финансах» та же кнопка честно гаснет при accounts.length<2 (app/(dashboard)/finances/index.tsx:880) — две двери ведут себя по-разному.

**Фикс:** Добавить в шаг выбора счёта EmptyState («Переводить некуда — заведите второй счёт» + кнопка создания), либо гасить ⇄ в шапке при <2 активных счетов, как на «Финансах». Стейл-комментарий убрать.

### [x] U120 · P2 · copy · `src/features/finances/FinanceOverview.tsx:260`
**VoiceOver плитки «Документы»: «1 документ ждут оплаты»**

a11yValue={`${formatCountRu(invoices.openCount, FORMS_DOCUMENT)} ждут оплаты`} — глагол зашит во множественном числе: при openCount=1 читается «1 документ ждут оплаты» (надо «ждёт»).

**Фикс:** Склонять глагол вместе с числительным: `ждёт` для формы ONE, `ждут` для остальных — например `pluralRu(openCount, ["ждёт", "ждут", "ждут"])` или готовой фразой в plural-ru.

### [x] U121 · P2 · copy · `src/features/finances/documents.ts:144`
**Аннулированный чек называется «Погашен» — читается как «оплачен»**

Для инвойса status=void → «Аннулирован» (строка 116), для чека тот же void → «Погашен». В финансовой лексике «погашен» означает «оплачен» (погашенный долг/счёт) — потухшая строка чека сообщает противоположное тому, что случилось. Одно серверное состояние названо двумя словами в одном списке.

**Фикс:** Заменить «Погашен» на «Аннулирован» — то же слово, что у инвойса и в тосте отказа; сленг «погашенный документ» оставить только в комментариях.

### [x] U122 · P2 · copy · `src/features/finances/AccountTeamInflow.tsx:165`
**Заголовок «Сдали выручку» — слово, снесённое владельцем 2026-08-15**

Блок инкассаций на карточке legacy-счёта компании печатает капс-заголовок «Сдали выручку». По решению владельца «сдачи выручки» отдельным словом больше нет (transfer-options.ts:13-14, TransferSheet.tsx:75-77) — а этот экран жив, пока в проде остаётся Revolut Business со scope=company.

**Фикс:** Переименовать заголовок в «Переводы с касс» / «Переводы от команд» — то же событие названо словом «перевод», как во всём продукте.

### [x] U131 · P2 · test · `src/features/finances/period.ts:55`
**period.ts — граница всех денежных запросов — без единого теста**

presetRange (строки 55–95), monthPeriodOf (113–122), periodPhrase (183–221), presetHint (230–241) не импортируются ни одним *.test.ts (account-period.test.ts тестирует другой модуль — account-period.ts). Между тем from/to отсюда уходят в useAccountPeriodTotals, ленты операций, панель НДС, документы и экспорт: ошибка на стыке года (lastmonth в январе → new Date(y, -1, 1); week/lastweek через 1 января; понедельничная неделя) — это деньги, посчитанные не за тот период. periodPhrase дополнительно зависит от несинъектированного new Date() (строка 207).

**Фикс:** Добавить period.test.ts с фиксированной base: lastmonth в январе, week/lastweek на стыке года, «целый месяц»/«целый год» в periodPhrase, custom-фолбэк, presetHint. Заодно передавать «сегодня» параметром в periodPhrase вместо new Date().

### [x] U132 · P2 · test · `src/features/finances/breakdown.ts:61`
**breakdown.ts: неттинг возвратов в «Разборе прибыли» не покрыт тестами**

breakdownIncome (строки 61–97) несёт нетривиальные денежные правила: возврат вливается в корзину исходного дохода через поиск refund_of_id в том же массиве (строки 82–88), сиротский возврат падает в «Возвраты», корзины с нулевым неттом отбрасываются (строка 95), возврат не уменьшает count. Ни одного теста нет — а именно это число сверяется с «Прибылью» на герое экрана. Ошибка здесь = секции не сходятся с итогом.

**Фикс:** Добавить breakdown.test.ts: возврат в периоде неттится в свою услугу; сиротский возврат → «Возвраты» с минусом; полностью возвращённая услуга исчезает из списка; сумма строк дохода − сумма строк расхода = прибыль периода.

### [x] U133 · P2 · test · `src/features/finances/vat-queries.ts:141`
**effectiveVatSettings — клиентское зеркало серверного резолвера НДС — без теста на паритет**

effectiveVatSettings (строки 141–153) повторяет логику SQL-триггера fill_transaction_vat: режим coalesce(счёт, команда, компания), ставка coalesce(команда, компания) — у счёта своей ставки нет намеренно. Форма показывает налог по клиентскому резолверу (OperationSheet.tsx:248–252, 305), а в базу пишет триггер: разъезд этих двух формул = человек видит один налог, а в чек уходит другой. Тонкие места без тестов: accountMode='off' глушит налог при включённой компании; accountMode перебивает только mode, ставка остаётся командной; teamOverride.rate=null наследует компанию.

**Фикс:** Добавить vat-queries.test.ts на чистую effectiveVatSettings: все три уровня наследования, «счёт off при компании on», «счёт inclusive + ставка команды 24 против компании 19», пустой tenant → VAT_OFF. В комментарии закрепить, что это зеркало fill_transaction_vat.

### [ ] U1 · P3 · design · `app/(dashboard)/finances/index.tsx:266`
**Материалы in_progress-записей уменьшают прибыль периода до того, как появился их доход**

materialSummary считает записи `status !== "completed" && status !== "in_progress" → continue` (стр. 266), а авто-доход по записи сервер пишет только при completed+paid (sync_appointment_finance, 20260528_002:267+). Пока бригада на объекте, расход по материалам уже вычтен из прибыли периода, а доход этой работы ещё не существует — прибыль дня системно занижена.

**Фикс:** Считать материалы только по completed-записям (симметрично признанию дохода) или явно решить и задокументировать базис «расход при старте работ».

### [x] U2 · P3 · bug · `src/features/finances/FinanceOverview.tsx:284`
**«Доход» на плитке красится и подписывается по сырому знаку float: возможен красный «−€0»**

`color={totals.income < 0 ? t.danger : t.success}` и `value={`${totals.income < 0 ? "−" : ""}${formatEUR(Math.abs(totals.income))}`}` (стр. 284-287) — сырой знак; сумма 2-значных float (доход 0.30 − возвраты 0.10 − 0.20) даёт −2.8e-17 → красный «−€0». Соседний комментарий у «Прибыли» (стр. 311-312) сам объявляет правило «минус по округлённым центам, а не по сырому знаку».
[дубль линзы edge-copy: Плитка «Доход» может напечатать «−€0»: знак считается по сырому float]

**Фикс:** Использовать moneySign(totals.income) для цвета и позволить money() печатать минус самому (как у «Прибыли»).

### [x] U3 · P3 · design · `src/features/finances/IncomeShareDonut.tsx:182`
**Донат «Доли»: проценты слайсов округляются независимо — легенда суммируется в 99% или 101%**

`{Math.round((s.value / total) * 100)}%` (стр. 182) для каждого слайса отдельно: три равные доли по 33.33% печатаются как 33+33+33=99%; 33.5+33.5+33 → 34+34+33=101%.

**Фикс:** Распределять проценты методом наибольших остатков (largest remainder), чтобы легенда всегда сходилась в 100%.

### [x] U4 · P3 · copy · `app/(dashboard)/finances/index.tsx:841`
**Комментарий про авто-расход по материалам врёт: сервер пишет только income/refund**

«Правило одно на доход и расход: расход тоже родится сам, если у услуги записаны материалы» (стр. 841-843) — sync_appointment_finance вставляет только type='income' и type='refund' (20260528_002_finance_redesign.sql:267+), авто-expense в леджере не существует; материалы живут только клиентским расчётом materialSummary. Комментарий о движении денег, вводящий следующего разработчика в заблуждение.

**Фикс:** Переписать комментарий: авто-проводки — только доход/возврат; материалы — расчётная величина клиента.

### [x] U5 · P3 · design · `app/accounts/[id]/index.tsx:315`
**handleRefund продублирован дословно в двух экранах — правило возврата чинится в двух местах**

app/(dashboard)/finances/index.tsx:534-551 и app/accounts/[id]/index.tsx:315-332 — идентичные копии (тип, минус-сумма, наследование полей, заметка «Возврат по операции от …»). Грядущий фикс наследования НДС и request_id придётся вносить дважды; копии уже готовы разъехаться.

**Фикс:** Вынести buildRefundDraft(tx, amount, businessToday) в src/features/finances (рядом с queries.ts) и звать из обоих экранов.

### [x] U6 · P3 · design · `src/features/finances/TransactionsFeed.tsx:219`
**Нулевой итог дня в ленте операций красится зелёным**

`color: moneySign(section.net) < 0 ? t.danger : t.success` (стр. 219) — день, где приход и расход схлопнулись в €0, печатается зелёным «€0», как будто деньги пришли. По ДС «цвет = смысл»: ноль движения не приход.
[дубль линзы period-scope: Нулевой итог дня в ленте операций красится зелёным]
[дубль линзы edge-copy: Нулевой итог дня в ленте операций красится зелёным]

**Фикс:** Трёхцветно: sign>0 → success, sign<0 → danger, 0 → t.sub/ink.

### [x] U13 · P3 · dead-code · `app/(dashboard)/finances/index.tsx:247`
**Фильтр miniCardAccounts по scope==='team' — no-op со стёртым смыслом**

scopedAccounts уже отфильтрованы accountServesTeam (строка 240), который после 2026-08-15 сравнивает только brigade_id (integrity.ts:49-54), а счёт с brigade_id не бывает scope==='company' (assertScopeConsistency, shared accounts.ts:160-162). Значит «scopedAccounts.filter((a) => a.scope === "team")» ничего не отсекает, а комментарии рядом («свои счета + общие, к которым команда подключена», «полный баланс общего умножался бы на число команд») описывают старую модель.

**Фикс:** Убрать второй фильтр (miniCardAccounts = scopedAccounts) и актуализировать комментарии.

### [x] U14 · P3 · copy · `src/features/finances/AccountCreateSheet.tsx:28`
**Комментарий листа создания обещает «шесть глифов», а сетка — пятнадцать**

Шапка файла: «шесть глифов, а не двадцать семь (см. ACCOUNT_ICONS)» — а сам ACCOUNT_ICONS (account-ui.ts:48-64) содержит 15 значков и свой комментарий «Пятнадцать штук». Число разъехалось после расширения набора 2026-08-15.

**Фикс:** Поправить комментарий (или просто убрать число — оно живёт в account-ui.ts).

### [x] U15 · P3 · ux · `src/features/finances/AccountCreateSheet.tsx:309`
**VoiceOver читает значки счёта английскими слагами: «Значок handcoins»**

accessibilityLabel={`Значок ${value}`}, где value — слаг из ACCOUNT_ICONS ('handcoins', 'piggy', 'case'…). Незрячий пользователь слышит смесь русского с английским кодом и не может отличить «копилку» от «сейфа».
[дубль линзы edge-copy: VoiceOver значков счёта читает английские слаги: «Значок piggy», «Значок handcoins»]

**Фикс:** Добавить в ACCOUNT_ICONS русскую подпись (label: «Копилка», «Сейф»…) и читать её в accessibilityLabel.

### [x] U16 · P3 · ux · `src/features/finances/AccountsPanel.tsx:64`
**Пустая панель «Счета» на «Финансах»: кнопка «Добавить счёт» открывает список, а не создание**

action={{ label: "Добавить счёт", onPress: () => onOpen("/accounts") }} — тап ведёт на страницу счетов, где (для бригады без счетов) придётся нажать вторую такую же кнопку. Кнопка называет действие, которого не делает.
[дубль линзы ux-micro: Пустая панель «Счета»: кнопка «Добавить счёт» ведёт на страницу, а не в лист создания]

**Фикс:** Вести сразу в создание: либо на /accounts/settings с автооткрытием листа (параметр ?create=1), либо переименовать в «К счетам».

### [x] U17 · P3 · copy · `src/features/finances/accounts-sections.ts:12`
**Комментарии слоя счетов до сих пор описывают «счёт нескольких бригад в списке каждой», а механика стала brigade-only**

Шапка: «счёт, которым пользуются несколько бригад, просто появляется в списке КАЖДОЙ подключённой… доступ решает общий accountServesTeam» — но accountServesTeam с 2026-08-15 сравнивает только brigade_id (integrity.ts:49-54), и legacy-счёт компании (brigade_id null, team_ids [X,Y]) виден ТОЛЬКО под чипом «Без бригады», а не в списках X и Y. Ту же старую модель пересказывают app/accounts/index.tsx:78-80, app/accounts/[id]/index.tsx:400-403 и док accountSubtitle (account-ui.ts:90-95: обещает «Наличные · Юра, Аня», код печатает «Без бригады»). Ветка «Пользуются:» ладдера подписи (accounts-sections.ts:398-401) для новых счетов недостижима: у team-счетов team_ids всегда [] (shared accounts.ts:66).

**Фикс:** Переписать комментарии под фактическую модель «один счёт — одна бригада, наследие живёт под „Без бригады“»; ветку sharedWith либо пометить как legacy-only, либо снести вместе с прокидкой sharedWith из экранов.

### [x] U18 · P3 · dead-code · `app/accounts/index.tsx:184`
**Стейт createTeamIds хранит легенду про «тупик перевода», которого больше нет**

Комментарий: «Кому заводим счёт: обычно выбранная бригада, из тупика перевода — все». Единственная запись в setCreateTeamIds — openCreate (строка 208, всегда [teamId] либо []); ветка тупика удалена из TransferSheet (TransferSheet.tsx:317-321). Плюс AccountCreateSheet использует только preset[0] (строка 137), так что массив избыточен.

**Фикс:** Свести стейт к createTeamId: string | null (или к простому openCreate без стейта) и убрать комментарий про тупик.

### [x] U21 · P3 · design · `src/features/finances/transfer-options.ts:93`
**Счета удалённой команды в пикере попадают в группу «Без бригады», хотя лейбл различает «Команда удалена»**

transferGroups: в orphans уходит всё, что не разобрали живые команды — «const orphans = …; groups.push({ teamId: null, title: "Без бригады", accounts: orphans })». Счёт с brigade_id жёстко удалённой команды получает заголовок группы «Без бригады», тогда как accountOwnerLabel (строки 47-50) для того же счёта честно печатает «Команда удалена» — тест transfer-options.test.ts:65-74 фиксирует, что «удалённая команда и отсутствие бригады — разные вещи». Заголовок «Команда удалена» достаётся только группе источника (строка 87).
[дубль линзы edge-copy: Счета удалённой команды в листе перевода подписаны «Без бригады», хотя бригада у них есть]

**Фикс:** Делить хвост на две группы по тому же правилу, что accountOwnerLabel: brigade_id есть, но команды нет → «Команда удалена»; brigade_id null → «Без бригады».

### [x] U22 · P3 · ux · `src/features/finances/TransferSheet.tsx:225`
**Остаток предзаполняется только из двери «со строки счёта» — ручной выбор источника оставляет сумму пустой**

Инициализация (строки 165-170) ставит amount = остаток источника только при presetFromId. pickFrom (строки 225-240) сумму не трогает: открыв лист иконкой ⇄ (openTransfer(null), app/accounts/index.tsx:510) и выбрав «Откуда», человек получает пустое поле — обещание «„сдать всё“ это ноль набора» (строки 52-53) работает лишь из свайпа/карточки. Чип «Весь остаток» смягчает, но это уже второй тап.

**Фикс:** В pickFrom, если amount пуст или равен остатку прежнего источника, подставлять formatMoneyForInput(next.balance) — та же логика «сдать всё», что и при открытии с пресетом.

### [x] U23 · P3 · copy · `src/features/finances/period.ts:166`
**Док dayPhrase утверждает, что дата перевода «не выбирается», хотя выбор даты уже отгружен**

«Один день словами: „10 августа“. Дата перевода печатается ПОКАЗАНИЕМ и не выбирается (ТЗ §5.2), но назвать её продукт обязан» — устарело: с 2026-08-15 дата выбирается третьим шагом листа (TransferSheet.tsx:63-67, шаг "date" со спиннером, строки 325-376).

**Фикс:** Обновить комментарий: dayPhrase подписывает и выбранную дату перевода (строка «Когда»), и возраст остатка.

### [x] U24 · P3 · ux · `src/features/finances/TransferSheet.tsx:353`
**У барабана даты перевода нет нижней границы — случайная прокрутка года пишет перевод в глубокое прошлое**

DateTimePicker задаёт только maximumDate={parseYMD(businessToday)}; minimumDate отсутствует — колесо крутится хоть в 2020-й. rejectFutureLedgerDate режет только будущее, а серверный guard_closed_day_finance_write защищает лишь дни до последней сверки: тенант, ни разу не закрывавший день, может незаметно провести перевод годовой давности и разъехаться отчётами.

**Фикс:** Поставить minimumDate — например, первый день движения по счетам (first_tx_on) или разумный пол вроде начала прошлого месяца, согласовав с правилом закрытых дней.

### [x] U25 · P3 · ux · `src/features/finances/TransactionsFeed.tsx:137`
**Перевод с комментарием теряет в ленте слово «Перевод» — читается как расход**

desc = cat?.name || tx.notes || (isTr ? "Перевод" : "Расход") — у перевода категории нет, поэтому заметка («на бензин») полностью вытесняет тип; остаются лишь серые бар/цифра (barColor=t.faint, amountColor=t.sub) и минус у исходящей ноги. Строка «на бензин −€50» без слова «Перевод» и без счёта-корреспондента неотличима от расхода, хотя в P&L она нейтральна.

**Фикс:** Для tx.type === "transfer" всегда титуловать строку «Перевод» (лучше — «Перевод → {счёт}»), а заметку опускать в ctx-строку.

### [x] U26 · P3 · test · `src/features/finances/transfer-undo.ts:36`
**Ни одного теста на transfer-undo, transfer-memory и ключ намерения request_id**

В src/features/finances есть только transfer-options.test.ts; файлов transfer-undo.test.ts и transfer-memory.test.ts нет (листинг каталога). Логика requestIdFor зашита приватно в компонент (TransferSheet.tsx:219-223) и не покрыта — баг с ключом без даты/комментария (см. отдельную находку) тестом бы поймался; поведение «тост без группы не обещает Отменить» (transfer-undo.ts:60-66) тоже держится только на чтении кода.

**Фикс:** Вынести requestIdFor в чистый хелпер (key → stable uuid) и покрыть тестом смену ключа при изменении суммы/даты/заметки; добавить тест transfer-undo: успех → тост с «Отменить» только при group_id, отказ отмены → error-тост.

### [x] U28 · P3 · copy · `src/features/finances/OperationSheet.tsx:383`
**Два разных диалога удаления одной операции: пустое тело против «нельзя отменить»**

OperationSheet.tsx:383 — Alert(«Удалить операцию?», "") с пустым телом; TransactionPopup.tsx:134 — «Удалить операцию?», «Действие нельзя отменить.». Правила текстов продукта (account-alerts.ts:9-13): тело — последствие; тексты одного действия не должны расходиться по копиям — ровно та болезнь, ради которой заведён account-alerts.
[дубль линзы ux-micro: Два разных текста подтверждения удаления одной и той же операции]

**Фикс:** Один текст в account-alerts (например «Операция исчезнет из ленты, остаток счёта пересчитается») и использовать его в обоих местах.

### [x] U29 · P3 · ux · `src/features/finances/OperationSheet.tsx:606`
**Повторный тап по выбранному чипу счёта снимает выбор — форма становится несохраняемой**

Строки 606-608: const off = accountId === a.id; setAccountId(off ? null : a.id). Счёт в операции обязателен (canSave, 308-311) — «ничего не выбрано» здесь тупик, а не значение. Собственный примитив продукта это уже сформулировал: ValueOptionList.clearable=false «там, где „ничего не выбрано“ — не значение, а тупик» (ValuePickerSheet.tsx:57-60).

**Фикс:** Убрать деселект: повторный тап по выбранному чипу счёта не делает ничего (radio-семантика).

### [x] U31 · P3 · ux · `app/accounts/[id]/index.tsx:935`
**Шапка листа на карточке счёта мигает «Операция»→«Новая операция» при закрытии**

onClose карточки счёта сбрасывает editingTx сразу (935-938), тогда как «Финансы» нарочно этого не делают с комментарием «шапка мигала „Операция“→„Новая операция“ пока лист уезжал» (finances/index.tsx:946-948). Тот же лист, два поведения — на карточке счёта баг, от которого финансы уже защитились.

**Фикс:** Повторить паттерн финансов: в onClose только setOpOpen(false), editingTx ставят открывающие пути.

### [x] U32 · P3 · bug · `app/(dashboard)/finances/index.tsx:968`
**OperationSheet показывает «Создать возврат» до загрузки суммы возвратов**

Для попапа родитель консервативен: refundTotals ещё нет → alreadyRefunded=Infinity, кнопка спрятана (922-928, комментарий «занизить кап хуже»). Для OperationSheet тот же родитель передаёт refundedTotal = refundTotals?.get(id) ?? 0 (968-970) — пока Σ не приехала, действие «Создать возврат» (OperationSheet.tsx:657-665) видно даже у полностью возвращённого дохода; тап ведёт в попап, где кнопки уже нет.

**Фикс:** Передавать undefined, пока refundTotals не загружены, и прятать действие в OperationSheet при refundedTotal === undefined — та же консервативность, что у попапа.

### [x] U33 · P3 · design · `src/features/finances/OperationSheet.tsx:642`
**Секция «Документ» стоит после действий «Ещё» — нумерация комментариев это признаёт**

В режиме правки порядок секций: Заметка → «Ещё» (действия, 642-667) → «Документ» (669-677); комментарии нумеруют их «8» перед «7». Поля самой операции разорваны чужеродным блоком действий: документ — часть операции, действия — нет.

**Фикс:** Переставить «Документ» до «Ещё», чтобы поля операции шли подряд, а действия закрывали лист.

### [x] U40 · P3 · copy · `app/(dashboard)/finances/vat.tsx:93`
**Заголовок «НДС и страна» — страны на странице нет**

ScreenHeader title="НДС и страна" (строка 93), но на экране только тумблер, режим, ставка и список команд; ни страны, ни языка документов (document_language загружается в useVatSettings:33, но нигде не показан).

**Фикс:** Переименовать в «НДС» либо довезти выбор страны/языка документов, раз заголовок его обещает.

### [x] U42 · P3 · copy · `src/features/finances/export.ts:96`
**Экспорт приписывает строкам без vat_mode режим «НДС включён» наугад**

При vat_mode=null и vat_amount!=null печатается «НДС включён» (строки 93-98), хотя auto-строки при настройке компании «Плюс НДС» (живой тенант — exclusive 19) назначались «плюсом». Колонка обещает «бухгалтер должен видеть, как назначали налог, а не догадываться» (строки 13-14) — и печатает догадку.

**Фикс:** Для строк без vat_mode печатать «—» (режим не записан), оставив ставку и сумму налога.

### [x] U43 · P3 · ux · `src/features/finances/TransactionPopup.tsx:103`
**В витрине операции не видно налога — ставку и «в т.ч. НДС» некуда посмотреть**

Попап показывает сумму/тип/счёт/команду (строки 96-130), но ни vat_amount, ни vat_rate (в файле нет ни одного упоминания vat). Узнать налог можно только открыв редактирование, а для auto-строк (приём оплаты записи) — вообще никак, хотя чек по ним печатает «в т.ч. НДС».

**Фикс:** Добавить строку «в т.ч. НДС 76 € (19%)» при vat_amount != null — тем же тоном, что счёт и команда.

### [x] U44 · P3 · test · `../../packages/shared/src/local/finance/vat.ts:134`
**summarizeVat верит vat_amount даже у строк, помеченных «Без НДС»**

`const vat = t.vat_amount ?? 0;` (строка 134) — без сверки с t.vat_mode==='none'. Вместе с P0-находкой (апдейт не чистит снимок) отчёт посчитает налог по операции, где оператор его явно выключил. Теста на комбинацию vat_mode='none' + vat_amount!=null нет (vat.test.ts:134-178).

**Фикс:** При vat_mode==='none' игнорировать vat_amount в summarizeVat и закрепить поведение тестом — двойная защита, пока UPDATE-путь не починен.

### [ ] U45 · P3 · feature · `src/features/finances/FinanceOverview.tsx:326`
**Сводке «НДС к уплате» негде жить: summarizeVat не вызывается ни одной поверхностью**

Комментарии FinanceOverview.tsx:323-327 и index.tsx:331-333 фиксируют: плашку убрали, «когда владелец назовёт новое место, там его и зовут» — но место так и не названо, и цифра «собрал минус уплатил» (канон: «считать наперёд — цифра должна быть видна всегда») не видна нигде, включая страницу /finances/vat, где ей естественно жить.
[дубль линзы dead-code: summarizeVat остался без единого вызова в мобильном приложении]

**Фикс:** Предложить владельцу карточку «НДС за период» на странице /finances/vat (collected/paid/due из summarizeVat по периоду) — страница уже знает ставку и режим.

### [x] U49 · P3 · dead-code · `../../packages/shared/src/local/finance/invoice-ledger.ts:131`
**Мёртвая формула-соперник formatInvoiceNumber в shared: жёсткие 3 знака и всегда год**

export function formatInvoiceNumber (131-138) padStart(3) и без yearlyReset — не совпадает ни с сервером (greatest/сквозная серия), ни с клиентской формулой src/features/invoices/numbering.ts. Единственный потребитель — собственный тест (invoice-ledger.test.ts:228); grep по приложению других вызовов не находит. Канон numbering.ts: «правило одно и записано дважды» — это ТРЕТЬЯ запись.

**Фикс:** Удалить функцию и её тест; кто захочет формулу — возьмёт numbering.ts.

### [x] U50 · P3 · dead-code · `src/features/finances/documents.ts:44`
**Поле overdue наружу не используется, а его док-комментарий обещает снятую красноту**

Комментарий (42-44): «Просрочка — …единственное, которое красится красным», но DocumentRow ничего не красит (решение владельца 2026-08-15 задокументировано тут же, DocumentsPanel.tsx:347-350); document.overdue не читает ни один компонент — только тест (documents.test.ts:174,211). Слово «Просрочен» и так живёт в state.
[дубль линзы dead-code: FinanceDocument.overdue не читает ни один экран, а его док-коммент врёт про красный цвет]

**Фикс:** Убрать поле overdue из FinanceDocument (оставить локальной переменной для state) и переписать комментарий.

### [x] U51 · P3 · copy · `src/features/invoices/InvoiceLineEditor.tsx:80`
**«Цена, €» зашита в редакторе строки, хотя валюта документа — из настроек компании**

Заголовок поля «Цена, €» — литерал, при этом сам документ считает currency: tenant?.currency || "EUR" (InvoiceEditor.tsx:271), и деньги везде печатаются через money(amount, currency). Компания с другой валютой увидит евро в форме и свою валюту в документе.

**Фикс:** Передавать символ/код валюты в InvoiceLineEditor из редактора.

### [x] U52 · P3 · ux · `src/features/invoices/InvoiceEditor.tsx:296`
**Привязка заявки затирает набранное руками название строки: «пустой бланк» проверяет только цену**

Комментарий обещает «ЗАПОЛНЕННОЕ РУКАМИ НЕ ЗАТИРАЕМ», но blank = одна строка && пустая/нулевая цена (295-297) — введённый title не учитывается: набрал «Чистка теплообменника», выбрал заявку — строки заменились генераторными.
[дубль линзы ux-micro: Привязка заявки к инвойсу затирает набранное название строки]

**Фикс:** Считать бланк пустым только если и title.trim() пуст (или дефолтный).

### [x] U53 · P3 · bug · `app/invoices/new.tsx:45`
**Предпросмотр номера инвойса считается по году устройства, а не по дате выставления**

useNextInvoiceNumber(new Date().getFullYear()) — год девайса, а не таймзоны бизнеса (businessToday из todayYmd, 71-73) и не выбранной пользователем даты выставления (issued_on редактируется, InvoiceEditor.tsx:417-425, будущие даты разрешены намеренно). В новогоднюю ночь или при датировании другим годом с yearly reset человек видит номер чужой серии, а документ получает другой.

**Фикс:** Считать год из issuedOn формы (перезапрашивать next_invoice_number при смене года даты выставления).

### [x] U54 · P3 · copy · `app/(dashboard)/finances/settings.tsx:31`
**Строка «Счета клиентам» в настройках финансов показывает не реальный следующий номер**

invoiceLine строит образец с seq: tenant.invoice_next_number ?? 1 — а invoice_next_number гасится сервером после первого выпуска, так что у живого тенанта строка вечно показывает «INV-2026-001…», тогда как внутренняя страница печатает настоящий следующий номер через RPC (finances/invoices.tsx:202). Два соседних экрана называют разные номера.

**Фикс:** Либо использовать useNextInvoiceNumber и в строке-саммари, либо явно печатать только формат («INV-ГГГГ-№№№»), не похожий на конкретный номер.

### [x] U55 · P3 · ux · `src/features/finances/DocumentsPanel.tsx:169`
**Пока грузятся чеки, панель прячет сегмент Инвойсы|Чеки, от которого зависит кнопка внизу**

Ветка receipts === undefined (169-189) рендерит только PanelHeader + EmptyState — без SegmentedControl, хотя комментарий (223-225) настаивает: «Сегмент стоит ВСЕГДА… Спрятать его значит спрятать и её»: кнопка внизу экрана продолжает показывать «Принять оплату»/«Выставить инвойс» по невидимому docFilter.
[дубль линзы data-layer: DocumentsPanel офлайн крутит вечный спиннер вместо честного «Нет сети»]

**Фикс:** Рендерить сегмент и в загрузочной/ошибочной ветке (список — под ним).

### [x] U56 · P3 · ux · `src/features/finances/documents.ts:174`
**Поиск документов «по сумме» матчится только с сырым float: «150,50» и «1 200» не находятся**

searchKey складывает String(amount) («150.5»), а подсказка обещает поиск по сумме («Номер, клиент, сумма», finances/index.tsx:646). Человек с русской раскладкой набирает запятую или видит на строке «€ 150,50» — includes не совпадает.

**Фикс:** Класть в search обе формы суммы (с точкой и запятой, без разрядных пробелов) или нормализовать запятую в needle в filterDocuments.

### [x] U57 · P3 · copy · `src/features/invoices/text.ts:24`
**Фолбэк продавца «Babun CRM» в клиентском тексте инвойса и чека**

buildInvoiceShareText без снимка подставляет продавцом «Babun CRM» (24), buildReceiptShareText — то же (receipt-text.ts:28), при том что в соседней ветке той же функции фолбэк честный — «Продавец не указан» (23). Документ клиенту уходит от имени SaaS-вендора, а не компании (Babun — продукт, а не продавец услуг; identity-канон).

**Фикс:** Заменить оба фолбэка на «Продавец не указан» — одинаково с веткой снимка.

### [x] U59 · P3 · bug · `src/features/finances/period.ts:218`
**periodPhrase теряет год начала у диапазона через границу года**

Для sameYear=false печатается только `yearTail = to.getFullYear()`: диапазон 2024-12-15..2026-01-10 и 2025-12-15..2026-01-10 дают одинаковую фразу «15 декабря – 10 января 2026» — двухлетний период неотличим от двухмесячного. Фраза стоит значением строки «Период» и хвостом «Пришло за …» на карточке счёта.
[дубль линзы edge-copy: periodPhrase для диапазона через границу года теряет год начала]

**Фикс:** Когда годы различаются, печатать год у обеих границ: «15 декабря 2024 – 10 января 2026».

### [x] U60 · P3 · bug · `src/features/finances/TransactionsFeed.tsx:31`
**Время операции в ленте печатается по часам телефона, а не бизнеса**

`hhmm(iso)` строит `new Date(iso).getHours()` — это пояс УСТРОЙСТВА. Контекст дохода без записи (строка 145: `appt?.time_start || hhmm(tx.created_at)`) у диспетчера с телефоном в другой стране показывает чужое время оплаты, хотя весь остальной контур последовательно живёт по calendar_settings.timezone (todayYmd, getCurrentTimeInZone).
[дубль линзы edge-copy: Время дохода без записи печатается по часам телефона, а не бизнеса]

**Фикс:** Форматировать created_at через Intl.DateTimeFormat с timeZone тенанта (пробросить businessTimezone в ленту или вынести хелпер рядом с todayYmd).

### [x] U61 · P3 · copy · `app/(dashboard)/cabinet/close-day.tsx:329`
**Алерт закрытия дня говорит про несверенные кассы, даже когда все сверены**

`` `${leftovers.join(" · ")}. Несверенные кассы в итог дня не войдут.` `` — вторая фраза приклеена безусловно. Если leftovers содержит только «3 записи не выполнены» (pendingRegisters === 0), человек читает предупреждение о кассах, которых нет: все кассы сверены.

**Фикс:** Добавлять фразу про кассы только при pendingRegisters > 0; при одних невыполненных записях — свой хвост («невыполненные записи останутся в «Не закрыто»»).

### [x] U62 · P3 · dead-code · `app/(dashboard)/finances/index.tsx:249`
**Мёртвый фильтр `a.scope === "team"` и врущие комментарии про «общие счета» в miniCardAccounts**

После перехода accountServesTeam на строгое `brigade_id === teamId` (integrity.ts:49-54) в scopedAccounts не может попасть счёт другой природы, и дофильтр `scopedAccounts.filter((a) => a.scope === "team")` (строка 249) ничего не отсекает в норме (а при дрейфе данных «company + brigade_id» молча прячет деньги из Σ). Комментарии строк 238 («видит свои счета + общие, к которым команда подключена») и 247-248 («полный баланс общего умножался бы на число команд») описывают снесённую модель общего счёта.

**Фикс:** Убрать дофильтр и miniCardAccounts (оставить scopedAccounts), переписать комментарии под модель «счёт = одна бригада»; дрейф company+brigade_id ловить проверкой/миграцией, а не молчаливым фильтром витрины.

### [x] U63 · P3 · copy · `src/features/finances/use-business-period.ts:2`
**Комментарий use-business-period обещает «список счетов», где периода больше нет**

Шапка: «ОДИН КОНТРОЛ И ОДНА ЛОВУШКА НА ВСЕ ДЕНЕЖНЫЕ ЭКРАНЫ (список счетов и карточка счёта)». Список счетов период потерял 2026-08-11 (app/accounts/index.tsx:74-76: «период целиком … убран»), хук реально используется одной карточкой счёта (grep: единственный импорт в app/accounts/[id]/index.tsx:72), а главный денежный экран несёт копию логики вместо хука.

**Фикс:** Обновить комментарий (карточка счёта + «Финансы» после дедупликации) — вместе с находкой о переводе finances/index.tsx на этот хук.

### [x] U64 · P3 · bug · `app/(dashboard)/cabinet/close-day.tsx:143`
**Первый кадр «Закрыть день» и «Не закрыто» считает сегодня по зашитому Кипру, игнорируя кэш таймзоны**

`useState(() => formatYMD(getCurrentCyprusTime()))` — даже когда calendarSettings уже в кэше с другой таймзоной, первый рендер группирует записи и кассы по кипрской дате; useFocusEffect чинит следующим кадром (мигание списков около полуночи). То же в src/features/finances/UnclosedScreen.tsx:84-86. Соседний finances/index.tsx делает правильно — сразу через todayYmd(timezone) с фолбэком (строка 107).

**Фикс:** Инициализировать состояние через readBusinessToday() (перенести useCallback выше useState) либо просто `useState(() => todayYmd(calendarSettings?.timezone))`.

### [x] U65 · P3 · bug · `app/(dashboard)/cabinet/close-day.tsx:177`
**Итог «Доход» закрытия дня: записи считаются по всем командам, day-extras — только по активным**

extrasIncome суммируется с гейтом `team.is_active` (строки 177-183), а слагаемое из записей — `appts.filter((a) => a.date === todayKey)` без фильтра по команде (строка 160): визит архивной бригады в доход дня входит, её же ручной day-extra — нет. Комментарий на строке 106-107 объявляет «Деньги дня по-прежнему считаются по активным», но выполняется это только для extras.

**Фикс:** Выбрать одно правило и применить к обоим слагаемым: либо фильтровать записи по активным командам, либо убрать is_active-гейт у extras (деньги дня — это все деньги дня).

### [x] U74 · P3 · design · `src/features/invoices/InvoiceEditor.tsx:447`
**«Добавить позицию» — самодельная кнопка вместо AddRow**

Pressable с 1px бордером и центрированным текстом (строки 447-457). Закон «один дизайн»: создание везде выглядит строкой AddRow «+ Добавить …» (эталон — «Добавить счёт» на экране счетов, app/accounts/index.tsx:614).

**Фикс:** Заменить на `<AddRow label="Добавить позицию" …/>` внутри SectionCard.

### [x] U75 · P3 · design · `src/features/finances/DebtorsList.tsx:221`
**Хардкод-тинт кобальта в кнопке «Напомнить»**

`backgroundColor: "rgba(44,91,224,0.10)"` — тинт акцента зашит числом; при смене accent в colors.ts кнопка отвяжется от бренда. Рядом текст уже берёт t.accent (строка 227).

**Фикс:** Считать заливку из токена: `t.accent + "1a"` (как в SummaryToggle) или завести общий helper тинтов.

### [x] U77 · P3 · design · `src/features/finances/AccountCreateSheet.tsx:321`
**#ffffff вместо токена onAccent в трёх местах**

AccountCreateSheet.tsx:321 `color={active ? "#ffffff" : t.sub}` (глиф выбранного значка), TransactionPopup.tsx:383 и UnclosedScreen.tsx:457 `style={{ color: "#ffffff" }}` на залитых кнопках. Токен t.onAccent существует ровно для этого.

**Фикс:** Заменить литералы на t.onAccent.

### [x] U78 · P3 · design · `app/accounts/[id]/index.tsx:125`
**Ручные ink-альфы мимо токенов материала**

`backgroundColor: strong ? "rgba(11,18,32,0.03)" : undefined` — подложка итога колонки чуть светлее токена rowFill (0.04); TeamChecklist.tsx:70 кольцо невыбранной галки `borderColor: "rgba(11,18,32,0.22)"` — на волосок от separator (0.20). Обе величины — самодельные чернила, которые не поедут за палитрой.

**Фикс:** Итог — t.rowFill; кольцо чекбокса — t.separator (или вынести в токен, если 0.22 принципиальны).

### [x] U79 · P3 · design · `app/(dashboard)/finances/settings.tsx:105`
**Плитки настроек финансов: три разных синих и «удалённый серый» #5B6678**

В одной стопке: tile="#2F6FD6" (строка 66), "#3157A4" (105 — акцент бумаги инвойса) и кобальт бренда #2C5BE0 в шапке — три близких синих на одном экране; tile="#5B6678" (113) — буквально тот серый пигмент, который ДС объявила удалённым («самостоятельные серые (#5b6678…) удалены»), он же fallback в vat.tsx:209. Хексы рассыпаны литералами и в clients/calendar-настройках — общей константы нет.

**Фикс:** Завести общий словарь SETTINGS_TILE_COLORS (один синий = t.accent), серый fallback заменить на tile="neutral" — SettingsRow его уже умеет.

### [x] U80 · P3 · dead-code · `src/features/invoices/navigation.ts:7`
**Мёртвый экспорт openInvoices**

`const openInvoices = () => router.push("/invoices" as Href);` возвращается из useInvoiceNavigation (строка 28), но ни одна из двух точек использования хука (finances/index.tsx, accounts/[id]/index.tsx) его не деструктурирует — грепом вызовов нет.
[дубль линзы ux-micro: openInvoices — мёртвый экспорт]
[дубль линзы dead-code: openInvoices в useInvoiceNavigation осиротел после переезда документов в панель]

**Фикс:** Удалить openInvoices из хука (правило владельца: авто-чистка мёртвого кода после изменений).

### [x] U81 · P3 · design · `app/(dashboard)/finances/invoices.tsx:347`
**Свой Divider внутри настроек «Счета клиентам» дублирует примитив**

Локальная `function Divider()` (строки 347-350) повторяет `components/ui/Divider` (который экран даже не импортирует), с зашитым inset ml-4 вместо пропа. Соседний settings.tsx пользуется общим Divider с inset={56}.
[дубль линзы dead-code: Локальный Divider в настройках инвойсов дублирует ui/Divider]

**Фикс:** Импортировать общий `Divider` и удалить локальную копию.

### [x] U82 · P3 · design · `src/features/finances/FinanceOverview.tsx:100`
**Выбранное состояние SummaryToggle — третья грамматика выбора (цветной 1.5px бордер)**

`borderWidth: 1.5, borderColor: active ? color : "transparent"` поверх 10%-тинта. В ДС выбранность выражается заливкой/тинтом (Chip) либо оттиском; «DON'T use 1px borders where a separator color works». Цветная рамка — новый, нигде больше не встречающийся язык выбора.

**Фикс:** Оставить только тинт `color+"1a"` (у Chip variant="tint" его хватает), либо узаконить рамку в ДС как язык «раскрытой панели».

### [x] U83 · P3 · design · `src/features/finances/TransactionPopup.tsx:266`
**Две вставные заливки на денежных поверхностях: t.canvas против t.fill**

Meta-блок витрины — `backgroundColor: t.canvas` (266), поле возврата — t.canvas (343); у InvoicePaymentSheet поле суммы — t.fill (219), но дата и список счетов — t.canvas (244, 297); InvoiceEditor итоги — t.canvas (474). ДС: `fill` — «the ONE inset fill». Канва как вставка на белом листе — второй, конкурирующий материал.

**Фикс:** Внутри карточек и листов использовать t.fill для всех вставных блоков/полей; t.canvas оставить фоном экрана.

### [x] U84 · P3 · design · `docs/DESIGN-SYSTEM.md:24`
**DESIGN-SYSTEM.md разъехался с кодом: палитра §1 и описание «Финансов» §6 устарели**

Таблица §1 обещает success/danger/warning = #1FB47A/#F0473C/#F5A623 и separator #E7EBF0, а источник правды colors.ts:109-124 давно другой (#087a52/#c9372c/#955f00, separator rgba(11,18,32,0.20) — с обоснованием прямо в коде). §6 (строка 108) описывает «Display „Финансы" + profit hero in Display tabular cobalt + team-chip strip in header», которых на экране нет с 2026-08-09/08-11 (шапка = шестерёнка·поиск·аналитика, сводка из SummaryToggle). Аудиты по документу будут ловить ложные «нарушения».

**Фикс:** Обновить таблицу §1 значениями из colors.ts и переписать §6 «Finances» под текущую сводку (по образцу комментариев в FinanceOverview.tsx).

### [x] U85 · P3 · design · `app/(dashboard)/cabinet/close-day.tsx:446`
**close-day — те же радиус-литералы и no-op tabular-nums, что вычищены из финансов**

rounded-2xl (446), rounded-xl (450, 508, 547, 588) и классы tabular-nums на суммах (90, 519, 559, 600) — смежный денежный экран живёт по старым правилам рядом с финансовым контуром.

**Фикс:** Пройтись тем же рефактором: радиусы из t.radius, моноширинность через fontVariant.

### [x] U87 · P3 · ux · `src/features/finances/OperationSheet.tsx:372`
**Haptics успеха есть у пересчёта и отмены перевода, но нет у остальных денежных действий**

`toast(isEdit ? "Сохранено" : "Операция добавлена")` — без haptics; grep по src/features/finances и src/features/invoices: haptics только в PeriodSheets, transfer-undo (haptics.success, строки 55/72) и CashCountSheet (haptics.success, 159). Сохранение операции, проведение перевода (сам send), оплата инвойса и создание счёта проходят без тактильного подтверждения — один продукт отвечает на успех по-разному.

**Фикс:** Добавить haptics.success() рядом с тостом успеха в OperationSheet.save, TransferSheet.send, InvoicePaymentSheet.submit и AccountCreateSheet.submit.

### [x] U88 · P3 · ux · `app/(dashboard)/finances/index.tsx:880`
**«Сделать перевод» гаснет без печатной причины**

`<GradientButton label="Сделать перевод" disabled={accounts.length < 2} …>` — серая кнопка без единого слова почему. Собственный закон контура: «ПРИЧИНА ПЕЧАТАЕТСЯ ВСЕГДА… серая кнопка без объяснения читается как поломка продукта» (TransferSheet.tsx:205–206); AccountCreateSheet держит то же правило (173–174).

**Фикс:** При accounts.length < 2 печатать строку над кнопкой («Для перевода нужен второй счёт — заведите его в настройках счетов») или не гасить кнопку, а открывать лист с объяснением.

### [x] U89 · P3 · bug · `src/features/finances/DebtorsList.tsx:145`
**«Напомнить» должнику: Linking.openURL без catch — на устройстве без SMS тап молчит**

`Linking.openURL(`sms:${digits}${sep}body=${body}`)` — промис не обработан: на iPad/устройстве без Сообщений openURL реджектится, пользователь не получает никакой реакции на нажатие, в консоли — unhandled promise rejection.

**Фикс:** `Linking.openURL(url).catch(() => Alert.alert("Не удалось открыть Сообщения", "На этом устройстве нельзя отправить SMS."))`.

### [x] U90 · P3 · design · `app/accounts/[id]/settings.tsx:77`
**pickSheet в настройках счёта дублирует канонический chooseOption**

Локальный `function pickSheet(title, options)` (77–105) — вторая реализация «выбора из списка» через ActionSheetIOS/Alert, при том что экран счетов уже пользуется общим `chooseOption` из "@/lib/choose" (app/accounts/index.tsx:57, 306), который к тому же нижний лист, а не системный ActionSheet — два диалекта одного действия.

**Фикс:** Заменить pickSheet на chooseOption (или ValuePickerSheet для «Вид»/«Команда»), удалить локальный хелпер.

### [x] U91 · P3 · ux · `src/features/invoices/InvoicePaymentSheet.tsx:129`
**Префилл сумм в инвойс-листах — String(number) с точкой вместо локального формата**

`setAmount(String(remaining))` (и InvoiceRefundSheet.tsx:78 `setAmount(String(refundable))`) — в поле попадает «116.7» с точкой и без второго знака, тогда как TransferSheet префиллит той же ситуации `formatMoneyForInput(preset)` (TransferSheet.tsx:170) — с запятой и двумя знаками. Один продукт показывает сумму в поле двумя написаниями.

**Фикс:** Использовать formatMoneyForInput(remaining/refundable) в обоих листах.

### [x] U92 · P3 · ux · `app/invoices/[id].tsx:276`
**Иконка «Поделиться PDF» в шапке инвойса не показывает занятость**

Pressable шапки при pdfBusy получает `disabled` и onPress=undefined, но визуально не меняется (нет спиннера/opacity для disabled — только active:opacity-60 на нажатие). Сборка PDF занимает секунды; повторные тапы по «немой» иконке читаются как поломка, хотя нижняя кнопка «Поделиться PDF» (459) спиннер показывает.

**Фикс:** На время pdfBusy рисовать в слоте иконки Spinner size={18} или давать иконке opacity 0.4.

### [x] U93 · P3 · design · `src/features/finances/OperationSheet.tsx:671`
**OperationSheet: секция «Документ» стоит после «Ещё» вопреки собственной нумерации**

Комментарии нумеруют порядок полей «…6. Заметка → 7. Документ», но в коде блок «8. Действия этой операции» (639–667) рендерится РАНЬШЕ блока «7. Документ…» (669–677): в режиме правки чек-вложение уезжает под «Открыть клиента / Выставить счёт / Создать возврат», а нумерация в комментариях противоречит фактическому порядку.

**Фикс:** Либо переставить секции по нумерации (Документ перед «Ещё»), либо перенумеровать комментарии, зафиксировав порядок осознанно.

### [x] U94 · P3 · ux · `src/features/finances/TransactionPopup.tsx:214`
**TransactionPopup: скрим закрывает попап во время полёта возврата/удаления**

Скрим `<Pressable className="absolute inset-0" onPress={onClose} …>` не гейтится busy: пока onRefund/onDelete в полёте, тап мимо карточки закрывает попап; Alert об ошибке из catch (161–163) прилетит поверх уже закрытого окна без контекста суммы. Кнопки внутри при этом честно disabled по busy (177).

**Фикс:** `onPress={busy ? undefined : onClose}` на скриме — как в InvoicePaymentSheet.tsx:195.

### [x] U95 · P3 · ux · `src/features/finances/OperationSheet.tsx:536`
**Денежные тексты OperationSheet без maxFontSizeMultiplier — крупный шрифт ломает лист первым**

TextInput суммы (text-3xl, 536–548), заголовок листа (419) и строки ошибок футера не имеют maxFontSizeMultiplier, тогда как соседние денежные листы капят всё: TransferSheet — 1.2 на сумме (535) и 1.3 на текстах, CashCountSheet и AccountCreateSheet — тоже. На крупном системном шрифте 3xl-сумма с «€» выталкивает друг друга из строки.

**Фикс:** Проставить maxFontSizeMultiplier={1.2–1.3} на сумму, заголовок и футерные строки OperationSheet — в тон остальным листам.

### [x] U96 · P3 · ux · `app/accounts/[id]/index.tsx:874`
**Погашенная «Выгрузить выписку» не называет причину**

`<ActionRow label="Выгрузить выписку" dimmed={!totals || stale} onPress={…}>` — строка гаснет, пока агрегат периода не приехал или срез несвежий, но в отличие от группы «Действия» (у которой при офлайне печатается RowCaption OFFLINE_ACCOUNT_ACTIONS, 838) причины у неё нет: dimmed-строка молчит, а тап по ней просто ничего не делает (exportStatement: `if (!totals || stale) return;` 465).

**Фикс:** Под группой печатать причину: «Выписка соберётся, когда посчитается период» / при stale — «Дождитесь обновления среза», тем же RowCaption.

### [x] U97 · P3 · bug · `packages/shared/src/db/repositories/finance-transactions.ts:346`
**listRefundTotals — та же offset-пагинация на растущем all-time наборе возвратов**

Запрос всех возвратов тенанта постранично через .order("id").range(offset, …) (стр. 346-354). Набор глобальный по времени («deliberately global and paged», стр. 339-340) и рано или поздно перевалит за 1000 строк; конкурентная вставка возврата между страницами исказит сумму «уже возвращено» — а по ней режется кап повторного возврата.

**Фикс:** Заменить на keyset (.gt("id", lastId), уже есть образец в этом же файле) — сортировка по id уже стоит.

### [x] U100 · P3 · bug · `src/features/finances/templates-queries.ts:27`
**Мутации категорий и шаблонов паузятся офлайн — mutateAsync зависает без ошибки**

useInsertTemplate/useUpdateTemplate/useDeleteTemplate (templates-queries.ts:27-55) и useInsertCategory/useUpdateCategory/useSetCategoryHidden/useDeleteCategory (finances/queries.ts:168-210) — без NEVER_PAUSE. С NetInfo-онлайн-менеджером офлайн-вызов встаёт в paused: кнопка сохранения категории крутится вечно, meta.errorHandled есть, но ошибки нет — алерт call site так и не срабатывает.

**Фикс:** Расставить ...NEVER_PAUSE (справочники тоже пишутся онлайн-only) — единым паттерном с остальными финансовыми мутациями.

### [x] U101 · P3 · feature · `src/features/finances/account-inflow.ts:103`
**breakdownAccountInflowByTeam ищет вторую ногу перевода линейным сканом внутри цикла — O(n²) на месячном срезе**

Для каждой входящей transfer-ноги вызывается transactions.find(...) по всему массиву (стр. 102-109). Функция получает ПОЛНЫЙ месячный срез тенанта (комментарий стр. 59) и пересчитывается в useMemo при каждом изменении журнала (app/accounts/[id]/index.tsx:213-216). Месяц с сотнями операций и десятками инкассаций — сотни тысяч сравнений на JS-потоке при каждом рефетче.

**Фикс:** Построить Map<transfer_group_id, tx[]> одним проходом до цикла и брать вторую ногу из него.

### [x] U102 · P3 · feature · `src/features/clients/blocks/ClientDocumentsRow.tsx:36`
**ClientDocumentsRow тянет ВСЕ инвойсы тенанта, хотя репозиторий умеет фильтр по клиенту**

Строка карточки клиента вызывает useInvoices() без параметров (стр. 36) и фильтрует на клиенте, при том что чеки грузятся уже срезом useReceipts({ clientId }) (стр. 37), а listInvoices принимает opts.clientId (packages/shared/src/db/repositories/invoices.ts:100, 117). Каждое открытие карточки клиента поднимает полную историю инвойсов компании ради пары строк.

**Фикс:** Добавить в useInvoices параметр clientId (ключ ["invoices", tenantId, clientId]) и использовать его здесь и в app/documents/*.

### [x] U106 · P3 · dead-code · `src/features/finances/account-period.ts:127`
**sumAccountPeriodTotals не используется в проде — только собственным тестом**

`sumAccountPeriodTotals` (account-period.ts:127-142) после коммита 1e802ddc («итог — только по ней») не вызывается ни одним экраном: app/accounts/index.tsx больше не импортирует account-period вовсе, единственный потребитель — account-period.test.ts.

**Фикс:** Удалить функцию вместе с её тест-кейсами (или оставить, если суммирование «по всем командам» вернётся, — тогда пометить комментарием, кто её ждёт).

### [x] U107 · P3 · dead-code · `app/(dashboard)/finances/vat.tsx:146`
**Осколки-фрагменты <>…</> на экране НДС — следы снесённых условий**

Внутри ветки `v.mode === "off" ? null : (…)` лежат два безусловных фрагмента: vat.tsx:146-161 (`<>` вокруг Divider+View с примером) и vat.tsx:164-229 (`<>` вокруг секций «Ставка компании» и «Своя ставка у команды»). Оба ничего не группируют по-условию — остатки от удалённых `rate > 0 ? … : null`.

**Фикс:** Убрать оба лишних фрагмента, вернув детей напрямую в JSX; заодно уйдёт сбитая индентация строк 119-231.

### [x] U108 · P3 · design · `src/features/finances/UnclosedScreen.tsx:63`
**daysSince в UnclosedScreen дублирует daysBetweenYmd из accounts-sections**

UnclosedScreen.tsx:57-64 (`Math.max(0, Math.round((today - past) / 86_400_000))`) — та же арифметика, что daysBetweenYmd в accounts-sections.ts:292-298 (тоже фича finances, тоже clamp к нулю). Свежий дифф уже дедуплицировал здесь countWord → countWordRu, а день-диффы остались в двух копиях.

**Фикс:** Вынести daysBetweenYmd в общий модуль (shared date-utils или finances/dates.ts) и вызвать из обоих мест.

### [x] U109 · P3 · design · `src/features/finances/period.ts:23`
**YYYY-MM-DD и HH:MM собираются руками в четырёх местах финансового контура**

Локальные ymd/pad2: period.ts:23-26 и :129; invoices/format.ts:57-59 (todayYmd) и :66-68 (addDaysYmd); плюс HH:MM дважды — TransactionsFeed.tsx:28-34 (hhmm) и accounts-snapshot.ts:111-113 (инлайн в snapshotNote). В shared уже есть formatDateKey (его же использует accounts-snapshot.ts:20 для сравнения дней).

**Фикс:** Свести к shared formatDateKey + одному hhmm-хелперу; каждая копия — потенциальное место для будущего расхождения формата ключей дат.

### [x] U110 · P3 · design · `src/features/finances/AccountsPanel.tsx:99`
**Магический эпсилон 0.005 вместо канонического moneySign в трёх местах**

`Math.abs(account.balance) < 0.005` в AccountsPanel.tsx:99 и app/accounts/index.tsx:329, `transaction.amount - refundedTotal > 0.005` в OperationSheet.tsx:659 — при том что shared moneySign (money.ts:62-66) существует ровно для «нуля по округлённым центам» и уже используется строками рядом (AccountsPanel.tsx:95).

**Фикс:** Заменить на `moneySign(x) === 0` / `moneySign(diff) > 0` — одна семантика нуля на весь продукт, без рассыпанных литералов.

### [x] U111 · P3 · copy · `src/features/appointments/payment-accounts.ts:13`
**Комментарий payment-accounts врёт: icon/color счёта снова рисуются, но пикер оплаты их не получает**

payment-accounts.ts:13-15: «колонки accounts.icon/color… их не рисует ни один экран, и проекция RPC их больше не отдаёт». С 2026-08-15 это неправда: значок выбирается руками (account-ui.ts:36-64, ACCOUNT_ICONS), цвет рисуется диском (AccountsPanel.tsx:90, accounts/index). PaymentAccountOption (строки 16-22) icon/color не несёт — пикер приёма денег показывает счета без выбранных владельцем значков.

**Фикс:** Обновить комментарий и решить консистентность: либо вернуть icon/color в проекцию list_payment_accounts_safe и рисовать их в пикере, либо явно записать, почему пикер намеренно без значков.

### [x] U112 · P3 · dead-code · `src/features/finances/CashCountSheet.tsx:407`
**resultToast экспортирован без единого внешнего потребителя и без теста**

`export function resultToast` (CashCountSheet.tsx:407) используется только внутри файла (:160); теста у CashCountSheet нет, других импортёров нет (проверено скану всех app+src).

**Фикс:** Убрать `export` (или завести тест на фразы тоста, раз функция вынесена ради тестируемости).

### [x] U113 · P3 · dead-code · `src/features/invoices/pdf.ts:21`
**renderInvoiceHtml экспортирован зря — снаружи и тестом не используется**

`export function renderInvoiceHtml` (pdf.ts:21) вызывается только из buildInvoicePdfHtml в этом же файле (:18); pdf.test.ts импортирует buildInvoicePdfHtml и escapeHtml, но не renderInvoiceHtml.

**Фикс:** Снять `export` с renderInvoiceHtml.

### [x] U114 · P3 · dead-code · `src/features/finances/breakdown.ts:21`
**incomeLabel/expenseLabel экспортированы, но тестов на breakdown нет и внешних вызовов нет**

`export function incomeLabel` (breakdown.ts:21) и `expenseLabel` (:44) используются только внутри файла (:78,:86,:107); ProfitBreakdown импортирует breakdownIncome/breakdownExpense/BreakdownRow (ProfitBreakdown.tsx:10-14), IncomeShareDonut — только тип. Файла breakdown.test.ts не существует.

**Фикс:** Убрать `export` с обеих функций — либо, что лучше для денег, написать тест на правила подписей (нейминг строк «Прибыли») и оставить.

### [x] U115 · P3 · dead-code · `app/documents/index.tsx:16`
**Хаб /documents живёт двойной жизнью: копия сводки, стpromise «Договоры» и вход только из карточки клиента**

После переезда документов в панель «Финансов» (канон 2026-08-12: только Инвойсы|Чеки) на /documents ведёт единственная дверь — карточка клиента с clientId (ClientDocumentsRow.tsx:56). Экран же по-прежнему называет себя «одна дверь ко всем финансовым бумагам компании» (documents/index.tsx:15-18), держит задимленную строку «Договоры»+Alert «Скоро» (:107-118) и третью копию сводки по инвойсам (:42-64).

**Фикс:** Сузить экран до его реальной роли «Документы клиента» (заголовок, копия), убрать общий-компанейский текст; строку «Договоры» либо оставить как осознанный тизер, либо снять до готовности фичи. Сводку взять из общего селектора (см. находку про тройной цикл).

### [x] U116 · P3 · copy · `src/features/finances/account-ui.ts:86`
**Док-комменты ещё рассказывают про счёт нескольких бригад: «Наличные · Юра, Аня» и «Revolut · Юра, Аня»**

accountSubtitle документирована примерами «Наличные · Юра, Аня» и абзацем про «Счёт, которым пользуются несколько бригад» (account-ui.ts:85-96), хотя реализация берёт единственный brigade_id, а канон 2026-08-15 — счёт ровно одной бригады. Тот же реликт в transfer-undo.ts:29-30 («Revolut · Юра, Аня»).

**Фикс:** Поправить оба комментария под одно-бригадную модель, чтобы следующий читатель не решил, что multi-team подпись ещё поддерживается.

### [ ] U117 · P3 · design · `src/features/invoices/format.ts:37`
**invoiceVatMode угадывает режим НДС по расстоянию между итогами вместо хранения режима**

format.ts:37-43 восстанавливает режим эвристикой `Math.abs(lineTotal - total) < Math.abs(lineTotal - subtotal_net)`; ей пользуются и печать документа (document.ts:133), и редактор при повторном открытии (InvoiceEditor.tsx:174). У операции режим — хранимое поле (FinanceTransaction.vat_mode), у инвойса — вывод из чисел: при малых суммах/ставках с округлениями inclusive и exclusive почти неразличимы, и режим может «перещёлкнуться» при редактировании.

**Фикс:** Хранить vat_mode колонкой инвойса (как у операции) и заполнить бэкфиллом текущей эвристикой один раз; invoiceVatMode оставить только для легаси-строк без значения.

### [x] U123 · P3 · copy · `src/features/finances/UnclosedScreen.tsx:173`
**Счётчик в заголовке «Не закрыто (3)» выбивается из конвенции « · N»**

Заголовок собирается как `Не закрыто (${n})`, тогда как все финансовые панели считают через точку-разделитель: «Счета · 3» (AccountsPanel.tsx:54), «Операции · 12», «Долги · N» (DebtorsList.tsx:154).

**Фикс:** Печатать «Не закрыто · 3» — той же грамматикой, что остальные счётчики продукта.

### [x] U124 · P3 · copy · `src/features/finances/TransferSheet.tsx:484`
**Кнопка «Перевести €X на Наличка · Команда 2» — сломанный падеж и обрезание длинных имён**

`Перевести ${money(amountNum)} на ${label(to)}` — имя счёта в именительном падеже после «на» («на Наличка»), а label включает « · Команда 2»: с длинными именами строка не влезает (GradientButton печатает label с numberOfLines={1}) и обрезается вместе с суммой.

**Фикс:** Сократить до «Перевести €X» (получатель уже виден в карточке «Куда» прямо над кнопкой) либо писать «на счёт „Наличка“» без хвоста команды.

### [x] U125 · P3 · copy · `src/features/finances/account-alerts.ts:66`
**Алерт о непустом счёте с долгом советует «заведите счёт, куда его перевести»**

accountNotEmptyAlert при canTransfer=false: «На „Касса“ −€50. … Спишите остаток операцией или заведите счёт, куда его перевести.» Отрицательный остаток перевести нельзя в принципе (transferValidationError требует amount ≤ balance) — совет невыполним; вызов с балансом <0 гарантирует canTransfer=false (settings.tsx:307).

**Фикс:** Для balance<0 отдельная фраза: «Счёт в минусе на €50 — закройте разницу операцией дохода или корректировкой», без упоминания перевода.

### [x] U126 · P3 · bug · `app/(dashboard)/finances/vat.tsx:77`
**«Работаем с НДС» включён + ставка 0% → клавиши НДС не появляются нигде, без объяснения**

commitRate допускает 0 (`rate < 0 || rate >= 100` — 0 валиден), а OperationSheet.tsx:254 требует `vat.rate > 0` для vatVisible: с включённым тумблером и ставкой 0 форма операции молчит про НДС, тумблер выглядит сломанным. defaultTxVatMode (vat.ts) тоже трактует rate≤0 как «none».

**Фикс:** Либо не принимать 0 при включённом режиме («Ставка должна быть больше нуля — иначе выключите НДС»), либо при сохранении 0 автоматически переводить mode в off с объяснением.

### [x] U127 · P3 · copy · `src/features/finances/OperationSheet.tsx:619`
**Форма операции просит «выберите команду», которую в ней выбрать нельзя**

Строка «Выберите команду наверху экрана, чтобы появились её кассы» и футер «Выберите команду и счёт для способа оплаты» (733-736) — но лист модальный и закрывает экран с чипами, а ряд «Команда» в самом листе — не-нажимаемое показание (комментарий 470-472). Совет невыполним, не закрыв форму и не потеряв набранное.

**Фикс:** Переписать подсказку по-честному: «Закройте форму и выберите команду чипом над экраном» — либо (лучше) в состоянии без teamId сделать ряд «Команда» выбираемым.

### [x] U128 · P3 · bug · `src/features/finances/documents.ts:152`
**Сортировка документов одного дня «по номеру» — лексикографическая, а не числовая**

Комментарий обещает «одна дата — выше тот, чей номер больше», но sort сравнивает `b.title.localeCompare(a.title)`: «Инвойс INV-2026-9» встанет выше «Инвойс INV-2026-10» (строково «9» > «1»). Порядок детерминированный, но не тот, что заявлен, и заметен при 10+ документах в день.

**Фикс:** Сравнивать localeCompare с { numeric: true } либо вытаскивать числовой хвост номера; заодно поправить комментарий.

### [x] U129 · P3 · ux · `app/accounts/[id]/index.tsx:488`
**Диалог выгрузки выписки показывает сырые ISO-даты, имя файла не чистится от «/»**

dialogTitle: `${account.name}: ${period.from} – ${period.to}` — «Касса: 2026-08-01 – 2026-08-15», хотя всюду в продукте даты печатаются как «01.08.26» или словами. Имя файла `babun-${account.name}-…` берёт имя счёта как есть — счёт «Нал/Карта» даст слэш в имени файла.

**Фикс:** В dialogTitle печатать periodDates()/periodPhrase(), а имя счёта в filename прогонять через замену недопустимых символов (/, :, пробелы).

### [x] U130 · P3 · copy · `app/(dashboard)/finances/invoices.tsx:266`
**Валидация «Продолжить с номера» называет только нижнюю границу**

Проверка `value < 1 || value > 1000000000`, а алерт говорит «Введите целое число от 1.» — про потолок миллиард ни слова, и фраза обрывается («от 1» без «до»). Введя 2000000000, человек получает совет, которому уже следует.

**Фикс:** «Введите целое число от 1 до 1 000 000 000» — и разряды в подсказке пробелами, как всюду в продукте.

### [x] U134 · P3 · test · `src/features/finances/TransactionPopup.tsx:117`
**Кап возврата считается центами прямо в компоненте — уже чинившаяся float-логика без теста**

refundRemainingCents = Math.max(0, Math.round(tx.amount*100) − Math.round(alreadyRefunded*100)) и refundValid = refundCents <= refundRemainingCents (строки 117–131) живут внутри JSX-компонента. Комментарий на строке 115–116 сам документирует прошлую регрессию («10 − 1.12 = 8.879999… ломало префилл и запрещало вернуть ровно остаток») — то есть баг здесь уже был, а фикс лежит в непокрываемом месте.

**Фикс:** Вынести расчёт остатка возврата в чистую функцию (например, refundRemainingCents(amount, alreadyRefunded)) рядом с edit-rule и накрыть тестом: возврат ровно остатка разрешён, сверх — нет, 10 − 1.12 − 8.88 = 0.

### [x] U135 · P3 · test · `src/features/invoices/numbering.ts:29`
**Образец номера инвойса ограничивает ширину 8, сервер — нет: формулы «обязаны совпадать» могут разойтись**

Клиент: Math.min(8, Math.max(1, …)) (строки 28–31). Сервер format_invoice_number: greatest(coalesce(p_padding,3), 1, length(seq)) без верхней границы (../web/supabase/migrations/20260810120000_invoice_numbering.sql:55). Мобильный экран сам зажимает ввод до 8 (app/(dashboard)/finances/invoices.tsx:83), но значение >8, записанное вебом или SQL, даст образец в настройках, не совпадающий с выданным номером — ровно то, что шапка файла запрещает. numbering.test.ts (4 теста) случай padding>8 не проверяет.

**Фикс:** Либо убрать кап 8 из formatInvoiceNumber (пусть формула буквально повторяет SQL), либо добавить тот же кап в SQL; в numbering.test.ts добавить случай padding=10 как контракт паритета.

### [~] U136 · P3 · test · `../../packages/shared/src/db/repositories/finance-transactions.test.ts:1`
**Три тестовых фреймворка в одном денежном контуре — шардинг тестов мешает завести их в CI**

В одном пакете shared соседствуют `import { … } from "vitest"` (finance-transactions.test.ts:1), `from "bun:test"` (integrity.test.ts:1, invoice-ledger.test.ts:1, vat.test.ts:1, money.test.ts:1) и `from "node:test"` (invoice-generator.test.ts:2, appointment-calc.test.ts:2); все 14 мобильных тестов — node:test. Сейчас всё случайно работает, потому что bun шимит все три, но CI-раннер (vitest) не исполнит bun:test-файлы — это прямое препятствие к закрытию находки про CI-ворота.

**Фикс:** Выбрать один диалект под фактический раннер (bun:test, раз bun основной) и привести импорты к нему — механическая замена в 7 файлах shared; мобильные node:test файлы bun исполняет и так, но для единообразия стоит привести и их.

**Сделано 2026-08-16 — частично, и это осознанно.** Проверено фактами, а не описанием: `vitest` стоит ТОЛЬКО в `apps/web`, в `packages/shared` его нет вовсе. То есть по-настоящему сломан был ровно один файл — `finance-transactions.test.ts`: его не исполнял ни один раннер репозитория. Переведён на bun:test, 7 тестов проходят. Остальные диалекты bun исполняет сам — проверено прогоном: `bun test packages/shared apps/mobile` = 650 pass / 0 fail на 110 файлах, node:test-файлы в их числе.

Массовая замена node:test → bun:test НЕ сделана намеренно. Это не «7 файлов shared», как сказано в находке, а ~80 (5 в shared и ~75 в mobile), и она не механическая: node:test пишет `assert.equal` из `node:assert/strict`, bun:test — `expect().toBe()`, то есть переписываются ВСЕ утверждения денежных и клиентских тестов. Такой заход стоит делать отдельной задачей со своим прогоном, а не хвостом дизайн-аудита; барьера для CI он не снимает, потому что раннер продукта — bun, и оба диалекта он исполняет.

### [x] U137 · P3 · test · `src/features/finances/cash-counts.ts:142`
**Окно сверок и тристейт lastCountedOn («не знаем» vs «ни разу») не покрыты тестом**

lastCountedOn (строки 142–150) возвращает undefined/null/дату, а флаг complete = rows.length < COUNT_WINDOW (строка 126) решает, можно ли утверждать «ни разу не сверяли» — это утверждение о деньгах кассы. accounts-sections.test.ts:358 проверяет только потребителя подписи, сам модуль (свёртка первой строки на счёт из отсортированного окна, граница ровно в 500 строк) не тестируется.

**Фикс:** Вынести свёртку rows→LastCashCounts в чистую функцию и добавить тест: при 500 строках complete=false и отсутствие счёта в карте даёт undefined, при 499 — null; первая строка по счёту побеждает более старые.


## Опровергнуто сверкой

- `../../packages/shared/src/local/finance/vat.ts` — inputFromGross и applyTxVat не взаимообратны: пустое сохранение exclusive-операции сдвигает сумму на цент — Арифметика аудитора верна в вакууме, но сценарий недостижим: exclusive-операция всегда сохраняется как gross = grossFromNet(net) (OperationSheet.tsx:351-353 — единственный писатель, память «вся математика в applyTxVat»), а исчерпывающий перебор всех 2-значных net до 20 000.00 при ставках 5/9/19/20/24 даёт НОЛЬ расхождений: каждый реально записанный gross — неподвижная точка композиции grossFromNet∘netFromGross. Gross 99.99 при ставке 19 в exclusive-режиме из приложения возникнуть не может (не лежит в образе grossFromNet), а легаси-строки без vat_mode гидрируются как inclusive (строка 172), где inputFromGross — тождество. Единственный реальный сдвиг возможен при смене ставки НДС между созданием и редактированием (гидрация берёт transaction.vat_rate, сохранение — текущий vat.rate), но это переоценка net по новой ставке — другое и, вероятно, задуманное поведение. Предложенный фикс («не пересобирать gross при неизменённом поле») чинит несуществующую проблему.



## Сервер: что применено к живой базе 2026-08-16

Пять миграций записаны в историю Supabase (тела — в истории миграций проекта, `list_migrations`):

1. `finance_audit_vat_snapshot_lifecycle` — fill_transaction_vat: триггер стал BEFORE INSERT **OR UPDATE** (C0/C6); на правке суммы налог пересчитывается по ставке самой операции (C31-сервер); возврат наследует снимок исходного дохода пропорционально (C3-сервер); тумблер компании «off» гасит и закреплённый за счётом/командой режим (C30-сервер).
2. `finance_audit_refund_ledger_guards` — assert_finance_transaction_integrity: доход с возвратами не удаляется (C1); сумму дохода нельзя опустить ниже уже возвращённого (C2-сервер).
3. `finance_audit_cash_count_and_receipt_lifecycle` — пересчёт кассы защищён и на UPDATE (C20-сервер); новый trg_sync_receipt_with_income — чек обновляется вслед за правкой дохода (C34); void_receipt_on_refund стал INSERT OR DELETE — чек оживает при удалении возврата.
4. `finance_audit_document_numbering` — lpad больше не режет длинные номера чеков и кредит-нот (C39); unique(tenant_id, **kind**, year, seq) — серия CN отделена от инвойсной, next_invoice_number фильтрует по kind (C38).
5. `finance_audit_invoice_payment_vat_snapshot` — record_invoice_payment несёт НДС инвойса в проводку (частичная оплата — пропорциональная доля) (C4/C29).

## Применено владельцем 2026-08-16 (C15, C18, достройка 20260815150000)

Владелец скомандовал «зайди в Supabase и всё сделай сам» — применено миграциями `finance_audit_accounts_one_team_completion` и `finance_audit_transfer_between_teams`. Проверено по живой базе: «Revolut Business» стал счётом своей бригады (is_primary уступил уже существующему основному), account_teams пуста, счетов scope='company' не осталось, текста запрета в record_account_transfer больше нет. Исходный SQL был подготовлен здесь:
`/private/tmp/claude-501/-Users-artem-Documents-Project-Claude-Babun/8be27940-bde5-4cdf-b042-494383cb45c8/scratchpad/PENDING-transfer-unban.sql`

Он: (1) открывает узкую самозакрывающуюся дверь в guard_account_financial_history для конверсии company→team; (2) переносит «Revolut Business» на его бригаду и чистит account_teams; (3) снимает в record_account_transfer запрет «перевод между командами идёт через счёт компании» и перестаёт сверять ноги перевода с сегодняшним brigade_id; (4) то же в delete_account_transfer. Без него: лист перевода между бригадами получает отказ сервера, дверь «Отдать бригаде» (C14) отвечает честным алертом.
