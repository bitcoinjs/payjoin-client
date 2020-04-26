import { Psbt } from 'bitcoinjs-lib';
export interface IPayjoinRequester {
    /**
     * @async
     * This requests the payjoin from the payjoin server
     *
     * @param {Psbt} psbt - A fully signed, finalized, and valid Psbt.
     * @return {Promise<Psbt>} The payjoin proposal Psbt.
     */
    requestPayjoin(psbt: Psbt): Promise<Psbt>;
}
export declare class PayjoinRequester implements IPayjoinRequester {
    private endpointUrl;
    constructor(endpointUrl: string);
    requestPayjoin(psbt: Psbt): Promise<Psbt>;
}
