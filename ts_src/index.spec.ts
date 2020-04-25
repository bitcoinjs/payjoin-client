import { requestPayjoin, requestPayjoinWithCustomRemoteCall } from './index';
import { RegtestUtils } from 'regtest-client';
import { BTCPayClient, crypto as btcPayCrypto } from 'btcpay';
import * as puppeteer from 'puppeteer';
import { Browser, Page } from 'puppeteer';
import * as bitcoin from 'bitcoinjs-lib';
import * as qs from 'querystring';

// pass the regtest network to everything
const network = bitcoin.networks.regtest;

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

    KP1 = btcPayCrypto.generate_keypair();
    KP2 = btcPayCrypto.generate_keypair();

    const browser = await getBrowser();

    const { pairingCode: pairingCode1 } = await loginAndGetPairingCode(
      browser,
      'p2wpkh',
    );
    btcPayClientSegwit = new BTCPayClient(HOST, KP1);
    const token1 = await btcPayClientSegwit.pair_client(pairingCode1);
    btcPayClientSegwit = new BTCPayClient(HOST, KP1, token1);

    const { pairingCode: pairingCode2 } = await loginAndGetPairingCode(
      browser,
      'p2sh-p2wpkh',
      true,
    );
    btcPayClientSegwitP2SH = new BTCPayClient(HOST, KP2);
    const token2 = await btcPayClientSegwitP2SH.pair_client(pairingCode2);
    btcPayClientSegwitP2SH = new BTCPayClient(HOST, KP2, token2);

    browser.close();
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

// Used for getting a new pairing code
const HEADLESS = true;
const WINDOW_WIDTH = 1920;
const WINDOW_HEIGHT = 1080;
const IGNORE_SANDBOX_ERROR = process.env['BTCPAY_IGNORE_SANDBOX_ERROR'];
const USER_NAME = 'test@example.com';
const PASSWORD = 'satoshinakamoto';
let STORE_ID = '';
async function getBrowser(): Promise<Browser> {
  return puppeteer
    .launch({
      headless: HEADLESS,
      args: ['--window-size=' + WINDOW_WIDTH + ',' + WINDOW_HEIGHT],
    })
    .then(
      (v) => v, // if success, passthrough
      // if error, check for env and ignore sandbox and warn.
      (err) => {
        if (IGNORE_SANDBOX_ERROR === '1') {
          console.warn(
            'WARNING!!! Error occurred, Chromium will be started ' +
              "without sandbox. This won't guarantee success.",
          );
          return puppeteer.launch({
            headless: HEADLESS,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--window-size=' + WINDOW_WIDTH + ',' + WINDOW_HEIGHT,
            ],
          });
        } else {
          console.warn(
            'If "No usable sandbox!" error, retry test with ' +
              'BTCPAY_IGNORE_SANDBOX_ERROR=1',
          );
          throw err;
        }
      },
    );
}
async function loginAndGetPairingCode(
  browser: Browser,
  type: 'p2sh-p2wpkh' | 'p2wpkh',
  skipLogin: boolean = false,
): Promise<{
  browser: Browser;
  page: Page;
  pairingCode: string;
}> {
  const newTokenName = 'autotest ' + type + new Date().getTime();
  const storeIndex = type === 'p2wpkh' ? 1 : 2;
  const page = (await browser.pages())[0];
  await page.setViewport({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  try {
    await page.goto(HOST + '/Account/Login');
  } catch (e) {
    if (e.message === `net::ERR_CONNECTION_REFUSED at ${HOST}/Account/Login`) {
      browser.close();
      console.log(
        'Please start docker container locally:\n' +
          'docker run -p 49392:49392 -p 8080:8080 -p 18271:18271 junderw/btcpay-client-test-server',
      );
      return {
        page,
        browser,
        pairingCode: '',
      };
    }
    throw e;
  }

  if (!skipLogin) {
    await page.type('#Email', USER_NAME);
    await page.type('#Password', PASSWORD);
    await page.click('#LoginButton');
  }
  await page.goto(HOST + '/stores');
  await page.waitForSelector('#CreateStore');
  await page.click(
    'table.table.table-sm.table-responsive-md > tbody > ' +
      'tr:nth-of-type(' +
      storeIndex +
      ') > td:nth-of-type(3) > a:nth-of-type(2)',
  );
  await page.waitForSelector('#Id');
  const idElement = await page.$$('#Id');
  STORE_ID = (await idElement[0]
    .getProperty('value')
    .then((v) => v.jsonValue())) as string;
  await page.goto(HOST + '/stores/' + STORE_ID + '/Tokens/Create');
  await page.waitForSelector('input#Label');
  await page.waitForSelector('[type="submit"]');

  await page.type('#Label', newTokenName);
  await page.click('[type="submit"]');
  await page.waitForSelector('button[type="submit"]');
  await page.click('[type="submit"]');
  await page.waitForSelector('div.alert.alert-success.alert-dismissible');
  const contents = await page.evaluate(() => {
    const el = document.querySelector(
      'div.alert.alert-success.alert-dismissible',
    );
    if (el === null) return '';
    return el.innerHTML;
  });
  const pairingCode = (contents.match(
    /Server initiated pairing code: (\S{7})/,
  ) || [])[1];
  if (!pairingCode) throw new Error('Could not get pairing code');
  return {
    browser,
    page,
    pairingCode,
  };
}
