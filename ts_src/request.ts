import { Psbt } from 'bitcoinjs-lib';

/**
 * Handle known errors and return a generic message for unkonw errors.
 *
 * This prevents people integrating this library introducing an accidental
 * phishing vulnerability in their app by displaying a server generated
 * messages in their UI.
 *
 * We still expose the error code so custom handling of specific or unknown
 * error codes can still be added in the app.
 */
export class PayjoinEndpointError extends Error {
  static messageMap: { [key: string]: string } = {
    'leaking-data':
      'Key path information or GlobalXPubs should not be included in the original PSBT.',
    'psbt-not-finalized': 'The original PSBT must be finalized.',
    unavailable: 'The payjoin endpoint is not available for now.',
    'out-of-utxos':
      'The receiver does not have any UTXO to contribute in a payjoin proposal.',
    'not-enough-money':
      'The receiver added some inputs but could not bump the fee of the payjoin proposal.',
    'insane-psbt': 'Some consistency check on the PSBT failed.',
    'version-unsupported': 'This version of payjoin is not supported.',
    'need-utxo-information': 'The witness UTXO or non witness UTXO is missing.',
    'invalid-transaction': 'The original transaction is invalid for payjoin.',
  };

  static codeToMessage(code: string): string {
    return (
      this.messageMap[code] ||
      'Something went wrong when requesting the payjoin endpoint.'
    );
  }

  code: string;

  constructor(code: string) {
    super(PayjoinEndpointError.codeToMessage(code));
    this.code = code;
  }
}

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
      let errorCode = '';
      try {
        errorCode = JSON.parse(responseText).errorCode;
      } catch (err) {}

      throw new PayjoinEndpointError(errorCode);
    }

    return Psbt.fromBase64(responseText);
  }
}
