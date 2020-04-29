import { PayjoinRequester } from '../ts_src/request';
import fetchMock from 'jest-fetch-mock';
import * as bitcoin from 'bitcoinjs-lib';
import { default as VECTORS } from './fixtures/client.fixtures';
const PSBTTEXT = VECTORS.valid[0].p2wpkh.wallet;

describe('payjoin requester', () => {
  beforeEach(() => {
    // if you have an existing `beforeEach` just add the following line to it
    fetchMock.doMock();
  });
  it('should fetch a psbt', async () => {
    fetchMock.mockResponseOnce(PSBTTEXT);
    const requester = new PayjoinRequester('http://127.0.0.1:12345/1234');
    const response = await requester.requestPayjoin(
      bitcoin.Psbt.fromBase64(PSBTTEXT),
    );
    expect(response.toBase64()).toEqual(PSBTTEXT);
    // @ts-ignore
    await expect(requester.requestPayjoin()).rejects.toThrowError(
      /Need to pass psbt/,
    );
    fetchMock.mockRejectOnce(new Error('failed you noob'));
    await expect(
      requester.requestPayjoin(bitcoin.Psbt.fromBase64(PSBTTEXT)),
    ).rejects.toThrowError(/failed you noob/);
  });
});
