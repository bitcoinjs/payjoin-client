import { Psbt } from 'bitcoinjs-lib';
declare type Nullable<T> = T | null;
export declare function requestPayjoinWithCustomRemoteCall(psbt: Psbt, remoteCall: (psbt: Psbt) => Promise<Nullable<Psbt>>): Promise<Psbt>;
export declare function requestPayjoin(psbt: Psbt, payjoinEndpoint: string): Promise<Psbt>;
export {};
