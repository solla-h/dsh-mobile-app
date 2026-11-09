/**
 * 地址簿的读取与「换址」流程。
 *
 * 设计取舍（见 docs/rendezvous-design.md §7.5）：
 * - RN 的 whatwg-fetch 不支持 redirect:'error'，cache:'no-store' 只是追加时间戳，
 *   且响应体在 resolve 前已完整缓冲；所以这里只做「读后丢弃超长 body」，
 *   不假装能禁止跳转或限制内存。
 * - 所有结果在 await 之后都重新核对网关身份/key，迟到响应不能写回别的网关。
 */
import {
  decodeAddressBook,
  deriveLocator,
  pickGatewayUrl,
  type RendezvousConfig,
} from '../protocol/rendezvous';
import type { SavedGateway } from '../storage/gateway-store';

export const ADDRESS_BOOK_TIMEOUT_MS = 5_000;
export const ADDRESS_BOOK_MAX_CHARS = 8192;

type PatchGateway = (
  id: string,
  patch:
    | Partial<Omit<SavedGateway, 'id'>>
    | ((current: SavedGateway) => Partial<Omit<SavedGateway, 'id'>> | null),
) => Promise<SavedGateway | null>;

export interface UrlRefresherDeps {
  /** 调用时读取，不能用闭包快照。 */
  getSaved: () => SavedGateway | null;
  patch: PatchGateway;
  /** 写回成功后的通知（更新 App 状态/列表）。 */
  onUpdated?: (entry: SavedGateway) => void;
  fetchBook?: (config: RendezvousConfig, options?: { timeoutMs?: number }) => Promise<string | null>;
  now?: () => number;
}

export async function fetchAddressBook(
  config: RendezvousConfig,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  let path: string;
  try {
    path = deriveLocator(config.key).path;
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ADDRESS_BOOK_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/r/${path}`, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (response.status !== 200) return null;
    const body = await response.text();
    // 响应已经完整缓冲；这里只能「读后丢弃」，不是接收上限。
    if (typeof body !== 'string' || body.length > ADDRESS_BOOK_MAX_CHARS) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 返回 (gatewayId) => 现在应该连的 url。
 * 等待期间切换网关/重新配对时返回 undefined；没有可采纳的新记录时返回
 * 当前保存的 URL（调用方看到 URL 没变会 no-op）。
 */
export function createUrlRefresher(deps: UrlRefresherDeps) {
  const fetchBook = deps.fetchBook ?? fetchAddressBook;
  const now = deps.now ?? Date.now;
  const inFlight = new Map<string, Promise<string | undefined>>();

  const refresh = async (gatewayId: string): Promise<string | undefined> => {
    const before = deps.getSaved();
    if (!before || before.id !== gatewayId || !before.rendezvous) return undefined;
    const key = before.rendezvous.key;

    const body = await fetchBook(before.rendezvous);

    // 每个 await 之后确认身份没变：期间可能切网关、重新配对或删除。
    const after = deps.getSaved();
    if (!after || after.id !== gatewayId || after.rendezvous?.key !== key) return undefined;
    // 没有可采纳的新记录（Worker 不可达/损坏/rev 未推进）：把当前保存的 URL
    // 交回去。session 与 control 两条连接是各自刷新的——先完成的那条已经把
    // 新地址写进存储，后一条拿到 undefined 的话会一直卡在旧地址上，
    // 直到网关下次重发（最长 30 分钟）。URL 没变时调用方自然 no-op。
    if (!body) return after.url;

    const decoded = decodeAddressBook({ body, config: after.rendezvous, now: now() });
    if (!decoded) return after.url;
    const url = pickGatewayUrl(decoded.endpoints);
    if (!url) return after.url;

    let entry: SavedGateway | null = null;
    try {
      entry = await deps.patch(gatewayId, (current) => {
        if (!current || current.rendezvous?.key !== key) return null;
        return {
          url,
          endpoints: decoded.endpoints,
          rendezvous: { ...current.rendezvous, seenRev: decoded.rev },
        };
      });
    } catch {
      return undefined;
    }
    if (!entry) return undefined;

    deps.onUpdated?.(entry);
    return entry.url;
  };

  return (gatewayId: string): Promise<string | undefined> => {
    const existing = inFlight.get(gatewayId);
    if (existing) return existing;
    const run = refresh(gatewayId).catch(() => undefined);
    inFlight.set(gatewayId, run);
    void run.finally(() => {
      if (inFlight.get(gatewayId) === run) inFlight.delete(gatewayId);
    });
    return run;
  };
}
