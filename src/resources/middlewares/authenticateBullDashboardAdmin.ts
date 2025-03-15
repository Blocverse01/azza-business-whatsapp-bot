import redis from '@/cache/redis';
import { FORBIDDEN, UNAUTHORIZED } from '@/constants/status-codes';
import { dbClient } from '@/db/dbClient';
import logger from '@/resources/logger';
import { NextFunction, Request, Response } from 'express';

export const authenticateAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const accessToken = req.cookies?.token;

    if (!accessToken) {
        await logger.error('Error authenticating admin: Access token missing', {
            accessToken,
        });
        return res.status(FORBIDDEN).send('Forbidden');
    }

    try {
        const cacheKey = `bull_dashboard_access_${accessToken}`;
        const cachedToken = await redis.get(cacheKey);

        if (cachedToken) {
            next();
            return;
        }

        const validToken = await dbClient.bull_dashboard_access
            .filter({
                accessToken: accessToken as string,
            })
            .getFirst();

        if (!validToken) {
            await logger.error('Error authenticating admin: Invalid access token', {
                accessToken,
            });

            return res.status(UNAUTHORIZED).send('Unauthorized');
        }

        await redis.set(cacheKey, accessToken, 'EX', 60 * 60 * 24);

        next();
    } catch (error) {
        await logger.error('Error authenticating admin', {
            accessToken,
        });

        return res.status(UNAUTHORIZED).send('Unauthorized');
    }
};
