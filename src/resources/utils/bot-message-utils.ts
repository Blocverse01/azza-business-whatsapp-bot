import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { UserAssetInfo } from '@/app/User/userSchema';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { SIX } from '@/constants/numbers';
import { USD_SYMBOL } from '@/constants/strings';
import {
    formatNumberAsCurrency,
    getCountryFlagEmoji,
    prettifyNumber,
} from '@/resources/utils/currency';

type BankInfo = {
    name: string;
    accountName: string;
    accountNumber: string;
};

export function generateOnrampTransactionInitiatedMessage(params: {
    tokenAmount: string;
    assetName: string;
    assetNetwork: string;
    fiatToPay: string;
    bankInfo: BankInfo;
    localCurrency: string;
}): string {
    const { tokenAmount, assetName, assetNetwork, fiatToPay, localCurrency, bankInfo } = params;

    const fiatToPayFormatted = formatNumberAsCurrency(parseFloat(fiatToPay), localCurrency);

    return `🔔 New transaction initiated.\n\n🧾 *Summary*:\nBuy ${tokenAmount} ${assetName} on ${assetNetwork} with ${fiatToPayFormatted}\n\n-------------------------------------------------------\n💳 *Payment Details*.\n-------------------------------------------------------\n\n*\`Account Number\`* ${bankInfo.accountNumber}\n\n*\`Account Name\`* ${bankInfo.accountName}\n\n*\`Bank Name\`* ${bankInfo.name}\n\n*\`Amount\`* ${fiatToPayFormatted}\n\n-------------------------------------------------------\n_After payment, we'll send you updates on your transaction's status._\n-------------------------------------------------------`;
}

export function generateOnrampTransactionInitiatedWithMomoPaymentMessage(params: {
    tokenAmount: string;
    assetName: string;
    assetNetwork: string;
    fiatToPay: string;
    localCurrency: string;
    momoDetails: BankInfo;
}): string {
    const { tokenAmount, assetName, assetNetwork, fiatToPay, localCurrency, momoDetails } = params;

    const fiatToPayFormatted = formatNumberAsCurrency(parseFloat(fiatToPay), localCurrency);

    return `🔔 New transaction initiated.\n\n🧾 *Summary*:\nBuy ${tokenAmount} ${assetName} on ${assetNetwork} with ${fiatToPayFormatted}\n\n-------------------------------------------------------\n💳 *MoMo Details*.\n-------------------------------------------------------\n\n*\`Phone Number\`* ${momoDetails.accountNumber}\n\n*\`Full Name\`* ${momoDetails.accountName}\n\n*\`Mobile Provider\`* ${momoDetails.name}\n\n*\`Amount\`* ${fiatToPayFormatted}\n\n-------------------------------------------------------\n_Please follow the instructions on your phone to complete the transaction._\n-------------------------------------------------------`;
}

export function generateOfframpProcessingMessage(params: {
    tokenAmount: string;
    assetName: string;
    assetNetwork: string;
    localCurrency: string;
    fiatAmount: string;
}): string {
    const { tokenAmount, assetName, assetNetwork, localCurrency, fiatAmount } = params;

    const fiatAmountFormatted = formatNumberAsCurrency(parseFloat(fiatAmount), localCurrency);

    return `🔔 New transaction initiated.\n\n🧾 *Summary*:\nSell ${tokenAmount} ${assetName} on ${assetNetwork} for ${fiatAmountFormatted}\n\n-------------------------------------------------------\n_Your transaction has been created, we'll send you updates on your transaction's status._\n-------------------------------------------------------`;
}

export function generateReceivedTokenMessage(params: {
    tokenAmount: string;
    assetName: string;
    assetNetwork: string;
    senderAddress: string;
    transactionHash: string;
    explorerUrl: string;
    newTokenBalance: string;
}): string {
    const {
        tokenAmount,
        assetName,
        assetNetwork,
        transactionHash,
        explorerUrl,
        senderAddress,
        newTokenBalance,
    } = params;

    return `🔔 Crypto Deposit Notification.\n\n🧾 *Summary:*\nReceived *${tokenAmount} ${assetName}* on *${assetNetwork}* from ${senderAddress}\n\n*You now have: ${newTokenBalance} ${assetName}*\n\n➡️ *Transaction Hash:* ${transactionHash}\n\n🔍 *View In Explorer:* ${explorerUrl}`;
}

export const EMOJIS_FOR_NETWORKS: Record<SupportedChain | ExtendedWalletSupportedNetworks, string> =
    {
        Ethereum: '🔷',
        Optimism: '🎯',
        Polygon: '💜',
        Base: '🔵',
        Tron: '♦️',
        Bep20: '🟡',
        Solana: '🟢',
    };

export const getNetworkEmoji = (network: SupportedChain | ExtendedWalletSupportedNetworks) =>
    EMOJIS_FOR_NETWORKS[network];

export function generateAssetBalanceMessage(
    assetInfo: UserAssetInfo,
    fiatConfig?: {
        localCurrencySymbol: string;
        countryCode: string;
        conversionRate: number;
    }
) {
    const { assetName, assetNetwork, usdDisplayBalance, tokenBalance, tokenBalanceDisplay } =
        assetInfo;

    const localCurrencyBalance = fiatConfig
        ? formatNumberAsCurrency(
              tokenBalance * fiatConfig.conversionRate,
              fiatConfig.localCurrencySymbol
          )
        : '';

    const localCurrencyEquivalent = fiatConfig
        ? `${getCountryFlagEmoji(fiatConfig.countryCode)} *Value:* ${localCurrencyBalance}`
        : '';

    const assetLabel = `${assetName} on ${assetNetwork}`;

    return `_*${EMOJIS_FOR_NETWORKS[assetNetwork]} ${assetLabel}*_\n- *Balance:* ${tokenBalanceDisplay}\n- *USD Value:*  ${usdDisplayBalance}${localCurrencyEquivalent ? `\n- ${localCurrencyEquivalent}` : ''}`;
}

export function generateAssetBalanceMessageV2(
    assetBalance: AssetBalance,
    fiatConfig?: {
        localCurrencySymbol: string;
        countryCode: string;
        conversionRate: number;
    }
) {
    const { asset, blockchainNetwork, balance, convertedBalanceUsd } = assetBalance;
    const assetName = asset.tokenName;

    const localCurrencyBalance =
        convertedBalanceUsd !== undefined && fiatConfig
            ? formatNumberAsCurrency(
                  convertedBalanceUsd * fiatConfig.conversionRate,
                  fiatConfig.localCurrencySymbol
              )
            : '';

    const localCurrencyEquivalent = fiatConfig
        ? `${getCountryFlagEmoji(fiatConfig.countryCode)} *Value:* ${localCurrencyBalance}`
        : '';

    const assetLabel = `${assetName} on ${blockchainNetwork}`;
    const tokenBalanceDisplay = prettifyNumber(balance, SIX);
    const usdBalanceDisplay =
        convertedBalanceUsd !== undefined ? prettifyNumber(convertedBalanceUsd, SIX) : null;

    return `_*${EMOJIS_FOR_NETWORKS[blockchainNetwork]} ${assetLabel}*_\n- *Balance:* ${tokenBalanceDisplay}${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''}${localCurrencyEquivalent ? `\n- ${localCurrencyEquivalent}` : ''}`;
}
