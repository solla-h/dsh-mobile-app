import type { ChatMessage } from '../../protocol/chat';
import { toolFailed } from '../tool-format';
import type { ToolEntry } from './ToolGroup';
import { tr } from '../../i18n';

/** 活动胶囊里的一步：思考消息或一批工具调用（不会嵌套 activity）。 */
export type ActivityStep =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tools'; id: string; tools: ToolEntry[] };

export type StreamRow =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tools'; id: string; tools: ToolEntry[] }
  /**
   * 一轮里「正式回答之前」的全部思考与工具调用，收拢成一个可折叠条目。
   * 只在同一 turn 里确实出现了带正文的 assistant 后才生成——正式回答还没开始吐字时，
   * 思考/工具保持原样展开，不让用户失去实时进度。
   */
  | { kind: 'activity'; id: string; steps: ActivityStep[] };

/**
 * 活动胶囊外层的中文摘要（FLOW-1）：`思考 2 段 · 调用 Bash、Read 等 4 步 · 1 次失败`。
 *
 * 刻意不带「已思考 18s」：历史里只有工具耗时可算（tool/result.time - tool/call.time），
 * assistant 消息只有落地时间、没有思考起止，编不出可信时长（Codex 走查结论）。
 */
export function activitySummary(steps: ActivityStep[]): { label: string; failed: number } {
  let thoughts = 0;
  let toolCount = 0;
  let failed = 0;
  const names: string[] = [];
  for (const step of steps) {
    if (step.kind === 'message') {
      thoughts += 1;
      continue;
    }
    for (const tool of step.tools) {
      toolCount += 1;
      if (toolFailed(tool.name, tool.output, tool.isError)) failed += 1;
      const clean = tool.name.trim();
      if (!clean) continue;
      const pretty = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      if (!names.includes(pretty)) names.push(pretty);
    }
  }
  const parts: string[] = [];
  if (thoughts > 0) parts.push(tr("思考 {0} 段", [thoughts]));
  if (toolCount > 0) {
    parts.push(
      names.length <= 2
        ? tr("调用 {0}", [names.join('、')])
        : tr("调用 {0} 等 {1} 步", [names.slice(0, 2).join('、'), toolCount]),
    );
  }
  if (failed > 0) parts.push(tr("{0} 次失败", [failed]));
  return { label: parts.join(' · ') || tr("思考与工具调用"), failed };
}

/** 带正文的 assistant（正式回答）——空 text 的 assistant 只是 reasoning 载体。 */
function hasBody(message: ChatMessage): boolean {
  if (message.kind !== 'assistant') return false;
  // 失败轮次 text 是空的、只有 failure。这种行也必须在胶囊外面，
  // 一旦收进去，ActivityGroup 展开只画思考条，错误原因就彻底看不见了。
  return message.text.trim().length > 0 || Boolean(message.failure);
}

/**
 * 把连续的 tool 消息合并成一组（§2.1 的「连续工具调用」）。
 * 中间夹了任何别的东西（回答、用户消息、交付文件）就断开，重新起一组。
 */
export function groupMessages(
  messages: ChatMessage[],
  options?: { running?: boolean },
): StreamRow[] {
  const rows = mergeToolRuns(messages);
  return foldActivities(rows, options?.running === true);
}

function mergeToolRuns(messages: ChatMessage[]): StreamRow[] {
  const rows: StreamRow[] = [];
  let buffer: ToolEntry[] = [];

  const flush = () => {
    if (!buffer.length) return;
    rows.push({ kind: 'tools', id: `tools-${buffer[0].id}`, tools: buffer });
    buffer = [];
  };

  for (const message of messages) {
    if (message.kind === 'tool') {
      buffer.push({
        id: message.id,
        callId: message.callId,
        name: message.name,
        time: message.time,
        args: message.args,
        output: message.output,
        isError: message.isError,
        running: message.output === undefined,
      });
      continue;
    }
    flush();
    rows.push({ kind: 'message', id: message.id, message });
  }
  flush();
  return rows;
}

/**
 * 收拢「正式回答之前的思考与工具」：
 * 顺序扫描；纯 reasoning 的 assistant 与 tools 进缓冲；
 * 遇到带正文的 assistant 时把缓冲收成一条 activity（所以「正文已出现」是折叠前提）；
 * 用户消息/交付文件等打断缓冲并原样输出。
 *
 * 这样历史里的多轮 reasoning/tool 交替只剩一个胶囊，
 * 而正在跑、还没开始回答的那一轮保持原样（实时进度可见）。
 */
function foldActivities(rows: StreamRow[], running: boolean): StreamRow[] {
  const out: StreamRow[] = [];
  let pending: ActivityStep[] = [];

  const flush = () => {
    if (!pending.length) return;
    out.push({ kind: 'activity', id: `activity-${pending[0].id}`, steps: pending });
    pending = [];
  };

  for (const row of rows) {
    if (row.kind === 'tools') {
      pending.push(row);
      continue;
    }
    if (row.kind === 'message' && row.message.kind === 'assistant') {
      if (!hasBody(row.message)) {
        // 只有 reasoning 没有正文：属于本轮活动，收进缓冲。
        pending.push(row);
        continue;
      }
      // 正式回答出现：之前的活动收成一个胶囊，回答本身留在外面。
      flush();
      out.push(row);
      continue;
    }
    // 客户端的排队/发送中回显不是回合边界，只是本地乐观行。正在跑的时候拿它
    // 打断，会把还没出正文的最后一轮错误地折成胶囊，等这条排队消息被消费掉
    // 又展开回来——同一批步骤在两种形态间来回跳，key 也变，动画和振动重复触发。
    if (running && row.kind === 'message' && row.message.kind === 'queued') {
      // 缓冲原样吐出来（保持展开）再放排队行，顺序不能反。
      for (const step of pending) out.push(step);
      pending = [];
      out.push(row);
      continue;
    }
    // 用户消息 / 交付文件 / 通知等：打断本轮活动——出现打断行说明这一轮已经结束，
    // 活动收成胶囊（即使这一轮没有正文，用户也已经看过实时过程了）。
    flush();
    out.push(row);
  }
  // 尾部的活动属于最后一轮：还在跑就保持展开（实时进度不能被藏），
  // 已经结束（或没有 running 信息）就折叠。
  if (pending.length) {
    if (running) {
      for (const row of pending) out.push(row);
    } else {
      flush();
    }
  }
  return out;
}
