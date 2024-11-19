import { mnemonicToAccount } from 'viem/accounts';

export async function findPrivateKeyByAddress(
    mnemonic: string,
    knownAddress: string,
    startFromIndex: number = 0,
    maxIndex: number = 1000
): Promise<string | null> {
    if (startFromIndex < 0) {
        throw new Error('startFromIndex cannot be negative');
    }
    if (maxIndex < 0) {
        throw new Error('maxIndex cannot be negative');
    }
    if (startFromIndex >= maxIndex) {
        throw new Error('startFromIndex cannot be greater than or equal to maxIndex');
    }
    for (let index = startFromIndex; index < maxIndex; index++) {
        const derivationPath = `m/44'/60'/0'/0/${index}` as const;

        const account = mnemonicToAccount(mnemonic, {
            path: derivationPath,
        });

        const address = account.address.toLowerCase();
        const privateKey = Buffer.from(
            account.getHdKey().privateKey?.buffer ?? new ArrayBuffer(0)
        ).toString('hex');

        console.log({ address, privateKey, index });

        if (address === knownAddress.toLowerCase()) {
            return privateKey ?? null;
        }
    }

    return null; // Return null if the address is not found within the range
}
