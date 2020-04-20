import { Psbt, Transaction } from 'bitcoinjs-lib';
import { p2wpkh } from 'bitcoinjs-lib/types/payments';
import { GlobalXpub, PsbtInput } from 'bip174/src/lib/interfaces';

type Nullable<T> = T | null;

export async function requestPayjoinWithCustomRemoteCall(psbt: Psbt, remoteCall: (psbt: Psbt) => Promise<Nullable<Psbt>>) {
  const clonedPsbt = psbt.clone();
  clonedPsbt.finalizeAllInputs();

  // We make sure we don't send unnecessary information to the receiver
  for (let index = 0; index < clonedPsbt.inputCount; index++) {
    clonedPsbt.clearFinalizedInput(index);
  }
  clonedPsbt.data.outputs.forEach(output => {
    delete output.bip32Derivation;
  });
  delete clonedPsbt.data.globalMap.globalXpub;

  const payjoinPsbt = await remoteCall(clonedPsbt);
  if (!payjoinPsbt) throw new Error('We did not get the receiver\'s PSBT');

  // no inputs were added?
  if (clonedPsbt.inputCount <= payjoinPsbt.inputCount) {
    throw new Error('There were less inputs than before in the receiver\'s PSBT');
  }

  if(payjoinPsbt.data.globalMap.globalXpub && (payjoinPsbt.data.globalMap.globalXpub as GlobalXpub[]).length > 0){
    throw new Error('GlobalXPubs should not be included in the receiver\'s PSBT');
  }
  if (payjoinPsbt.data.outputs.filter(value => value.bip32Derivation && value.bip32Derivation.length>0).length > 0 ||
    payjoinPsbt.data.inputs.filter(value => value.bip32Derivation && value.bip32Derivation.length>0).length > 0 )
  {
    throw new Error(('Keypath information should not be included in the receiver\'s PSBT');
  }

  // We make sure we don't sign what should not be signed
  for (let index = 0; index < payjoinPsbt.inputCount; index++) {
    // check if input is Finalized
    if ( isFinalized(payjoinPsbt.data.inputs[index]))
      payjoinPsbt.clearFinalizedInput(index);
  }

  for (let index = 0; index < payjoinPsbt.data.outputs.length; index++) {
    const output = payjoinPsbt.data.outputs[index];
    const outputLegacy = getGlobalTransaction(payjoinPsbt).outs[index];
    // Make sure only our output has any information
    delete output.bip32Derivation;
    psbt.data.outputs.forEach(originalOutput => {
      // update the payjoin outputs
      if (
        outputLegacy.script.equals(
          // TODO: what if output is P2SH or P2WSH or anything other than P2WPKH?
          // Can we assume output will contain redeemScript and witnessScript?
          // If so, we could decompile scriptPubkey, RS, and WS, and search for
          // the pubkey and its hash160.
          p2wpkh({
            pubkey: originalOutput.bip32Derivation.pubkey,
          }).output,
        )
      )
        payjoinPsbt.updateOutput(index, originalOutput);
    });
  }
  // TODO: check payjoinPsbt.version == psbt.version
  // TODO: check payjoinPsbt.locktime == psbt.locktime
  // TODO: check payjoinPsbt.inputs where input belongs to us, that it is not finalized
  // TODO: check payjoinPsbt.inputs where input belongs to us, that it is was included in psbt.inputs
  // TODO: check payjoinPsbt.inputs where input belongs to us, that its sequence has not changed from that of psbt.inputs
  // TODO: check payjoinPsbt.inputs where input is new, that it is finalized
  // TODO: check payjoinPsbt.inputs where input is new, that it is the same type as all other inputs from psbt.inputs (all==P2WPKH || all = P2SH-P2WPKH)
  // TODO: check psbt.inputs that payjoinPsbt.inputs contains them all
  // TODO: check payjoinPsbt.inputs > psbt.inputs
  // TODO: check that if spend amount of payjoinPsbt > spend amount of psbt:
  // TODO: * check if the difference is due to adjusting fee to increase transaction size
}

export function requestPayjoin(psbt: Psbt, payjoinEndpoint: string) {
  return requestPayjoinWithCustomRemoteCall(psbt, psbt1 => doRequest(psbt1, payjoinEndpoint));
}

function isFinalized(input: PsbtInput) {
  return input.finalScriptSig !== undefined ||
    input.finalScriptWitness !== undefined;
}

function getGlobalTransaction(psbt: Psbt): Transaction {
  // TODO: bitcoinjs-lib to expose outputs to Psbt class
  // instead of using private (JS has no private) attributes
  // @ts-ignore
  return psbt.__CACHE.__TX;
}

function doRequest(psbt: Psbt, payjoinEndpoint: string): Promise<Nullable<Psbt>> {
  return new Promise<Nullable<Psbt>>((resolve, reject) => {
    if (!psbt) {
      reject();
    }

    const xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(Psbt.fromHex(xhr.responseText));
      } else {
        reject(xhr.responseText);
      }
    };
    xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.open('POST', payjoinEndpoint);
    xhr.send(psbt.toHex());
  });
}
