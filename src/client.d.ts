import { IPayjoinRequester } from './request';
import { IPayjoinClientWallet } from './wallet';
export declare class PayjoinClient {
    private wallet;
    private payjoinRequester;
    constructor(opts: PayjoinClientOpts);
    private getSumPaidToUs;
    run(): Promise<void>;
}
declare type PayjoinClientOpts = PayjoinClientOptsUrl | PayjoinClientOptsRequester;
interface PayjoinClientOptsUrl {
    wallet: IPayjoinClientWallet;
    payjoinUrl: string;
}
interface PayjoinClientOptsRequester {
    wallet: IPayjoinClientWallet;
    payjoinRequester: IPayjoinRequester;
}
export {};
