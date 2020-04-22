'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const bitcoinjs_lib_1 = require('bitcoinjs-lib');
const fetch = require('isomorphic-fetch');
var ScriptPubKeyType;
(function (ScriptPubKeyType) {
  /// <summary>
  /// Derive P2PKH addresses (P2PKH)
  /// Only use this for legacy code or coins not supporting segwit
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['Legacy'] = 0)] = 'Legacy';
  /// <summary>
  /// Derive Segwit (Bech32) addresses (P2WPKH)
  /// This will result in the cheapest fees. This is the recommended choice.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['Segwit'] = 1)] = 'Segwit';
  /// <summary>
  /// Derive P2SH address of a Segwit address (P2WPKH-P2SH)
  /// Use this when you worry that your users do not support Bech address format.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['SegwitP2SH'] = 2)] = 'SegwitP2SH';
})(ScriptPubKeyType || (ScriptPubKeyType = {}));
exports.supportedWalletFormats = [
  ScriptPubKeyType.Segwit,
  ScriptPubKeyType.SegwitP2SH,
];
// The following is lifted straight from:
// https://github.com/bitcoinjs/bitcoinjs-lib/blob/f67aab371c1d47684b3c211643a39e8e0295b306/src/psbt.js
// Seems pretty useful, maybe we should export classifyScript() from bitcoinjs-lib?
function isPaymentFactory(payment) {
  return (script) => {
    try {
      payment({ output: script });
      return true;
    } catch (err) {
      return false;
    }
  };
}
const isP2WPKH = isPaymentFactory(bitcoinjs_lib_1.payments.p2wpkh);
const isP2WSHScript = isPaymentFactory(bitcoinjs_lib_1.payments.p2wsh);
async function requestPayjoinWithCustomRemoteCall(psbt, remoteCall) {
  const clonedPsbt = psbt.clone();
  clonedPsbt.finalizeAllInputs();
  const originalType = getInputsScriptPubKeyType(clonedPsbt);
  if (
    !originalType ||
    exports.supportedWalletFormats.indexOf(
      getInputsScriptPubKeyType(clonedPsbt),
    ) === -1
  ) {
    throw new Error(
      'Inputs used do not support payjoin (need to be segwit and need to be all the same)',
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
  const payjoinPsbt = await remoteCall(clonedPsbt);
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
    hasKeypathInformationSet(payjoinPsbt.data.outputs) ||
    hasKeypathInformationSet(payjoinPsbt.data.inputs)
  ) {
    throw new Error(
      "Keypath information should not be included in the receiver's PSBT",
    );
  }
  const ourInputIndexes = [];
  // Add back input data from the original psbt (such as witnessUtxo)
  for (const [index, originalInput] of getGlobalTransaction(
    clonedPsbt,
  ).ins.entries()) {
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
    payjoinPsbt.updateInput(payjoinIndex, clonedPsbt.data.inputs[index]);
    const payjoinPsbtInput = payjoinPsbt.data.inputs[payjoinIndex];
    delete payjoinPsbtInput.partialSig;
    delete payjoinPsbtInput.finalScriptSig;
    delete payjoinPsbtInput.finalScriptWitness;
    ourInputIndexes.push(payjoinIndex);
  }
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
        const originalInputs = clonedPsbt.data.inputs;
        const payjoinInputs = payjoinPsbt.data.inputs;
        const input = payjoinInputs[index];
        console.log('originalInputs', originalInputs);
        console.log('payjoinInputs', payjoinInputs);
        console.log('index', index);
        console.log('input', input);
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
    psbt.data.outputs.forEach((originalOutput) => {
      // update the payjoin outputs
      if (
        outputLegacy.script.equals(
          // TODO: what if output is P2SH or P2WSH or anything other than P2WPKH?
          // Can we assume output will contain redeemScript and witnessScript?
          // If so, we could decompile scriptPubkey, RS, and WS, and search for
          // the pubkey and its hash160.
          bitcoinjs_lib_1.payments.p2wpkh({
            pubkey: originalOutput.bip32Derivation[0].pubkey,
          }).output,
        )
      )
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
    throw new Error('The LockTime field of the transaction has been modified');
  }
  if (payjoinPsbt.data.inputs.length <= psbt.data.inputs.length) {
    throw new Error(
      `Receiver's PSBT should have more inputs than the sent PSBT`,
    );
  }
  // TODO: check payjoinPsbt.inputs where input is new, that it is the same type as all other inputs from psbt.inputs (all==P2WPKH || all = P2SH-P2WPKH)
  // TODO: check that if spend amount of payjoinPsbt > spend amount of psbt:
  // TODO: * check if the difference is due to adjusting fee to increase transaction size
  return payjoinPsbt;
}
exports.requestPayjoinWithCustomRemoteCall = requestPayjoinWithCustomRemoteCall;
async function requestPayjoin(psbt, payjoinEndpoint) {
  return requestPayjoinWithCustomRemoteCall(psbt, (psbt1) =>
    doRequest(psbt1, payjoinEndpoint),
  );
}
exports.requestPayjoin = requestPayjoin;
function checkSanity(psbt) {
  const result = {};
  psbt.data.inputs.forEach((value, index) => {
    const sanityResult = checkInputSanity(
      value,
      getGlobalTransaction(psbt).ins[index],
    );
    if (sanityResult.length > 0) {
      result[index] = sanityResult;
    }
  });
  return result;
}
function checkInputSanity(input, txInput) {
  const errors = [];
  if (isFinalized(input)) {
    if (input.partialSig && input.partialSig.length > 0) {
      errors.push('Input finalized, but partial sigs are not empty');
    }
    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      errors.push('Input finalized, but hd keypaths are not empty');
    }
    if (input.sighashType) {
      errors.push('Input finalized, but sighash type is not null');
    }
    if (input.redeemScript) {
      errors.push('Input finalized, but redeem script is not null');
    }
    if (input.witnessScript) {
      errors.push('Input finalized, but witness script is not null');
    }
  }
  if (input.witnessUtxo && input.nonWitnessUtxo) {
    errors.push('witness utxo and non witness utxo simultaneously present');
  }
  if (input.witnessScript && !input.witnessUtxo) {
    errors.push('witness script present but no witness utxo');
  }
  if (!input.finalScriptWitness && !input.witnessUtxo) {
    errors.push('final witness script present but no witness utxo');
  }
  if (input.nonWitnessUtxo) {
    const prevTx = bitcoinjs_lib_1.Transaction.fromBuffer(input.nonWitnessUtxo);
    const prevOutTxId = prevTx.getHash();
    let validOutpoint = true;
    if (!txInput.hash.equals(prevOutTxId)) {
      errors.push(
        'non_witness_utxo does not match the transaction id referenced by the global transaction sign',
      );
      validOutpoint = false;
    }
    if (txInput.index >= prevTx.outs.length) {
      errors.push(
        'Global transaction referencing an out of bound output in non_witness_utxo',
      );
      validOutpoint = false;
    }
    if (input.redeemScript && validOutpoint) {
      if (
        !redeemScriptToScriptPubkey(input.redeemScript).equals(
          prevTx.outs[txInput.index].script,
        )
      )
        errors.push(
          'The redeem_script is not coherent with the scriptPubKey of the non_witness_utxo',
        );
    }
  }
  if (input.witnessUtxo) {
    if (input.redeemScript) {
      if (
        !redeemScriptToScriptPubkey(input.redeemScript).equals(
          input.witnessUtxo.script,
        )
      )
        errors.push(
          'The redeem_script is not coherent with the scriptPubKey of the witness_utxo',
        );
      if (
        input.witnessScript &&
        input.redeemScript &&
        !input.redeemScript.equals(
          witnessScriptToScriptPubkey(input.witnessScript),
        )
      )
        errors.push(
          'witnessScript with witness UTXO does not match the redeemScript',
        );
    }
  }
  // TODO: if witnessUtxo is p2sh
  // if (input.witnessUtxo.ScriptPubKey is  Script s)
  // {
  //   if (!s.IsScriptType(ScriptType.P2SH) && !s.IsScriptType(ScriptType.Witness))
  //     errors.push('A Witness UTXO is provided for a non-witness input');
  //   if (s.IsScriptType(ScriptType.P2SH) && redeem_script is Script r && !r.IsScriptType(ScriptType.Witness))
  //   errors.push('A Witness UTXO is provided for a non-witness input');
  // }
  return errors;
}
function getInputsScriptPubKeyType(psbt) {
  if (
    !isAllFinalized(psbt) ||
    psbt.data.inputs.filter((i) => !i.witnessUtxo).length > 0
  )
    throw new Error('The psbt should be finalized with witness information');
  let result = null;
  for (const input of psbt.data.inputs) {
    const inputScript = input.witnessUtxo.script;
    const type = getInputScriptPubKeyType(inputScript);
    if (type == null || (result !== null && type !== result)) {
      return null;
    }
    result = type;
  }
  return result;
}
// TODO: I think these checks are correct, get Jon to double check they do what
// I think they do...
// There might be some extra stuff needed for ScriptPubKeyType.SegwitP2SH.
function getInputScriptPubKeyType(inputScript) {
  if (isP2WPKH(inputScript)) {
    return ScriptPubKeyType.Segwit;
  } else if (isP2WSHScript(inputScript)) {
    return ScriptPubKeyType.SegwitP2SH;
  }
  return ScriptPubKeyType.Legacy;
}
function redeemScriptToScriptPubkey(redeemScript) {
  return bitcoinjs_lib_1.payments.p2sh({ redeem: { output: redeemScript } })
    .output;
}
function witnessScriptToScriptPubkey(witnessScript) {
  return bitcoinjs_lib_1.payments.p2wsh({ redeem: { output: witnessScript } })
    .output;
}
function hasKeypathInformationSet(items) {
  return (
    items.filter(
      (value) => !!value.bip32Derivation && value.bip32Derivation.length > 0,
    ).length > 0
  );
}
function isFinalized(input) {
  return (
    input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined
  );
}
function isAllFinalized(psbt) {
  for (const input of psbt.data.inputs) {
    if (!isFinalized(input)) {
      return false;
    }
  }
  return true;
}
function getGlobalTransaction(psbt) {
  // TODO: bitcoinjs-lib to expose outputs to Psbt class
  // instead of using private (JS has no private) attributes
  // @ts-ignore
  return psbt.__CACHE.__TX;
}
function getInputIndex(psbt, prevOutHash, prevOutIndex) {
  for (const [index, input] of getGlobalTransaction(psbt).ins.entries()) {
    if (
      Buffer.compare(input.hash, prevOutHash) === 0 &&
      input.index === prevOutIndex
    ) {
      return index;
    }
  }
  return -1;
}
async function doRequest(psbt, payjoinEndpoint) {
  if (!psbt) {
    throw new Error();
  }
  const response = await fetch(payjoinEndpoint, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'text/plain',
    }),
    body: psbt.toHex(),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText);
  }
  return bitcoinjs_lib_1.Psbt.fromBase64(responseText);
}
