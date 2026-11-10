#!/bin/zsh
# 抽屉工作台 · 更新网页快照
# 把当前本地服务里的全部书签导出为 public/data.snapshot.json，
# 提交到 GitHub 后，没启动本地服务的访问者就能在 github.io 页面上只读浏览这些书签。
cd "$(dirname "$0")" || exit 1

if ! curl -fsS --max-time 2 http://127.0.0.1:4780/api/links > /dev/null 2>&1; then
  echo "本地服务未启动：请先运行 node server.js（或双击「启动工作台.command」）"
  exit 1
fi

curl -fsS http://127.0.0.1:4780/api/links > public/data.snapshot.json \
  && echo "快照已更新：public/data.snapshot.json（记得 git 提交推送，页面才会生效）"
