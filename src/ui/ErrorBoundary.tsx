import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

/**
 * 会话页的错误边界（OBS-1）：一个渲染异常只把会话页换成降级卡，
 * 不炸掉整个 App——列表、网关、已保存的会话都还在。
 * （错误边界必须是类组件，降级卡本身是函数组件，照常用主题 hook。）
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onBack: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 只记日志，不做上报；日志里带上组件栈，真机排查用。
    console.warn('[boundary] screen render failed', error, info.componentStack ?? '');
  }

  render() {
    if (this.state.error) {
      return (
        <FallbackCard
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          onBack={this.props.onBack}
        />
      );
    }
    return this.props.children;
  }
}

function FallbackCard({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>会话页出了点问题</Text>
        <Text style={styles.body} numberOfLines={4}>
          {message}
        </Text>
        <Text style={styles.hint}>其它页面不受影响。可以原地重试，或先返回会话列表。</Text>
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.retryButton]}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="重试"
          >
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="返回会话列表"
          >
            <Text style={styles.backText}>返回列表</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: t.bg.canvas,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      alignSelf: 'stretch',
      backgroundColor: t.bg.surface,
      borderRadius: 14,
      padding: 20,
      gap: 10,
    },
    title: { color: t.text.primary, fontSize: 16, fontWeight: '600' },
    body: { color: t.text.secondary, fontSize: 13, lineHeight: 19 },
    hint: { color: t.text.muted, fontSize: 12, lineHeight: 17 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
    button: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: t.action.secondaryBg,
    },
    retryButton: { backgroundColor: t.action.primaryBg },
    retryText: { color: t.action.primaryText, fontSize: 14, fontWeight: '600' },
    backText: { color: t.action.secondaryText, fontSize: 14, fontWeight: '600' },
  });
