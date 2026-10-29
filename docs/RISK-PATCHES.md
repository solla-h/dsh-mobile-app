# 风险补丁与修复清单（非标准状态）

> 这份文档只记「服务器/依赖被我们手工改过、升级时可能崩」的地方。
> 不记普通代码变更（那些看 git log）。
> 最后更新：2026-10-29

服务器：`chuncheon-from0632`（aarch64 / 2 核 / 12G），dsh-web 由 systemd 托管，
用户 `dsh`，profile 为 `web`。

---

## 1. 语音插件跨 rc 强制豁免（2026-10-29 新增，风险最高）

### 是什么

官方语音包 `@deepseek-ai/dsh-experimental-voice-input-bundle@0.1.7-alpha.1` 声明依赖
`@deepseek-ai/dsh-settings@^0.1.7-alpha.1` 等，而线上 DSH 是 `0.2.1-rc.3`。
DSH 的加载器默认会**把不满足版本约束的插件行整行禁用**，语音因此不可用。

我们用「exact-version 豁免」强行放行了 **4 个包**：

```bash
dsh plugin --profile web allow-version @deepseek-ai/dsh-experimental-speech-to-text@0.1.7-alpha.1 --dsh-version 0.2.1-rc.3 --accept-risk
dsh plugin --profile web allow-version @deepseek-ai/dsh-experimental-speech-to-text-sensevoice@0.1.7-alpha.1 --dsh-version 0.2.1-rc.3 --accept-risk
dsh plugin --profile web allow-version @deepseek-ai/dsh-experimental-api-speech-to-text@0.1.7-alpha.1 --dsh-version 0.2.1-rc.3 --accept-risk
dsh plugin --profile web allow-version @deepseek-ai/dsh-experimental-client-ui-voice-input@0.1.7-alpha.1 --dsh-version 0.2.1-rc.3 --accept-risk
```

### 写在哪

| 内容 | 路径 |
| --- | --- |
| 豁免记录 | `/home/dsh/.dsh/profiles/web/compatibility.json` |
| 依赖声明 + bundle 顺序 | `/home/dsh/.dsh/profiles/web/package.json`（`dependencies` 和 `dsh.profile.bundles`） |
| 锁文件 | `/home/dsh/.dsh/profiles/web/pnpm-lock.yaml` |
| 模型（约 1 GB） | `/home/dsh/.dsh/speech-to-text/` |

### 坏了会怎样

- **症状 A**：App 里语音入口显示「语音还没就绪」；`speech-catalog` 返回 `available:false`。
  日志里会有 `disabling profile plugin row ... incompatible with dsh 0.2.1-rc.3`。
- **症状 B**：dsh-web 起不来，或起来后 `/mgw/pair` 不返回 201。
- **症状 C**：转写报 `speech/unavailable` 或 `speech/invalid-response`（跨版本 API 变了）。

### 怎么查

```bash
ssh chuncheon-from0632
systemctl is-active dsh-web
sudo journalctl -u dsh-web --since "5 min ago" | grep -iE "disabling|speech|voice|error"
sudo cat /home/dsh/.dsh/profiles/web/compatibility.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3080/mgw/pair \
  -H "content-type: application/json" -d "{}"        # 期望 201
```

### 怎么修

1. 版本对不上但包还在 → 重新发一次上面的 4 条 `allow-version`（DSH 版本变了要换 `--dsh-version`）。
2. 包被删了 → `dsh plugin --profile web add @deepseek-ai/dsh-experimental-voice-input-bundle@0.1.7-alpha.1`，
   再把名字加回 `package.json` 的 `dsh.profile.bundles`（**只装不加 bundle 不会加载**）。
3. 模型丢了 → 连上网关发 `{"type":"speech-prepare","providerId":"sensevoice-local"}`，会重新下载。

### 怎么彻底回滚

```bash
sudo -u dsh env HOME=/home/dsh bash -lc \
  "cd /home/dsh/.dsh/profiles/web && dsh plugin --profile web remove @deepseek-ai/dsh-experimental-voice-input-bundle"
# 再从 package.json 的 dsh.profile.bundles 里删掉那一行，然后
sudo systemctl restart dsh-web
```

回滚后 App 的语音入口自动变成「语音未就绪」，其余功能不受影响（`speech-catalog` 会回 `available:false`）。

### 升级 DSH 时

**先看这条**。官方语音包一旦发布 0.2.x 版本，优先升级到官方兼容版并删掉这 4 条豁免，
不要带着豁免跨版本跑。备份在 `/tmp/web-package.json.bak`、`/tmp/web-lock.bak`（临时目录，重启机器会没）。

---

## 2. profile 的 load patch：审批策略改成 ask（2026-10-28）

### 是什么

`/home/dsh/.dsh/profiles/web/cordis.patch.yml` 里手工加了审批策略覆盖：

```yaml
- id: approval
  config:
    policy: ask
```

默认策略是 `workspace-write`，会自动放行工作区内写操作，手机上根本看不到审批。
改成 `ask` 之后越权写、危险命令才会真的弹审批——**这是能测审批 UI 的前提**。

### 备份

同目录下有历史备份：`cordis.patch.yml.bak-2026-10-23-0821`、
`cordis.patch.yml.bak-2026-10-23-1035`、`cordis.patch.yml.bak-20261028-0758`。

### 坏了会怎样

- 审批不再弹出（策略被覆盖回 `workspace-write`）；
- 或者 dsh-web 起不来（YAML 写坏）。

### 怎么查

```bash
sudo grep -n "approval" -A 3 /home/dsh/.dsh/profiles/web/cordis.patch.yml
sudo journalctl -u dsh-web --since "5 min ago" | grep -i "patch\|yaml\|approval"
```

### 怎么修

拿最近的 `.bak-*` 对比或还原，然后 `sudo systemctl restart dsh-web`。

---

## 3. 网关 npm 包与源码仓库的分叉

线上装的是 npm 的 `dsh-plugin-mobile-gateway@0.11.1`；上游 `main` 已经比发布版多若干提交
（浏览器设备子协议、locale 等）。**「源码里有」不等于「线上跑着」**。

### 怎么查

```bash
# 线上版本
sudo grep '"version"' /home/dsh/.dsh/profiles/web/node_modules/dsh-plugin-mobile-gateway/package.json
# 与本地 clone 对比
cd D:/workspace/open_source/dsh-plugin-mobile-gateway && git log --oneline -1
```

### 怎么修

以 npm 包为准。要确认某个能力是否真的落地，`npm pack dsh-plugin-mobile-gateway@<线上版本>` 解开对比，
不要拿仓库 main 当线上行为写代码。

---

## 4. 本轮做过但已经回滚的事（留档，避免重复踩）

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-10-29 | 直接安装语音包（未豁免） | DSH 禁用 4 个插件行，已完整回滚并重启 |
| 2026-10-29 | 重新安装 + 4 条 allow-version | 成功，`speech-catalog.available=true`，模型 ready |
| 2026-10-29 | 用合成 1s WAV 冒烟 | `speech-transcript` 正常返回，推理 12 ms |

## 5. 一句话检查清单（出问题时按顺序看）

1. `systemctl is-active dsh-web` —— 服务活着吗
2. `journalctl -u dsh-web --since "10 min ago" | grep -iE "disabling|error"` —— 有插件被禁吗
3. `curl POST /mgw/pair` 返回 201 吗 —— 网关本身能不能用
4. `compatibility.json` 里的豁免还在吗 —— 语音相关
5. `cordis.patch.yml` 里 approval 还在吗 —— 审批相关
