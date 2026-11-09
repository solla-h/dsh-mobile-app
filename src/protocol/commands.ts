/**
 * 输入菜单目录（命令 + 技能）。
 * 分组、顺序、条目和交互参数全部由服务端下发，客户端只解释 ui.kind。
 */

export type CommandUiKind = 'immediate' | 'input' | 'select';

export interface CommandUi {
  kind: CommandUiKind;
  submitRequest?: string;
  submitText?: string;
  insertText?: string;
  images?: boolean;
  optionsRequest?: string;
  selectionRequest?: string;
  displayHint?: string;
  hint?: string;
}

export interface CommandItem {
  id: string;
  name: string;
  description?: string;
  source?: string;
  action?: string;
  modelInvocable?: boolean;
  ui?: CommandUi;
}

export interface CommandGroup {
  id: string;
  title: string;
  items: CommandItem[];
}

export interface CommandOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  selected?: boolean;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function mapUi(value: unknown): CommandUi | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const kind = str(raw.kind);
  if (kind !== 'immediate' && kind !== 'input' && kind !== 'select') return undefined;
  return {
    kind,
    submitRequest: str(raw.submitRequest),
    submitText: str(raw.submitText),
    insertText: str(raw.insertText),
    images: raw.images === true,
    optionsRequest: str(raw.optionsRequest),
    selectionRequest: str(raw.selectionRequest),
    displayHint: str(raw.displayHint),
    hint: str(raw.hint),
  };
}

export function mapCommandGroups(value: unknown): CommandGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: CommandGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = str(raw.id);
    if (!id || !Array.isArray(raw.items)) continue;
    const items: CommandItem[] = [];
    for (const entryItem of raw.items) {
      if (!entryItem || typeof entryItem !== 'object') continue;
      const item = entryItem as Record<string, unknown>;
      const name = str(item.name);
      if (!name) continue;
      items.push({
        id: str(item.id) ?? name,
        name,
        description: str(item.description),
        source: str(item.source),
        action: str(item.action),
        modelInvocable: item.modelInvocable !== false,
        ui: mapUi(item.ui),
      });
    }
    if (items.length) groups.push({ id, title: str(raw.title) ?? id, items });
  }
  return groups;
}

export function mapCommandOptions(value: unknown): CommandOption[] {
  if (!Array.isArray(value)) return [];
  const options: CommandOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = str(raw.id);
    if (!id) continue;
    options.push({
      id,
      label: str(raw.label) ?? id,
      detail: str(raw.detail),
      description: str(raw.description),
      selected: raw.selected === true,
    });
  }
  return options;
}

/** 按输入框里 / 之后的那一段做过滤，命中名称或描述即可。 */
export function filterCommands(groups: CommandGroup[], query: string): CommandGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const matched: CommandGroup[] = [];
  for (const group of groups) {
    const items = group.items.filter((item) =>
      (item.name + ' ' + (item.description ?? '')).toLowerCase().includes(needle),
    );
    if (items.length) matched.push({ ...group, items });
  }
  return matched;
}

/** 选中条目后要写进草稿的文本。 */
export function insertTextOf(item: CommandItem): string {
  return item.ui?.insertText ?? '/' + item.name + ' ';
}
