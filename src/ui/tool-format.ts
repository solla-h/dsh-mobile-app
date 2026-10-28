/** 工具调用的展示层格式化：参数压成一行摘要、取 shell 命令、提取内联 diff、判断失败。 */

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
    case 'apply_patch':
    case 'patch':
      return pick('file_path') ?? pick('path') ?? pick('file') ?? '';
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

/**
 * 从 edit / write / patch 工具调用的参数或输出中提取 unified diff。
 * 如果是 {old_string, new_string}（如 edit 工具），自动合成标准 +/- diff 以便用 DiffView 渲染并支持点按行引用。
 */
export function extractToolDiff(
  name: string,
  args?: string,
  output?: string,
): { file?: string; diff: string; additions: number; deletions: number } | null {
  const parsed = parseArgs(args);
  const file =
    (parsed &&
      (typeof parsed.file_path === 'string'
        ? parsed.file_path
        : typeof parsed.path === 'string'
          ? parsed.path
          : typeof parsed.file === 'string'
            ? parsed.file
            : undefined)) ||
    undefined;

  const rawPatch =
    (parsed &&
      (typeof parsed.patch === 'string'
        ? parsed.patch
        : typeof parsed.diff === 'string'
          ? parsed.diff
          : undefined)) ||
    (output && /^(\+\+\+|---|@@|diff --git)/m.test(output) ? output : undefined);

  if (rawPatch && /^(\+\+\+|---|@@|diff --git|[+-])/m.test(rawPatch)) {
    const lines = rawPatch.split('\n');
    const additions = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const deletions = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    return { file, diff: rawPatch, additions, deletions };
  }

  // 支持 edit 工具的 old_string / new_string 合成 unified diff
  if (
    parsed &&
    typeof parsed.old_string === 'string' &&
    typeof parsed.new_string === 'string'
  ) {
    const oldLines = (parsed.old_string as string).split('\n');
    const newLines = (parsed.new_string as string).split('\n');
    const synth = [
      ...(file ? [`--- a/${file}`, `+++ b/${file}`] : []),
      '@@ -1 +1 @@',
      ...oldLines.map((l) => `-${l}`),
      ...newLines.map((l) => `+${l}`),
    ].join('\n');
    return {
      file,
      diff: synth,
      additions: newLines.length,
      deletions: oldLines.length,
    };
  }

  return null;
}

/** Host 的 isError 不反映 shell 退出码，输出末尾的 [exit code: N] 才是。 */
export function toolFailed(name: string, output: string | undefined, isError?: boolean): boolean {
  const trimmed = output?.trim();
  const exitCode = trimmed ? /\[exit code: (-?\d+)\]\s*$/.exec(trimmed) : null;
  if (isError) return true;
  return Boolean(exitCode && exitCode[1] !== '0');
}

/** 工具组折叠时的类型缩写：Read · Grep · Bash（展示前 3 个去重工具名，还原设计稿质感） */
export function toolKinds(names: string[]): string {
  const seen: string[] = [];
  for (const name of names) {
    const clean = name.trim();
    if (!clean) continue;
    const label = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
    if (!seen.includes(label)) seen.push(label);
  }
  if (seen.length <= 3) return seen.join(' · ');
  return `${seen.slice(0, 3).join(' · ')} +${seen.length - 3}`;
}
