import { payments, Psbt, PsbtTxInput, Transaction } from 'bitcoinjs-lib';
import { Bip32Derivation, PsbtInput } from 'bip174/src/lib/interfaces';

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

export function checkSanity(psbt: Psbt): string[][] {
  const result: string[][] = [];
  psbt.data.inputs.forEach((value, index): void => {
    result[index] = checkInputSanity(value, psbt.txInputs[index]);
  });
  return result;
}

function checkInputSanity(input: PsbtInput, txInput: PsbtTxInput): string[] {
  const errors: string[] = [];
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
    const prevTx = Transaction.fromBuffer(input.nonWitnessUtxo);
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

function redeemScriptToScriptPubkey(redeemScript: Buffer): Buffer {
  return payments.p2sh({ redeem: { output: redeemScript } }).output!;
}

function witnessScriptToScriptPubkey(witnessScript: Buffer): Buffer {
  return payments.p2wsh({ redeem: { output: witnessScript } }).output!;
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
