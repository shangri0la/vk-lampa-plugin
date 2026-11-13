#!/usr/bin/env bash
# Сборка vk-video.js: исходник плагина + встроенный QR-генератор
set -e
cd "$(dirname "$0")"

{
  echo "/*"
  echo " * VK Video — плагин для Lampa. Сборка содержит встроенный QR-генератор:"
  echo " * QR Code Generator for JavaScript (c) 2009 Kazuhiko Arase, MIT license."
  echo " */"
  echo ""
  cat vendor/qrcode-lib.js
  echo ""
  cat src-plugin.js
} > vk-video.js

node --check vk-video.js
echo "OK: vk-video.js $(wc -c < vk-video.js) байт"
