'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.PayjoinRequester = exports.PayjoinEndpointError = void 0;
const bitcoinjs_lib_1 = require('bitcoinjs-lib');
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
class PayjoinEndpointError extends Error {
  constructor(code) {
    super(PayjoinEndpointError.codeToMessage(code));
    this.code = code;
  }
  static codeToMessage(code) {
    return (
      this.messageMap[code] ||
      'Something went wrong when requesting the payjoin endpoint.'
    );
  }
}
exports.PayjoinEndpointError = PayjoinEndpointError;
PayjoinEndpointError.messageMap = {
  unavailable: 'The payjoin endpoint is not available for now.',
  'not-enough-money':
    'The receiver added some inputs but could not bump the fee of the payjoin proposal.',
  'version-unsupported': 'This version of payjoin is not supported.',
  'original-psbt-rejected': 'The receiver rejected the original PSBT.',
};
class PayjoinRequester {
  constructor(endpointUrl, customFetch) {
    this.endpointUrl = endpointUrl;
    this.customFetch = customFetch;
  }
  async requestPayjoin(psbt) {
    if (!psbt) {
      throw new Error('Need to pass psbt');
    }
    const fetchFunction = this.customFetch || fetch;
    const response = await fetchFunction(this.endpointUrl, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'text/plain',
      }),
      body: psbt.toBase64(),
    }).catch((v) => ({
      ok: false,
      async text() {
        return v.message;
      },
    }));
    const responseText = await response.text();
    if (!response.ok) {
      let errorCode = '';
      try {
        errorCode = JSON.parse(responseText).errorCode;
      } catch (err) {}
      throw new PayjoinEndpointError(errorCode);
    }
    return bitcoinjs_lib_1.Psbt.fromBase64(responseText);
  }
}
exports.PayjoinRequester = PayjoinRequester;
