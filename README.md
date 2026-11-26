# Clash YML 配置工具（node-yml-config-tool）

一个管理 Clash / mihomo 节点配置的小工具：把零散的节点分享链接和订阅链接整理好，一键生成完整的 YML 配置文件。同一份网页代码可以：

- 直接在浏览器里打开使用（手机、电脑都行，可「添加到主屏幕」当 App 用）
- 用 Electron 打包成 Windows 的 `.exe`（安装版 + 免安装版）
- 用 Capacitor 打包成安卓的 `.apk`

## 隐私：默认完全为空

**本工具不含任何预置数据。** 首次打开时：节点 0 个、订阅 0 个、分组 0 个，没有默认分组，也没有任何示例账号、服务器或订阅地址。所有数据只保存在使用者自己设备上的浏览器 localStorage 里，不上传到任何服务器。把它发给别人用，对方打开也是空白的，只能填他们自己的节点和订阅。

## 功能

- **节点**：粘贴分享链接自动解析（vless / vmess / trojan / hysteria2 / tuic / anytls / ss），也可以手动填参数；列表、搜索、按分组/协议筛选、编辑、删除
- **节点命名**：按「分组名|地点名|地址|端口」自动生成，同地址同端口重名时可加第 5 段后缀区分，重名会被拦住
- **国家自动检测**：添加节点时先按链接备注里的国家信息、再按域名后缀预填地点名；CDN 前置地址和纯 IP 无法确定真实出口国家时，会明确提示手动填写，不会乱猜
- **分组**：自己新建、重命名（改名会同步更新组内所有节点的名称）、删除空分组；没有任何预置分组
- **订阅**：单个添加（可起名）、一次粘贴多个批量添加（一行一个，可在链接前写名字，没名字按域名自动起名，无效行和重复链接会跳过并说明原因）、改名、换链接、删除；链接默认打码显示
- **导出配置**：生成完整 mihomo / Clash YAML（通用模板：全局设置、嗅探、TUN、DNS、策略组、MetaCubeX 公开规则集），其中节点来自你添加的节点、订阅段来自你添加的订阅；一个订阅都没有时，导出的文件里不会出现订阅段。可以下载 `.yaml` 或一键复制
- **数据备份**：可把全部数据导出为 JSON 文件，再导入到另一台设备

## 本地运行

最简单的办法：直接用浏览器打开 `www/index.html`。

或者起一个本地服务器：

```bash
npm install
npm run serve
# 打开 http://localhost:8080
```

桌面版调试运行：

```bash
npm install
npm start
```

## 上传到 GitHub 并自动打包（推荐）

本项目带了两份 GitHub Actions 配置，代码推上去就能在云端自动打出 exe 和 apk，你的电脑上什么都不用装。

### 1. 建仓库并上传代码

方法 A（网页上传）：

1. 登录 GitHub，新建一个仓库（公开或私有都行），比如叫 `node-yml-config-tool`
2. 把本项目所有文件（含 `.github` 文件夹，注意别漏）上传到仓库

方法 B（git 命令行）：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<你的用户名>/node-yml-config-tool.git
git push -u origin main
```

### 2. 触发打包

- **手动触发**：打开仓库的 **Actions** 页 → 左侧选 `Build Windows EXE` 或 `Build Android APK` → 点 **Run workflow**
- **打标签触发**：推送一个 `v` 开头的标签（如 `v1.0.0`），两个打包会自动运行，并把 exe 和 apk 挂到对应的 **Release** 里

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 3. 下载成品

- 手动触发的：进入那次 Actions 运行记录，在页面下方的 **Artifacts** 里下载 `windows-exe` / `android-apk`
- 打标签触发的：到仓库的 **Releases** 页下载

Windows 产物包含安装版和免安装（portable）两种 exe；安卓产物包含 debug 版 apk 和未签名的 release 版 apk。

## 签名说明（先看这里，能省很多疑惑）

- **Windows**：本项目的 exe 没有代码签名证书。别人第一次打开时，Windows SmartScreen 会弹「Windows 已保护你的电脑」的提示，点「更多信息 → 仍要运行」即可，这是所有未签名小工具的通病，不是病毒。想要不弹这个提示，需要自己购买代码签名证书并配置到打包流程里。
- **安卓 debug 版**：`app-debug.apk` 用调试签名，可以直接安装到手机上（需要允许「安装未知应用」），适合自己和朋友之间分发。
- **安卓正式签名**：想长期发布、让用户能覆盖升级，需要你自己的签名文件（keystore）：
  1. 本地生成一次：`keytool -genkeypair -v -keystore my.keystore -alias mykey -keyalg RSA -keysize 2048 -validity 10000`（妥善保管，丢了就没法给老用户发升级包）
  2. 把 keystore 文件 base64 编码后存入仓库 **Settings → Secrets and variables → Actions**，再加密码、别名等几个 Secret
  3. 修改 `android/app/build.gradle`（打包时由 Capacitor 生成）加入 signingConfigs 读取这些 Secret，再改工作流在打包前把 keystore 写回文件。这一步可以按 Capacitor / Android 官方文档的「signing a release build」章节操作
  4. 在没配正式签名之前，请分发 debug 版 apk，不要分发未签名的 release 版（装不上）

## 项目结构

```text
.
├── www/                        # 网页应用本体（无构建步骤）
│   ├── index.html
│   ├── css/style.css
│   ├── js/core.js              # 核心逻辑：链接解析 / 国家检测 / YAML 生成
│   ├── js/app.js               # 界面与 localStorage 存储
│   ├── manifest.webmanifest    # 可安装到主屏幕的配置
│   └── icon.svg
├── electron/
│   ├── main.js                 # Electron 主进程
│   └── preload.js
├── capacitor.config.json       # Capacitor 配置（webDir = www）
├── package.json                # 依赖、脚本、electron-builder 打包配置
├── .github/workflows/
│   ├── build-windows.yml       # 云端打 Windows exe
│   └── build-android.yml       # 云端打安卓 apk
├── LICENSE                     # CC BY-NC-SA 4.0
└── README.md
```

安卓的 `android/` 工程文件夹**不包含在源码里**，是打包时由 `npx cap add android` 现场生成的，已写进 `.gitignore`，这是正常现象。

## 许可证

CC BY-NC-SA 4.0（署名-非商业性使用-相同方式共享），见 [LICENSE](LICENSE)。

简单说：可以免费使用、查看和修改源码，但**不得用于商业用途**；使用或修改必须**注明原作者 Vardven 及本仓库地址**；修改后的版本必须以**相同协议**公开发布。
