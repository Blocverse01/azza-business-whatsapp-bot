import express, { type Request } from 'express';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature } from '@/resources/middlewares/verifyMetaSignature';
import { envSchema } from '@/constants/env';
import { withServer } from './http';

function createWebhookApp() {
    const app = express();
    app.use(
        express.json({
            verify: (req: Request, _res, buf) => {
                req.rawBody = buf.toString();
            },
        })
    );
    app.post('/api/whatsapp/messages/webhook', verifyMetaSignature, (_req, res) => {
        res.sendStatus(200);
    });
    return app;
}

describe('BIZBOT-SEC-001 Meta webhook signature', () => {
    it('rejects an unsigned POST /api/whatsapp/messages/webhook with 401', async () => {
        await withServer(createWebhookApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/whatsapp/messages/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
            });

            expect(response.status).toBe(401);
        });
    });

    it('accepts a request signed with META_APP_SECRET', async () => {
        const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
        const signature = `sha256=${createHmac('sha256', process.env.META_APP_SECRET as string)
            .update(body)
            .digest('hex')}`;

        await withServer(createWebhookApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/whatsapp/messages/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hub-Signature-256': signature,
                },
                body,
            });

            expect(response.status).toBe(200);
        });
    });

    it('requires META_APP_SECRET in the env schema', () => {
        const result = envSchema.safeParse({
            ...process.env,
            META_APP_SECRET: '',
        });

        expect(result.success).toBe(false);
    });
});
