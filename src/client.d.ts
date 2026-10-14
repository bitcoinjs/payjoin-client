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
type PayjoinClientOpts = PayjoinClientOptsUrl | PayjoinClientOptsRequester;
interface PayjoinClientOptsUrl {
    wallet: IPayjoinClientWallet;
    payjoinUrl: string;
    paymentScript: Uint8Array;
    payjoinParameters?: PayjoinClientOptionalParameters;
    getEndpointUrl?: (url: string, payjoinParameters?: PayjoinClientOptionalParameters) => string;
}
interface PayjoinClientOptsRequester {
    wallet: IPayjoinClientWallet;
    payjoinRequester: IPayjoinRequester;
    paymentScript: Uint8Array;
    payjoinParameters?: PayjoinClientOptionalParameters;
}
export {};
