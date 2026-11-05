import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

export async function withServer(
    app: Express,
    run: (baseUrl: string) => Promise<void>
): Promise<void> {
    const server = app.listen(0);

    await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', reject);
    });

    const { port } = server.address() as AddressInfo;

    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
