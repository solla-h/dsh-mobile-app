/** 会话的 agent 预设（模式）。只有空白会话能改，开跑之后就锁死。 */

export interface AgentPreset {
  id: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  /** 预设本身不可用（缺模型/插件），列出来但别让点 */
  broken?: boolean;
}

export interface PresetList {
  presets: AgentPreset[];
  /** 网关是否允许在会话里切模式 */
  modeSelectionEnabled: boolean;
}

export function mapPresetList(raw: unknown): PresetList {
  const source = (raw ?? {}) as { presets?: unknown; modeSelectionEnabled?: unknown };
  const list = Array.isArray(source.presets) ? source.presets : [];
  const presets = list
    .map((item): AgentPreset | null => {
      const value = (item ?? {}) as Record<string, unknown>;
      if (typeof value.id !== 'string' || !value.id) return null;
      return {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : undefined,
        description: typeof value.description === 'string' ? value.description : undefined,
        isDefault: value.isDefault === true,
        broken: value.broken === true,
      };
    })
    .filter((item): item is AgentPreset => item !== null);
  return { presets, modeSelectionEnabled: source.modeSelectionEnabled !== false };
}

export function presetName(presets: AgentPreset[], id: string | null | undefined): string {
  if (!id) return '默认模式';
  const found = presets.find((item) => item.id === id);
  return found?.name || found?.id || id;
}
