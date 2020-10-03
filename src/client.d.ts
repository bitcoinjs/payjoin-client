/// <reference types="node" />
import { IPayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
export interface PayjoinClientOptionalParameters {
    disableOutputSubstitution?: boolean;
    payjoinVersion?: number;
    additionalFeeOutputIndex?: number;
    maxAdditionalFeeContribution?: number;
    minimumFeeRate?: number;
}
export declare class PayjoinClient {
    private wallet;
    private paymentScript;
    private payjoinRequester;
    private payjoinParameters?;
    constructor(opts: PayjoinClientOpts);
    run(): Promise<void>;
}
declare type PayjoinClientOpts = PayjoinClientOptsUrl | PayjoinClientOptsRequester;
interface PayjoinClientOptsUrl {
    wallet: IPayjoinClientWallet;
    payjoinUrl: string;
    paymentScript: Buffer;
    payjoinParameters?: PayjoinClientOptionalParameters;
}
interface PayjoinClientOptsRequester {
    wallet: IPayjoinClientWallet;
    payjoinRequester: IPayjoinRequester;
    paymentScript: Buffer;
    payjoinParameters?: PayjoinClientOptionalParameters;
}
export {};
