import crypto from 'node:crypto';

export const decryptRequest = (
    requestBody: Record<string, string>,
    privatePem: string,
    passphrase: string
) => {
    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = requestBody;

    const privateKey = crypto.createPrivateKey({ key: privatePem, passphrase });

    // Decrypt the AES key created by the client
    const decryptedAesKey = crypto.privateDecrypt(
        {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        Buffer.from(encrypted_aes_key, 'base64')
    );

    // Decrypt the Flow data
    const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
    const initialVectorBuffer = Buffer.from(initial_vector, 'base64');

    const TAG_LENGTH = 16;
    const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
    const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-128-gcm', decryptedAesKey, initialVectorBuffer);
    decipher.setAuthTag(encrypted_flow_data_tag);

    const decryptedJSONString = Buffer.concat([
        decipher.update(encrypted_flow_data_body),
        decipher.final(),
    ]).toString('utf-8');

    return {
        decryptedBody: JSON.parse(decryptedJSONString),
        aesKeyBuffer: decryptedAesKey,
        initialVectorBuffer,
    };
};

export const encryptResponse = (
    responseData: unknown,
    aesKeyBuffer: Buffer,
    initialVectorBuffer: Buffer
) => {
    const flipped_iv = [];
    for (const pair of initialVectorBuffer.entries()) {
        flipped_iv.push(~pair[1]);
    }
    // Encrypt the response data
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, Buffer.from(flipped_iv));
    return Buffer.concat([
        cipher.update(JSON.stringify(responseData), 'utf-8'),
        cipher.final(),
        cipher.getAuthTag(),
    ]).toString('base64');
};

export const encryptWithPublicKey = (data: string, publicKey: string) => {
    const buffer = Buffer.from(data);
    return crypto
        .publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            buffer
        )
        .toString('base64');
};

export function decryptWithPrivateKey(
    encryptedData: string,
    privateKey: string,
    passphrase: string
): any {
    return crypto
        .privateDecrypt(
            {
                key: privateKey,
                passphrase: passphrase,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            Buffer.from(encryptedData, 'base64')
        )
        .toString();
}

export const convertBase64ToAsciiString = (key: string) =>
    Buffer.from(key, 'base64').toString('ascii');
export const convertAsciiStringToBase64 = (key: string) => Buffer.from(key).toString('base64');

export const generateRandomHexString = (length: number) =>
    crypto.randomBytes(length).toString('hex');

// Symmetric encryption
export const encryptWithAES = (data: string, key: string, iv: string) => {
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.from(iv, 'hex')
    );
    const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([encrypted, authTag]).toString('hex');
};

export const decryptWithAES = (encryptedData: string, key: string, iv: string) => {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.from(iv, 'hex')
    );
    const encryptedDataBuffer = Buffer.from(encryptedData, 'hex');
    const encryptedDataBody = encryptedDataBuffer.subarray(0, -16);
    const encryptedDataTag = encryptedDataBuffer.subarray(-16);
    decipher.setAuthTag(encryptedDataTag);
    return Buffer.concat([decipher.update(encryptedDataBody), decipher.final()]).toString('utf-8');
};
