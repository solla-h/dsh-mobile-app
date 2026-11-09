/**
 * 会话运行时配置：模型与思考等级、权限 preset、宿主信息、全局默认。
 *
 * 全部走 dsh-mobile-v1（PROTOCOL.md 第 8/9/10/12 章）。这些帧多为宽松结构，
 * 映射时做容错：字段缺失时保留 undefined，不猜默认值。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ---------------- 模型与思考等级 ----------------

export interface ReasoningEffort {
  id: string;
  name: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  efforts: ReasoningEffort[];
}

export interface ModelGroup {
  id: string;
  name: string;
  models: ModelEntry[];
}

export interface SelectedModel {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface ModelCatalog {
  /** 带 sessionId 查询时返回；全局目录为 null */
  current: SelectedModel | null;
  routable: boolean;
  groups: ModelGroup[];
  failures: string[];
}

function mapEffort(value: unknown): ReasoningEffort | null {
  const raw = asRecord(value);
  const id = str(raw?.id);
  if (!id) return null;
  return { id, name: str(raw?.name) ?? id };
}

function mapModel(value: unknown): ModelEntry | null {
  const raw = asRecord(value);
  const id = str(raw?.id);
  if (!id) return null;
  const reasoning = asRecord(raw?.reasoning);
  const efforts = Array.isArray(reasoning?.efforts)
    ? reasoning.efforts
        .map(mapEffort)
        .filter((item): item is ReasoningEffort => item !== null)
    : [];
  return { id, name: str(raw?.name) ?? id, efforts };
}

function mapGroup(value: unknown): ModelGroup | null {
  const raw = asRecord(value);
  const id = str(raw?.id);
  if (!id) return null;
  const models = (Array.isArray(raw?.models) ? raw!.models : [])
    .map(mapModel)
    .filter((item): item is ModelEntry => item !== null);
  return { id, name: str(raw?.name) ?? id, models };
}

/** models 响应：带 sessionId 时有 current/routable；不带时是全局目录。 */
export function mapModelCatalog(raw: unknown): ModelCatalog | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  const current = asRecord(frame.current);
  return {
    current:
      current && str(current.provider) && str(current.model)
        ? {
            provider: str(current.provider)!,
            model: str(current.model)!,
            reasoningEffort: str(current.reasoningEffort),
          }
        : null,
    routable: frame.routable !== false,
    groups: (Array.isArray(frame.groups) ? frame.groups : [])
      .map(mapGroup)
      .filter((item): item is ModelGroup => item !== null),
    failures: Array.isArray(frame.failures)
      ? frame.failures.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

/** select-model 响应：selected 为切换后的生效值。 */
export function mapSelectModel(raw: unknown): SelectedModel | null {
  const frame = asRecord(raw);
  const selected = asRecord(frame?.selected);
  if (!selected || !str(selected.provider) || !str(selected.model)) return null;
  return {
    provider: str(selected.provider)!,
    model: str(selected.model)!,
    reasoningEffort: str(selected.reasoningEffort),
  };
}

export interface ProviderInfo {
  provider: string;
  displayName?: string;
  declared?: boolean;
}

export function mapProviders(raw: unknown): ProviderInfo[] {
  const frame = asRecord(raw);
  if (!Array.isArray(frame?.providers)) return [];
  return frame!.providers
    .map((item): ProviderInfo | null => {
      const record = asRecord(item);
      const id = str(record?.provider) ?? str(record?.id);
      if (!id) return null;
      return {
        provider: id,
        displayName: str(record?.displayName) ?? str(record?.name),
        declared: record?.declared === true ? true : undefined,
      };
    })
    .filter((item): item is ProviderInfo => item !== null);
}

// ---------------- 权限 preset ----------------

export interface PermissionOption {
  value: string;
  name: string;
  description?: string;
}

export interface PermissionCatalog {
  options: PermissionOption[];
  defaultOptions: PermissionOption[];
  defaultPreset?: string;
  /** 该会话当前生效的权限名；网关不返回会话记录时为 undefined */
  sessionPermissions?: string;
}

function mapPermissionOption(value: unknown): PermissionOption | null {
  if (typeof value === 'string' && value.trim()) {
    return { value: value.trim(), name: value.trim() };
  }
  const raw = asRecord(value);
  const id = str(raw?.value) ?? str(raw?.id) ?? str(raw?.name);
  if (!id) return null;
  return {
    value: id,
    name: str(raw?.name) ?? str(raw?.label) ?? id,
    description: str(raw?.description),
  };
}

function mapPermissionList(value: unknown): PermissionOption[] {
  return Array.isArray(value)
    ? value.map(mapPermissionOption).filter((item): item is PermissionOption => item !== null)
    : [];
}

export function mapPermissionCatalog(raw: unknown): PermissionCatalog | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  // 线上 0.11.1 给的是对象 { currentValue, options, ... }（lib/index.mjs:1847
  // 把会话的 permissions projection 展开进来），会话不存在时是 null。
  const sessionPermissions = str(asRecord(frame.sessionPermissions)?.currentValue);
  return {
    options: mapPermissionList(frame.options),
    defaultOptions: mapPermissionList(frame.defaultOptions),
    defaultPreset: str(frame.defaultPreset),
    sessionPermissions,
  };
}

/** permission 响应：set 为切换后的生效权限，result 是官方命令结果。 */
export function mapPermissionResult(raw: unknown): { set?: string; ok: boolean; text?: string } | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  const result = asRecord(frame.result);
  return {
    set: str(frame.set),
    ok: result?.kind === 'success' || result === undefined,
    text: str(result?.text),
  };
}

// ---------------- 宿主信息 ----------------

export interface HostInfo {
  version?: string;
  cwd?: string;
  /** 默认模型精简版 */
  provider?: string;
  model?: string;
  attachedSessions?: number;
  canOpenPath?: boolean;
}

export function mapHost(raw: unknown): HostInfo | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    version: str(frame.version),
    cwd: str(frame.cwd),
    provider: str(frame.provider),
    model: str(frame.model),
    attachedSessions:
      typeof frame.attachedSessions === 'number' ? frame.attachedSessions : undefined,
    canOpenPath: typeof frame.canOpenPath === 'boolean' ? frame.canOpenPath : undefined,
  };
}

// ---------------- 全局默认 ----------------

export interface DefaultsInfo {
  agentPresetDefault?: string;
  permissionDefault?: string;
  permissionDefaultOptions: PermissionOption[];
  modeSelectionEnabled: boolean;
}

export function mapDefaults(raw: unknown): DefaultsInfo | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    agentPresetDefault: str(frame.agentPresetDefault),
    permissionDefault: str(frame.permissionDefault),
    permissionDefaultOptions: mapPermissionList(frame.permissionDefaultOptions),
    // 缺省视为允许（协议：字段缺失时移动端仍允许选择与保存）
    modeSelectionEnabled: frame.modeSelectionEnabled !== false,
  };
}

export interface SetDefaultResult {
  target?: string;
  value?: string;
  applied: boolean;
}

export function mapSetDefault(raw: unknown): SetDefaultResult | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    target: str(frame.target),
    value: str(frame.value),
    applied: frame.applied !== false,
  };
}
