import { Psbt } from 'bitcoinjs-lib';
import * as fetch from 'isomorphic-fetch';

export interface IPayjoinRequester {
  /**
   * @async
   * This requests the payjoin from the payjoin server
   *
   * @param {Psbt} psbt - A fully signed, finalized, and valid Psbt.
   * @return {Promise<Psbt>} The payjoin proposal Psbt.
   */
  requestPayjoin(psbt: Psbt): Promise<Psbt>;
}

export class PayjoinRequester implements IPayjoinRequester {
  constructor(private endpointUrl: string) {}

  async requestPayjoin(psbt: Psbt): Promise<Psbt> {
    if (!psbt) {
      throw new Error('Need to pass psbt');
    }

    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'text/plain',
      }),
      body: psbt.toBase64(),
    }).catch(
      (v: Error): Response =>
        ({
          ok: false,
          async text(): Promise<string> {
            return v.message;
          },
        } as any),
    );
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(responseText);
    }

    return Psbt.fromBase64(responseText);
  }
}
