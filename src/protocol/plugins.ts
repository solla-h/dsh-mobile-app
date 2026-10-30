/**
 * plugin-management-v1：与 DSH Web 插件页对齐的管理帧。
 *
 * 全部走 control 连接。每个请求必带连接内唯一的 requestId，响应原样带回——
 * 按 requestId 关联，不按 kind。对接细节见网关仓库
 * docs/dsh-0.2.0-rc.2-plugin-management-mobile-integration.md。
 */

export type PluginOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] };

export type PluginBundle = {
  name: string;
  version?: string;
  title?: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  installed: boolean;
  optional: boolean;
  removable: boolean;
  readOnlyReason?: string;
  error?: string;
  experimental: boolean;
};

/** Host pluginManager/listPlugins 的条目（包内或独立的插件条目）。 */
export interface PluginEntry {
  entryId: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  bundle?: string;
  error?: string;
}

/** Web 插件页的四类内置配置卡片。 */
export interface OfficialItem {
  id: string;
  namespaces: string[];
}

export interface PluginCatalog {
  managementAvailable: boolean;
  bundles: PluginBundle[];
  plugins: PluginEntry[];
  officialItems: OfficialItem[];
  settingsWritable: boolean;
}

export interface PluginRegistries {
  registry?: string | null;
  fallbackRegistries: string[];
  resolved?: unknown;
}

export interface PluginInspection {
  status: 'accepted' | 'refused' | 'unknown';
  raw: Record<string, unknown>;
}

/** Host 的 ChangeResult：所有写操作的回执。 */
export interface ChangeResult {
  application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled' | string;
  changed?: boolean;
  stage?: string;
  error?: string;
  warnings?: string[];
  pendingBuilds?: string[];
  approvedBuilds?: string[];
  raw: Record<string, unknown>;
}

/** settings namespace：schema 驱动配置表单，secrets 只显是否已设置，不回传明文。 */
export interface SettingNamespace {
  ns: string;
  writable: boolean;
  revision?: number;
  schema?: Record<string, unknown>;
  value?: unknown;
  base?: unknown;
  user?: unknown;
  secrets?: { path?: string[]; set?: boolean }[];
  error?: string;
}

export interface VersionExemption {
  packageVersion?: string;
  runtimeVersion?: string;
  enabled?: boolean;
  acceptRisk?: boolean;
}

/** plugins-changed 的 reason；收到就整体重查目录。 */
export type PluginsChangedReason = 'plugin' | 'bundle' | 'install' | 'remove' | string;

export type InstallPhase = 'installing' | 'cancelling' | 'applying' | string;

export interface InstallStateEvent {
  requestId: string;
  phase: InstallPhase;
  attempt?: { registry?: string | null; index?: number; total?: number };
}

export interface InstallLogEvent {
  requestId: string;
  jobId?: string;
  stream?: 'stdout' | 'stderr' | string;
  text?: string;
  exitCode?: number;
}

/** DSH 内置 profile 包：不进「已安装/官方」列表，和 Web 页保持一致。 */
export const BUILTIN_BUNDLES = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-sdk-minimal',
]);

/** Web 页内置配置卡片的固定顺序与中文名。 */
export const OFFICIAL_ITEM_LABELS: Record<string, string> = {
  shell: 'Shell 沙箱',
  'agent-loop': 'Agent 循环',
  subagent: '子智能体',
  'web-search': '联网搜索',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * meta.title / meta.description：文本或带 en 回退的语言映射。
 * 优先取中文，再英文，再任意一个字符串值。
 */
export function pickLocalized(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const map = asRecord(value);
  if (!map) return undefined;
  for (const key of ['zh-CN', 'zh-Hans', 'zh', 'en']) {
    const hit = map[key];
    if (typeof hit === 'string' && hit.trim()) return hit.trim();
  }
  for (const hit of Object.values(map)) {
    if (typeof hit === 'string' && hit.trim()) return hit.trim();
  }
  return undefined;
}

function mapBundle(value: unknown): PluginBundle | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.name !== 'string' || !raw.name) return null;
  const meta = asRecord(raw.meta);
  return {
    name: raw.name,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    title: pickLocalized(meta?.title),
    description: pickLocalized(meta?.description) ?? pickLocalized(raw.description),
    icon:
      typeof meta?.icon === 'string' && meta.icon.startsWith('data:image') ? meta.icon : undefined,
    enabled: raw.enabled === true,
    installed: raw.installed === true,
    optional: raw.optional === true,
    removable: raw.removable === true,
    readOnlyReason: typeof raw.readOnlyReason === 'string' ? raw.readOnlyReason : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    experimental: raw.experimental === true,
  };
}

function mapEntry(value: unknown): PluginEntry | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const entryId =
    typeof raw.entryId === 'string'
      ? raw.entryId
      : typeof raw.id === 'string'
        ? raw.id
        : undefined;
  if (!entryId) return null;
  const meta = asRecord(raw.meta);
  return {
    entryId,
    title: pickLocalized(meta?.title) ?? pickLocalized(raw.title) ?? pickLocalized(raw.name),
    description: pickLocalized(meta?.description) ?? pickLocalized(raw.description),
    enabled: raw.enabled === true,
    bundle:
      typeof raw.bundle === 'string'
        ? raw.bundle
        : typeof raw.bundleName === 'string'
          ? raw.bundleName
          : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  };
}

/** plugin-catalog 响应 → 目录模型。managementAvailable=false 时是空目录。 */
export function mapCatalog(raw: unknown): PluginCatalog | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  const bundles = (Array.isArray(frame.bundles) ? frame.bundles : [])
    .map(mapBundle)
    .filter((item): item is PluginBundle => item !== null);
  const plugins = (Array.isArray(frame.plugins) ? frame.plugins : [])
    .map(mapEntry)
    .filter((item): item is PluginEntry => item !== null);
  const officialItems = (Array.isArray(frame.officialItems) ? frame.officialItems : [])
    .map((item) => {
      const rawItem = asRecord(item);
      if (!rawItem || typeof rawItem.id !== 'string') return null;
      return {
        id: rawItem.id,
        namespaces: Array.isArray(rawItem.namespaces)
          ? rawItem.namespaces.filter((ns): ns is string => typeof ns === 'string')
          : [],
      };
    })
    .filter((item): item is OfficialItem => item !== null);
  return {
    managementAvailable: frame.managementAvailable === true,
    bundles,
    plugins,
    officialItems,
    settingsWritable: frame.settingsWritable === true,
  };
}

/**
 * 按 Web 页语义分组：排除内置 profile 包；
 * optional && !installed →「官方可选」，installed || !optional →「已安装」。
 */
export function groupBundles(bundles: PluginBundle[]): {
  installed: PluginBundle[];
  official: PluginBundle[];
} {
  const installed: PluginBundle[] = [];
  const official: PluginBundle[] = [];
  for (const bundle of bundles) {
    if (BUILTIN_BUNDLES.includes(bundle.name)) continue;
    if (bundle.optional && !bundle.installed) official.push(bundle);
    else installed.push(bundle);
  }
  return { installed, official };
}

/** 一个 bundle 名下的插件条目（entry.bundle 对应包名）。 */
export function entriesOfBundle(plugins: PluginEntry[], bundleName: string): PluginEntry[] {
  return plugins.filter((entry) => entry.bundle === bundleName);
}

/** 没挂在任何已知 bundle 下的独立条目。 */
export function standaloneEntries(plugins: PluginEntry[], bundles: PluginBundle[]): PluginEntry[] {
  const names = new Set(bundles.map((bundle) => bundle.name));
  return plugins.filter((entry) => !entry.bundle || !names.has(entry.bundle));
}

export function mapRegistries(raw: unknown): PluginRegistries | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    registry:
      typeof frame.registry === 'string'
        ? frame.registry
        : frame.registry === null
          ? null
          : undefined,
    fallbackRegistries: Array.isArray(frame.fallbackRegistries)
      ? frame.fallbackRegistries.filter((item): item is string => typeof item === 'string')
      : [],
    resolved: frame.resolved,
  };
}

export function mapInspection(raw: unknown): PluginInspection | null {
  const frame = asRecord(raw);
  const result = asRecord(frame?.result);
  if (!frame || !result) return null;
  const status =
    result.status === 'accepted' || result.status === 'refused' ? result.status : 'unknown';
  return { status, raw: result };
}

export function mapChangeResult(raw: unknown): ChangeResult | null {
  const frame = asRecord(raw);
  const result = asRecord(frame?.result) ?? {};
  return {
    application: typeof result.application === 'string' ? result.application : undefined,
    changed: result.changed === true,
    stage: typeof result.stage === 'string' ? result.stage : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
    warnings: Array.isArray(result.warnings)
      ? result.warnings.filter((item): item is string => typeof item === 'string')
      : [],
    pendingBuilds: Array.isArray(result.pendingBuilds)
      ? result.pendingBuilds.filter((item): item is string => typeof item === 'string')
      : [],
    approvedBuilds: Array.isArray(result.approvedBuilds)
      ? result.approvedBuilds.filter((item): item is string => typeof item === 'string')
      : [],
    raw: result,
  };
}

function mapNamespace(raw: unknown, ns: string): SettingNamespace {
  const rawNs = asRecord(raw) ?? {};
  const secrets = Array.isArray(rawNs.secrets)
    ? rawNs.secrets
        .map((item): { path?: string[]; set?: boolean } | null => {
          const secret = asRecord(item);
          if (!secret) return null;
          return {
            path: Array.isArray(secret.path)
              ? secret.path.filter((part): part is string => typeof part === 'string')
              : undefined,
            set: secret.set === true,
          };
        })
        .filter((item): item is { path?: string[]; set?: boolean } => item !== null)
    : [];
  return {
    ns,
    writable: rawNs.writable !== false,
    revision: typeof rawNs.revision === 'number' ? rawNs.revision : undefined,
    schema: asRecord(rawNs.schema) ?? undefined,
    value: rawNs.value,
    base: rawNs.base,
    user: rawNs.user,
    secrets,
    error: typeof rawNs.error === 'string' ? rawNs.error : undefined,
  };
}

/**
 * plugin-settings 响应：
 * - 不带 ns：返回全部 namespaces（扁平帧 writable + namespaces[]）；
 * - 带 ns：返回 namespace 视图（扁平帧 writable + namespace{...}）。
 */
export function mapSettings(
  raw: unknown,
  ns?: string,
): { writable: boolean; namespaces: SettingNamespace[] } | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  const writable = frame.writable === true;
  if (ns !== undefined) {
    return { writable, namespaces: [mapNamespace(frame.namespace, ns)] };
  }
  const list = Array.isArray(frame.namespaces) ? frame.namespaces : [];
  const namespaces = list
    .map((item) => {
      const rawNs = asRecord(item);
      return rawNs && typeof rawNs.ns === 'string' ? mapNamespace(rawNs, rawNs.ns) : null;
    })
    .filter((item): item is SettingNamespace => item !== null);
  return { writable, namespaces };
}

export function mapExemptions(
  raw: unknown,
): { exemptions: VersionExemption[]; warnings: string[] } | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    exemptions: (Array.isArray(frame.exemptions) ? frame.exemptions : []).filter(
      (item) => asRecord(item) !== null,
    ) as VersionExemption[],
    warnings: Array.isArray(frame.warnings)
      ? frame.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export function mapInstallState(raw: unknown): InstallStateEvent | null {
  const frame = asRecord(raw);
  if (!frame || typeof frame.requestId !== 'string') return null;
  const attempt = asRecord(frame.attempt);
  return {
    requestId: frame.requestId,
    phase: typeof frame.phase === 'string' ? frame.phase : 'installing',
    attempt:
      attempt && (typeof attempt.registry === 'string' || typeof attempt.index === 'number')
        ? {
            registry:
              typeof attempt.registry === 'string'
                ? attempt.registry
                : attempt.registry === null
                  ? null
                  : undefined,
            index: typeof attempt.index === 'number' ? attempt.index : undefined,
            total: typeof attempt.total === 'number' ? attempt.total : undefined,
          }
        : undefined,
  };
}

export function mapInstallLog(raw: unknown): InstallLogEvent | null {
  const frame = asRecord(raw);
  if (!frame || typeof frame.requestId !== 'string') return null;
  return {
    requestId: frame.requestId,
    jobId: typeof frame.jobId === 'string' ? frame.jobId : undefined,
    stream: typeof frame.stream === 'string' ? frame.stream : undefined,
    text: typeof frame.text === 'string' ? frame.text : undefined,
    exitCode: typeof frame.exitCode === 'number' ? frame.exitCode : undefined,
  };
}

/**
 * plugin-settings-changed 帧只带 ns 和 revision；
 * 正在编辑这个 namespace 时用它提示「远端已更新」并重读。
 */
export function mapSettingsChanged(raw: unknown): { ns: string; revision?: number } | null {
  const frame = asRecord(raw);
  if (!frame || typeof frame.ns !== 'string') return null;
  return { ns: frame.ns, revision: typeof frame.revision === 'number' ? frame.revision : undefined };
}

/** ChangeResult 的人类可读结论：开关/卸载后按 application 提示。 */
export function describeApplication(result: ChangeResult): string | null {
  switch (result.application) {
    case 'applied':
      return result.changed ? '已生效' : '无变化';
    case 'restart-required':
      return '已保存，重启 DSH Web 后生效';
    case 'overridden':
      return '已被更高优先级的配置覆盖';
    case 'failed':
      return result.error ?? '操作失败';
    case 'cancelled':
      return '已取消';
    default:
      return null;
  }
}

/**
 * schema 顶层字段列表，供配置表单渲染。
 * 只展开顶层 properties；嵌套对象/数组交给 JSON 编辑兜底。
 */
export interface SchemaField {
  path: string[];
  label: string;
  type: 'boolean' | 'string' | 'number' | 'enum' | 'json';
  enumValues?: unknown[];
  required?: boolean;
  description?: string;
  secret?: boolean;
}

export function schemaFields(namespace: SettingNamespace): SchemaField[] {
  const schema = namespace.schema ?? {};
  const props = asRecord(schema.properties);
  if (!props) {
    // 没给出 schema：整个配置节当 JSON 兜底编辑。
    return [{ path: [], label: namespace.ns, type: 'json' }];
  }
  const requiredList = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  return Object.entries(props).map(([key, raw]) => {
    const prop = asRecord(raw) ?? {};
    let type: SchemaField['type'] = 'json';
    if (Array.isArray(prop.enum)) type = 'enum';
    else if (prop.type === 'boolean') type = 'boolean';
    else if (prop.type === 'number' || prop.type === 'integer') type = 'number';
    else if (prop.type === 'string') type = 'string';
    const secret = namespace.secrets?.some(
      (item) => item.set !== undefined && item.path?.[0] === key,
    );
    return {
      path: [key],
      label: pickLocalized(prop.title) ?? key,
      type,
      enumValues: type === 'enum' && Array.isArray(prop.enum) ? prop.enum : undefined,
      required: requiredList.includes(key),
      description: pickLocalized(prop.description),
      secret: secret === true ? true : undefined,
    };
  });
}

/** 表单当前值：user 是部分覆盖层，逐层回落 value，缺省用 schema default。 */
export function currentValue(namespace: SettingNamespace, path: string[]): unknown {
  for (const layer of [namespace.user, namespace.value]) {
    let node: unknown = layer;
    for (const part of path) {
      const record = asRecord(node);
      if (!record) {
        node = undefined;
        break;
      }
      node = record[part];
    }
    if (node !== undefined) return node;
  }
  if (path.length === 1) {
    const props = asRecord(asRecord(namespace.schema)?.properties);
    const prop = asRecord(props?.[path[0]]);
    if (prop && 'default' in prop) return prop.default;
  }
  return undefined;
}
