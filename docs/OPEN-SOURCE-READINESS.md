# 开源发布准备清单

> 记录 2026-11-05 的发布审计结果。所有条目完成并通过验收后，才把仓库状态改成
> 「public alpha / 可正式开源」。
>
> 目标版本：`v0.1.0-alpha.1`（Android 真机已验证，iOS 未验证，不上架应用商店）。

## 0. 发布门槛

- [x] 仓库任何 ref（HEAD、分支、tag、历史 blob）里都不再含真实主机名、公网 IP、
      个人路径、SSH 账号、设备标识、局域网 IP。
- [x] `LICENSE` 是 MIT，版权人是 `solla-h`；`NOTICE` 覆盖 Expo 模板来源和宠物素材的
      非商业许可。
- [x] README 不再声称「未发布 / experimental-only」，明确当前支持范围。
- [x] CI 在干净 clone 上通过：协议单测、TypeScript、lint、node 测试、expo-doctor。
- [x] 至少能按 README 的 fake-gateway 路径在本地走通一次配对和一条消息（文档 + 服务端冒烟；App 侧配对/发消息已在真实网关真机验证，见兼容表）。

## 1. P0：必须先做（阻塞发布）

### 1.1 清除敏感信息并重写历史

- [x] 审计所有 tracked 文件，列出需要替换的值（主机别名、公网 IP、域名、个人路径、
  局域网 IP、设备型号、服务账号）。
- [x] 备份所有 ref 到仓库外的 `git bundle`，并把含真实信息的内部文档另存到仓库外。
- [x] 替换 HEAD 中所有敏感值；同一批替换必须覆盖测试夹具和文档示例。
- [x] 用 `git filter-repo --replace-text` 重写所有 ref（用户已授权）。
- [x] force-push `master`（用户已授权），并核对远端历史。
- [x] 对 HEAD 和全历史做一次密钥/主机信息扫描，结果为空。
- [x] 确认 `credentials.json`、`keys/`、`*.jks`、`.env*`、`.scratch/`、`node_modules/`
      从未进入历史。

验收命令（示例，替换为你自己的扫描器）：

```bash
# 任一历史提交新增/删除了敏感串
git log --all -S'<sensitive-pattern>' --oneline
# 当前 HEAD 是否残留
git grep -nIE '<sensitive-pattern>' -- .
```

### 1.2 许可证与素材许可

- [x] `LICENSE` 改为标准 MIT 文本，版权行：
      `Copyright (c) 2026 solla-h`。
- [x] 新增 `NOTICE`：
      - Expo 模板部分仍归 Expo / 650 Industries，MIT；
      - `assets/pet/*.webp` 来自 `dsh-pet`，CC BY-NC-SA 4.0，**仅限非商业使用**；
      - 其余原创代码 MIT。
- [x] `assets/pet/README.md` 与根 README 的许可描述一致，明确「宠物素材非商业」。
- [x] `package.json` 增加 `"license": "MIT"`。
- [x] README（中英）的 License 段落链接到 `LICENSE` 和 `NOTICE`，不再只写一句 MIT。

### 1.3 版本与依赖元数据

- [x] `package.json` 版本与 `app.json` 对齐（当前前者 `1.0.0`、后者 `0.1.0`，
      统一为 `0.1.0`）。
- [x] `jest`、`@types/jest` 从 `dependencies` 移到 `devDependencies`。
- [x] 增加运行 node 测试的脚本（`scripts/__tests__`、`docs/tools` 相关）。
- [x] 确认 `private` 字段的去留：App 不上 npm，保留 `private: true` 并在 README 说明。

## 2. P1：正式发布前应有

### 2.1 CI 与供应链

- [x] `.github/workflows/ci.yml`：`npm ci` → `npm test` → `npm run typecheck` →
      `npm run lint` → node 测试 → `npx expo-doctor`。
- [x] README 顶部加 CI badge。
- [x] `.github/dependabot.yml`：npm 每周、GitHub Actions 每月。
- [x] 在 GitHub 仓库设置里启用 Dependabot security updates。
- [x] 确认 secret scanning + push protection 仍开启；如可用，开启 private vulnerability
      reporting（见 2.3）。

### 2.2 社区与安全文件

- [x] `SECURITY.md`：支持版本、漏洞报告渠道、不要公开 pairing token / 设备 token /
      Worker 写密钥 / 截图里的主机名。
- [x] `CONTRIBUTING.md`：开发环境、命令、协议层约定、真机验证方式、提 PR 前要求。
- [x] `CODE_OF_CONDUCT.md`（Contributor Covenant 2.1）。
- [x] `.github/ISSUE_TEMPLATE/bug_report.yml`、`feature_request.yml`。
- [x] `.github/PULL_REQUEST_TEMPLATE.md`（含 lint/typecheck/test 勾选项）。
- [x] 仓库设置：补 description、topics、启用 Discussions、关闭未使用的 Projects/Wiki
      或写明用途。

### 2.3 发布工程

- [x] `CHANGELOG.md` 按 Keep a Changelog 记录 `0.1.0-alpha.1`。
- [x] 打 tag `v0.1.0-alpha.1`，创建 GitHub pre-release，附源码包和已知限制。
- [x] 如果没有可公开的 APK/AAB，明确写「source-only alpha」，不要伪造安装包。
- [x] 更新 `compatibility.json` 的 `verified` 条目：DSH `0.2.1-rc.5`、gateway
      `0.12.0-rdv.3`、voice `0.2.1-rc.5`、Android 真机、配对/语音/回复已验证。
- [x] 同步更新 `docs/COMPATIBILITY.md` 的已验证矩阵和日期。
- [x] README 增加「已验证 / 未验证」矩阵（Android 真机、iOS、Expo Go、开发构建）。

### 2.4 文档与演示

- [x] README / README.zh-CN 状态从「experimental, not released」改为
      「public alpha，Android 真机已验证，iOS 未验证，不上架」。
- [x] 增加最小可复现 demo：`docs/tools/fake-gateway.mjs` 的启动、配对、发消息步骤。
- [ ] 如条件允许，加 2–3 张脱敏截图或 GIF；没有就明确写「截图待补」，不要用带真实
      主机名的图。（本次未加，截图待补）
- [x] 把内部工作文档（HANDOFF / STATUS / RISK-PATCHES / AGENTS 的宿主章节）改成
      通用工程说明，或移到私有仓库；公开仓库里不保留服务器操作细节。
- [x] 检查 `docs/AGENT-SETUP.md` 里「不要读某文档」的表述，改成「这些是开发记录，
      不是安装面」，避免公开后显得像在隐藏内容。

## 3. P2：发布后继续

- [ ] `App.tsx` 状态机拆分（当前文件过大，影响贡献者阅读）。
- [ ] 补 UI / E2E 测试（Detox 或等价方案），至少覆盖配对 → 列表 → 会话 → 发送。
- [ ] 无障碍检查（动态字体、屏幕阅读器标签、对比度）。
- [ ] i18n：当前中英混排，抽出文案表。
- [ ] iOS 真机验证；没有设备就在 README 明确写「未验证」。
- [ ] 分支保护：master 需要 PR + CI；禁止 force-push（历史重写完成后开启）。
- [ ] 评估是否把 `docs/HANDOFF.md`、`STATUS-*` 等历史记录迁到 `docs/archive/` 或私有仓库。

## 4. 本次审计发现（按严重度）

| 级别 | 发现 | 证据 | 处理 |
| --- | --- | --- | --- |
| P0 | `LICENSE` 是 Expo 模板的版权行，不是本项目 | 根 `LICENSE` | 1.2 |
| P0 | tracked 文档含真实主机别名、公网 IP、域名、个人路径、局域网 IP、设备型号 | `AGENTS.md`、`docs/HANDOFF.md`、`docs/STATUS-*`、`docs/RISK-PATCHES.md`、测试夹具 | 1.1 |
| P0 | 宠物素材是 CC BY-NC-SA 4.0，README 却只写 MIT | `assets/pet/README.md` | 1.2 |
| P0 | 上述敏感值已进入 git 历史（不只是 HEAD） | `git log -S` | 1.1 |
| P1 | 没有 CI、Dependabot、SECURITY、CONTRIBUTING、issue/PR 模板 | `.github/` 不存在 | 2.1/2.2 |
| P1 | `package.json` 版本与 `app.json` 不一致；无 license 字段；jest 在运行时依赖 | `package.json` | 1.3 |
| P1 | `compatibility.json` 的 verified 条目仍停在旧 gateway 版本 | `compatibility.json` | 2.3 |
| P1 | README 仍写「experimental / not released」，没有测试矩阵 | `README.md`、`README.zh-CN.md` | 2.4 |
| P2 | 无截图/GIF、无 CHANGELOG/tag/release | 仓库根 | 2.3/2.4 |
| P2 | `App.tsx` 过大，缺 UI/E2E 测试与无障碍/i18n | `App.tsx` | 3 |

## 5. 验收记录

| 日期 | 项 | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-11-05 | 审计 | 完成 | 本文件 |
|  | 敏感信息清理 |  |  |
|  | 历史重写 |  |  |
|  | LICENSE / NOTICE |  |  |
|  | CI |  |  |
|  | 发布 |  |  |
