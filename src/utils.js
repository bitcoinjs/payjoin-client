'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getVirtualSize = exports.getInputIndex = exports.isFinalized = exports.hasKeypathInformationSet = exports.getInputScriptPubKeyType = exports.getInputsScriptPubKeyType = exports.checkSanity = exports.getFee = exports.ScriptPubKeyType = void 0;
const bitcoinjs_lib_1 = require('bitcoinjs-lib');
var ScriptPubKeyType;
(function (ScriptPubKeyType) {
  /// <summary>
  /// This type is reserved for scripts that are unsupported.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['Unsupported'] = 0)] = 'Unsupported';
  /// <summary>
  /// Derive P2PKH addresses (P2PKH)
  /// Only use this for legacy code or coins not supporting segwit.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['Legacy'] = 1)] = 'Legacy';
  /// <summary>
  /// Derive Segwit (Bech32) addresses (P2WPKH)
  /// This will result in the cheapest fees. This is the recommended choice.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['Segwit'] = 2)] = 'Segwit';
  /// <summary>
  /// Derive P2SH address of a Segwit address (P2WPKH-P2SH)
  /// Use this when you worry that your users do not support Bech address format.
  /// </summary>
  ScriptPubKeyType[(ScriptPubKeyType['SegwitP2SH'] = 3)] = 'SegwitP2SH';
})(
  (ScriptPubKeyType =
    exports.ScriptPubKeyType || (exports.ScriptPubKeyType = {})),
);
function getFee(feeRate, size) {
  return feeRate * size;
}
exports.getFee = getFee;
function checkSanity(psbt) {
  const result = [];
  psbt.data.inputs.forEach((value, index) => {
    result[index] = checkInputSanity(value, psbt.txInputs[index]);
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
    if (input.sighashType !== undefined) {
      errors.push('Input finalized, but sighash type is not empty');
    }
    if (input.redeemScript) {
      errors.push('Input finalized, but redeem script is not empty');
    }
    if (input.witnessScript) {
      errors.push('Input finalized, but witness script is not empty');
    }
  }
  if (input.witnessUtxo && input.nonWitnessUtxo) {
    errors.push('witness utxo and non witness utxo simultaneously present');
  }
  if (input.witnessScript && !input.witnessUtxo) {
    errors.push('witness script present but no witness utxo');
  }
  if (input.finalScriptWitness && !input.witnessUtxo) {
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
  if (
    psbt.data.inputs.filter((i) => !i.witnessUtxo && !i.nonWitnessUtxo).length >
    0
  )
    throw new Error(
      'The psbt should be able to be finalized with utxo information',
    );
  const types = new Set();
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    types.add(getInputScriptPubKeyType(psbt, i));
  }
  if (types.size > 1) throw new Error('Inputs must all be the same type');
  return types.values().next().value;
}
exports.getInputsScriptPubKeyType = getInputsScriptPubKeyType;
function getInputScriptPubKeyType(psbt, i) {
  const type = psbt.getInputType(i);
  switch (type) {
    case 'witnesspubkeyhash':
      return ScriptPubKeyType.Segwit;
    case 'p2sh-witnesspubkeyhash':
      return ScriptPubKeyType.SegwitP2SH;
    case 'pubkeyhash':
      return ScriptPubKeyType.Legacy;
    default:
      return ScriptPubKeyType.Unsupported;
  }
}
exports.getInputScriptPubKeyType = getInputScriptPubKeyType;
function redeemScriptToScriptPubkey(redeemScript) {
  return bitcoinjs_lib_1.payments.p2sh({ redeem: { output: redeemScript } })
    .output;
}
function witnessScriptToScriptPubkey(witnessScript) {
  return bitcoinjs_lib_1.payments.p2wsh({ redeem: { output: witnessScript } })
    .output;
}
function hasKeypathInformationSet(item) {
  return !!item.bip32Derivation && item.bip32Derivation.length > 0;
}
exports.hasKeypathInformationSet = hasKeypathInformationSet;
function isFinalized(input) {
  return (
    input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined
  );
}
exports.isFinalized = isFinalized;
function getInputIndex(psbt, prevOutHash, prevOutIndex) {
  for (const [index, input] of psbt.txInputs.entries()) {
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
function getVirtualSize(scriptPubKeyType) {
  switch (scriptPubKeyType) {
    case ScriptPubKeyType.Legacy:
      return 148;
    case ScriptPubKeyType.Segwit:
      return 68;
    case ScriptPubKeyType.SegwitP2SH:
      return 91;
    default:
      return 110;
  }
}
exports.getVirtualSize = getVirtualSize;
