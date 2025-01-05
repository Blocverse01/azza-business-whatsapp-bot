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

        await dbClient.bull_dashboard_access.update(
            validToken.id,
            {
                lastAccessed: new Date().toISOString(),
            },
            ['lastAccessed']
        );
        console.log(`${validToken.adminName} accessed BullMQ Dashboard`);

        next();
    } catch (error) {
        await logger.error('Error authenticating admin', {
            accessToken,
        });

        return res.status(UNAUTHORIZED).send('Unauthorized');
    }
};
