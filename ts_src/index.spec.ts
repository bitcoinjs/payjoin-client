import { requestPayjoin, requestPayjoinWithCustomRemoteCall } from './index';

describe('requestPayjoin', () => {
  it('should exist', () => {
    expect(requestPayjoin).toBeDefined();
    expect(typeof requestPayjoin).toBe('function');
    expect(requestPayjoinWithCustomRemoteCall).toBeDefined();
    expect(typeof requestPayjoinWithCustomRemoteCall).toBe('function');
  });
});
