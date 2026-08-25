#!/bin/bash
# Чистка GitHub после сноса веб-приложения. 2026-08-25.
#
# Всё, что здесь удаляется, УЖЕ продублировано тегами archive/* на remote —
# ни один коммит не потеряется. Проверить можно так:
#   git ls-remote --tags origin | grep archive/
#
# Вернуть удалённую ветку, если понадобится:
#   git push origin archive/<имя>:refs/heads/<имя>
#
# Запуск:  bash scripts/github-cleanup.sh
set -u

echo "1/4 · закрываю устаревшие PR"
for pr in 118 116 106 83 52; do
  if gh pr close "$pr" --repo giliuta/babun2 --comment \
"Закрыт при чистке 2026-08-25. Next.js-приложение (apps/web) удалено — разработка идёт только в apps/mobile (Expo/React Native), веб собирается из того же кода через React Native Web. Коммиты ветки сохранены тегом archive/* и не потеряны." >/dev/null 2>&1; then
    echo "   закрыт #$pr"
  else
    echo "   пропущен #$pr (уже закрыт или нет доступа)"
  fi
done

echo "2/4 · удаляю мёртвые ветки (все трогали только удалённый apps/web)"
while IFS= read -r b; do
  [ -z "$b" ] && continue
  if git push origin --delete "$b" >/dev/null 2>&1; then
    echo "   удалена $b"
  else
    echo "   пропущена $b"
  fi
done <<'BRANCHES'
claude/angry-ride-e86a8d
claude/branch-review-merge-0q5J0
claude/calendar-fixed-divider
claude/calendar-readability
claude/calendar-scroll-reset
claude/calendar-settings-gear-Kcm89
claude/calendar-static-separator
claude/calendar-ui-simplify-bu1Lp
claude/calendar-zoom-reattach
claude/clients-filter-hotfix
claude/compact-team-chip
claude/customer-request-form-design-6JIvl
claude/daily-financial-summary-9JsNg
claude/finance-day-modes
claude/finance-footer-contextual
claude/finance-footer-no-labels
claude/finance-footer-redesign
claude/finance-footer-simple
claude/label-redesign
claude/modest-margulis-7d44df
claude/no-dim-past
claude/remove-dark-mode
claude/sentry-wrap-non-error-and-audit
claude/text-shift-input-Aj7FQ
feat/create-as-card
feat/daily-finance-tracking
feat/finance-footer-tighten
feat/finance-phase-e-invoices
feat/finance-phase-f-templates
feat/finance-redesign-phase-a
feat/finances-analytics
feat/finances-money-fixes
feat/unified-client-card
fix/finance-footer-gap
BRANCHES

echo "3/4 · освобождаю имя babun"
echo "     (старый giliuta/babun — первый Next.js-заход, 24 коммита, апрель 2026)"
if gh repo rename babun-legacy-web-2026-04 --repo giliuta/babun --yes >/dev/null 2>&1; then
  echo "   старый репозиторий переименован в babun-legacy-web-2026-04"
else
  echo "   пропущено (возможно, уже переименован)"
fi

echo "4/4 · переименовываю babun2 → babun"
if gh repo rename babun --repo giliuta/babun2 --yes >/dev/null 2>&1; then
  git remote set-url origin https://github.com/giliuta/babun.git
  echo "   готово, remote теперь $(git remote get-url origin)"
else
  echo "   пропущено"
fi

echo
echo "Локальные ветки, у которых на remote больше нет пары, чистятся так:"
echo "  git fetch --prune && git branch -vv | grep ': gone]' | awk '{print \$1}' | xargs -r git branch -D"

echo
echo "──────────────────────────────────────────────────────────────────────"
echo "ОТДЕЛЬНЫЙ ШАГ: перевести master на код React Native"
echo
echo "Сейчас master отстаёт на $(git rev-list --count origin/master..HEAD) коммитов, и babun.app отдаёт СТАРОЕ"
echo "Next.js-приложение. После этого шага master будет содержать код"
echo "React Native, и Vercel начнёт собирать веб из него."
echo
echo "Домен переключится НЕ сразу: пока в настройках проекта Vercel"
echo "Root Directory = babun-crm/apps/web (папки нет), сборка падает, и"
echo "babun.app продолжает отдавать последний удачный старый деплой."
echo "То есть порядок безопасный: сначала этот шаг, потом настройка."
echo "──────────────────────────────────────────────────────────────────────"
printf "Перевести master? [y/N] "
read -r answer
case "$answer" in
  [yY]*)
    if git push origin HEAD:master; then
      echo "   master переведён. Теперь в панели Vercel, проект babun2:"
      echo "     Settings → Build & Deployment → Root Directory  →  очистить"
      echo "     Settings → Build & Deployment → Framework Preset →  Other"
      echo "   Остальное возьмёт на себя vercel.json в корне репозитория."
    else
      echo "   не прошло"
    fi
    ;;
  *) echo "   пропущено — master остался как был" ;;
esac
