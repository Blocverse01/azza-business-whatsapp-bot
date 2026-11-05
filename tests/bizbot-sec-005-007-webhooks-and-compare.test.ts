import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeCompare } from '@/resources/utils/safeCompare';

describe('BIZBOT-SEC-005..007 webhook logging and compares', () => {
    const src = (relativePath: string) => readFileSync(join(__dirname, '..', relativePath), 'utf8');

    it('compares secrets with timing-safe equality', () => {
        expect(safeCompare('same-secret', 'same-secret')).toBe(true);
        expect(safeCompare('same-secret', 'other-secret')).toBe(false);
        expect(safeCompare('short', 'longer-value')).toBe(false);
    });

    it('uses safeCompare for HoneyCoin, YellowCard, and SumSub', () => {
        expect(src('src/app/HoneyCoin/HoneyCoinController.ts')).toContain('safeCompare');
        expect(src('src/app/FiatRamp/FiatRampService.ts')).toContain('safeCompare');
        expect(src('src/app/SumSub/SumSubService.ts')).toContain('safeCompare');
        expect(src('src/app/HoneyCoin/HoneyCoinController.ts')).not.toMatch(
            /signature !== HoneyCoinWebhookSecret/
        );
        expect(src('src/app/FiatRamp/FiatRampService.ts')).not.toMatch(
            /signature === calculatedSignature/
        );
        expect(src('src/app/SumSub/SumSubService.ts')).not.toMatch(
            /calculatedDigest === payloadDigest/
        );
    });

    it('logs HoneyCoin and YellowCard webhooks after verification and only IDs', () => {
        const honeyCoin = src('src/app/HoneyCoin/HoneyCoinController.ts');
        const yellowCard = src('src/app/FiatRamp/FiatRampServiceController.ts');
        const safeHaven = src('src/app/NigeriaBanks/SafeHaven/SafeHavenController.ts');
        const bullBoard = src('src/resources/middlewares/authenticateBullDashboardAdmin.ts');

        expect(honeyCoin).toMatch(
            /receiveWebHookData\(req\);[\s\S]*logSync\('info', 'HoneyCoin Offramp Webhook Received'/
        );
        expect(honeyCoin).not.toMatch(/HoneyCoin Offramp Webhook Received',\s*req\.body/);
        expect(yellowCard).not.toMatch(/Offramp Webhook Received',\s*req\.body/);
        expect(yellowCard).not.toMatch(/Onramp Webhook Received',\s*req\.body/);
        expect(safeHaven).not.toContain('SafeHaven Webhook Body');
        expect(safeHaven).not.toMatch(/console\.log\([\s\S]*request\.body/);
        expect(bullBoard).not.toMatch(/accessToken,/);
    });
});
