import compatibility from '../../compatibility.json';
import { tr } from '../i18n';

/**
 * 版本绑定：App 发布时验证过的 gateway / DSH / 协议组合。
 *
 * compatibility.json 是唯一事实源。运行时这里只检查 hello.protocol；
 * 网关当前的 hello.dshVersion 是插件编译期常量（0.12.0-rdv.1 报 0.2.1-rc.2），
 * 不是宿主实际版本，不能用来判定。实际 DSH 版本由 Agent 安装前的
 * scripts/check-compat.mjs 通过 `dsh --version` 检查。
 */

export const SUPPORTED_PROTOCOL_VERSION: number = compatibility.protocol.version;

export interface GatewayCompat {
  protocolMismatch: boolean;
  message: string | null;
}

export function checkGatewayCompatibility(hello: { protocol?: number }): GatewayCompat {
  const protocolMismatch =
    typeof hello.protocol === 'number' && hello.protocol !== SUPPORTED_PROTOCOL_VERSION;
  return {
    protocolMismatch,
    message: protocolMismatch
      ? tr("网关协议 v{0} 未验证；App 验证的是 v{1}。", [hello.protocol, SUPPORTED_PROTOCOL_VERSION])
      : null,
  };
}
