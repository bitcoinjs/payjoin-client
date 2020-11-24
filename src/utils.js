'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getEndpointUrl = exports.getVirtualSize = exports.getInputIndex = exports.isFinalized = exports.hasKeypathInformationSet = exports.getInputScriptPubKeyType = exports.getInputsScriptPubKeyType = exports.getFee = exports.ScriptPubKeyType = void 0;
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
function setParam(url, key, value) {
  const parsedURL = new URL(url);
  parsedURL.searchParams.set(key, value);
  return parsedURL.href;
}
function getEndpointUrl(url, payjoinParameters, setParamFunc) {
  if (!payjoinParameters) {
    return url;
  }
  let result = url;
  setParamFunc = setParamFunc || setParam;
  if (payjoinParameters.disableOutputSubstitution !== undefined) {
    result = setParamFunc(
      result,
      'disableoutputsubstitution',
      payjoinParameters.disableOutputSubstitution.toString(),
    );
  }
  if (payjoinParameters.payjoinVersion !== undefined) {
    result = setParamFunc(
      result,
      'v',
      payjoinParameters.payjoinVersion.toString(),
    );
  }
  if (payjoinParameters.minimumFeeRate !== undefined) {
    result = setParamFunc(
      result,
      'minfeerate',
      payjoinParameters.minimumFeeRate.toString(),
    );
  }
  if (payjoinParameters.maxAdditionalFeeContribution !== undefined) {
    result = setParamFunc(
      result,
      'maxadditionalfeecontribution',
      payjoinParameters.maxAdditionalFeeContribution.toString(),
    );
  }
  if (payjoinParameters.additionalFeeOutputIndex !== undefined) {
    result = setParamFunc(
      result,
      'additionalfeeoutputindex',
      payjoinParameters.additionalFeeOutputIndex.toString(),
    );
  }
  return result;
}
exports.getEndpointUrl = getEndpointUrl;
