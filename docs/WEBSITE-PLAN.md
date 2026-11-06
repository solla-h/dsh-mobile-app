# fatwhale.app 宣传站：页面提纲与部署方案

> 2026-11-06；供后续 Claude 制作页面时交接。
> **本轮只规划，不制作页面、不创建 Cloudflare 项目、不修改 DNS。**
> 产品名暂沿用 **DSH Mobile**；`fatwhale.app` 是拟用域名，不代表已经上线或更名。
> App 的 i18n 和 iOS 版本暂缓；维护英文 README 不属于 App i18n 工作。

## 1. 两个入口，各自解决一个问题

| 入口 | 读者的问题 | 主要行动 |
| --- | --- | --- |
| GitHub README | 这是什么，能否试用，怎么安装或参与？ | 下载 APK、读安装指南、反馈/贡献 |
| fatwhale.app | 我为什么要在手机上使用 DSH？ | 理解场景 → 确认前提 → 下载与配对 |

根 `README.md` 使用简体中文，`README.en.md` 提供同结构英文版；原 `README.zh-CN.md`
保留跳转说明，兼容旧链接。README 按产品与使用顺序组织，完整安装、网络排障和工程细节链接到专门文档。
宣传站首版只做中文，不重复整套手册，不承担登录、配对、网关代理或对话服务。

## 2. 页面布局与内容组成

这是内容槽位和排序，具体标题、文案与视觉设计交给 Claude。

| 顺序 | 模块 | 必须回答的内容 | 素材与交互 |
| --- | --- | --- | --- |
| 1 | 简洁导航 | 产品名，能力介绍，开始使用，GitHub | 锚点导航；保持手机上一眼可读 |
| 2 | 首屏 | 给谁用、带来什么价值；第三方 DSH 手机客户端、Android alpha | 一个主按钮：获取 Android APK；次入口：安装与配对 |
| 3 | 核心场景 | 看进度：聚焦运行/待办；做决定：回复审批/提问；继续说：文字/语音 | 三个短场景；写用户动作和收益，不罗列协议名 |
| 4 | 产品展示 | 从首页进入会话、处理待办、继续对话 | 1–2 张脱敏真机图优先；没有时用明确标注的界面示意，不能冒充截图 |
| 5 | 三步开始 | 已有 DSH 宿主 → 安装手机网关并生成配对码 → 安装 APK 后扫码 | 说明宿主持续运行、手机能访问网关；链接中文指南与 Agent 安装手册 |
| 6 | 使用边界与 FAQ | 是否官方、需要什么、语音条件、断线行为、iOS、数据与许可 | 原生可展开问答；关键前提在首屏附近也简要提示 |
| 7 | 收尾与页脚 | 下载、阅读文档、反馈问题、查看源码 | alpha 状态、独立项目声明、代码和素材许可 |

**桌面布局：** 首屏左侧讲价值和行动，右侧产品图；中段按三种使用场景展开，随后放上手步骤与 FAQ。
**手机布局：** 单列；先显示产品身份、前提和行动，再展示产品图。导航与长标题不能挤出屏幕；
不做全屏自动播放、强制弹窗、注册墙或遮挡内容的悬浮层。末尾再放一次下载入口即可。

不使用虚构用户数量、评价、性能指标或未经验证的能力。首版没有数据收集需求，不加登录、留言表单、
第三方统计 SDK 或营销追踪；用 GitHub Issues 接收反馈。

## 3. 文案事实与边界

| 可以表达 | 必须同时说明的条件 |
| --- | --- |
| 在手机上查看 DSH 会话、进度和待办，处理审批与提问 | DSH 运行在用户自己的宿主上；这不是手机本地模型或托管 AI 服务 |
| 按住说话、转写后继续对话 | 宿主需要匹配的语音插件及就绪的识别模型 |
| 离线保留列表、草稿，文字进入发件箱 | 发送和执行仍需要恢复连接；附件上传需要在线 |
| 多网关切换、扫码配对 | 每个网关分别配对，手机需要能访问对应入口 |
| 可选加密地址簿帮助找回变化的入口 | 这是入口地址的加密，不等于所有会话端到端加密；也不是使用 App 的前提 |
| Android APK 可下载 | 当前为 alpha、侧载安装；不宣称应用商店发行或稳定版 |
| 开源 | 原创代码 MIT；宠物素材 CC BY-NC-SA 4.0，仅限非商业；不要统称全部素材 MIT |

不宣称系统推送通知、后台始终在线、永不断线、零数据留存、所有 Android 机型兼容或 iOS 已可用。
页面不放真实主机地址、配对码、设备标识、账号或用户对话。宣传站不使用真实网关作为交互演示后端。

### 事实来源

- 功能与操作：[中文使用说明](USER-GUIDE.zh-CN.md)。
- 安装边界：[Agent 安装手册](AGENT-SETUP.md)。
- 版本：[`compatibility.json`](../compatibility.json) 与[兼容表](COMPATIBILITY.md)，不要自行改成 `@latest`。
- 可分发版本：[GitHub Releases](https://github.com/solla-h/dsh-mobile-app/releases)。
- 许可：[LICENSE](../LICENSE)、[NOTICE](../NOTICE)。

2026-11-06 的证据：`v0.1.0-alpha.3` 已发布，下载校验与 APK 签名已独立验证；
**新包真机安装/覆盖升级仍待验证**。既有配对、文字和语音真机证据来自此前的 preview，不能换个版本号沿用。
网站上线前重新核对这些事实；不要把此处日期和版本永久写死在主标题中。

## 4. 部署选择：Cloudflare Pages + GitHub 集成

推荐继续使用当前仓库，不另外维护一个网站仓库。首版采用静态 HTML/CSS，只有需要的交互才加少量 JS。
不为单页引入服务端、数据库、构建框架或新的 npm 依赖。

预期结构（**尚未创建**）：

```text
site/
  index.html          # 简体中文宣传页
  styles.css
  script.js           # 有必要时才添加
  assets/             # 原创视觉、脱敏截图、分享图
  _headers            # 必要的 HTTP 安全头
  robots.txt
  sitemap.xml
docs/WEBSITE-PLAN.md   # 方案保留在部署目录之外
```

| Cloudflare 设置 | 建议值 |
| --- | --- |
| 创建方式 | Pages 的 Git integration，连接 `solla-h/dsh-mobile-app` |
| 项目名 | `dsh-mobile-site`（候选名，创建时核实可用性） |
| Production branch | `master` |
| Root directory | 仓库根目录 |
| Framework preset | None |
| Build command | `exit 0` |
| Build output directory | `site` |
| Build watch paths | Include `site/*`，Exclude 留空；该通配符也匹配子目录 |
| Preview branches | 本仓库的网站工作分支；外部 fork PR 不自动生成预览 |
| 正式域名 | `fatwhale.app` |
| 可选别名 | `www.fatwhale.app`，绑定后统一重定向至主域名，保留路径与查询参数 |

选择 Git integration 后通过 Cloudflare 的 GitHub App 授权此仓库。此方案不需要往 GitHub Actions
添加 Cloudflare API Token，也不接触 Android 签名环境。不要把整个仓库作为输出目录。
若未来引入构建工具，再同时调整构建命令、输出目录和依赖文件的 watch paths。

Pages 原生 Git 部署与 APK 的 Actions 发布相互独立：网页修改不重打 APK，App 发布也不必重建网页。
Pages 不是等待其他 GitHub CI 通过的保证；**正式启用自动发布前，配置 master 的 PR/必需 CI 检查保护**。
当前仓库尚未启用该保护，不能把计划当作已经生效的门禁。

### 首次上线顺序

1. Claude 在网站分支制作页面，所有发布文件都放入 `site/`；先本地预览、检查内容和素材授权。
   首次页面经审阅和 CI 后合并，让 `master` 确实包含 `site/index.html`，再创建生产部署。
2. 在 Cloudflare 创建 Git 集成的 Pages 项目、按表配置，先检查 `pages.dev` 的部署结果。
3. 用这个部署走完手机和桌面浏览旅程；用户确认实际页面后再绑定正式域名。
   后续更新使用 PR 预览，不必重复这次初始化流程。
4. 确认 `fatwhale.app` 所在 zone 与 Pages 项目属于同一 Cloudflare 账号；检查现有 DNS、Worker 路由及重定向。
5. 在项目 **Custom domains → Set up a domain** 中添加 `fatwhale.app`，按引导确认 DNS，等待证书有效。
   不要只手填一个指向 `pages.dev` 的 CNAME；未先关联自定义域名可能出现 522。
   若已有同名站点或记录，先确认替换范围。`www` 不属于首版必需项。
6. 验证 HTTPS、下载/指南链接、移动端布局、分享卡片和 canonical；完成后才在仓库添加正式官网入口。

本轮没有进行 Cloudflare 登录、项目创建、账户检查或 DNS 操作；部署时再确认实际账号与记录。

## 5. 更新与回滚

**内容或样式更新：** Claude 修改 `site/` → 提 PR → Cloudflare 给出预览链接 → 检查内容与浏览体验 →
CI 通过、审核合并 → Pages 自动更新正式站。不需要 SSH 登录服务器或手工上传压缩包。
小改动也走这条路径，方便定位哪次更新改变了线上内容。

预览地址默认公开，`noindex` 只是防索引，不是访问控制；需要限制访问时再配置 Cloudflare Access。
不要在预览中放秘密。仅文档/App 代码变化由 watch paths 跳过网站构建；
官方文档列出的空变更或超大 push 是过滤例外，不应以路径过滤代替权限控制。

**App 新版本：** APK、`SHA256SUMS`、`build-info.json` 继续以 GitHub Release 为唯一分发来源。
官网首版下载按钮链接到 Releases 列表，不写死 APK 文件名，也不请求 GitHub API 动态拼“最新版”。
当前包含 prerelease，不能使用 `/releases/latest` 作为测试版入口。
如果以后需要一键直下，再让成功的 APK 发布流程提出网站下载清单更新 PR；首版不增加这套自动化。

**错误上线：** 在 Pages Deployments 选择此前成功的 production deployment 回滚；preview 不能作为回滚目标。
随后在 Git 中 revert 出问题的网站提交或提交修复，走正常 PR，保证仓库与下一次部署一致。
只改网页时不用重发 APK，也不要移动发布 tag 或替换历史 APK。

**成本与配额：** 根据 2026-11-06 核对的官方限制，Pages Free 为每月 500 次构建、同时 1 次构建，
最多 20,000 个文件，单文件最多 25 MiB。首版不使用 Pages Functions；域名续费独立。
当前 APK 约 103 MB，超过 Pages 单文件上限，所以安装包留在 GitHub Releases。
网站部署使用 Pages 的构建配额，不占 EAS 次数；仅网页检查使用 GitHub Actions 时才运行相应 CI。

## 6. Claude 制作时的交付与验收

交付页面、样式、必要资源及可预览链接；更新本方案中实际发生变化的部署参数，不新增真实账号或主机资料。
不要为了交付设计稿提前改 DNS。

按访客旅程验收：手机打开首页 → 看懂产品及使用前提 → 看一段场景/展示 → 打开 Releases 找到 APK →
返回页面打开安装指南 → 展开 FAQ → 找到反馈入口。桌面同样走一遍。
检查 360px 窄屏无横向滚动、200% 缩放、键盘焦点、链接名称/对比度、图片替代文本和加载失败时的可读性。
图片是真机图还是示意图必须清晰；没有真机证据的功能不能用“已实测”文案。
网站浏览验证与 App 真机验证分别记录，不相互替代。

## 7. 官方部署参考

- [部署纯静态 HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [GitHub 集成](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [构建路径过滤](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
- [预览部署](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [回滚](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- [Free 配额与限制](https://developers.cloudflare.com/pages/platform/limits/)
