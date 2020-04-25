import { requestPayjoin, requestPayjoinWithCustomRemoteCall } from './index';
import { RegtestUtils } from 'regtest-client';
import { BTCPayClient, crypto as btcPayCrypto } from 'btcpay';
import * as fetch from 'isomorphic-fetch';
import * as bitcoin from 'bitcoinjs-lib';
import * as qs from 'querystring';

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
    expect(requestPayjoin).toBeDefined();
    expect(typeof requestPayjoin).toBe('function');
    expect(requestPayjoinWithCustomRemoteCall).toBeDefined();
    expect(typeof requestPayjoinWithCustomRemoteCall).toBe('function');
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

  const keyPair = bitcoin.ECPair.makeRandom({ network });
  const payment = getPayment(keyPair.publicKey);
  const unspent = await regtestUtils.faucet(payment.address!, 2e7);
  const sendAmount = Math.round(parseFloat(invoice.btcPrice) * 1e8);
  const psbt = new bitcoin.Psbt({ network })
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
      address: invoice.bitcoinAddress,
      value: sendAmount,
    })
    .addOutput({
      address: payment.address!,
      value: unspent.value - sendAmount - 10000,
    })
    .signInput(0, keyPair);
  const newPsbt = await requestPayjoin(psbt, pjEndpoint);
  newPsbt.data.inputs.forEach((psbtInput, i) => {
    if (
      psbtInput.finalScriptSig === undefined &&
      psbtInput.finalScriptWitness === undefined
    ) {
      newPsbt.signInput(i, keyPair).finalizeInput(i);
    }
  });
  const tx = newPsbt.extractTransaction();
  await regtestUtils.broadcast(tx.toHex());
  await regtestUtils.verify({
    txId: tx.getId(),
    address: bitcoin.address.fromOutputScript(tx.outs[1].script, network),
    vout: 1,
    value: tx.outs[1].value,
  });
  expect(tx).toBeDefined();
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
