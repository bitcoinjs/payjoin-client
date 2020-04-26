import { IPayjoinRequester, PayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
import {
  checkSanity,
  getInputIndex,
  getInputsScriptPubKeyType,
  getFee,
  getGlobalTransaction,
  getPsbtFee,
  hasKeypathInformationSet,
  isFinalized,
  SUPPORTED_WALLET_FORMATS,
} from './utils';

const BROADCAST_ATTEMPT_TIME = 2 * 60 * 1000; // 2 minutes

export class PayjoinClient {
  private wallet: IPayjoinClientWallet;
  private payjoinRequester: IPayjoinRequester;
  constructor(opts: PayjoinClientOpts) {
    this.wallet = opts.wallet;
    if (isRequesterOpts(opts)) {
      this.payjoinRequester = opts.payjoinRequester;
    } else {
      this.payjoinRequester = new PayjoinRequester(opts.payjoinUrl);
    }
  }

  async run(): Promise<void> {
    const psbt = await this.wallet.getPsbt();
    const clonedPsbt = psbt.clone();
    const originalType = getInputsScriptPubKeyType(clonedPsbt);
    clonedPsbt.finalizeAllInputs();
    if (SUPPORTED_WALLET_FORMATS.indexOf(originalType) === -1) {
      throw new Error(
        'Inputs used do not support payjoin, they must be segwit',
      );
    }

    // We make sure we don't send unnecessary information to the receiver
    for (let index = 0; index < clonedPsbt.inputCount; index++) {
      clonedPsbt.clearFinalizedInput(index);
    }
    clonedPsbt.data.outputs.forEach((output): void => {
      delete output.bip32Derivation;
    });
    delete clonedPsbt.data.globalMap.globalXpub;

    const payjoinPsbt = await this.payjoinRequester.requestPayjoin(clonedPsbt);
    if (!payjoinPsbt) throw new Error("We did not get the receiver's PSBT");

    if (
      payjoinPsbt.data.globalMap.globalXpub &&
      (payjoinPsbt.data.globalMap.globalXpub as any[]).length > 0
    ) {
      throw new Error(
        "GlobalXPubs should not be included in the receiver's PSBT",
      );
    }
    if (
      hasKeypathInformationSet(payjoinPsbt.data.outputs) ||
      hasKeypathInformationSet(payjoinPsbt.data.inputs)
    ) {
      throw new Error(
        "Keypath information should not be included in the receiver's PSBT",
      );
    }

    const ourInputIndexes: number[] = [];
    // Add back input data from the original psbt (such as witnessUtxo)
    getGlobalTransaction(psbt).ins.forEach((originalInput, index): void => {
      const payjoinIndex = getInputIndex(
        payjoinPsbt,
        originalInput.hash,
        originalInput.index,
      );

      if (payjoinIndex === -1) {
        throw new Error(
          `Receiver's PSBT is missing input #${index} from the sent PSBT`,
        );
      }

      if (
        originalInput.sequence !==
        getGlobalTransaction(payjoinPsbt).ins[payjoinIndex].sequence
      ) {
        throw new Error(`Inputs from original PSBT have a different sequence`);
      }

      payjoinPsbt.updateInput(payjoinIndex, psbt.data.inputs[index]);
      const payjoinPsbtInput = payjoinPsbt.data.inputs[payjoinIndex];
      delete payjoinPsbtInput.partialSig;
      delete payjoinPsbtInput.finalScriptSig;
      delete payjoinPsbtInput.finalScriptWitness;

      ourInputIndexes.push(payjoinIndex);
    });

    const sanityResult = checkSanity(payjoinPsbt);
    if (Object.keys(sanityResult).length > 0) {
      throw new Error(
        `Receiver's PSBT is insane: ${JSON.stringify(sanityResult)}`,
      );
    }

    // We make sure we don't sign what should not be signed
    for (let index = 0; index < payjoinPsbt.inputCount; index++) {
      // check if input is Finalized
      const ourInput = ourInputIndexes.indexOf(index) !== -1;
      if (isFinalized(payjoinPsbt.data.inputs[index])) {
        if (ourInput) {
          throw new Error(
            `Receiver's PSBT included a finalized input from original PSBT `,
          );
        } else {
          payjoinPsbt.clearFinalizedInput(index);
        }
      } else if (!ourInput) {
        throw new Error(`Receiver's PSBT included a non-finalized new input`);
      }
    }

    for (let index = 0; index < payjoinPsbt.data.outputs.length; index++) {
      const output = payjoinPsbt.data.outputs[index];
      const outputLegacy = getGlobalTransaction(payjoinPsbt).outs[index];
      // Make sure only our output has any information
      delete output.bip32Derivation;
      psbt.data.outputs.forEach((originalOutput, i): void => {
        // update the payjoin outputs
        const originalOutputLegacy = getGlobalTransaction(psbt).outs[i];

        if (outputLegacy.script.equals(originalOutputLegacy.script))
          payjoinPsbt.updateOutput(index, originalOutput);
      });
    }

    if (
      getGlobalTransaction(payjoinPsbt).version !==
      getGlobalTransaction(psbt).version
    ) {
      throw new Error('The version field of the transaction has been modified');
    }
    if (
      getGlobalTransaction(payjoinPsbt).locktime !==
      getGlobalTransaction(psbt).locktime
    ) {
      throw new Error(
        'The LockTime field of the transaction has been modified',
      );
    }
    if (payjoinPsbt.data.inputs.length <= psbt.data.inputs.length) {
      throw new Error(
        `Receiver's PSBT should have more inputs than the sent PSBT`,
      );
    }

    if (getInputsScriptPubKeyType(payjoinPsbt) !== originalType) {
      throw new Error(
        `Receiver's PSBT included inputs which were of a different format than the sent PSBT`,
      );
    }
    // TODO: figure out the payment amount here, perhaps by specifying in a param which output is the change
    const originalBalanceChange = 0;
    const payjoinBalanceChange = 0;

    // TODO: make sure this logic is correct
    if (payjoinBalanceChange < originalBalanceChange) {
      const overPaying = payjoinBalanceChange - originalBalanceChange;
      const originalFee = getPsbtFee(clonedPsbt);
      const additionalFee = getPsbtFee(payjoinPsbt) - originalFee;
      if (overPaying > additionalFee)
        throw new Error(
          'The payjoin receiver is sending more money to himself',
        );
      if (overPaying > originalFee)
        throw new Error(
          'The payjoin receiver is making us pay more than twice the original fee',
        );
      const newVirtualSize = getGlobalTransaction(payjoinPsbt).virtualSize();
      // Let's check the difference is only for the fee and that feerate
      // did not changed that much
      const originalFeeRate = clonedPsbt.getFeeRate();
      let expectedFee = getFee(originalFeeRate, newVirtualSize);
      // Signing precisely is hard science, give some breathing room for error.
      expectedFee += getFee(originalFeeRate, payjoinPsbt.inputCount * 2);
      if (overPaying > expectedFee - originalFee)
        throw new Error(
          'The payjoin receiver increased the fee rate we are paying too much',
        );
    }

    const signedPsbt = await this.wallet.signPsbt(payjoinPsbt);
    const tx = signedPsbt.extractTransaction();

    // All looks good, schedule original psbt broadcast check.
    await this.wallet.scheduleBroadcastTx(
      psbt.finalizeAllInputs().extractTransaction().toHex(),
      BROADCAST_ATTEMPT_TIME,
    );
    // Now broadcast. If this fails, there's a possibility the server is
    // trying to leak information by double spending an input, this is why
    // we schedule broadcast of original BEFORE we broadcast the payjoin.
    // And it is why schedule broadcast is expected to fail. (why you must
    // not throw an error.)
    const response = await this.wallet.broadcastTx(tx.toHex());
    if (response !== '') {
      throw new Error('payjoin tx failed to broadcast.\nReason:\n' + response);
    }
  }
}

type PayjoinClientOpts = PayjoinClientOptsUrl | PayjoinClientOptsRequester;

interface PayjoinClientOptsUrl {
  wallet: IPayjoinClientWallet;
  payjoinUrl: string;
}

interface PayjoinClientOptsRequester {
  wallet: IPayjoinClientWallet;
  payjoinRequester: IPayjoinRequester;
}

function isRequesterOpts(
  opts: PayjoinClientOpts,
): opts is PayjoinClientOptsRequester {
  return (opts as PayjoinClientOptsRequester).payjoinRequester !== undefined;
}
