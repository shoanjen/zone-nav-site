#!/bin/zsh
# 抽屉工作台 · 启动脚本
# 云端入口地址：部署到你自己的 GitHub Pages 后，改成你的地址（见 README「部署方式」）
SITE_URL="https://shoanjen.github.io/zone-nav-site/"

cd "$(dirname "$0")" || exit 1

# 服务已在运行则直接打开
if curl -fsS --max-time 2 http://127.0.0.1:4780/api/links >/dev/null 2>&1; then
  open "$SITE_URL"
  exit 0
fi

node server.js &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 0.8
open "$SITE_URL"
wait $PID
