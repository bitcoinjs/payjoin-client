'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const bitcoinjs_lib_1 = require('bitcoinjs-lib');
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
})(
  (ScriptPubKeyType =
    exports.ScriptPubKeyType || (exports.ScriptPubKeyType = {})),
);
exports.SUPPORTED_WALLET_FORMATS = [
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
function getFee(feeRate, size) {
  return feeRate * size;
}
exports.getFee = getFee;
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
exports.checkSanity = checkSanity;
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
  return errors;
}
function getInputsScriptPubKeyType(psbt) {
  if (psbt.data.inputs.filter((i) => !i.witnessUtxo).length > 0)
    throw new Error('The psbt should be finalized with witness information');
  const types = new Set();
  for (const input of psbt.data.inputs) {
    const inputScript = input.witnessUtxo.script;
    const redeemScript =
      input.redeemScript ||
      (input.finalScriptSig &&
        bitcoinjs_lib_1.script.decompile(input.finalScriptSig)[0]) ||
      Buffer.from([]);
    if (typeof redeemScript === 'number') continue;
    const type = getInputScriptPubKeyType(inputScript, redeemScript);
    types.add(type);
  }
  if (types.size > 1) throw new Error('Inputs must all be the same type');
  return types.values().next().value;
}
exports.getInputsScriptPubKeyType = getInputsScriptPubKeyType;
// TODO: I think these checks are correct, get Jon to double check they do what
// I think they do...
// There might be some extra stuff needed for ScriptPubKeyType.SegwitP2SH.
function getInputScriptPubKeyType(inputScript, redeemScript) {
  if (isP2WPKH(inputScript)) {
    return ScriptPubKeyType.Segwit;
  } else if (isP2WPKH(redeemScript)) {
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
exports.hasKeypathInformationSet = hasKeypathInformationSet;
function isFinalized(input) {
  return (
    input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined
  );
}
exports.isFinalized = isFinalized;
function getGlobalTransaction(psbt) {
  // TODO: bitcoinjs-lib to expose outputs to Psbt class
  // instead of using private (JS has no private) attributes
  // @ts-ignore
  return psbt.__CACHE.__TX;
}
exports.getGlobalTransaction = getGlobalTransaction;
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
exports.getInputIndex = getInputIndex;
