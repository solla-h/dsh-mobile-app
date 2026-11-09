import type { ChatMessage } from '../protocol/chat';

/**
 * 历史 L1 内存缓存：按 (gatewayId, sessionId) 存最近打开的 8 个会话。
 *
 * 只活在本次进程生命周期里——不做磁盘层（冷启动频率有测量后再议，见 STATUS §5 决策 5），
 * 所以不需要格式版本迁移：升级必然重启进程，缓存自然失效。
 *
 * 存的是数组引用，不拷贝：SessionScreen 里的消息更新全走不可变替换，
 * 引用即快照；写穿由 SessionScreen 的一个 effect 负责（每次 messages 变化登记一次）。
 * 缓存内容可能落后于服务端（别的端发了言），调用方负责用 mergeSnapshot 对账，不整体替换。
 * 在途工具行（output 还没到）不写入：重进时它若落在新鲜窗口之外，tool/result
 * 永远配不上对（mapHistory 只在本页内回填），会变成永远转圈的幽灵行。
 */
const MAX_SESSIONS = 8;
const store = new Map<string, ChatMessage[]>();

const keyOf = (gatewayId: string | undefined, sessionId: string): string =>
  `${gatewayId ?? ''}:${sessionId}`;

/** 读缓存；命中会刷新 LRU 年龄。取回后先进 UI，新鲜 history 回来再 mergeSnapshot 对账。 */
export function getCachedHistory(
  gatewayId: string | undefined,
  sessionId: string,
): ChatMessage[] | undefined {
  const key = keyOf(gatewayId, sessionId);
  const hit = store.get(key);
  if (!hit) return undefined;
  store.delete(key);
  store.set(key, hit);
  return hit;
}

const isRunningTool = (message: ChatMessage): boolean =>
  message.kind === 'tool' && message.output === undefined;

/** 写缓存。空数组等于删除：别把「空会话」的假象留给下次进入。 */
export function cacheHistory(
  gatewayId: string | undefined,
  sessionId: string,
  messages: ChatMessage[],
): void {
  const key = keyOf(gatewayId, sessionId);
  store.delete(key);
  // 常见路径保持零拷贝（引用入库）；只有在途工具行时才过滤一份。
  const stable = messages.some(isRunningTool) ? messages.filter((m) => !isRunningTool(m)) : messages;
  if (stable.length === 0) return;
  store.set(key, stable);
  while (store.size > MAX_SESSIONS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** 移除网关时清掉它的命名空间：这个网关的会话再也回不来了，别占着 LRU 名额。 */
export function dropCachedGateway(gatewayId: string | undefined): void {
  const prefix = `${gatewayId ?? ''}:`;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** 测试用：清空全部缓存。 */
export function clearHistoryCache(): void {
  store.clear();
}
