import { dbClient } from '@/db/dbClient';
import { z } from 'zod';

// Rate override schema for database storage
export const rateOverrideSchema = z.object({
    currencyCode: z.string(), // e.g., 'NGN', 'KES'
    buyRate: z.number().optional().nullable(),
    sellRate: z.number().optional().nullable(),
    isActive: z.boolean().default(true),
    updatedAt: z.date(),
    lastUpdatedBy: z.string(), // Admin user ID
    displayCurrencyCodeAs: z.string().optional().nullable() // e,g cNGN
});

export type RateOverride = z.infer<typeof rateOverrideSchema>;

export class AzzaRateSource {
    /**
     * Get active rate overrides for specific currencies
     */
    public static async getRateOverrides(currencyCodes?: string[]): Promise<RateOverride[]> {
        let query = dbClient.rate_overrides.filter({
            isActive: true,
        });

        if (currencyCodes && currencyCodes.length > 0) {
            query = query.filter({
                currencyCode: { $any: currencyCodes }
            });
        }

        return z.array(rateOverrideSchema).parse(await query.getAll());
    }

    /**
     * Get all active overrides with their effective dates
     */
    public static async getAllActiveOverrides(): Promise<RateOverride[]> {
        return await this.getRateOverrides();
    }
}