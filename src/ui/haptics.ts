import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * 触觉反馈的薄封装（§5 Motion & Haptics Choreography）。
 * 全部失败都吞掉：模拟器、旧设备、没开振动权限都不该让业务逻辑报错。
 */
function run(action: () => Promise<void>): void {
  if (Platform.OS === 'web') return;
  void action().catch(() => undefined);
}

/** 轻点：发送、打开抽屉、跨越 72pt 阈值 */
export function tapFeedback(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** 柔触：正式回答开始、<think> 与连续工具组自动折叠瞬间（§5 Soft Impact） */
export function softFeedback(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
}

/** 棘轮刻度感：右侧拇指弧形焦段转盘每扫过一个会话 Title 时触发（§5 机械齿轮感） */
export function tickFeedback(): void {
  run(() => Haptics.selectionAsync());
}

/** 长按开始充能：比轻点重一点，让手指知道「按住了」 */
export function chargeStartFeedback(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** 危险操作确认完成 / 批准成功 */
export function successFeedback(): void {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** 失败/被拒绝 */
export function errorFeedback(): void {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
