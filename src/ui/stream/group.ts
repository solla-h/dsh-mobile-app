import type { ChatMessage } from '../../protocol/chat';
import type { ToolEntry } from './ToolGroup';

export type StreamRow =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tools'; id: string; tools: ToolEntry[] };

/**
 * 把连续的 tool 消息合并成一组（§2.1 的「连续工具调用」）。
 * 中间夹了任何别的东西（回答、用户消息、交付文件）就断开，重新起一组。
 */
export function groupMessages(messages: ChatMessage[]): StreamRow[] {
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
