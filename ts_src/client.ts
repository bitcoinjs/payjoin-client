import { Psbt } from 'bitcoinjs-lib';
import { IPayjoinRequester, PayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
import {
  checkSanity,
  getInputIndex,
  getInputsScriptPubKeyType,
  getFee,
  hasKeypathInformationSet,
  isFinalized,
} from './utils';

const BROADCAST_ATTEMPT_TIME = 2 * 60 * 1000; // 2 minute

export interface PayjoinClientOptionalParameters {
  disableOutputSubstitution?: boolean;
  payjoinVersion?: number;
  additionalfeeoutputindex?: number;
  maxadditionalfeecontribution?: number;
  minimumFeeRate?: number;
}

export class PayjoinClient {
  private wallet: IPayjoinClientWallet;
  private payjoinRequester: IPayjoinRequester;
  private payjoinParameters?: PayjoinClientOptionalParameters;
  constructor(opts: PayjoinClientOpts) {
    this.wallet = opts.wallet;
    this.payjoinParameters = opts.payjoinParameters;
    if (isRequesterOpts(opts)) {
      this.payjoinRequester = opts.payjoinRequester;
    } else {
      this.payjoinRequester = new PayjoinRequester(
        this.getEndpointUrl(opts.payjoinUrl, opts.payjoinParameters),
      );
    }
  }

  private getEndpointUrl(
    url: string,
    payjoinParameters?: PayjoinClientOptionalParameters,
  ): string {
    if (!payjoinParameters) {
      return url;
    }
    const parsedURL = new URL(url);

    if (payjoinParameters.disableOutputSubstitution !== undefined) {
      parsedURL.searchParams.set(
        'disableoutputsubstitution',
        payjoinParameters.disableOutputSubstitution.toString(),
      );
    }
    if (payjoinParameters.payjoinVersion !== undefined) {
      parsedURL.searchParams.set(
        'v',
        payjoinParameters.payjoinVersion.toString(),
      );
    }
    if (payjoinParameters.minimumFeeRate !== undefined) {
      parsedURL.searchParams.set(
        'minfeerate',
        payjoinParameters.minimumFeeRate.toString(),
      );
    }
    if (payjoinParameters.maxadditionalfeecontribution !== undefined) {
      parsedURL.searchParams.set(
        'maxadditionalfeecontribution',
        payjoinParameters.maxadditionalfeecontribution.toString(),
      );
    }
    if (payjoinParameters.additionalfeeoutputindex !== undefined) {
      parsedURL.searchParams.set(
        'additionalfeeoutputindex',
        payjoinParameters.additionalfeeoutputindex.toString(),
      );
    }
    return parsedURL.href;
  }

  private async getSumPaidToUs(psbt: Psbt): Promise<number> {
    let sumPaidToUs = 0;

    for (const input of psbt.data.inputs) {
      const { bip32Derivation } = input;
      const pathFromRoot = bip32Derivation && bip32Derivation[0].path;
      if (
        await this.wallet.isOwnOutputScript(
          input.witnessUtxo!.script,
          pathFromRoot,
        )
      ) {
        sumPaidToUs -= input.witnessUtxo!.value;
      }
    }

    for (const [index, output] of Object.entries(psbt.txOutputs)) {
      const { bip32Derivation } = psbt.data.outputs[parseInt(index, 10)];
      const pathFromRoot = bip32Derivation && bip32Derivation[0].path;
      if (await this.wallet.isOwnOutputScript(output.script, pathFromRoot)) {
        sumPaidToUs += output.value;
      }
    }

    return sumPaidToUs;
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

      if (this.payjoinParameters?.disableOutputSubstitution) {
        // Verify that all of sender's outputs from the original PSBT are in the proposal.
        psbt.data.outputs.forEach((_originalOutput, i): void => {
          const outputLegacy = psbt.txOutputs[i];
          let found = false;
          for (
            let payjoinIndex = 0;
            payjoinIndex < payjoinPsbt.data.outputs.length;
            payjoinIndex++
          ) {
            const payjoinOutputLegacy = payjoinPsbt.txOutputs[payjoinIndex];

            if (outputLegacy.script.equals(payjoinOutputLegacy.script)) {
              found = true;
              if (
                this.payjoinParameters?.additionalfeeoutputindex === undefined
              ) {
                break;
              }
              if (this.payjoinParameters?.additionalfeeoutputindex === i) {
                // validate maxadditionalfeecontribution
                const differenceInValueOfOuputs =
                  payjoinOutputLegacy.value - outputLegacy.value;
                if (
                  this.payjoinParameters?.maxadditionalfeecontribution !==
                    undefined &&
                  differenceInValueOfOuputs >
                    this.payjoinParameters?.maxadditionalfeecontribution
                ) {
                  throw new Error(
                    'The actual contribution is more than maxadditionalfeecontribution',
                  );
                }
              } else {
                // Make sure the output's value did not decrease if it is not the specified index where fee should be deducted from
                if (outputLegacy.value - payjoinOutputLegacy.value > 0) {
                  throw new Error(
                    `Sender output #${i} value was modified when only #${this.payjoinParameters?.additionalfeeoutputindex} should have changed`,
                  );
                }
              }
            }
          }
          if (!found) {
            throw new Error(
              `Some of our outputs are not included in the proposal`,
            );
          }
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

      const paidBack = await this.getSumPaidToUs(psbt);
      const payjoinPaidBack = await this.getSumPaidToUs(payjoinPsbt);

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
        if (
          this.payjoinParameters?.maxadditionalfeecontribution !== undefined &&
          overPaying > this.payjoinParameters?.maxadditionalfeecontribution
        ) {
          throw new Error(
            'The actual contribution is more than maxadditionalfeecontribution',
          );
        } else if (overPaying > originalFee)
          throw new Error(
            'The payjoin receiver is making us pay more than twice the original fee',
          );

        const newVirtualSize = tx.virtualSize();
        // Let's check the difference is only for the fee and that feerate
        // did not changed that much
        const originalFeeRate = psbt.getFeeRate();

        if (
          this.payjoinParameters?.minimumFeeRate &&
          this.payjoinParameters.minimumFeeRate > signedPsbt.getFeeRate()
        ) {
          throw new Error(
            'The payjoin receiver created a payjoin with a too low fee rate',
          );
        }
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
  payjoinParameters?: PayjoinClientOptionalParameters;
}

interface PayjoinClientOptsRequester {
  wallet: IPayjoinClientWallet;
  payjoinRequester: IPayjoinRequester;
  payjoinParameters?: PayjoinClientOptionalParameters;
}

function isRequesterOpts(
  opts: PayjoinClientOpts,
): opts is PayjoinClientOptsRequester {
  return (opts as PayjoinClientOptsRequester).payjoinRequester !== undefined;
}
