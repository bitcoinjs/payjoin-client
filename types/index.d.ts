import { Psbt } from 'bitcoinjs-lib';
declare type Nullable<T> = T | null;
export declare function requestPayjoinWithCustomRemoteCall(psbt: Psbt, remoteCall: (psbt: Psbt) => Promise<Nullable<Psbt>>): Promise<null | undefined>;
export declare function requestPayjoin(psbt: Psbt, payjoinEndpoint: string): Promise<null | undefined>;
export {};
