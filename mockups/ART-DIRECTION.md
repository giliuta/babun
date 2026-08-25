# Babun · арт-дирекшн знака

Документ для генерации визуального эталона знака. Один выбранный
интент — не набор стилей. Всё ниже выведено из аудита
(рынок · семантика и риск · морфология · коллизии · техника иконки)
и из слепого тестирования восьми зрителей.

---

## 1. Интент

**«Печать хранителя».**

Знак — не иллюстрация животного и не маскот. Это **оттиск печати**:
фронтальный сидящий хамадрил на плинтусе, иератичный и симметричный,
одной краской, с прорезанной внутренней структурой. Регистр —
древний административный артефакт, исполненный со швейцарской
точностью. Печать писца, которой заверяют запись.

Почему именно так:

- **Тот.** Хамадрил — животное бога письма, счёта и записи. CRM и есть
  запись: кто приехал, что сделал, сколько взял. Печать — предмет,
  которым запись заверяют.
- **Монумент вместо персонажа.** Плинтус под фигурой — не декор.
  Статуя на постаменте не может надеть комбинезон, а именно
  антропоморфный маскот в спецовке был признан главным репутационным
  риском проекта.
- **Категория пустая.** Двадцать два конкурента — плоский моно-вектор
  без единого животного. Резаная структура и один пигмент — свободная
  территория.

## 2. Обязательная анатомия

| Признак | Как рисовать |
|---|---|
| Поза | Сидя, строго фронтально, симметрично, неподвижно. Кисти лежат на приподнятых коленях. |
| Мантия | Плечевой плащ взрослого самца — **колокол, а не нимб**: над теменем почти плоский, к плечам расходится вдвое шире головы, спадает по спине. Это главный опознавательный признак вида. |
| Морда | Длинная, тупая, направлена вниз-вперёд, заканчивается округлой мочкой. Не короче 0.45 длины головы. |
| Надбровье | Один сплошной тяжёлый козырёк над глазами. |
| Глаза | Мелкие, сплошные, тёмные, близко к оси, глубоко под козырьком. |
| Уши | Не рисовать: у хамадрила они мелкие и полностью утоплены в гриве. |
| Плинтус | Сплошная плита под фигурой. |

## 3. Запрещено (риск-аудит, не обсуждается)

Губы · открытый рот · оскал · клыки · язык · белки глаз · круглые
мультяшные зрачки · брови · любая мимика · телесный тон · тёмная
заливка лица · двухцветность · поза на двух ногах · жесты · одежда ·
каска · инструмент · любой предмет в руках · бананы · джунгли · лианы ·
пальмы · система костюмов и сезонных вариантов.

Стилевые запреты: не тату-флеш, не племенная маска, не ацтекский идол,
не солнечное божество с лучами, не милая обезьянка, не киберпанк,
не 3D-рендер, не металлик, не градиент, не свечение, не тень.

## 4. Промпт

```
A single-colour logotype mark: a hamadryas baboon seated frontally on a
stone plinth, rendered as an ancient seal impression.

Composition: strictly symmetrical about the vertical axis, hieratic and
still, centred, full figure with a solid rectangular plinth beneath it.
Head and shoulders dominate; forearms descend to hands resting flat on
raised knees.

The defining feature is the adult male's shoulder mantle: a broad cape of
fur that sits almost flat over the crown and flares outward to roughly
twice the head's width at the shoulders, then falls. It is a garment-like
bell, never a radial halo and never sun rays. The fur reads as carved
parallel grooves flowing downward and outward from the crown in one
continuous sweep.

The face is a narrow plate set inside the mantle: wide at the brow,
narrowing sharply into a long blunt muzzle that points down and forward
and ends in a rounded nose pad. One heavy continuous brow ridge. Two
small solid dark eyes, close to the midline, deep beneath the brow. No
ears are visible.

Rendering: flat vector, one flat ink — charcoal black #1A1714 — on a
plain limestone background #EFE7D9. No gradient, no shading, no
texture, no highlight, no drop shadow, no outline glow, no third colour.
Interior structure is expressed only as carved negative-space grooves cut
out of the solid mass, in the manner of an intaglio seal or a wax
impression. Line weights are even and deliberate. Geometry is precise and
constructed, not sketchy.

Mood: ancient administrative artefact executed with Swiss precision.
Restrained, authoritative, dry, monumental, calm. A scribe's seal.

Absolutely no: lips, open mouth, teeth, tongue, sclera, round cartoon
pupils, eyebrows, facial expression, skin tones, clothing, hard hat,
tools, held objects, bananas, jungle foliage, tribal mask motifs, sun-god
rays, tattoo flash, 3D rendering, metallic finish, drop shadow, text,
letters, watermark, signature.

Square 1:1, the figure fully inside the frame with even margins.
```

## 5. Параметры

| Параметр | Значение |
|---|---|
| Модель | `gpt-image-2` (не `gpt-image-1` — отключается 23.10.2026) |
| Размер | `1024x1024` |
| Качество | `high` |
| Фон | непрозрачный (грунт — часть композиции) |
| Количество | 6 на прогон, три прогона с вариациями формулировки мантии |

## 6. Что дальше с картинкой

Растр из генератора — **эталон намерения, а не логотип**. Модель не
держит точную симметрию, не даёт контролируемую толщину штриха и
подвирает анатомию. Рабочий порядок такой же, как в любой студии:

1. Сгенерировать набор, отобрать лучший по силуэту и по посадке мантии.
2. Перерисовать победителя вектором на сетке 120 — симметрия считается,
   а не рисуется на глаз.
3. Свести к плотному мастеру для 16–32 px.
4. Прогнать слепой тест ещё раз: если бабуина не называют — переделать.
