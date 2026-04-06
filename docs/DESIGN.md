# BABUN — Design System

## Философия

Чистый, минималистичный, функциональный. Как Notion встретил Linear.
Dashboard должен быть приятным для ежедневного использования.

## Цвета

Используй shadcn/ui default theme (Zinc base). Кастомизация через CSS variables.

- Primary: Zinc/Slate
- Accent: Blue (#3B82F6) для CTA
- Статусы заказов:
  - new: gray
  - confirmed: blue
  - scheduled: amber
  - in_progress: purple
  - completed: green
  - cancelled: red
  - no_show: orange

## Типография

- Headings: Inter (или системный sans-serif), 500 weight
- Body: 400, 14-16px
- Monospace: для ID заказов, сумм

## Компоненты

Не создавай кастомные если есть в shadcn/ui:
Button, Card, Dialog, Sheet, DropdownMenu, Table, Tabs, Badge, Avatar,
Skeleton, Alert, Toast (Sonner), Command, Popover, Calendar, Checkbox,
Switch, Select, Input, Label, Form, Separator, ScrollArea

## Иконки

Lucide React. Размер: 16-20px. Не смешивать библиотеки.

## Анимации

Минимум:

- Sidebar toggle: transition-all 200ms
- Modal/Sheet: встроенные shadcn/ui
- Skeleton: pulse для загрузки
- Kanban drag: @dnd-kit
- Toast: slide-in (Sonner)

## Responsive

- Desktop-first (CRM = рабочий инструмент)
- Mobile: sidebar → Sheet, tables → cards
- Breakpoints: sm=640, md=768, lg=1024, xl=1280
