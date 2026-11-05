import express from 'express';
import { authenticateAdmin } from '@/resources/middlewares/authenticateBullDashboardAdmin';
import { withServer } from './http';

jest.mock('@/cache/redis', () => ({
    __esModule: true,
    default: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
    },
}));

jest.mock('@/db/dbClient', () => ({
    dbClient: {
        bull_dashboard_access: {
            filter: jest.fn().mockReturnValue({
                getFirst: jest.fn().mockResolvedValue({ ipAddress: '203.0.113.10' }),
            }),
        },
    },
}));

jest.mock('@/resources/logger', () => ({
    __esModule: true,
    default: {
        error: jest.fn().mockResolvedValue(undefined),
    },
    logSync: jest.fn(),
}));

describe('BIZBOT-SEC-002 Bull Board XFF spoof', () => {
    it('rejects a spoofed X-Forwarded-For without a cookie with 403', async () => {
        const app = express();
        app.use('/bjs/ui', authenticateAdmin, (_req, res) => res.sendStatus(200));

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/bjs/ui`, {
                headers: {
                    'X-Forwarded-For': '203.0.113.10',
                },
            });

            expect(response.status).toBe(403);
        });
    });
});
