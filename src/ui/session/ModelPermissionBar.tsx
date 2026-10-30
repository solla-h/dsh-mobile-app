import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  mapModelCatalog,
  mapPermissionCatalog,
  mapPermissionResult,
  mapSelectModel,
  type ModelCatalog,
  type PermissionCatalog,
  type SelectedModel,
} from '../../protocol/runtime';
import { tapFeedback } from '../haptics';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import { ActionSheet, type SheetAction } from '../ActionSheet';
import type { GatewayClient } from '../../transport/gateway-client';

/**
 * 输入框上方的运行时配置条：模型胶囊 + 权限胶囊。
 *
 * 协议（PROTOCOL.md §8/§9）：
 * - models {sessionId} → current/routable/groups（模型带 reasoning.efforts）
 * - select-model {sessionId, provider, model, reasoningEffort?}
 * - permission-options {sessionId} → options/defaultOptions/defaultPreset/sessionPermissions
 * - permission {sessionId, name} → set + 官方命令结果
 * 帧响应不带 requestId，按 kind 关联；同一时刻只有一个会话页，不会串台。
 */

interface Props {
  client: GatewayClient;
  sessionId: string;
}

export function ModelPermissionBar({ client, sessionId }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [models, setModels] = useState<ModelCatalog | null>(null);
  const [permission, setPermission] = useState<PermissionCatalog | null>(null);
  /** 单个 ActionSheet 复用：模型 → 等级/权限切换只换内容。
      Android 上两个 Modal 同帧一关一开，新的那个会被丢弃。 */
  const [sheet, setSheet] = useState<
    | null
    | { kind: 'model' }
    | { kind: 'permission' }
    | {
        kind: 'effort';
        provider: string;
        model: string;
        modelName: string;
        efforts: { id: string; name: string }[];
      }
  >(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    client.send({ type: 'models', sessionId });
    client.send({ type: 'permission-options', sessionId });
  }, [client, sessionId]);

  useEffect(() => {
    const offFrame = client.onFrame((frame) => {
      const kind = (frame as { kind?: string }).kind;
      if (kind === 'models') {
        setModels(mapModelCatalog(frame));
      } else if (kind === 'select-model') {
        const selected = mapSelectModel(frame);
        if (selected) {
          setModels((current) => (current ? { ...current, current: selected } : current));
        }
        setBusy(false);
      } else if (kind === 'permission-options') {
        setPermission(mapPermissionCatalog(frame));
      } else if (kind === 'permission') {
        const result = mapPermissionResult(frame);
        if (result?.set) {
          setPermission((current) =>
            current ? { ...current, sessionPermissions: [result.set!] } : current,
          );
        }
        setBusy(false);
      } else if (kind === 'error') {
        setBusy(false);
      }
    });
    return offFrame;
  }, [client]);

  // 挂载与重连后拉一次当前值。
  useEffect(() => {
    reload();
    const off = client.onState((state) => {
      if (state === 'ready') reload();
    });
    return off;
  }, [client, reload]);

  const selectModel = useCallback(
    (target: SelectedModel) => {
      setBusy(true);
      client.send({
        type: 'select-model',
        sessionId,
        provider: target.provider,
        model: target.model,
        ...(target.reasoningEffort ? { reasoningEffort: target.reasoningEffort } : {}),
      });
    },
    [client, sessionId],
  );

  const pickPermission = useCallback(
    (name: string) => {
      setBusy(true);
      client.send({ type: 'permission', sessionId, name });
    },
    [client, sessionId],
  );

  const current = models?.current;
  const currentPermission = permission?.sessionPermissions?.[permission.sessionPermissions.length - 1];
  const modelLabel = current ? displayModel(current.model) : null;
  /** 当前思考强度的可读名；没有指定时显示「默认」——胶囊上始终能看到强度。 */
  const effortLabel = (() => {
    if (!current) return null;
    if (!current.reasoningEffort) return '默认';
    const entry = models?.groups
      .flatMap((group) => group.models)
      .find((model) => model.id === current.model);
    return entry?.efforts.find((effort) => effort.id === current.reasoningEffort)?.name ??
      current.reasoningEffort;
  })();
  const permissionLabel =
    permission?.options.find((item) => item.value === currentPermission)?.name ?? currentPermission;

  // 模型列表拍平：label 用模型名，hint 带组名与思考等级标记。
  // 两级选择：模型列表 → 有思考等级的模型进入强度列表（同一个弹层换内容，
  // 不重开 Modal——Android 上两个 Modal 同帧一关一开，新的会被丢弃）。
  // id 用 JSON 编码，模型 id 本身可能含斜杠（deepseek-ai/DeepSeek-V4.1-Flash-1017）。
  const modelActions: SheetAction[] = (models?.groups ?? []).flatMap((group) =>
    group.models.map((model) => ({
      id: JSON.stringify([group.id, model.id]),
      label:
        (current?.provider === group.id && current?.model === model.id ? '✓ ' : '') + model.name,
      hint: [group.name, model.efforts.length > 0 ? '可选思考等级' : null]
        .filter(Boolean)
        .join(' · '),
    })),
  );
  const effortActions: SheetAction[] =
    sheet?.kind === 'effort'
      ? [
          ...sheet.efforts.map((effort) => ({
            id: effort.id,
            label: (current?.reasoningEffort === effort.id ? '✓ ' : '') + effort.name,
            hint: current?.reasoningEffort === effort.id ? '当前' : undefined,
          })),
          { id: '__default__', label: '默认等级', hint: '不指定，交给模型自己决定' },
          { id: '__back__', label: '← 返回模型列表' },
        ]
      : [];

  const permissionActions: SheetAction[] = (permission?.options ?? []).map((option) => ({
    id: option.value,
    label: (currentPermission === option.value ? '✓ ' : '') + option.name,
    hint: option.description,
  }));

  return (
    <View style={styles.bar}>
      {modelLabel ? (
        <Pressable
          style={styles.chip}
          onPress={() => {
            tapFeedback();
            setSheet({ kind: 'model' });
          }}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {modelLabel}
            {effortLabel ? ' · ' + effortLabel : ''}
          </Text>
        </Pressable>
      ) : null}
      {permissionLabel ? (
        <Pressable
          style={styles.chip}
          onPress={() => {
            tapFeedback();
            setSheet({ kind: 'permission' });
          }}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {permissionLabel}
          </Text>
        </Pressable>
      ) : null}
      {busy ? <Text style={styles.busy}>切换中…</Text> : null}

      <ActionSheet
        visible={sheet !== null}
        title={
          sheet?.kind === 'model'
            ? '切换模型'
            : sheet?.kind === 'effort'
              ? '思考等级'
              : '权限预设'
        }
        subtitle={
          sheet?.kind === 'model'
            ? models?.routable === false
              ? '当前模型目录不可路由'
              : undefined
            : sheet?.kind === 'effort'
              ? sheet.modelName + '（返回可换模型）'
              : permission?.defaultPreset
                ? '宿主默认：' + permission.defaultPreset
                : undefined
        }
        actions={
          sheet?.kind === 'model'
            ? modelActions
            : sheet?.kind === 'effort'
              ? effortActions
              : permissionActions
        }
        onPick={(id) => {
          console.log('[MPB] onPick', id, sheet ? sheet.kind : 'null');
          const active = sheet;
          if (!active) return;
          if (active.kind === 'model') {
            let provider = '';
            let modelId = '';
            try {
              [provider, modelId] = JSON.parse(id) as [string, string];
            } catch {
              return;
            }
            const model = models?.groups
              .find((group) => group.id === provider)
              ?.models.find((item) => item.id === modelId);
            if (!model) return;
            if (model.efforts.length > 0) {
              // 同一弹层内换成强度列表，不关不重开。
              setSheet({
                kind: 'effort',
                provider,
                model: modelId,
                modelName: model.name,
                efforts: model.efforts,
              });
            } else {
              setSheet(null);
              selectModel({ provider, model: modelId });
            }
          } else if (active.kind === 'effort') {
            if (id === '__back__') {
              setSheet({ kind: 'model' });
              return;
            }
            setSheet(null);
            if (id === '__default__') {
              selectModel({ provider: active.provider, model: active.model });
            } else {
              selectModel({
                provider: active.provider,
                model: active.model,
                reasoningEffort: id,
              });
            }
          } else {
            setSheet(null);
            pickPermission(id);
          }
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/**
 * 模型显示名：去掉 provider 前缀（deepseek-ai/DeepSeek-V4.1-Flash-1017 → DeepSeek-V4.1-Flash-1017）。
 * 太长时做「中间省略」（保留头尾辨识度），而不是砍掉尾部。
 */
function displayModel(model: string): string {
  const parts = model.split('/');
  const name = parts[parts.length - 1];
  if (name.length <= 26) return name;
  return name.slice(0, 16) + '…' + name.slice(-8);
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingBottom: 4,
    },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: t.bg.surface,
      maxWidth: '62%',
    },
    chipText: { color: t.text.secondary, fontSize: 10.5, fontWeight: '600' },
    busy: { color: t.text.muted, fontSize: 10 },
  });
