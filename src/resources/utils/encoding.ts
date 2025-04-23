import fs from 'fs';

export const HEX_ENCODING = 'hex';

export function uint8ArrayToHex(privateKey: Uint8Array): string {
    return Buffer.from(privateKey).toString(HEX_ENCODING);
}

export function hexToUint8Array(privateKey: string): Uint8Array {
    return new Uint8Array(Buffer.from(privateKey, HEX_ENCODING));
}

export function encodeToBase64(filePath: string, fileType: string) {
    return `data:${fileType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}
