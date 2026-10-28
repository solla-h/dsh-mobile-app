/** 工具调用的展示层格式化：参数压成一行摘要、取 shell 命令、判断失败。 */

export function parseArgs(args?: string): Record<string, any> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 把工具参数压成一行人类可读的摘要。 */
export function describeTool(name: string, args?: string): string {
  const parsed = parseArgs(args);
  if (!parsed) return (args ?? '').replace(/\s+/g, ' ').slice(0, 160);
  const pick = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : undefined);
  switch (name) {
    case 'bash':
    case 'shell':
      return pick('description') ?? pick('command')?.split('\n')[0] ?? '';
    case 'read':
    case 'write':
    case 'edit':
      return pick('file_path') ?? pick('path') ?? '';
    case 'grep':
      return `/${pick('pattern') ?? ''}/ ${pick('path') ?? ''}`.trim();
    case 'glob':
      return pick('pattern') ?? '';
    default: {
      const first = Object.values(parsed).find((value) => typeof value === 'string');
      return typeof first === 'string' ? first.slice(0, 120) : '';
    }
  }
}

export function toolCommand(name: string, args?: string): string | undefined {
  if (name !== 'bash' && name !== 'shell') return undefined;
  const parsed = parseArgs(args);
  const command = parsed?.command;
  return typeof command === 'string' ? command.trim() : undefined;
}

/** Host 的 isError 不反映 shell 退出码，输出末尾的 [exit code: N] 才是。 */
export function toolFailed(name: string, output: string | undefined, isError?: boolean): boolean {
  const trimmed = output?.trim();
  const exitCode = trimmed ? /\[exit code: (-?\d+)\]\s*$/.exec(trimmed) : null;
  if (isError) return true;
  return Boolean(exitCode && exitCode[1] !== '0');
}

/** 工具组折叠时的类型缩写：BASH · READ · GREP */
export function toolKinds(names: string[]): string {
  const seen: string[] = [];
  for (const name of names) {
    const label = name.toUpperCase();
    if (!seen.includes(label)) seen.push(label);
  }
  // 胶囊只有一行：只报第一个名字，其余折成 +N，别让长名字把计数挤掉。
  if (seen.length <= 1) return seen.join('');
  return `${seen[0]} +${seen.length - 1}`;
}
