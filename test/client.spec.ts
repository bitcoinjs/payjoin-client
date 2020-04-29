import {
  PayjoinClient,
  IPayjoinClientWallet,
  IPayjoinRequester,
} from '..';
import * as bitcoin from 'bitcoinjs-lib';

// pass the regtest network to everything
const network = bitcoin.networks.regtest;

describe('requestPayjoin', () => {
  it('should exist', () => {
    expect(PayjoinClient).toBeDefined();
    expect(typeof PayjoinClient).toBe('function'); // JS classes are functions
  });
  it('should request p2sh-p2wpkh payjoin', async () => {
    await testPayjoin('p2shp2wpkh');
  });
  it('should request p2wpkh payjoin', async () => {
    await testPayjoin('p2wpkh');
  });
});

async function testPayjoin(scriptType: ScriptType): Promise<void> {
  const vector = VECTORS[scriptType];
  const rootNode = bitcoin.bip32.fromBase58(ROOTXPRV, network);
  const wallet = new TestWallet(vector.wallet, rootNode);
  const payjoinRequester = new DummyRequester(vector.payjoin);
  const client = new PayjoinClient({
    wallet,
    payjoinRequester,
  });

  await client.run();

  expect(wallet.tx).toBeDefined();
  expect(wallet.tx!.toHex()).toEqual(vector.finaltx);
}

// Use this for testing
type ScriptType = 'p2wpkh' | 'p2shp2wpkh';
class TestWallet implements IPayjoinClientWallet {
  tx: bitcoin.Transaction | undefined;
  timeout: NodeJS.Timeout | undefined;

  constructor(
    private psbtString: string,
    private rootNode: bitcoin.BIP32Interface,
  ) {}

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

  async getSumPaidToUs(psbt: bitcoin.Psbt): Promise<number> {
    let ourTotalIn = 0;
    let ourTotalOut = 0;
    for (let i = 0; i < psbt.inputCount; i++) {
      if (psbt.inputHasHDKey(i, this.rootNode))
        ourTotalOut += psbt.data.inputs[i].witnessUtxo!.value;
    }

    for (let i = 0; i < psbt.data.outputs.length; i++) {
      if (psbt.outputHasHDKey(i, this.rootNode))
        ourTotalIn += psbt.txOutputs[i].value;
    }

    return ourTotalIn - ourTotalOut;
  }
}

class DummyRequester implements IPayjoinRequester {
  constructor(private psbt: string) {}

  async requestPayjoin(psbt: bitcoin.Psbt): Promise<bitcoin.Psbt> {
    const myString = psbt ? this.psbt : this.psbt;
    return bitcoin.Psbt.fromBase64(myString, { network });
  }
}

const ROOTXPRV =
  'tprv8ZgxMBicQKsPfBD2PErVQNAqcjwLBg8fWZSX8qwx1cRyFsDrgvRDLqaT5Rf2N4VEXZDAk' +
  'pWeJ9vXXREbAUY67RtoZorrfxqgDMxsb6FiBFH';

const VECTORS = {
  p2shp2wpkh: {
    wallet:
      'cHNidP8BAHMCAAAAAe3cMHpMFX6UHpGPK+xGWLDw3QGfmDRLGLlTJE4czTayAQAAAAD//' +
      '///AhY3AAAAAAAAF6kUGUpoD/FYeCkzIQx9LCFO8/HGy8CH2s4wAQAAAAAXqRRX9409aW' +
      'dn9NbRyKxZhrq60kTtb4cAAAAAAAEBIAAtMQEAAAAAF6kUzOrfUgwsdkXW9MwTqFVnWJY' +
      'neG6HIgIDMK/+LKSLLXGbmoZDWhO+wfQNSg4EZDiysJ01XudKR1FIMEUCIQC2ueU0wAHb' +
      't0k0hKHYIy56LP5mPkYl7l7fchZxq51dXAIgCS10esmX6NEPiKhDEmpXNdMfDXuky79kO' +
      '7o14ICtdBIBAQQWABTCMhP785DvZ/hbAFqf8xLvhW+i+iIGAzCv/iykiy1xm5qGQ1oTvs' +
      'H0DUoOBGQ4srCdNV7nSkdRGL2ZyQMxAACAAQAAgAAAAIAAAAAAAAAAAAAAIgIDhOiaJvr' +
      'nFp4/cwvgS1YRsR7ogQ1DBEGKa6soIaoC0AwYvZnJAzEAAIABAACAAAAAgAEAAAAAAAAA' +
      'AA==',
    payjoin:
      'cHNidP8BAJwCAAAAAu3cMHpMFX6UHpGPK+xGWLDw3QGfmDRLGLlTJE4czTayAQAAAAD//' +
      '///sCrDg0SI1KmVv7LpsN35WnZ6G5Ibh5EgEpTTfUAbv6QAAAAAAP////8C3N7MAAAAAA' +
      'AXqRQZSmgP8Vh4KTMhDH0sIU7z8cbLwIdxuTABAAAAABepFFf3jT1pZ2f01tHIrFmGurr' +
      'SRO1vhwAAAAAAAAEBIManzAAAAAAAF6kU8YKUJ//lXt+c2a2J3k4fk6lM8v+HAQcXFgAU' +
      'eomseQvDNhdw39dTc5Mz8pb0gIUBCGsCRzBEAiA11cfhH3R6+R25Y/0g64NUOV/DgiyiF' +
      'JYsz9AYwIcQxwIgD3B4PEi+iKCfWkoOT0TxInvabmVeqBBi9JYwKOuTXjIBIQIHExZSjf' +
      'M0g3ykBAQVLPMn4q7+3iu6syPS0KlqlhdpiwAAAA==',
    finaltx:
      '02000000000102eddc307a4c157e941e918f2bec4658b0f0dd019f98344b18b953244' +
      'e1ccd36b20100000017160014c23213fbf390ef67f85b005a9ff312ef856fa2faffff' +
      'ffffb02ac3834488d4a995bfb2e9b0ddf95a767a1b921b8791201294d37d401bbfa40' +
      '0000000171600147a89ac790bc3361770dfd753739333f296f48085ffffffff02dcde' +
      'cc000000000017a914194a680ff158782933210c7d2c214ef3f1c6cbc08771b930010' +
      '000000017a91457f78d3d696767f4d6d1c8ac5986babad244ed6f8702483045022100' +
      'c7fcc918ecbb754265c0dda155a27e7d3c54f483445e67136311f8f3f872c5b002204' +
      'b01978ba1ae7fa436a244c4761cafdf3a9790606aa98301fdfe2363cee77fa3012103' +
      '30affe2ca48b2d719b9a86435a13bec1f40d4a0e046438b2b09d355ee74a475102473' +
      '044022035d5c7e11f747af91db963fd20eb8354395fc3822ca214962ccfd018c08710' +
      'c702200f70783c48be88a09f5a4a0e4f44f1227bda6e655ea81062f4963028eb935e3' +
      '2012102071316528df334837ca40404152cf327e2aefede2bbab323d2d0a96a961769' +
      '8b00000000',
  },
  p2wpkh: {
    wallet:
      'cHNidP8BAHECAAAAAcG1DqRm0b8vhX6JpsU3m2N8V6xVz226gjY+pE7up8ebAAAAAAD//' +
      '///AhY3AAAAAAAAFgAUn1AUWTvX0DxQkFIeS+rmPrPMvBrazjABAAAAABYAFD4WR6SuL+' +
      'LmgQYyQeDKe7e53H2FAAAAAAABAR8ALTEBAAAAABYAFH+Ar5fIkaBhnFoV+l63h8a3ieX' +
      'NIgICz9HHZqLbHIDNDIlaeWJXXhfij/uu5fpIoXRDkICd/IBHMEQCIA5rthangBAiievr' +
      'SBxLjaY84rH0rTQWtLZZgjJXmCNwAiBfahFoEsKJIpYNT6gLpgnz4Kd5tfhwxVu4suC3J' +
      'tYDRwEiBgLP0cdmotscgM0MiVp5YldeF+KP+67l+kihdEOQgJ38gBi9mckDVAAAgAEAAI' +
      'AAAACAAAAAAAAAAAAAACICAnV5cU7BjADcEOOyGq9mFwih6VX/4pXpJdKCxY/szjOXGL2' +
      'ZyQNUAACAAQAAgAAAAIABAAAAAAAAAAA=',
    payjoin:
      'cHNidP8BAJoCAAAAAsG1DqRm0b8vhX6JpsU3m2N8V6xVz226gjY+pE7up8ebAAAAAAD//' +
      '///r0UF7k4QIg7eU5xF5s+hAqE7Jfd6sipD1Yd8va6VK7AAAAAAAP////8CBLwwAQAAAA' +
      'AWABQ+Fkekri/i5oEGMkHgynu3udx9hbhwzAAAAAAAFgAUn1AUWTvX0DxQkFIeS+rmPrP' +
      'MvBoAAAAAAAABAR+iOcwAAAAAABYAFCZkjLYCTqSilHNgvSXmFJo2FwJAAQhrAkcwRAIg' +
      'SrvgI38Qc1LQbeJHuGstnmAxKa0r1vs0HEaXV/l9lDACIGY3HXTY3OI/k1qJwKsR5xAdm' +
      '0xisOIH7ExKDieGM3f8ASECW3pZhcq0tRXPiM7jLITLeCetYq48ElvgytyaUpGrvR0AAA' +
      'A=',
    finaltx:
      '02000000000102c1b50ea466d1bf2f857e89a6c5379b637c57ac55cf6dba82363ea44' +
      'eeea7c79b0000000000ffffffffaf4505ee4e10220ede539c45e6cfa102a13b25f77a' +
      'b22a43d5877cbdae952bb00000000000ffffffff0204bc3001000000001600143e164' +
      '7a4ae2fe2e681063241e0ca7bb7b9dc7d85b870cc00000000001600149f5014593bd7' +
      'd03c5090521e4beae63eb3ccbc1a0247304402205b63aba308d01cc9420744527edb0' +
      '7ff1c26c3335539784a3f6c022d7df61e51022018c6f1637eedc99ea95cd2000936ec' +
      'd4bc5e177b5be12afa5863bb4094e0ab59012102cfd1c766a2db1c80cd0c895a79625' +
      '75e17e28ffbaee5fa48a1744390809dfc800247304402204abbe0237f107352d06de2' +
      '47b86b2d9e603129ad2bd6fb341c469757f97d9430022066371d74d8dce23f935a89c' +
      '0ab11e7101d9b4c62b0e207ec4c4a0e27863377fc0121025b7a5985cab4b515cf88ce' +
      'e32c84cb7827ad62ae3c125be0cadc9a5291abbd1d00000000',
  },
};
