import { IPayjoinRequester, PayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
import {
  getFee,
  getInputIndex,
  getInputScriptPubKeyType,
  getInputsScriptPubKeyType,
  getVirtualSize,
  hasKeypathInformationSet,
  isFinalized,
} from './utils';
import { PsbtTxInput, PsbtTxOutput } from 'bitcoinjs-lib';
import { PsbtInput, PsbtOutput } from 'bip174/src/lib/interfaces';

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
  constructor(private opts: PayjoinClientOpts) {
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
      const originalInputs = clonedPsbt.txInputs.map((value, index): {
        originalTxIn: PsbtTxInput;
        signedPSBTInput: PsbtInput;
      } => {
        return {
          originalTxIn: value,
          signedPSBTInput: clonedPsbt.data.inputs[index],
        };
      });
      const originalOutputs = clonedPsbt.txOutputs.map((value, index): {
        originalTxOut: PsbtTxOutput;
        signedPSBTInput: PsbtOutput;
      } => {
        return {
          originalTxOut: value,
          signedPSBTInput: clonedPsbt.data.outputs[index],
        };
      });
      const feeOutput =
        this.payjoinParameters?.additionalfeeoutputindex !== undefined
          ? clonedPsbt.txOutputs[
              this.payjoinParameters?.additionalfeeoutputindex
            ]
          : null;
      const originalFeeRate = clonedPsbt.getFeeRate();
      const allowOutputSubstitution = !(
        this.payjoinParameters?.disableOutputSubstitution !== undefined &&
        this.payjoinParameters?.disableOutputSubstitution
      );
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

      if (payjoinPsbt.version !== clonedPsbt.version) {
        throw new Error('The proposal PSBT changed the transaction version');
      }

      if (payjoinPsbt.locktime !== clonedPsbt.locktime) {
        throw new Error('The proposal PSBT changed the nLocktime');
      }

      const sequences: Set<number> = new Set<number>();

      // For each inputs in the proposal:
      for (let i = 0; i < payjoinPsbt.data.inputs.length; i++) {
        const proposedPSBTInput = payjoinPsbt.data.inputs[i];
        if (hasKeypathInformationSet(proposedPSBTInput))
          throw new Error('The receiver added keypaths to an input');
        if (
          proposedPSBTInput.partialSig &&
          proposedPSBTInput.partialSig.length > 0
        )
          throw new Error('The receiver added partial signatures to an input');

        const proposedTxIn = payjoinPsbt.txInputs[i];
        const ourInputIndex = getInputIndex(
          clonedPsbt,
          proposedTxIn.hash,
          proposedTxIn.index,
        );
        const isOurInput = ourInputIndex >= 0;
        // If it is one of our input
        if (isOurInput) {
          const input = originalInputs.splice(0, 1)[0];
          // Verify that sequence is unchanged.
          if (input.originalTxIn.sequence !== proposedTxIn.sequence)
            throw new Error(
              'The proposedTxIn modified the sequence of one of our inputs',
            );
          // Verify the PSBT input is not finalized
          if (isFinalized(proposedPSBTInput))
            throw new Error('The receiver finalized one of our inputs');
          // Verify that <code>non_witness_utxo</code> and <code>witness_utxo</code> are not specified.
          if (proposedPSBTInput.nonWitnessUtxo || proposedPSBTInput.witnessUtxo)
            throw new Error(
              'The receiver added non_witness_utxo or witness_utxo to one of our inputs',
            );
          if (proposedTxIn.sequence != null) {
            sequences.add(proposedTxIn.sequence);
          }

          // Fill up the info from the original PSBT input so we can sign and get fees.
          proposedPSBTInput.nonWitnessUtxo =
            input.signedPSBTInput.nonWitnessUtxo;
          proposedPSBTInput.witnessUtxo = input.signedPSBTInput.witnessUtxo;
          // We fill up information we had on the signed PSBT, so we can sign it.

          payjoinPsbt.updateInput(i, input.signedPSBTInput);
        } else {
          // Verify the PSBT input is finalized
          if (!isFinalized(proposedPSBTInput))
            throw new Error(
              'The receiver did not finalized one of their input',
            );
          // Verify that non_witness_utxo or witness_utxo are filled in.
          if (
            !proposedPSBTInput.nonWitnessUtxo &&
            !proposedPSBTInput.witnessUtxo
          )
            throw new Error(
              'The receiver did not specify non_witness_utxo or witness_utxo for one of their inputs',
            );
          if (proposedTxIn.sequence != null) {
            sequences.add(proposedTxIn.sequence);
          }
          // Verify that the payjoin proposal did not introduced mixed input's type.
          if (originalType !== getInputScriptPubKeyType(payjoinPsbt, i))
            throw new Error('Mixed input type detected in the proposal');
        }
      }

      // Verify that all of sender's inputs from the original PSBT are in the proposal.
      if (originalInputs.length !== 0)
        throw new Error('Some of our inputs are not included in the proposal');

      // Verify that the payjoin proposal did not introduced mixed input's sequence.
      if (sequences.size !== 1)
        throw new Error('Mixed sequence detected in the proposal');

      const originalFee = psbt.getFee();
      let newFee: number;
      try {
        newFee = payjoinPsbt.getFee();
      } catch {
        throw new Error(
          'The payjoin receiver did not included UTXO information to calculate fee correctly',
        );
      }
      const additionalFee = newFee - originalFee;
      if (additionalFee < 0)
        throw new Error('The receiver decreased absolute fee');

      // For each outputs in the proposal:
      for (let i = 0; i < payjoinPsbt.data.outputs.length; i++) {
        const proposedPSBTOutput = payjoinPsbt.data.outputs[i];
        const proposedTxOut = payjoinPsbt.txOutputs[i];

        // Verify that no keypaths is in the PSBT output

        if (hasKeypathInformationSet(proposedPSBTOutput))
          throw new Error('The receiver added keypaths to an output');

        const isOriginalOutput =
          originalOutputs.length > 0 &&
          originalOutputs[0].originalTxOut.script.equals(
            payjoinPsbt.txOutputs[i].script,
          );
        if (isOriginalOutput) {
          const originalOutput = originalOutputs.splice(0, 1)[0];
          if (
            originalOutput.originalTxOut === feeOutput &&
            this.payjoinParameters?.maxadditionalfeecontribution
          ) {
            const actualContribution = feeOutput.value - proposedTxOut.value;
            // The amount that was substracted from the output's value is less or equal to maxadditionalfeecontribution
            if (
              actualContribution >
              this.payjoinParameters?.maxadditionalfeecontribution
            )
              throw new Error(
                'The actual contribution is more than maxadditionalfeecontribution',
              );
            // Make sure the actual contribution is only paying fee
            if (actualContribution > additionalFee)
              throw new Error('The actual contribution is not only paying fee');
            // Make sure the actual contribution is only paying for fee incurred by additional inputs
            const additionalInputsCount =
              payjoinPsbt.txInputs.length - clonedPsbt.txInputs.length;
            if (
              actualContribution >
              getFee(originalFeeRate, getVirtualSize(originalType)) *
                additionalInputsCount
            )
              throw new Error(
                'The actual contribution is not only paying for additional inputs',
              );
          } else if (
            allowOutputSubstitution &&
            originalOutput.originalTxOut.script.equals(this.opts.paymentScript)
          ) {
            // That's the payment output, the receiver may have changed it.
          } else {
            if (originalOutput.originalTxOut.value > proposedTxOut.value)
              throw new Error(
                'The receiver decreased the value of one of the outputs',
              );
          }
          // We fill up information we had on the signed PSBT, so we can sign it.
          payjoinPsbt.updateOutput(i, proposedPSBTOutput);
        }
      }
      // Verify that all of sender's outputs from the original PSBT are in the proposal.
      if (originalOutputs.length !== 0) {
        if (
          !allowOutputSubstitution ||
          originalOutputs.length !== 1 ||
          !originalOutputs
            .splice(0, 1)[0]
            .originalTxOut.script.equals(this.opts.paymentScript)
        ) {
          throw new Error(
            'Some of our outputs are not included in the proposal',
          );
        }
      }

      // If minfeerate was specified, check that the fee rate of the payjoin transaction is not less than this value.
      if (this.payjoinParameters?.minimumFeeRate) {
        let newFeeRate: number;
        try {
          newFeeRate = payjoinPsbt.getFeeRate();
        } catch {
          throw new Error(
            'The payjoin receiver did not included UTXO information to calculate fee correctly',
          );
        }
        if (newFeeRate < this.payjoinParameters?.minimumFeeRate)
          throw new Error(
            'The payjoin receiver created a payjoin with a too low fee rate',
          );
      }

      const signedPsbt = await this.wallet.signPsbt(payjoinPsbt);
      const tx = signedPsbt.extractTransaction();

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
  paymentScript: Buffer;
  payjoinParameters?: PayjoinClientOptionalParameters;
}

interface PayjoinClientOptsRequester {
  wallet: IPayjoinClientWallet;
  payjoinRequester: IPayjoinRequester;
  paymentScript: Buffer;
  payjoinParameters?: PayjoinClientOptionalParameters;
}

function isRequesterOpts(
  opts: PayjoinClientOpts,
): opts is PayjoinClientOptsRequester {
  return (opts as PayjoinClientOptsRequester).payjoinRequester !== undefined;
}
