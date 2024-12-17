import { spawn } from 'node:child_process';

type SendMessageWithGoParams = {
    token: string;
    url: string;
    id: string;
    message: string; // JSON string
};

type SendMessageWithGoResponse = {
    status: string;
    statusCode: number;
    elapsedTime: number; // in ms
    responseBody: string;
};

export async function sendMessageUsingGo(
    params: SendMessageWithGoParams
): Promise<SendMessageWithGoResponse> {
    return new Promise<SendMessageWithGoResponse>((resolve, reject) => {
        const args = [
            '-token',
            params.token,
            '-url',
            params.url,
            '-id',
            params.id,
            '-message',
            `'${params.message}'`, // Wrap the raw JSON string in single quotes
        ];

        const process = spawn('src/app/WhatsAppBot/sendWhatsappMessage', args);

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Execution failed (code ${code}): ${stderr || stdout}`));
                return;
            }

            try {
                const response = JSON.parse(stdout) as SendMessageWithGoResponse;
                resolve(response);
            } catch (parseError) {
                reject(new Error(`Failed to parse response: ${stdout}`));
            }
        });

        process.on('error', (error) => {
            reject(new Error(`Failed to execute process: ${error.message}`));
        });
    });
}
