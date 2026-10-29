# 给 Gemini 的研究提示词（首页看板 / 导航结构）

> 用法：整段复制给 Gemini（它能访问 GitHub，不能访问本地）。

```
你在做一款移动端产品的 UI/UX 设计与前端工程评审。仓库是公开的，请直接读代码，不要凭想象：

https://github.com/solla-h/dsh-mobile-app  （分支 master）

## 一、这是什么产品

DSH Mobile：Expo SDK 58 + React Native 0.88 的安卓客户端，用来连接 DeepSeek Harness（DSH）的会话：
看会话、发消息、批审批。**没有用 expo-router**，整个 App 是 `App.tsx` 里的单栈状态机
（未配对 → 会话列表 → 会话页）。

必读文件（按顺序）：

1. `docs/home-dashboard-proposal.md` —— 我写的首页看板提案，**这次要你评审的就是它**
2. `docs/protocol-coverage.md` —— 网关协议的覆盖清单（哪些能力已接、哪些没接）
3. `docs/dsh_mobile_app_product_ui_spec_v_4_0.md` —— 你上一版给的 UI 规范，已经在实现
4. `src/theme/tokens.ts` —— 双色板 token（paper / eink_slate）、字号、动效常量
5. `App.tsx` —— 现有首页（平铺会话列表）与状态机
6. `src/ui/SessionScreen.tsx` —— 会话页（三阶段流、审批坞、滚动逻辑）
7. `src/ui/nav/ArcDial.tsx` —— 右侧弧形会话转盘（最近的交互重点）
8. `src/protocol/types.ts` —— 客户端帧与 `SessionItem` 字段

## 二、已确认的事实（不要推翻，这些是读源码得到的）

- 手机端**只能**通过 `dsh-mobile-v1` 网关协议取数据。`sessions` 帧字段只有：
  `sessionId / updatedAt / running / blank / cwd / agentPreset / parentSessionId / origin / projections.values.title`。
- 网关**支持**但我们**还没接**的：`workspaces`（返回 `items[]` + `pinnedSessionIds` + `archivedSessionIds`）、
  `search`（全文搜索）、`schedule-*`（定时任务）、`permission*`（权限模式）、`models/select-model`、`context-usage`。
  详见 `docs/protocol-coverage.md`。
- 分组权威数据来自 `workspaces`（`WorkspaceView.sessionIds` 是成员关系，`title` 是项目名），
  组内排序用 `updatedAt` 降序；`cwd` 只作为旧版网关的兜底。
- 「哪个项目是展开的」这类 UI 状态协议里没有，只能本地存。
- 现有视觉语言：漫反射电纸书风（日间暖石纸 `#F4F2ED` / 夜间暖炭灰 `#252522`），
  不引入彩色、不用纯黑纯白、不使用第三方 UI 库或 Reanimated。

## 三、我们的目标与已定选择

**目标**：会话多起来之后首页要能「聚焦近期会话」，不是一个平铺列表，也不是纯文件夹树。

**已定**：

1. 首页三段式：焦点条（待审批 > 运行中 > 30 分钟内互动，最多 3 张）+ 项目分组（可折叠）+ 未分组。
2. 默认只展开最近活跃的 1 个项目组，组内默认 3 条 + 「还有 N 个」。
3. 全文搜索做成**首页标题栏的放大镜 → 居中浮层**，不做一级 tab。
4. 定时任务 / 插件**暂不做底部 tab**：先做「首页自动化入口卡 + 标题栏更多」，
   等使用频率上来再升级成两个 tab（会话 / 自动化），且进入会话后自动隐藏 tab bar。

## 四、需要你做的事

1. **先读代码再评**：指出提案里和实际代码/协议冲突的地方（例如某个字段其实拿不到、
   某个交互会和已有的右侧弧形转盘手势打架、某个尺寸在 436dp 宽的机型上放不下）。
2. **打磨信息架构**：三段式的权重、默认展开策略、焦点条的取舍（1 大 + 2 小 vs 3 行紧凑），
   以及「会话很少时」的降级形态。
3. **给可实现的规格**，不要抽象描述：
   - 每个区块的高度、内边距、字号、颜色 token 名（只能用 `tokens.ts` 里已有的，缺的请明确建议新增哪个 key）；
   - 展开/折叠、焦点卡入场、搜索浮层的动效参数（时长、曲线、是否用 LayoutAnimation / Animated）；
   - 触觉反馈的触发点（已有 `tapFeedback / softFeedback / tickFeedback / successFeedback` 四个封装）。
4. **交互细节**：组头点击/长按、组内「还有 N 个」、搜索的键盘态、断线态、空态、
   以及「运行中的会话被折叠在组里」这类边界。
5. **落地拆解**：按「协议层 → 纯函数 → 组件 → 接线」给出实现顺序，
   并标出哪些可以先做、哪些依赖还没接的协议（`workspaces` / `search`）。

## 五、硬约束（违反会直接返工）

- 不加新依赖（不要 Reanimated、不要 expo-blur、不要 UI 库）；动画只用 `Animated` + `LayoutAnimation`。
- 颜色只能来自 `src/theme/tokens.ts` 的 `PAPER` / `EINK_SLATE`，深浅两套都要成立。
- 不引入彩色边框；强调用「材质密度 + 线宽 + 反色块」，与现有转盘/审批坞一致。
- 页面是 436dp 宽 × 约 970dp 高的安卓机（1200×2670 @2.75），请按这个尺寸校验。
- 首页右侧目前**没有**弧形转盘（转盘只在会话页）；如果你建议首页也放，必须说明它和新列表滚动如何共存。

## 六、输出格式

1. 「提案 vs 代码」的冲突清单（每条给出文件与行为）
2. 修订后的信息架构 + ASCII 线框（折叠态 / 展开态 / 搜索态 / 空态）
3. 组件规格表（尺寸、token、字号、动效、触觉）
4. 实现顺序与风险
5. 仍需产品方拍板的开放问题（不超过 5 条）
```
