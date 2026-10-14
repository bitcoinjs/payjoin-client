import { IPayjoinClientWallet, PayjoinClient } from '..';
import { RegtestUtils } from 'regtest-client';
import { BTCPayClient, crypto as btcPayCrypto } from 'btcpay';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory, BIP32Interface } from 'bip32';
import { randomBytes } from 'crypto';
import * as ecc from 'tiny-secp256k1';
import * as qs from 'querystring';

// pass the regtest network to everything
const network = bitcoin.networks.regtest;
const bip32 = BIP32Factory(ecc);

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

// faucet + payjoin round trips take a while on the emulated test server
jest.setTimeout(60000);

describe('requestPayjoin', () => {
  beforeAll(async () => {
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
    // priced in BTC: a fiat invoice needs a rate feed the test server image cannot reach
    currency: 'BTC',
    price: 0.0001,
  });
  const qsVars = qs.decode(invoice.paymentUrls.BIP21 as string);
  const pjEndpoint = qsVars.pj as string;
  const paymentScript = bitcoin.address.toOutputScript(
    invoice.bitcoinAddress,
    network,
  );
  const wallet = new TestWallet(
    invoice.bitcoinAddress,
    Math.round(parseFloat(invoice.btcPrice) * 1e8),
    bip32.fromSeed(randomBytes(32), network),
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
    value: Number(wallet.tx!.outs[1].value),
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
    private rootNode: BIP32Interface,
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
          value: BigInt(unspent.value),
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
        value: BigInt(sendAmount),
      })
      .addOutput({
        address: firstChangepayment.address!,
        value: BigInt(unspent.value - sendAmount - 10000),
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
      return (e as Error).message;
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

  private getPayment(
    pubkey: Uint8Array,
    scriptType: ScriptType,
  ): bitcoin.Payment {
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
