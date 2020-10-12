import { Psbt } from 'bitcoinjs-lib';
import { Bip32Derivation, PsbtInput } from 'bip174/src/lib/interfaces';
import { PayjoinClientOptionalParameters } from './client';

export enum ScriptPubKeyType {
  /// <summary>
  /// This type is reserved for scripts that are unsupported.
  /// </summary>
  Unsupported,
  /// <summary>
  /// Derive P2PKH addresses (P2PKH)
  /// Only use this for legacy code or coins not supporting segwit.
  /// </summary>
  Legacy,
  /// <summary>
  /// Derive Segwit (Bech32) addresses (P2WPKH)
  /// This will result in the cheapest fees. This is the recommended choice.
  /// </summary>
  Segwit,
  /// <summary>
  /// Derive P2SH address of a Segwit address (P2WPKH-P2SH)
  /// Use this when you worry that your users do not support Bech address format.
  /// </summary>
  SegwitP2SH,
}

export function getFee(feeRate: number, size: number): number {
  return feeRate * size;
}

export function getInputsScriptPubKeyType(psbt: Psbt): ScriptPubKeyType {
  if (
    psbt.data.inputs.filter((i): boolean => !i.witnessUtxo && !i.nonWitnessUtxo)
      .length > 0
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

export function getInputScriptPubKeyType(
  psbt: Psbt,
  i: number,
): ScriptPubKeyType {
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

export function hasKeypathInformationSet(item: {
  bip32Derivation?: Bip32Derivation[];
}): boolean {
  return !!item.bip32Derivation && item.bip32Derivation.length > 0;
}

export function isFinalized(input: PsbtInput): boolean {
  return (
    input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined
  );
}

export function getInputIndex(
  psbt: Psbt,
  prevOutHash: Buffer,
  prevOutIndex: number,
): number {
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

export function getVirtualSize(scriptPubKeyType?: ScriptPubKeyType): number {
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

export function getEndpointUrl(
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
  if (payjoinParameters.maxAdditionalFeeContribution !== undefined) {
    parsedURL.searchParams.set(
      'maxadditionalfeecontribution',
      payjoinParameters.maxAdditionalFeeContribution.toString(),
    );
  }
  if (payjoinParameters.additionalFeeOutputIndex !== undefined) {
    parsedURL.searchParams.set(
      'additionalfeeoutputindex',
      payjoinParameters.additionalFeeOutputIndex.toString(),
    );
  }
  return parsedURL.href;
}
