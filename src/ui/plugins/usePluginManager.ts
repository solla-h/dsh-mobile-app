import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mapCatalog,
  mapChangeResult,
  mapExemptions,
  mapInspection,
  mapInstallLog,
  mapInstallState,
  mapRegistries,
  mapSettings,
  mapSettingsChanged,
  type ChangeResult,
  type InstallLogEvent,
  type InstallPhase,
  type PluginCatalog,
  type PluginInspection,
  type PluginOp,
  type PluginRegistries,
  type SettingNamespace,
  type VersionExemption,
} from '../../protocol/plugins';
import type { GatewayClient } from '../../transport/gateway-client';

/**
 * 插件管理的请求-响应关联与推送处理。
 *
 * 协议约定：每个请求必带连接内唯一 requestId，响应原样带回；
 * 安装期间网关会推 plugin-install-state / plugin-install-log（只发给发起安装的连接）；
 * plugins-changed / plugin-settings-changed 是全局推送，收到后刷新目录或标记配置过期。
 */

/** 日志行数上限：输出是不可信文本，按文档要求限制内存。 */
const MAX_LOG_LINES = 200;
const QUERY_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 300_000;

type ResponseFrame = Record<string, unknown>;

export interface InstallProgress {
  requestId: string;
  phase: InstallPhase;
  attempt?: { registry?: string | null; index?: number; total?: number };
  logs: InstallLogEvent[];
  finishedAt?: number;
}

export interface PluginManager {
  catalog: PluginCatalog | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** 发送任意插件请求并等响应帧（已按 requestId 关联）。 */
  request: (type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<ResponseFrame>;
  toggleBundle: (name: string, enabled: boolean) => Promise<ChangeResult>;
  toggleEntry: (entryId: string, enabled: boolean) => Promise<ChangeResult>;
  removeBundle: (name: string) => Promise<ChangeResult>;
  registries: () => Promise<PluginRegistries>;
  inspect: (spec: string, registry?: string | null) => Promise<PluginInspection>;
  install: (spec: string, options?: { enabled?: boolean; registry?: string | null; approvedBuilds?: string[] }) => Promise<ChangeResult>;
  cancelInstall: (installId: string) => Promise<ChangeResult>;
  installStatus: (installId: string) => Promise<ChangeResult | null>;
  loadSettings: (ns?: string) => Promise<SettingNamespace[]>;
  saveSettings: (ns: string, expectedRevision: number, ops: PluginOp[]) => Promise<SettingNamespace[]>;
  exemptions: () => Promise<VersionExemption[]>;
  setExemption: (packageVersion: string, runtimeVersion: string, enabled: boolean, acceptRisk?: boolean) => Promise<ChangeResult>;
  /** 进行中/刚结束的安装进度。 */
  installProgress: InstallProgress | null;
  clearInstallProgress: () => void;
  /** 正在编辑的 namespace 在远端被改过（含 ns + revision）。 */
  settingsChanged: { ns: string; revision?: number } | null;
  clearSettingsChanged: () => void;
}

interface PendingEntry {
  requestType: string;
  resolve: (frame: ResponseFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 提取响应帧的 result 字段（非扁平帧是 {result: ...} 包一层）。 */
function resultOf(frame: ResponseFrame): unknown {
  return frame.result;
}

export function usePluginManager(control: GatewayClient, active: boolean): PluginManager {
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [settingsChanged, setSettingsChanged] = useState<{ ns: string; revision?: number } | null>(null);

  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());
  const refreshRef = useRef<() => void>(() => undefined);

  const request = useCallback(
    (type: string, params: Record<string, unknown> = {}, timeoutMs = QUERY_TIMEOUT_MS) =>
      new Promise<ResponseFrame>((resolve, reject) => {
        const requestId = randomUUID();
        const entry: PendingEntry = {
          requestType: type,
          resolve,
          reject,
          timer: setTimeout(() => {
            pendingRef.current.delete(requestId);
            reject(new Error(type + ' 超时'));
          }, timeoutMs),
        };
        pendingRef.current.set(requestId, entry);
        const sent = control.send({ type, requestId, ...params } as never);
        if (!sent) {
          clearTimeout(entry.timer);
          pendingRef.current.delete(requestId);
          reject(new Error('网关未连接'));
        }
      }),
    [control],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const frame = await request('plugin-catalog');
      const mapped = mapCatalog(frame);
      if (!mapped) throw new Error('目录响应格式异常');
      setCatalog(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    refreshRef.current = () => void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active) return undefined;
    const offFrame = control.onFrame((raw) => {
      const frame = raw as unknown as ResponseFrame;
      const kind = typeof frame.kind === 'string' ? frame.kind : '';
      const requestId = typeof frame.requestId === 'string' ? frame.requestId : undefined;

      // 1) 请求-响应关联：error 与成功帧都回显 requestId。
      if (requestId) {
        const pending = pendingRef.current.get(requestId);
        if (pending) {
          pendingRef.current.delete(requestId);
          clearTimeout(pending.timer);
          if (kind === 'error') {
            pending.reject(new Error(typeof frame.message === 'string' ? frame.message : String(frame.code)));
          } else {
            pending.resolve(frame);
          }
          return;
        }
      }

      // 2) 安装进度（只发给发起安装的连接）。
      if (kind === 'plugin-install-state') {
        const state = mapInstallState(frame);
        if (state) {
          setInstallProgress((current) => ({
            requestId: state.requestId,
            phase: state.phase,
            attempt: state.attempt,
            logs: current?.requestId === state.requestId ? current.logs : [],
          }));
        }
        return;
      }
      if (kind === 'plugin-install-log') {
        const log = mapInstallLog(frame);
        if (log) {
          // 输出是不可信文本：限制行数，超出丢最旧的。
          setInstallProgress((current) => {
            if (!current || current.requestId !== log.requestId) return current;
            return { ...current, logs: [...current.logs, log].slice(-MAX_LOG_LINES) };
          });
        }
        return;
      }

      // 3) 全局推送。
      if (kind === 'plugins-changed') {
        refreshRef.current();
        return;
      }
      if (kind === 'plugin-settings-changed') {
        const changed = mapSettingsChanged(frame);
        if (changed) setSettingsChanged(changed);
      }
    });
    return offFrame;
  }, [control, active]);

  // tab 挂载或 control 重连成功时拉目录；延后一拍触发，避免渲染级联。
  useEffect(() => {
    if (!active) return undefined;
    const kick = setTimeout(() => refreshRef.current(), 0);
    const offState = control.onState((state) => {
      if (state === 'ready') refreshRef.current();
    });
    return () => {
      clearTimeout(kick);
      offState();
    };
  }, [control, active]);

  const wrapResult = useCallback(
    (frame: ResponseFrame): ChangeResult => {
      const mapped = mapChangeResult({ result: resultOf(frame) });
      if (!mapped) throw new Error('响应缺少 result');
      return mapped;
    },
    [],
  );

  const toggleBundle = useCallback(
    (name: string, enabled: boolean) =>
      request('plugin-bundle-set-enabled', { name, enabled }, WRITE_TIMEOUT_MS).then(wrapResult),
    [request, wrapResult],
  );

  const toggleEntry = useCallback(
    (entryId: string, enabled: boolean) =>
      request('plugin-entry-set-enabled', { entryId, enabled }, WRITE_TIMEOUT_MS).then(wrapResult),
    [request, wrapResult],
  );

  const removeBundle = useCallback(
    (name: string) => request('plugin-remove', { name }, WRITE_TIMEOUT_MS).then(wrapResult),
    [request, wrapResult],
  );

  const registries = useCallback(async () => {
    const frame = await request('plugin-registries');
    const mapped = mapRegistries(frame);
    if (!mapped) throw new Error('registry 响应格式异常');
    return mapped;
  }, [request]);

  const inspect = useCallback(
    async (spec: string, registry?: string | null) => {
      const params = registry === undefined ? { spec } : { spec, registry };
      const frame = await request('plugin-inspect', params, WRITE_TIMEOUT_MS);
      const mapped = mapInspection(frame);
      if (!mapped) throw new Error('检查响应格式异常');
      return mapped;
    },
    [request],
  );

  const install = useCallback(
    (spec: string, options: { enabled?: boolean; registry?: string | null; approvedBuilds?: string[] } = {}) => {
      const params: Record<string, unknown> = { spec };
      if (options.enabled !== undefined) params.enabled = options.enabled;
      if (options.registry !== undefined) params.registry = options.registry;
      if (options.approvedBuilds !== undefined) params.approvedBuilds = options.approvedBuilds;
      setInstallProgress({ requestId: '', phase: 'installing', logs: [] });
      return request('plugin-install', params, INSTALL_TIMEOUT_MS).then(
        (frame) => {
          const result = wrapResult(frame);
          setInstallProgress((current) => (current ? { ...current, finishedAt: Date.now() } : current));
          return result;
        },
        (err) => {
          setInstallProgress((current) => (current ? { ...current, finishedAt: Date.now() } : current));
          throw err;
        },
      );
    },
    [request, wrapResult],
  );

  const cancelInstall = useCallback(
    (installId: string) =>
      request('plugin-install-cancel', { installId }, WRITE_TIMEOUT_MS).then(wrapResult),
    [request, wrapResult],
  );

  const installStatus = useCallback(
    async (installId: string) => {
      const frame = await request('plugin-install-status', { installId }, WRITE_TIMEOUT_MS);
      return resultOf(frame) === null ? null : wrapResult(frame);
    },
    [request, wrapResult],
  );

  const loadSettings = useCallback(
    async (ns?: string) => {
      const frame = ns === undefined ? await request('plugin-settings') : await request('plugin-settings', { ns });
      const mapped = mapSettings(frame, ns);
      if (!mapped) throw new Error('配置响应格式异常');
      return mapped.namespaces;
    },
    [request],
  );

  const saveSettings = useCallback(
    async (ns: string, expectedRevision: number, ops: PluginOp[]) => {
      const frame = await request(
        'plugin-settings-mutate',
        { ns, expectedRevision, ops },
        WRITE_TIMEOUT_MS,
      );
      const mapped = mapSettings(frame, ns);
      if (!mapped || mapped.namespaces.length === 0) throw new Error('保存响应格式异常');
      setSettingsChanged(null);
      return mapped.namespaces;
    },
    [request],
  );

  const exemptions = useCallback(async () => {
    const frame = await request('plugin-version-exemptions');
    const mapped = mapExemptions(frame);
    if (!mapped) throw new Error('豁免响应格式异常');
    return mapped.exemptions;
  }, [request]);

  const setExemption = useCallback(
    (packageVersion: string, runtimeVersion: string, enabled: boolean, acceptRisk?: boolean) => {
      const params: Record<string, unknown> = { packageVersion, runtimeVersion, enabled };
      if (acceptRisk !== undefined) params.acceptRisk = acceptRisk;
      return request('plugin-version-exemption-set', params, WRITE_TIMEOUT_MS).then(wrapResult);
    },
    [request, wrapResult],
  );

  return {
    catalog,
    loading,
    error,
    refresh,
    request,
    toggleBundle,
    toggleEntry,
    removeBundle,
    registries,
    inspect,
    install,
    cancelInstall,
    installStatus,
    loadSettings,
    saveSettings,
    exemptions,
    setExemption,
    installProgress,
    clearInstallProgress: () => setInstallProgress(null),
    settingsChanged,
    clearSettingsChanged: () => setSettingsChanged(null),
  };
}
