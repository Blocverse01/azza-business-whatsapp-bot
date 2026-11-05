import {
    decryptWithRandomIvAES,
    encryptWithAES,
    encryptWithRandomIvAES,
} from '@/resources/utils/encryption';

describe('BIZBOT-SEC-004 payout authorizer nonce', () => {
    const key = 'aa'.repeat(32);
    const payload = JSON.stringify({
        reason: 'ONRAMP',
        triggerTransactionId: 'tx-1',
    });

    it('produces different ciphertext for two encryptions of the same payload', () => {
        const first = encryptWithRandomIvAES(payload, key);
        const second = encryptWithRandomIvAES(payload, key);

        expect(first).not.toEqual(second);
        expect(decryptWithRandomIvAES(first, key)).toEqual(payload);
        expect(decryptWithRandomIvAES(second, key)).toEqual(payload);
    });

    it('still decrypts legacy static-IV tokens during rotation', () => {
        const legacyIv = 'bb'.repeat(16);
        const legacy = encryptWithAES(payload, key, legacyIv);

        expect(decryptWithRandomIvAES(legacy, key, legacyIv)).toEqual(payload);
    });
});
