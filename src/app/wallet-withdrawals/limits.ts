import { AssetInteractiveButtonIds } from '@/app/WhatsAppBot/WhatsAppBotType';

const FIXED_WITHDRAWAL_MINIMUM: Partial<Record<AssetInteractiveButtonIds, number>> = {
    [AssetInteractiveButtonIds.USDC_SOLANA]: 10,
    [AssetInteractiveButtonIds.USDT_SOLANA]: 10,
};

export const getWithdrawalMinimum = (assetId: AssetInteractiveButtonIds): number | null => {
    return FIXED_WITHDRAWAL_MINIMUM[assetId] ?? null;
};
