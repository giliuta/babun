#!/bin/sh
# Запуск Babun Dev на физическом iPhone, нацеленный на текущий Metro.
#
# Dev-вариант живёт под СВОИМ id (com.babun.crm.dev, имя «Babun Dev»,
# scheme babundev) и не конфликтует с боевым TestFlight-Babun
# (com.babun.crm). Deep link открывает expo-dev-launcher сразу на
# адресе Metro этого Mac.
#
# Использование: scripts/launch-iphone.sh [coredevice-UUID]
set -e

DEVICE="${1:-4D0A5EBA-8E86-5455-B2DC-C251016EBFA8}" # iPhone 17 Pro Max
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)"

if [ -z "$IP" ]; then
  echo "Не удалось определить IP Mac (en0/en1)" >&2
  exit 1
fi

xcrun devicectl device process launch --terminate-existing \
  --payload-url "babundev://expo-development-client/?url=http%3A%2F%2F${IP}%3A8081" \
  --device "$DEVICE" com.babun.crm.dev

echo "Babun Dev запущен → Metro http://$IP:8081"
