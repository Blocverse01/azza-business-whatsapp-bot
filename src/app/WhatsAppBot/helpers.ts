import { execFile } from 'node:child_process';

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
        const args = [
            '-token',
            params.token,
            '-url',
            params.url,
            '-id',
            params.id,
            '-message',
            params.message,
        ];

        execFile('src/app/WhatsAppBot/sendWhatsappMessage', args, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Execution failed: ${stderr || error.message}`));
                return;
            }

            try {
                const response = JSON.parse(stdout) as SendMessageWithGoResponse;
                resolve(response);
            } catch (parseError) {
                reject(new Error(`Failed to parse response: ${stdout}`));
            }
        });
    });
}
