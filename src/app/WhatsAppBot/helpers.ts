import { spawn } from 'node:child_process';

type SendMessageWithGoParams = {
    token: string;
    url: string;
    id: string;
    message: string;
};

type SendMessageWithGoResponse = {
    status: string;
    statusCode: number;
    elapsedTime: number; // in ms
    responseBody: string;
};

export async function sendMessageUsingGo(params: SendMessageWithGoParams) {
    return new Promise<SendMessageWithGoResponse>((resolve, reject) => {
        const process = spawn('src/app/WhatsAppBot/sendWhatsappMessage', [
            '-token',
            params.token,
            '-url',
            params.url,
            '-id',
            params.id,
            '-message',
            params.message,
        ]);

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data;
        });

        process.stderr.on('data', (data) => {
            stderr += data;
        });

        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Execution failed: ${stderr ?? stdout}`));
            } else {
                try {
                    const response = JSON.parse(stdout) as SendMessageWithGoResponse;
                    resolve(response);
                } catch (parseError) {
                    reject(new Error(`Failed to parse response: ${stdout}`));
                }
            }
        });
    });
}
