import { Psbt } from 'bitcoinjs-lib';
/**
 * Handle known errors and return a generic message for unkonw errors.
 *
 * This prevents people integrating this library introducing an accidental
 * phishing vulnerability in their app by displaying a server generated
 * messages in their UI.
 *
 * We still expose the error code so custom handling of specific or unknown
 * error codes can still be added in the app.
 */
export declare class PayjoinEndpointError extends Error {
    static messageMap: {
        [key: string]: string;
    };
    static codeToMessage(code: string): string;
    code: string;
    constructor(code: string);
}
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
