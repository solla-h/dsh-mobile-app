import { Alert } from 'react-native';
import { tr } from '../../i18n';

export const MOBILE_GATEWAY_PACKAGE = 'dsh-plugin-mobile-gateway';

export function protectGatewayDisable(
  target: string,
  enabled: boolean,
  apply: () => void,
): void {
  if (target !== MOBILE_GATEWAY_PACKAGE || enabled) {
    apply();
    return;
  }

  Alert.alert(
    tr("停用移动网关"),
    tr("停用移动网关会立即断开手机连接，只能从 DSH Web 重新开启。确定继续？"),
    [
      { text: tr("取消"), style: 'cancel' },
      {
        text: tr("停用"),
        style: 'destructive',
        onPress: () => {
          apply();
          Alert.alert(tr("待重连确认"), tr("已提交停用，连接可能已中断；重连后请确认最终状态。"));
        },
      },
    ],
  );
}
