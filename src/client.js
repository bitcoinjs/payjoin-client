'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.PayjoinClient = void 0;
const request_1 = require('./request');
const utils_1 = require('./utils');
const BROADCAST_ATTEMPT_TIME = 2 * 60 * 1000; // 2 minute
class PayjoinClient {
  constructor(opts) {
    this.wallet = opts.wallet;
    this.payjoinParameters = opts.payjoinParameters;
    if (isRequesterOpts(opts)) {
      this.payjoinRequester = opts.payjoinRequester;
    } else {
      this.payjoinRequester = new request_1.PayjoinRequester(
        this.getEndpointUrl(opts.payjoinUrl, opts.payjoinParameters),
      );
    }
  }
  getEndpointUrl(url, payjoinParameters) {
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
  async run() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const psbt = await this.wallet.getPsbt();
    const clonedPsbt = psbt.clone();
    const originalType = utils_1.getInputsScriptPubKeyType(clonedPsbt);
    clonedPsbt.finalizeAllInputs();
    const originalTxHex = clonedPsbt.extractTransaction().toHex();
    const broadcastOriginalNow = () => this.wallet.broadcastTx(originalTxHex);
    try {
      // We make sure we don't send unnecessary information to the receiver
      for (let index = 0; index < clonedPsbt.inputCount; index++) {
        clonedPsbt.clearFinalizedInput(index);
      }
      clonedPsbt.data.outputs.forEach((output) => {
        delete output.bip32Derivation;
      });
      delete clonedPsbt.data.globalMap.globalXpub;
      const originalInputs = clonedPsbt.txInputs.map((value, index) => {
        return {
          originalTxIn: value,
          signedPSBTInput: clonedPsbt.data.inputs[index],
        };
      });
      const originalOutputs = clonedPsbt.txOutputs.map((value, index) => {
        return {
          originalTxOut: value,
          signedPSBTInput: clonedPsbt.data.outputs[index],
        };
      });
      const feeOutput =
        ((_a = this.payjoinParameters) === null || _a === void 0
          ? void 0
          : _a.additionalfeeoutputindex) !== undefined
          ? clonedPsbt.txOutputs[
              (_b = this.payjoinParameters) === null || _b === void 0
                ? void 0
                : _b.additionalfeeoutputindex
            ]
          : null;
      const originalFeeRate = clonedPsbt.getFeeRate();
      const allowOutputSubstitution = !(
        ((_c = this.payjoinParameters) === null || _c === void 0
          ? void 0
          : _c.disableOutputSubstitution) !== undefined &&
        ((_d = this.payjoinParameters) === null || _d === void 0
          ? void 0
          : _d.disableOutputSubstitution)
      );
      if (
        allowOutputSubstitution &&
        !((_e = this.payjoinParameters) === null || _e === void 0
          ? void 0
          : _e.paymentScript)
      ) {
        throw new Error(
          'paymentScript needs to be specified when disableOutputSubstitution is true',
        );
      }
      if (
        ((_f = this.payjoinParameters) === null || _f === void 0
          ? void 0
          : _f.additionalfeeoutputindex) !== undefined
      ) {
      }
      const payjoinPsbt = await this.payjoinRequester.requestPayjoin(
        clonedPsbt,
      );
      if (!payjoinPsbt) throw new Error("We did not get the receiver's PSBT");
      if (
        payjoinPsbt.data.globalMap.globalXpub &&
        payjoinPsbt.data.globalMap.globalXpub.length > 0
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
      const sequences = new Set();
      // For each inputs in the proposal:
      for (let i = 0; i < payjoinPsbt.data.inputs.length; i++) {
        let proposedPSBTInput = payjoinPsbt.data.inputs[i];
        if (utils_1.hasKeypathInformationSet(proposedPSBTInput))
          throw new Error('The receiver added keypaths to an input');
        if (
          proposedPSBTInput.partialSig &&
          proposedPSBTInput.partialSig.length > 0
        )
          throw new Error('The receiver added partial signatures to an input');
        var proposedTxIn = payjoinPsbt.txInputs[i];
        const ourInputIndex = utils_1.getInputIndex(
          clonedPsbt,
          proposedTxIn.hash,
          proposedTxIn.index,
        );
        const isOurInput = ourInputIndex >= 0;
        // If it is one of our input
        if (isOurInput) {
          const input = originalInputs.splice(0, 1)[0];
          // Verify that sequence is unchanged.
          if (input.originalTxIn.sequence != proposedTxIn.sequence)
            throw new Error(
              'The proposedTxIn modified the sequence of one of our inputs',
            );
          // Verify the PSBT input is not finalized
          if (utils_1.isFinalized(proposedPSBTInput))
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
          if (!utils_1.isFinalized(proposedPSBTInput))
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
          if (originalType != utils_1.getInputScriptPubKeyType(payjoinPsbt, i))
            throw new Error('Mixed input type detected in the proposal');
        }
      }
      // Verify that all of sender's inputs from the original PSBT are in the proposal.
      if (originalInputs.length != 0)
        throw new Error('Some of our inputs are not included in the proposal');
      // Verify that the payjoin proposal did not introduced mixed input's sequence.
      if (sequences.size != 1)
        throw new Error('Mixed sequence detected in the proposal');
      const originalFee = psbt.getFee();
      let newFee;
      try {
        newFee = payjoinPsbt.getFee();
      } catch (_q) {
        throw new Error(
          'The payjoin receiver did not included UTXO information to calculate fee correctly',
        );
      }
      var additionalFee = newFee - originalFee;
      if (additionalFee < 0)
        throw new Error('The receiver decreased absolute fee');
      // For each outputs in the proposal:
      for (let i = 0; i < payjoinPsbt.data.outputs.length; i++) {
        const proposedPSBTOutput = payjoinPsbt.data.outputs[i];
        const proposedTxOut = payjoinPsbt.txOutputs[i];
        // Verify that no keypaths is in the PSBT output
        if (utils_1.hasKeypathInformationSet(proposedPSBTOutput))
          throw new Error('The receiver added keypaths to an output');
        const isOriginalOutput =
          originalOutputs.length > 0 &&
          originalOutputs[0].originalTxOut.script.equals(
            payjoinPsbt.txOutputs[i].script,
          );
        if (isOriginalOutput) {
          var originalOutput = originalOutputs.splice(0, 1)[0];
          if (
            originalOutput.originalTxOut == feeOutput &&
            ((_g = this.payjoinParameters) === null || _g === void 0
              ? void 0
              : _g.maxadditionalfeecontribution)
          ) {
            var actualContribution = feeOutput.value - proposedTxOut.value;
            // The amount that was substracted from the output's value is less or equal to maxadditionalfeecontribution
            if (
              actualContribution >
              ((_h = this.payjoinParameters) === null || _h === void 0
                ? void 0
                : _h.maxadditionalfeecontribution)
            )
              throw new Error(
                'The actual contribution is more than maxadditionalfeecontribution',
              );
            // Make sure the actual contribution is only paying fee
            if (actualContribution > additionalFee)
              throw new Error('The actual contribution is not only paying fee');
            // Make sure the actual contribution is only paying for fee incurred by additional inputs
            var additionalInputsCount =
              payjoinPsbt.txInputs.length - clonedPsbt.txInputs.length;
            if (
              actualContribution >
              utils_1.getFee(
                originalFeeRate,
                utils_1.getVirtualSize(originalType),
              ) *
                additionalInputsCount
            )
              throw new Error(
                'The actual contribution is not only paying for additional inputs',
              );
          } else if (
            allowOutputSubstitution &&
            (!((_j = this.payjoinParameters) === null || _j === void 0
              ? void 0
              : _j.paymentScript) ||
              originalOutput.originalTxOut.script.equals(
                (_k = this.payjoinParameters) === null || _k === void 0
                  ? void 0
                  : _k.paymentScript,
              ))
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
      if (originalOutputs.length != 0) {
        if (
          !allowOutputSubstitution ||
          originalOutputs.length != 1 ||
          !((_l = this.payjoinParameters) === null || _l === void 0
            ? void 0
            : _l.paymentScript) ||
          !originalOutputs
            .splice(0, 1)[0]
            .originalTxOut.script.equals(
              (_m = this.payjoinParameters) === null || _m === void 0
                ? void 0
                : _m.paymentScript,
            )
        ) {
          throw new Error(
            'Some of our outputs are not included in the proposal',
          );
        }
      }
      // If minfeerate was specified, check that the fee rate of the payjoin transaction is not less than this value.
      if (
        (_o = this.payjoinParameters) === null || _o === void 0
          ? void 0
          : _o.minimumFeeRate
      ) {
        let newFeeRate;
        try {
          newFeeRate = payjoinPsbt.getFeeRate();
        } catch (_r) {
          throw new Error(
            'The payjoin receiver did not included UTXO information to calculate fee correctly',
          );
        }
        if (
          newFeeRate <
          ((_p = this.payjoinParameters) === null || _p === void 0
            ? void 0
            : _p.minimumFeeRate)
        )
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
exports.PayjoinClient = PayjoinClient;
function isRequesterOpts(opts) {
  return opts.payjoinRequester !== undefined;
}
