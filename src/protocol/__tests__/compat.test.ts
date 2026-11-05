import { checkGatewayCompatibility, SUPPORTED_PROTOCOL_VERSION } from '../compat';

describe('checkGatewayCompatibility', () => {
  test('passes the verified protocol', () => {
    const result = checkGatewayCompatibility({ protocol: SUPPORTED_PROTOCOL_VERSION });
    expect(result).toEqual({ protocolMismatch: false, message: null });
  });

  test('warns on a different protocol', () => {
    const result = checkGatewayCompatibility({ protocol: SUPPORTED_PROTOCOL_VERSION + 1 });
    expect(result.protocolMismatch).toBe(true);
    expect(result.message).toContain('协议');
  });

  test('does not guess when the gateway does not report a protocol', () => {
    expect(checkGatewayCompatibility({}).message).toBeNull();
  });
});
