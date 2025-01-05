export type FiatPayoutQueueResult =
    | {
          sequenceId: string;
          result: 'SENT';
      }
    | {
          error: string;
          result: 'FAILED' | 'REFUNDING_CRYPTO';
      };

export type CryptoDebitConfirmationQueueResult = {
    status: 'success' | 'failed' | 'dropped';
    transactionHash: string | null;
};
export type UserTxPinSecurityQueueInput =
    | {
          newPinHash: string;
          userId: string;
          encryptedSecurityQuestions: string;
      }
    | {
          newPinHash: string;
          userId: string;
      };
export type UserTxPinSecurityQueueResult = {
    status: 'success' | 'failed';
};

export enum QueueNames {
    fiatPayout = 'fiat-payout',
    cryptoDebit = 'crypto-debit',
    cryptoDebitConfirmation = 'crypto-debit-confirmation',
    userTxPinSecurity = 'user-tx-pin-security',
}
