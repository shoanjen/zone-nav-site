#!/bin/zsh
# 抽屉工作台 · 启动脚本
cd "$(dirname "$0")" || exit 1

# 服务已在运行则直接打开
if curl -fsS --max-time 2 http://127.0.0.1:4780/api/links >/dev/null 2>&1; then
  open "http://127.0.0.1:4780"
  exit 0
fi

node server.js &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 0.8
open "http://127.0.0.1:4780"
wait $PID
