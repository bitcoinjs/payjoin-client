/// <reference types="node" />
import { IPayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
export interface PayjoinClientOptionalParameters {
    disableOutputSubstitution?: boolean;
    paymentScript?: Buffer;
    payjoinVersion?: number;
    additionalfeeoutputindex?: number;
    maxadditionalfeecontribution?: number;
    minimumFeeRate?: number;
}
export declare class PayjoinClient {
    private wallet;
    private payjoinRequester;
    private payjoinParameters?;
    constructor(opts: PayjoinClientOpts);
    private getEndpointUrl;
    run(): Promise<void>;
}
declare type PayjoinClientOpts = PayjoinClientOptsUrl | PayjoinClientOptsRequester;
interface PayjoinClientOptsUrl {
    wallet: IPayjoinClientWallet;
    payjoinUrl: string;
    payjoinParameters?: PayjoinClientOptionalParameters;
}
interface PayjoinClientOptsRequester {
    wallet: IPayjoinClientWallet;
    payjoinRequester: IPayjoinRequester;
    payjoinParameters?: PayjoinClientOptionalParameters;
}
export {};
