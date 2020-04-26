'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const request_1 = require('./request');
const utils_1 = require('./utils');
const BROADCAST_ATTEMPT_TIME = 2 * 60 * 1000; // 2 minutes
class PayjoinClient {
  constructor(opts) {
    this.wallet = opts.wallet;
    if (isRequesterOpts(opts)) {
      this.payjoinRequester = opts.payjoinRequester;
    } else {
      this.payjoinRequester = new request_1.PayjoinRequester(opts.payjoinUrl);
    }
  }
  async run() {
    const psbt = await this.wallet.getPsbt();
    const clonedPsbt = psbt.clone();
    const originalType = utils_1.getInputsScriptPubKeyType(clonedPsbt);
    clonedPsbt.finalizeAllInputs();
    if (utils_1.SUPPORTED_WALLET_FORMATS.indexOf(originalType) === -1) {
      throw new Error(
        'Inputs used do not support payjoin, they must be segwit',
      );
    }
    // We make sure we don't send unnecessary information to the receiver
    for (let index = 0; index < clonedPsbt.inputCount; index++) {
      clonedPsbt.clearFinalizedInput(index);
    }
    clonedPsbt.data.outputs.forEach((output) => {
      delete output.bip32Derivation;
    });
    delete clonedPsbt.data.globalMap.globalXpub;
    const payjoinPsbt = await this.payjoinRequester.requestPayjoin(clonedPsbt);
    if (!payjoinPsbt) throw new Error("We did not get the receiver's PSBT");
    if (
      payjoinPsbt.data.globalMap.globalXpub &&
      payjoinPsbt.data.globalMap.globalXpub.length > 0
    ) {
      throw new Error(
        "GlobalXPubs should not be included in the receiver's PSBT",
      );
    }
    if (
      utils_1.hasKeypathInformationSet(payjoinPsbt.data.outputs) ||
      utils_1.hasKeypathInformationSet(payjoinPsbt.data.inputs)
    ) {
      throw new Error(
        "Keypath information should not be included in the receiver's PSBT",
      );
    }
    const ourInputIndexes = [];
    // Add back input data from the original psbt (such as witnessUtxo)
    utils_1.getGlobalTransaction(psbt).ins.forEach((originalInput, index) => {
      const payjoinIndex = utils_1.getInputIndex(
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
        utils_1.getGlobalTransaction(payjoinPsbt).ins[payjoinIndex].sequence
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
    const sanityResult = utils_1.checkSanity(payjoinPsbt);
    if (Object.keys(sanityResult).length > 0) {
      throw new Error(
        `Receiver's PSBT is insane: ${JSON.stringify(sanityResult)}`,
      );
    }
    // We make sure we don't sign what should not be signed
    for (let index = 0; index < payjoinPsbt.inputCount; index++) {
      // check if input is Finalized
      const ourInput = ourInputIndexes.indexOf(index) !== -1;
      if (utils_1.isFinalized(payjoinPsbt.data.inputs[index])) {
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
      const outputLegacy = utils_1.getGlobalTransaction(payjoinPsbt).outs[
        index
      ];
      // Make sure only our output has any information
      delete output.bip32Derivation;
      psbt.data.outputs.forEach((originalOutput, i) => {
        // update the payjoin outputs
        const originalOutputLegacy = utils_1.getGlobalTransaction(psbt).outs[i];
        if (outputLegacy.script.equals(originalOutputLegacy.script))
          payjoinPsbt.updateOutput(index, originalOutput);
      });
    }
    if (
      utils_1.getGlobalTransaction(payjoinPsbt).version !==
      utils_1.getGlobalTransaction(psbt).version
    ) {
      throw new Error('The version field of the transaction has been modified');
    }
    if (
      utils_1.getGlobalTransaction(payjoinPsbt).locktime !==
      utils_1.getGlobalTransaction(psbt).locktime
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
    if (utils_1.getInputsScriptPubKeyType(payjoinPsbt) !== originalType) {
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
      const overPaying = payjoinPaidBack - paidBack;
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
      let expectedFee = utils_1.getFee(originalFeeRate, newVirtualSize);
      // Signing precisely is hard science, give some breathing room for error.
      expectedFee += utils_1.getFee(
        originalFeeRate,
        payjoinPsbt.inputCount * 2,
      );
      if (overPaying > expectedFee - originalFee)
        throw new Error(
          'The payjoin receiver increased the fee rate we are paying too much',
        );
    }
    // All looks good, schedule original psbt broadcast check.
    await this.wallet.scheduleBroadcastTx(
      psbt.extractTransaction().toHex(),
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
exports.PayjoinClient = PayjoinClient;
function isRequesterOpts(opts) {
  return opts.payjoinRequester !== undefined;
}
