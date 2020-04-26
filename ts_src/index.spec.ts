import { IPayjoinClientWallet, PayjoinClient } from './index';
import { RegtestUtils } from 'regtest-client';
import { BTCPayClient, crypto as btcPayCrypto } from 'btcpay';
import * as fetch from 'isomorphic-fetch';
import * as bitcoin from 'bitcoinjs-lib';
import * as qs from 'querystring';
import { Psbt } from 'bitcoinjs-lib';
import { Transaction } from 'bitcoinjs-lib';

// pass the regtest network to everything
const network = bitcoin.networks.regtest;

const TOKENURL = 'http://127.0.0.1:18271/tokens';

const APIURL = process.env['APIURL'] || 'http://127.0.0.1:8080/1';
const APIPASS = process.env['APIPASS'] || 'satoshi';
let regtestUtils: RegtestUtils;

const HOST = process.env['BTCPAY_HOST'] || 'http://127.0.0.1:49392';
let KP1: any;
let KP2: any;
let btcPayClientSegwit: BTCPayClient;
let btcPayClientSegwitP2SH: BTCPayClient;

// # run the following docker command and wait 10 seconds before running tests
// docker run -p 49392:49392 -p 8080:8080 -p 18271:18271 junderw/btcpay-client-test-server

describe('requestPayjoin', () => {
  beforeAll(async () => {
    jest.setTimeout(20000);
    regtestUtils = new RegtestUtils({ APIURL, APIPASS });

    const tokens = await getTokens();

    KP1 = btcPayCrypto.load_keypair(
      Buffer.from(tokens.privateKeys.p2wpkh, 'hex'),
    );
    KP2 = btcPayCrypto.load_keypair(
      Buffer.from(tokens.privateKeys.p2shp2wpkh, 'hex'),
    );

    btcPayClientSegwit = new BTCPayClient(HOST, KP1, tokens.p2wpkh);
    btcPayClientSegwitP2SH = new BTCPayClient(HOST, KP2, tokens.p2shp2wpkh);
  });
  it('should exist', () => {
    expect(PayjoinClient).toBeDefined();
    expect(typeof PayjoinClient).toBe('function'); // JS classes are functions
  });
  it('should request p2sh-p2wpkh payjoin', async () => {
    await testPayjoin(btcPayClientSegwitP2SH, getP2SHP2WPKH);
  });
  it('should request p2wpkh payjoin', async () => {
    await testPayjoin(btcPayClientSegwit, getP2WPKH);
  });
});

async function testPayjoin(
  btcPayClient: BTCPayClient,
  getPayment: (pubkey: Buffer) => bitcoin.Payment,
): Promise<void> {
  const invoice = await btcPayClient.create_invoice({
    currency: 'USD',
    price: 1.12,
  });
  const pjEndpoint = qs.decode(invoice.paymentUrls.BIP21 as string)
    .pj as string;

  const wallet = new TestWallet(
    invoice.bitcoinAddress,
    Math.round(parseFloat(invoice.btcPrice) * 1e8),
    bitcoin.ECPair.makeRandom({ network }),
    getPayment,
  );
  const client = new PayjoinClient({
    wallet,
    payjoinUrl: pjEndpoint,
  });

  await client.run();

  expect(wallet.tx).toBeDefined();
  await regtestUtils.verify({
    txId: wallet.tx!.getId(),
    address: bitcoin.address.fromOutputScript(
      wallet.tx!.outs[1].script,
      network,
    ),
    vout: 1,
    value: wallet.tx!.outs[1].value,
  });
}

function getP2WPKH(pubkey: Buffer) {
  return bitcoin.payments.p2wpkh({
    pubkey,
    network,
  });
}

function getP2SHP2WPKH(pubkey: Buffer) {
  return bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({
      pubkey,
      network,
    }),
    network,
  });
}

async function getTokens(): Promise<{
  p2wpkh: {
    merchant: string;
  };
  p2shp2wpkh: {
    merchant: string;
  };
  privateKeys: {
    p2wpkh: string;
    p2shp2wpkh: string;
  };
}> {
  return fetch(TOKENURL).then((v) => v.json());
}

// Use this for testing
class TestWallet implements IPayjoinClientWallet {
  tx: bitcoin.Transaction | undefined;
  timeout: NodeJS.Timeout | undefined;

  constructor(
    private sendToAddress: string,
    private sendToAmount: number,
    private ecPair: bitcoin.ECPairInterface,
    private getPayment: (pubkey: Buffer) => bitcoin.Payment,
  ) {}

  async getPsbt() {
    const payment = this.getPayment(this.ecPair.publicKey);
    const unspent = await regtestUtils.faucet(payment.address!, 2e7);
    const sendAmount = this.sendToAmount;
    return new bitcoin.Psbt({ network })
      .addInput({
        hash: unspent.txId,
        index: unspent.vout,
        witnessUtxo: {
          script: payment.output!,
          value: unspent.value,
        },
        ...(payment.redeem ? { redeemScript: payment.redeem.output! } : {}),
      })
      .addOutput({
        address: this.sendToAddress,
        value: sendAmount,
      })
      .addOutput({
        address: payment.address!,
        value: unspent.value - sendAmount - 10000,
      })
      .signInput(0, this.ecPair);
  }

  async signPsbt(psbt: bitcoin.Psbt): Promise<bitcoin.Psbt> {
    psbt.data.inputs.forEach((psbtInput, i) => {
      if (
        psbtInput.finalScriptSig === undefined &&
        psbtInput.finalScriptWitness === undefined
      ) {
        psbt.signInput(i, this.ecPair).finalizeInput(i);
      }
    });
    return psbt;
  }

  async broadcastTx(txHex: string): Promise<string> {
    try {
      await regtestUtils.broadcast(txHex);
      clearTimeout(this.timeout!);
      this.tx = bitcoin.Transaction.fromHex(txHex);
    } catch (e) {
      return e.message;
    }
    return '';
  }

  async scheduleBroadcastTx(txHex: string, ms: number): Promise<void> {
    this.timeout = setTimeout(
      ((txHexInner) => async () => {
        try {
          await regtestUtils.broadcast(txHexInner);
        } catch (err) {
          // failure is good
          return;
        }
        // Do something here to log the fact that it broadcasted successfully
        // This is for tests so we won't do it.
      })(txHex),
      ms,
    );
    // returns immediately after setting the timeout.
  }

  async getBalanceChange(psbt: bitcoin.Psbt): Promise<number> {
    let ourTotalIn = 0;
    let ourTotalOut = 0;
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (input.bip32Derivation) ourTotalIn += input.witnessUtxo!.value;
    }

    for (let i = 0; i < psbt.data.outputs.length; i++) {
      const output = psbt.data.outputs[i];
      if (output.bip32Derivation)
        ourTotalIn += this.getGlobalTransaction(psbt).outs[i].value;
    }

    return ourTotalIn - ourTotalOut;
  }

  private getGlobalTransaction(psbt: Psbt): Transaction {
    // TODO: bitcoinjs-lib to expose outputs to Psbt class
    // instead of using private (JS has no private) attributes
    // @ts-ignore
    return psbt.__CACHE.__TX;
  }
}
