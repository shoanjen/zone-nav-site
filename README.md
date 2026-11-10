# 抽屉工作台

本地书签导航工具：左侧分类目录树 + 右侧卡片网格，配合 Chrome 扩展把每个 Chrome 个人资料的收藏自动收进对应「资料」。零依赖——服务端只用 Node 内置模块，前端是单文件原生 HTML/CSS/JS。

## 本地运行

```bash
node server.js          # 或 macOS 双击「启动工作台.command」
```

打开 http://127.0.0.1:4780 （可用环境变量 `PORT` 换端口）。数据保存在 `data/links.json`，只在本机。

「启动工作台.command」会自动启动本地服务，并打开脚本顶部 `SITE_URL` 指向的云端入口地址（部署后请改成你自己的，见下方「部署方式」）；也可以直接访问 http://127.0.0.1:4780 。

## Chrome 扩展「抽屉同步」

1. 打开 `chrome://extensions`，开启右上角「开发者模式」；
2. 「加载已解压的扩展程序」选择本项目的 `extension/` 文件夹；
3. 每个要分开收纳的 Chrome 个人资料各装一份，并在扩展弹窗里给资料起不同的名字；
4. 在网页上点收藏（或 `Cmd/Ctrl+Shift+S` 收藏当前标签页），书签自动进入对应资料。

收纳方式可在扩展弹窗里切换：默认弹窗选分类；改为「按书签文件夹」后，Chrome 书签所在的文件夹路径会自动成为多级分类。

## 部署方式（GitHub Pages · 混合模式）

### 部署步骤

1. 在 GitHub 创建一个仓库（公开仓库可免费使用 Pages，私有仓库需要付费计划）；
2. 推送项目：

   ```bash
   git init
   git add -A
   git commit -m "init"
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```

3. 仓库 Settings → Pages → Source 选择「GitHub Actions」；
4. 推送后内置工作流（`.github/workflows/deploy-pages.yml`）自动把 `public/` 部署到 `https://<用户名>.github.io/<仓库名>/`；
5. **修改启动脚本**：「启动工作台.command」顶部的 `SITE_URL` 默认是仓库作者的地址，请改成你自己的 `https://<用户名>.github.io/<仓库名>/`，这样双击脚本打开的就是你的云端入口。

### 部署后的工作方式

页面在云端，数据仍在各自电脑上：

- 页面加载时先连 `http://127.0.0.1:4780` 的本地服务——谁的电脑打开，就连谁的机器，看到的就是谁自己的书签。每个使用者按上面的步骤跑自己的本地服务、装自己的扩展即可；
- 本地服务没启动时，自动回退为**只读快照**（`public/data.snapshot.json`），可以浏览但不能修改；
- 想让只读访客看到最新书签：本地服务运行时双击「更新网页快照.command」，把结果提交推送即可；
- `127.0.0.1` 永远指向"当前打开网页的那台机器"，所以在别的设备上打开此网址，只能看到快照或错误提示，看不到你的数据。

进阶：服务换了端口或跑在局域网另一台机器上时，可在页面控制台执行 `localStorage.setItem('nav.apiBase', 'http://192.168.x.x:4780')` 覆盖 API 地址。

## 目录结构

```
抽屉工作台/
├── server.js              # Node 服务器（唯一后端文件）
├── public/
│   ├── index.html         # 全部前端（内联 CSS + JS）
│   └── data.snapshot.json # 只读快照（更新网页快照.command 生成）
├── extension/             # Chrome MV3 扩展「抽屉同步」
├── data/
│   └── links.json         # 运行时生成，已 gitignore，不会上传
└── 启动工作台.command      # zsh 启动脚本
```

## 隐私

`data/` 已在 `.gitignore` 中，你的书签数据不会被推到 GitHub；只有你主动运行快照脚本并提交时，公开的才是那一刻的只读副本。快照会公开可见，提交前请确认里面没有私密链接。
