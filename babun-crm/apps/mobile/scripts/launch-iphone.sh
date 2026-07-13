#!/bin/sh
# Запуск Babun на физическом iPhone с текущим адресом Metro.
#
# Лечит красный экран «No script URL provided»: dev-билд собран без
# expo-dev-client, поэтому адрес Metro зашит в бандл на момент сборки
# (ios/build/.../Babun.app/ip.txt) и протухает при смене сети Mac.
# Аргумент -RCT_jsLocation (NSArgumentDomain → RCTBundleURLProvider)
# переопределяет адрес на ОДИН запуск — холодный старт с иконки снова
# читает зашитый. Постоянное лечение: пересборка на текущей сети или
# expo-dev-client.
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
  --device "$DEVICE" com.babun.crm -- -RCT_jsLocation "$IP:8081"

echo "Babun запущен → Metro http://$IP:8081"
