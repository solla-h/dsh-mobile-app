import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * 触觉反馈的薄封装。
 * 全部失败都吞掉：模拟器、旧设备、没开振动权限都不该让业务逻辑报错。
 */
function run(action: () => Promise<void>): void {
  if (Platform.OS === 'web') return;
  void action().catch(() => undefined);
}

/** 轻点：发送、打开菜单 */
export function tapFeedback(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** 长按开始充能：比轻点重一点，让手指知道「按住了」 */
export function chargeStartFeedback(): void {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** 危险操作确认完成 */
export function successFeedback(): void {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** 失败/被拒绝 */
export function errorFeedback(): void {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
