import { IPayjoinClientWallet, PayjoinClient } from '..';
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
    expect(PayjoinClient).toBeDefined();
    expect(typeof PayjoinClient).toBe('function'); // JS classes are functions
  });
  it('should request p2sh-p2wpkh payjoin', async () => {
    await testPayjoin(btcPayClientSegwitP2SH, 'p2sh-p2wpkh');
  });
  it('should request p2wpkh payjoin', async () => {
    await testPayjoin(btcPayClientSegwit, 'p2wpkh');
  });
});

async function testPayjoin(
  btcPayClient: BTCPayClient,
  scriptType: ScriptType,
): Promise<void> {
  const invoice = await btcPayClient.create_invoice({
    currency: 'USD',
    price: 1.12,
  });
  const pjEndpoint = qs.decode(invoice.paymentUrls.BIP21 as string)
    .pj as string;
  const paymentScript = bitcoin.address.toOutputScript(
    invoice.bitcoinAddress,
    network,
  );
  const wallet = new TestWallet(
    invoice.bitcoinAddress,
    Math.round(parseFloat(invoice.btcPrice) * 1e8),
    bitcoin.bip32.fromSeed(bitcoin.ECPair.makeRandom().privateKey!, network),
    scriptType,
  );
  const client = new PayjoinClient({
    wallet,
    paymentScript: paymentScript,
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
type ScriptType = 'p2wpkh' | 'p2sh-p2wpkh';
class TestWallet implements IPayjoinClientWallet {
  tx: bitcoin.Transaction | undefined;
  timeout: NodeJS.Timeout | undefined;

  constructor(
    private sendToAddress: string,
    private sendToAmount: number,
    private rootNode: bitcoin.BIP32Interface,
    private scriptType: ScriptType,
  ) {}

  async getPsbt() {
    // See BIP84 and BIP49 for the derivation logic
    const path = this.scriptType === 'p2wpkh' ? "m/84'/1'/0'" : "m/49'/1'/0'";
    const accountNode = this.rootNode.derivePath(path);
    const firstKeyNode = accountNode.derivePath('0/0');
    const firstKeypayment = this.getPayment(
      firstKeyNode.publicKey,
      this.scriptType,
    );
    const firstChangeNode = accountNode.derivePath('1/0');
    const firstChangepayment = this.getPayment(
      firstChangeNode.publicKey,
      this.scriptType,
    );
    const unspent = await regtestUtils.faucet(firstKeypayment.address!, 2e7);
    const sendAmount = this.sendToAmount;
    return new bitcoin.Psbt({ network })
      .addInput({
        hash: unspent.txId,
        index: unspent.vout,
        witnessUtxo: {
          script: firstKeypayment.output!,
          value: unspent.value,
        },
        bip32Derivation: [
          {
            pubkey: firstKeyNode.publicKey,
            masterFingerprint: this.rootNode.fingerprint,
            path: path + '/0/0',
          },
        ],
        ...(firstKeypayment.redeem
          ? { redeemScript: firstKeypayment.redeem.output! }
          : {}),
      })
      .addOutput({
        address: this.sendToAddress,
        value: sendAmount,
      })
      .addOutput({
        address: firstChangepayment.address!,
        value: unspent.value - sendAmount - 10000,
        bip32Derivation: [
          {
            pubkey: firstChangeNode.publicKey,
            masterFingerprint: this.rootNode.fingerprint,
            path: path + '/1/0',
          },
        ],
      })
      .signInputHD(0, this.rootNode);
  }

  async signPsbt(psbt: bitcoin.Psbt): Promise<bitcoin.Psbt> {
    psbt.data.inputs.forEach((psbtInput, i) => {
      if (
        psbtInput.finalScriptSig === undefined &&
        psbtInput.finalScriptWitness === undefined
      ) {
        psbt.signInputHD(i, this.rootNode).finalizeInput(i);
      }
    });
    return psbt;
  }

  async broadcastTx(txHex: string): Promise<string> {
    try {
      await regtestUtils.broadcast(txHex);
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
        // broadcasting successfully is a bad thing. It means the payjoin
        // transaction didn't propagate OR the merchant double spent their input
        // to trick you into paying twice.
        // This is for tests so we won't do it.
      })(txHex),
      ms,
    );
    // returns immediately after setting the timeout.

    // But since this is a test, and we don't want the test to wait 2 minutes
    // we will cancel it immediately after
    clearTimeout(this.timeout);
  }

  private getPayment(pubkey: Buffer, scriptType: ScriptType): bitcoin.Payment {
    if (scriptType === 'p2wpkh') {
      return bitcoin.payments.p2wpkh({
        pubkey,
        network,
      });
    } else {
      return bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({
          pubkey,
          network,
        }),
        network,
      });
    }
  }
}
