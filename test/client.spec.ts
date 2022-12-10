import {
  PayjoinClient,
  IPayjoinClientWallet,
  IPayjoinRequester,
} from '../ts_src/index';
import * as bitcoin from 'bitcoinjs-lib';
import { default as VECTORS } from './fixtures/client.fixtures';
import { getEndpointUrl } from '../ts_src/utils';
import { BIP32Factory, BIP32Interface } from 'bip32';
import * as ecc from 'tiny-secp256k1';

// pass the regtest network to everything
const network = bitcoin.networks.regtest;

describe('requestPayjoin', () => {
  it('should exist', () => {
    expect(PayjoinClient).toBeDefined();
    expect(typeof PayjoinClient).toBe('function'); // JS classes are functions
  });

  it('should throw on invalid opts', () => {
    expect(() => {
      new PayjoinClient(null as any);
    }).toThrow();
    expect(() => {
      new PayjoinClient({
        payjoinUrl: 'hello',
        wallet: new TestWallet(null as any, null as any),
        paymentScript: null as any,
      });
    }).toThrow();
    expect(() => {
      new PayjoinClient({
        payjoinUrl: null as any,
        wallet: new TestWallet(null as any, null as any),
        paymentScript: Buffer.from('chocolate', 'hex'),
      });
    }).toThrow();
  });
  expect(() => {
    new PayjoinClient({
      payjoinRequester: null as any,
      wallet: new TestWallet(null as any, null as any),
      paymentScript: Buffer.from('chocolate', 'hex'),
    });
  }).toThrow();

  VECTORS.valid.forEach((f) => {
    it('should request p2sh-p2wpkh payjoin', async () => {
      let paymentScript = Buffer.from(
        'a91457f78d3d696767f4d6d1c8ac5986babad244ed6f87',
        'hex',
      );
      await testPayjoin(f.p2shp2wpkh, () => {
        return paymentScript;
      });
    });
    it('should request p2wpkh payjoin', async () => {
      let paymentScript = Buffer.from(
        'a91457f78d3d696767f4d6d1c8ac5986babad244ed6f87',
        'hex',
      );
      await testPayjoin(f.p2wpkh, () => {
        return paymentScript;
      });
    });
  });
  VECTORS.invalid.forEach((f) => {
    it(f.description, async () => {
      let paymentScript = Buffer.from(
        'a91457f78d3d696767f4d6d1c8ac5986babad244ed6f87',
        'hex',
      );
      await expect(
        testPayjoin(f.vector, () => {
          return paymentScript;
        }),
      ).rejects.toThrowError(new RegExp(f.exception));
    });
  });
});

describe('getEndpointUrl', () => {
  it('should exist', () => {
    expect(typeof getEndpointUrl).toBe('function');
  });
  it('should add parameters specified', () => {
    expect(
      getEndpointUrl('https://gozo.com', {
        additionalFeeOutputIndex: 0,
        disableOutputSubstitution: false,
        minimumFeeRate: 1,
        payjoinVersion: 2,
        maxAdditionalFeeContribution: 2,
      }),
    ).toBe(
      'https://gozo.com/?disableoutputsubstitution=false&v=2&minfeerate=1&maxadditionalfeecontribution=2&additionalfeeoutputindex=0',
    );

    expect(getEndpointUrl('https://gozo.com', {})).toBe('https://gozo.com');
  });
});

async function testPayjoin(
  vector: any,
  getOutputScript: Function,
): Promise<void> {
  const rootNode = BIP32Factory(ecc).fromBase58(VECTORS.privateRoot, network);
  const wallet = new TestWallet(vector.wallet, rootNode);
  const payjoinRequester = new DummyRequester(vector.payjoin);
  const client = new PayjoinClient({
    wallet,
    payjoinRequester,
    paymentScript: getOutputScript(),
    payjoinParameters: vector.payjoinParameters,
  });

  await client.run();

  expect(wallet.tx).toBeDefined();
  expect(wallet.tx!.toHex()).toEqual(vector.finaltx);
}

// Use this for testing
class TestWallet implements IPayjoinClientWallet {
  tx: bitcoin.Transaction | undefined;
  timeout: NodeJS.Timeout | undefined;

  constructor(private psbtString: string, private rootNode: BIP32Interface) {}

  async getPsbt() {
    return bitcoin.Psbt.fromBase64(this.psbtString, { network });
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
    this.tx = bitcoin.Transaction.fromHex(txHex);
    return '';
  }

  async scheduleBroadcastTx(txHex: string, ms: number): Promise<void> {
    return txHex + ms + 'x' ? undefined : undefined;
  }
}

class DummyRequester implements IPayjoinRequester {
  constructor(private psbt: string) {}

  async requestPayjoin(psbt: bitcoin.Psbt): Promise<bitcoin.Psbt> {
    const myString = psbt ? this.psbt : this.psbt;
    // @ts-ignore
    if (!myString) return;
    return bitcoin.Psbt.fromBase64(myString, { network });
  }
}
