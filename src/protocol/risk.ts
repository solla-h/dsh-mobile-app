/**
 * 审批风险分级。
 *
 * 手机上手滑一次就可能放行 rm -rf，所以高危操作改成「长按充能」，
 * 普通补丁仍然单击秒批，不破坏单手审批的节奏。
 */
import type { PendingApproval } from './interactions';

export type RiskLevel = 'normal' | 'high';

interface Rule {
  pattern: RegExp;
  label: string;
}

const RULES: Rule[] = [
  { pattern: /\brm\s+(-[a-z]+\s+)*-[a-z]*[rf]/i, label: '递归删除' },
  // Windows / PowerShell 的等价物：Remove-Item -Recurse、del /s、rd /s 等。
  { pattern: /\b(remove-item|del|erase|rd|rmdir)\b[^\n]*(-recurse|-r\b|\/s\b)/i, label: '递归删除' },
  { pattern: /\bgit\s+push\b[^\n]*(-f\b|--force)/i, label: '强推' },
  { pattern: /\bgit\s+reset\s+--hard/i, label: '硬重置' },
  { pattern: /\bgit\s+clean\s+-[a-z]*[fd]/i, label: '清理未跟踪文件' },
  { pattern: /\b(mkfs|fdisk|parted)\b/i, label: '磁盘操作' },
  { pattern: /\b(format-volume|clear-disk|initialize-disk|diskpart)\b/i, label: '磁盘操作' },
  { pattern: /\bdd\s+if=/i, label: '裸写设备' },
  { pattern: /\bsudo\b/i, label: '提权' },
  { pattern: /\bchmod\s+(-R\s+)?777\b/i, label: '放开权限' },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, label: '删表' },
  { pattern: /\btruncate\s+table\b/i, label: '清空表' },
  { pattern: /\bdelete\s+from\s+\w+\s*(;|$)/i, label: '全表删除' },
  { pattern: /\b(kubectl|helm)\s+delete\b/i, label: '删集群资源' },
  { pattern: /\bdocker\s+(system\s+prune|rm\s+-f)/i, label: '删容器' },
  { pattern: /:\s*>\s*\/dev\/sd/i, label: '覆写磁盘' },
  { pattern: /\b(shutdown|reboot|halt|stop-computer|restart-computer)\b/i, label: '关机重启' },
];

export interface RiskVerdict {
  level: RiskLevel;
  /** 命中的危险特征，用来在按钮上解释为什么要长按 */
  labels: string[];
}

/**
 * 审批风险分级。
 *
 * 审批帧本身不带工具参数，只能由调用方从同一 callId 的工具调用里取出命令再传进来。
 * 传不进来时宁可让 UI 显示「命令不可见」，也不要把 reason 当成完整事实。
 */
export function approvalRisk(approval: PendingApproval, command?: string): RiskVerdict {
  const parts = [approval.toolName ?? '', approval.reason ?? ''];
  if (approval.displayReason) parts.push(...Object.values(approval.displayReason));
  if (command) parts.push(command);
  return assessRisk(parts.join('\n'));
}

export function assessRisk(text: string): RiskVerdict {
  const labels: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(text) && !labels.includes(rule.label)) labels.push(rule.label);
  }
  return { level: labels.length > 0 ? 'high' : 'normal', labels };
}
