# Clash YML 配置工具

把 **v2rayN 的单个节点**和 **Clash 订阅**融合到一份配置里：在一个工具里统一管理单个节点与订阅，自由分组，一键导出完整的 Clash / mihomo YAML 拿去用；反过来，配置里的任意节点也能一键复制成分享链接，粘回 v2rayN 单独使用。

同一份代码有三种用法：

- **网页版**：部署到任意静态托管后用浏览器打开，手机、电脑都行，可「添加到主屏幕」当 App 用
- **Windows**：Electron 打包的 `.exe`（安装版 + 免安装版）
- **Android**：Capacitor 打包的 `.apk`（正式签名版，可覆盖升级）

## 界面截图

> 截图中的节点均为演示数据（example.com 示例地址），工具本身不含任何预置数据。

节点列表——每个节点可单独「复制链接」粘回 v2rayN：

![节点列表](docs/screenshots/nodes.png)

分组页——上半是 YAML 里的策略组（按地区自动归类，只能查看成员），下半是可自己改名的自定义分组：

![分组页](docs/screenshots/groups.png)

导出配置——预览完整 YAML，可下载或复制；还能把全部节点导出成链接清单：

![导出配置](docs/screenshots/export.png)

设置页（右上角齿轮进入）——语言切换、检查更新、关于与许可：

![设置页](docs/screenshots/settings.png)

## 功能

- **添加节点**：粘贴分享链接自动解析（vless / vmess / trojan / hysteria2 / tuic / anytls / ss），解析结果会列出已识别的参数供核对；一次粘贴多条链接可批量添加；也可以手动填参数。被换行断开的长链接会自动拼回再解析
- **节点命名**：按「分组名|地点名|地址|端口」自动生成；添加时先按链接备注、再按域名后缀预填国家/地区，CDN 前置和纯 IP 无法确定出口国家时明确提示手动填，不乱猜
- **节点转链接**：每个节点可复制成 v2rayN 分享链接；导出页还能一键复制全部节点链接或下载链接清单（.txt）
- **订阅**：单个或批量添加订阅链接（可改名、换链接、删除，链接默认打码显示）；导出配置时订阅会生成 `proxy-providers` 段
- **导入订阅内容**：把订阅内容（Base64、链接列表或 Clash YAML）粘进来，可解析成单个节点逐个挑选或全部导入——这样订阅里的节点也能单独复制回 v2rayN
- **分组**：「分组」页上半部分是导出 YAML 里的**策略组**（全部节点、自动选择、负载均衡、各地区分组等），与 YAML 模板实时对应，只能查看每个组包含哪些节点，不能改名删除；下半部分是**自定义分组**，可新建、重命名（自动同步组内节点名）、删除。新节点默认放入内置的「全部节点」
- **导出配置**：生成完整 mihomo / Clash YAML（全局设置、嗅探、TUN、DNS、策略组、MetaCubeX 公开规则集），可下载 `.yaml` 或一键复制，直接导入 Clash Verge 等客户端
- **备份**：全部数据可导出为 JSON 文件备份，换设备时导入恢复
- **设置**：右上角齿轮进入独立设置页，可切换界面语言（简体中文、繁體中文、English、Русский、فارسی、日本語、한국어 共 7 种）、检查更新（发现新版会弹窗提示）、查看关于与许可

## 使用方法

### 网页版（推荐先试这个，不用安装）

网页版就是仓库里的 `www/` 目录，把它放到任何能托管静态网页的地方即可：

### 🚀 一键部署（推荐）

点下面的按钮，会自动把本仓库克隆到你的 GitHub 账号并部署到 Cloudflare，全程不用敲命令（需要一个免费的 Cloudflare 账号）：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Vardven/node-yml-config-tool)

1. 点按钮后登录 Cloudflare，按提示授权它访问你的 GitHub
2. 确认项目名称（可以改），点部署，等一两分钟
3. 部署成功后会得到一个 `https://<项目名>.<你的子域>.workers.dev` 网址，打开就是网页版
4. 手机上打开该网址，点浏览器菜单里的「添加到主屏幕」，就能当 App 用

之后想更新版本：在你克隆的那份仓库里同步上游新版，Cloudflare 会自动重新部署。

**方式一：手动部署到免费静态托管（有自己的网址，手机电脑都能开）**

1. 注册一个静态托管服务，如 Cloudflare Pages、Vercel 或 Netlify（免费版即可）
2. 新建项目，选择上传/导入本仓库（或直接上传 `www` 文件夹），发布目录填 `www`
3. 部署完成后会得到一个网址，用浏览器打开就是网页版
4. 手机上打开该网址后，点浏览器菜单里的「添加到主屏幕」，桌面上会出现图标，用起来和 App 一样

**方式二：只在自己电脑上用（不用部署）**

```bash
npm install
npm run serve
# 浏览器打开 http://localhost:8080
```

或者直接双击打开 `www/index.html` 也能用（推荐用上面的本地服务器方式，数据保存更稳定）。

> 注意：网页版的数据保存在**当前浏览器**的本地存储里。换浏览器、换设备或清掉浏览器数据，数据不会自动跟过去；请定期用「导出配置」页的**导出备份（JSON）**保存数据，换地方时再导入。

### Windows 版

到仓库的 [Releases](https://github.com/Vardven/node-yml-config-tool/releases) 页下载最新版：

- `node-yml-config-tool-<版本>-x64-setup.exe`：安装版，装完从开始菜单打开
- `node-yml-config-tool-<版本>-x64-portable.exe`：免安装版，双击即用

exe 已做代码签名（自签名证书，发布者 Vardven）；因证书为自签名，首次运行如遇 SmartScreen 提示，点「更多信息 → 仍要运行」。

### Android 版

同样在 [Releases](https://github.com/Vardven/node-yml-config-tool/releases) 页下载：

- `app-release.apk`：**正式签名版，推荐装这个**，以后出新版可直接覆盖升级，不用卸载
- `app-debug.apk`：调试版，也可安装

安装时如系统提示，需要允许「安装未知应用」。

### 基本流程（三种版本都一样）

1. **加节点**：「添加节点」页粘贴分享链接（可一次多条），核对解析出的参数和地点，选好分组后添加；没有链接也可以手动填
2. **加订阅**：「订阅」页添加订阅链接；想把订阅里的节点拆出来单独用，就用同页的「导入订阅内容」把订阅内容粘进来解析成节点
3. **看分组**：「分组」页查看每个策略组实际包含哪些节点，或建自己的分组整理节点
4. **导出用**：「导出配置」页下载 YAML，导入 Clash Verge / mihomo 等客户端使用；想回 v2rayN，就在节点上点「复制链接」或导出全部节点链接
5. **备份**：换设备前在「导出配置」页导出 JSON 备份，新设备上导入

## 隐私：默认完全为空

**本工具不含任何预置数据。** 首次打开时节点 0 个、订阅 0 个、自定义分组 0 个（只有内置的「全部节点」和模板自带的策略组），没有任何示例账号、服务器或订阅地址。所有数据只保存在使用者自己设备本地，不上传到任何服务器。把它发给别人用，对方打开也是空白的，只能填他们自己的节点和订阅。

## 本地开发与打包

```bash
npm install
npm run serve   # 网页版本地调试 http://localhost:8080
npm start       # 桌面版调试运行（Electron）
```

打包不用在自己电脑上做：仓库带了两份 GitHub Actions 配置，推送 `v` 开头的标签（如 `v1.0.6`）会自动打包，并把 exe 和 apk 挂到对应的 Release 里；也可以在 Actions 页手动触发（产物在运行记录的 Artifacts 里）。

签名说明：

- **Windows**：exe 用自签名证书签名（发布者 Vardven），能防篡改，但不是受系统信任的商业证书，SmartScreen 仍可能提示，按上文方法放行即可。签名材料通过仓库 Secrets 注入，fork 本项目的人没有这些 Secrets 时打出的是未签名版本，功能不受影响
- **Android**：`app-release.apk` 用正式 keystore 签名，可覆盖升级；keystore 通过仓库 Secrets 注入。没有 Secrets 时请分发 debug 版，不要分发未签名的 release 版（装不上）。keystore 务必妥善保管，丢了就无法给老用户发覆盖升级包

## 项目结构

```text
.
├── www/                        # 网页应用本体（无构建步骤，三端共用）
│   ├── index.html
│   ├── css/style.css
│   ├── js/core.js              # 核心逻辑：链接解析 / 分享链接生成 / 订阅解析 / YAML 生成
│   ├── js/app.js               # 界面与 localStorage 存储
│   ├── js/i18n.js              # 7 种界面语言词典
│   ├── manifest.webmanifest    # 可安装到主屏幕的配置
│   └── icon.svg
├── electron/
│   ├── main.js                 # Electron 主进程
│   └── preload.js
├── capacitor.config.json       # Capacitor 配置（webDir = www）
├── package.json                # 依赖、脚本、electron-builder 打包配置
├── wrangler.jsonc              # Cloudflare 一键部署配置（静态资源指向 www）
├── docs/screenshots/           # README 截图（演示数据）
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

作者：Vardven
