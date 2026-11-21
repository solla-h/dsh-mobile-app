import { Alert } from 'react-native';

import { protectGatewayDisable, MOBILE_GATEWAY_PACKAGE } from '../gateway-disable';

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('disabling the mobile gateway requires confirmation and reports reconnect status', () => {
  const apply = jest.fn();

  protectGatewayDisable(MOBILE_GATEWAY_PACKAGE, false, apply);

  expect(apply).not.toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls[0]?.[2];
  expect(buttons?.map(({ text }) => text)).toEqual(['取消', '停用']);

  buttons?.find(({ text }) => text === '停用')?.onPress?.();

  expect(apply).toHaveBeenCalledTimes(1);
  expect(jest.mocked(Alert.alert).mock.calls[1]?.[0]).toBe('待重连确认');
});

test('canceling disable preserves the gateway and other toggles are not intercepted', () => {
  const apply = jest.fn();

  protectGatewayDisable(MOBILE_GATEWAY_PACKAGE, false, apply);
  jest.mocked(Alert.alert).mock.calls[0]?.[2]?.find(({ text }) => text === '取消')?.onPress?.();
  expect(apply).not.toHaveBeenCalled();

  protectGatewayDisable('other-plugin', false, apply);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(jest.mocked(Alert.alert)).toHaveBeenCalledTimes(1);
});
