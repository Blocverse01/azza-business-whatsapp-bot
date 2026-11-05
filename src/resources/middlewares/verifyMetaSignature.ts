import env from '@/constants/env';
import { UNAUTHORIZED } from '@/constants/status-codes';
import { safeCompare } from '@/resources/utils/safeCompare';
import { NextFunction, Request, Response } from 'express';
import { createHmac } from 'node:crypto';

export function expectedMetaSignature(rawBody: string, appSecret: string): string {
    return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function verifyMetaSignature(req: Request, res: Response, next: NextFunction) {
    const header = req.headers['x-hub-signature-256'];
    const signatureHeader = Array.isArray(header) ? header[0] : header;

    if (!signatureHeader || req.rawBody === undefined) {
        return res.status(UNAUTHORIZED).send('Unauthorized');
    }

    const expected = expectedMetaSignature(req.rawBody, env.META_APP_SECRET);

    if (!safeCompare(signatureHeader, expected)) {
        return res.status(UNAUTHORIZED).send('Unauthorized');
    }

    next();
}
