import { IPayjoinRequester, PayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
import {
  checkSanity,
  getInputIndex,
  getInputsScriptPubKeyType,
  getFee,
  hasKeypathInformationSet,
  isFinalized,
  SUPPORTED_WALLET_FORMATS,
} from './utils';

const BROADCAST_ATTEMPT_TIME = 1 * 60 * 1000; // 1 minute

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

    const originalTxHex = clonedPsbt.extractTransaction().toHex();
    const broadcastOriginalNow = (): Promise<string> =>
      this.wallet.broadcastTx(originalTxHex);

    try {
      if (SUPPORTED_WALLET_FORMATS.indexOf(originalType) === -1) {
        throw new Error(
          'Inputs used do not support payjoin, they must be segwit (p2wpkh or p2sh-p2wpkh)',
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

      const payjoinPsbt = await this.payjoinRequester.requestPayjoin(
        clonedPsbt,
      );
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
      psbt.txInputs.forEach((originalInput, index): void => {
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
          originalInput.sequence !== payjoinPsbt.txInputs[payjoinIndex].sequence
        ) {
          throw new Error(
            `Input #${index} from original PSBT have a different sequence`,
          );
        }

        payjoinPsbt.updateInput(payjoinIndex, psbt.data.inputs[index]);
        const payjoinPsbtInput = payjoinPsbt.data.inputs[payjoinIndex];
        // In theory these shouldn't be here, but just in case, we need to
        // re-sign so this is throwing away the invalidated data.
        delete payjoinPsbtInput.partialSig;
        delete payjoinPsbtInput.finalScriptSig;
        delete payjoinPsbtInput.finalScriptWitness;

        ourInputIndexes.push(payjoinIndex);
      });

      const sanityResult = checkSanity(payjoinPsbt);
      if (
        !sanityResult.every((inputErrors): boolean => inputErrors.length === 0)
      ) {
        throw new Error(
          `Receiver's PSBT is insane:\n${JSON.stringify(
            sanityResult,
            null,
            2,
          )}`,
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
        const outputLegacy = payjoinPsbt.txOutputs[index];
        // Make sure only our output has any information
        delete output.bip32Derivation;
        psbt.data.outputs.forEach((originalOutput, i): void => {
          // update the payjoin outputs
          const originalOutputLegacy = psbt.txOutputs[i];

          if (outputLegacy.script.equals(originalOutputLegacy.script))
            payjoinPsbt.updateOutput(index, originalOutput);
        });
      }

      if (payjoinPsbt.version !== psbt.version) {
        throw new Error(
          'The version field of the transaction has been modified',
        );
      }
      if (payjoinPsbt.locktime !== psbt.locktime) {
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

      const paidBack = await this.wallet.getSumPaidToUs(psbt);
      const payjoinPaidBack = await this.wallet.getSumPaidToUs(payjoinPsbt);

      const signedPsbt = await this.wallet.signPsbt(payjoinPsbt);
      const tx = signedPsbt.extractTransaction();
      psbt.finalizeAllInputs();

      // TODO: make sure this logic is correct
      if (payjoinPaidBack < paidBack) {
        const overPaying = paidBack - payjoinPaidBack;
        const originalFee = psbt.getFee();
        const additionalFee = signedPsbt.getFee() - originalFee;
        if (overPaying > additionalFee)
          throw new Error(
            'The payjoin receiver is sending more money to himself',
          );
        if (overPaying > originalFee)
          throw new Error(
            'The payjoin receiver is making us pay more than twice the original fee',
          );
        const newVirtualSize = tx.virtualSize();
        // Let's check the difference is only for the fee and that feerate
        // did not changed that much
        const originalFeeRate = psbt.getFeeRate();
        let expectedFee = getFee(originalFeeRate, newVirtualSize);
        // Signing precisely is hard science, give some breathing room for error.
        expectedFee += getFee(originalFeeRate, payjoinPsbt.inputCount * 2);
        if (overPaying > expectedFee - originalFee)
          throw new Error(
            'The payjoin receiver increased the fee rate we are paying too much',
          );
      }

      // Now broadcast. If this fails, there's a possibility the server is
      // trying to leak information by double spending an input, this is why
      // we schedule broadcast of original BEFORE we broadcast the payjoin.
      // And it is why schedule broadcast is expected to fail. (why you must
      // not throw an error.)
      const response = await this.wallet.broadcastTx(tx.toHex());
      if (response !== '') {
        throw new Error(
          'payjoin tx failed to broadcast.\nReason:\n' + response,
        );
      } else {
        // Schedule original tx broadcast after succeeding, just in case.
        await this.wallet.scheduleBroadcastTx(
          originalTxHex,
          BROADCAST_ATTEMPT_TIME,
        );
      }
    } catch (e) {
      // If anything goes wrong, broadcast original immediately.
      await broadcastOriginalNow();
      throw e;
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
