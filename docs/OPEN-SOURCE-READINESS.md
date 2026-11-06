# 发布与验证状态

DSH Mobile 当前是 **Android public alpha**。下载入口是
[GitHub Releases](https://github.com/solla-h/dsh-mobile-app/releases)。
支持的宿主与插件组合以 [`compatibility.json`](../compatibility.json) 和
[兼容记录](COMPATIBILITY.md) 为准。

## 已发布版本

[`v0.1.0-alpha.4`](https://github.com/solla-h/dsh-mobile-app/releases/tag/v0.1.0-alpha.4)
提供签名 APK、`SHA256SUMS` 和 `build-info.json`。
[发布运行](https://github.com/solla-h/dsh-mobile-app/actions/runs/42261625299)
完成原生构建、签名、签名产物的完整模拟器旅程和附件上传。发布后独立下载的文件哈希、APK 密码学签名、
包名与版本校验通过，Android versionCode 为 4，包含 arm64-v8a、armeabi-v7a、x86 和 x86_64。

`alpha.4` 修复了 `alpha.3` 阻止私有网络 `ws://` 连接的 Android 配置。已检查下载 APK 的 Manifest，
并由 Android 模拟器通过实际原生 WebSocket 完成旅程；客户端仍拒绝公网明文网关地址。
上述结论属于源码/产物/自动化确认，尚非新 APK 的真机实测。

官方 APK 使用 GitHub Ubuntu runner、Expo prebuild 和 Gradle 构建，不使用 EAS 云构建配额。
发布 tag 必须来自已合入 `master` 的提交，已发布 tag 和附件不替换。操作流程见[发布手册](RELEASING.md)。

## 工程保障

| 项目 | 当前状态 |
| --- | --- |
| 许可证 | 原创代码 MIT；宠物素材保留 CC BY-NC-SA 4.0 非商业限制，见 [NOTICE](../NOTICE) |
| 贡献与安全入口 | [贡献指南](../CONTRIBUTING.md)、[安全报告](../SECURITY.md)、issue/PR 模板已提供 |
| 主分支保护 | 必须经 PR，要求 GitHub Actions 的 `test` 通过且分支为最新；禁止 force-push 和删除，管理员也受保护 |
| 代码组织 | 配对、列表、重命名和样式已从 `App.tsx` 提取；连接、导航和全局状态继续集中协调 |
| UI 集成测试 | 真实 App 的配对→列表→会话→收发→返回，以及离线冷启动/草稿保留旅程 |
| 无障碍基础 | 主要操作名称/角色/状态、会话自定义操作、转盘调整动作；文字和相机覆盖层对比度回归检查 |
| 原生 Android 旅程 | [PR 测试 APK](https://github.com/solla-h/dsh-mobile-app/actions/runs/42258377358)与[正式签名 APK](https://github.com/solla-h/dsh-mobile-app/actions/runs/42261625299)均已通过：配对、列表/历史、收发、返回、重启后保留配对 |
| 固定版本安装 | [Linux / Windows 安装 CI](https://github.com/solla-h/dsh-mobile-app/actions/runs/42273169756)通过：实际安装固定 DSH、网关，校验来源与版本，再次执行安装；不覆盖 Web 模型配置、隧道、语音或手机连接 |
| 网关维护 | [维护规范](GATEWAY-MAINTENANCE.md)、双仓库 Agent 入口和网关主分支保护已落实；[网关源码与打包安装 CI](https://github.com/solla-h/dsh-plugin-mobile-gateway/actions/runs/42273457988)通过（可选 libdatachannel 互操作检查跳过） |
| 官网 | [fatwhale.app](https://fatwhale.app) 的中英文页面可访问，下载与安装文档入口已核对；由[独立仓库](https://github.com/solla-h/dsh-mobile-site)维护，APK 发布不依赖网站部署 |
| 文档 | 当前使用、安装、兼容、开发、设计与发布说明；原始讨论、状态日记和过期设计草稿不作为当前文档保留 |

单维护者模式不要求另一位维护者批准 PR，但 PR、CI 与对话处理规则仍生效。
本地合并检查已通过：35 个 Jest suites / 341 个测试、Node 脚本测试、签名脚本回归、typecheck、lint、
expo-doctor（20/20）和工作流语法检查。远端结果以
[Actions](https://github.com/solla-h/dsh-mobile-app/actions) 为准。

## 证据边界与待验证项

- **源码/测试确认：** 上述单元与 UI 集成测试；Android 14 模拟器中，编译后的测试 APK 完成了本地合成网关旅程，
  截图、JUnit 与网关事件记录均已核对。该证据不覆盖生产网关、真实网络切换、语音/相机或实体设备手势。
- **真机实测：** 较早的 Android 16 preview 构建验证过配对、会话列表、文字回复和按住说话；
  具体组合见兼容记录。该结果不自动覆盖 `alpha.4` 或后续 APK。
- **尚未验证：** 新 APK 的覆盖安装与配对保留、真实语音/相机、TalkBack 遍历、200% 系统字号、
  单手操作与真实网络切换。固定几何的转盘文字仍有局部字号上限。

完整验收应从打开 App 开始，覆盖成功、失败、取消、返回、后台恢复和重新打开；记录心流中断、
拇指动线与操作复杂度，见[开发与验证](DEVELOPMENT.md)。未附真实测试证据的能力不标记完成。

## 暂缓范围

- App 全面 i18n 和 iOS 版本暂缓；中文主页与英文 README 继续同步维护。
- 当前没有应用商店版本。

本页记录当前可核验状态，不是内部讨论记录或未来功能承诺。
