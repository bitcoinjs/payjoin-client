'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const bitcoinjs_lib_1 = require('bitcoinjs-lib');
const fetch = require('isomorphic-fetch');
class PayjoinRequester {
  constructor(endpointUrl) {
    this.endpointUrl = endpointUrl;
  }
  async requestPayjoin(psbt) {
    if (!psbt) {
      throw new Error();
    }
    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'text/plain',
      }),
      body: psbt.toBase64(),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText);
    }
    return bitcoinjs_lib_1.Psbt.fromBase64(responseText);
  }
}
exports.PayjoinRequester = PayjoinRequester;
