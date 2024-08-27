import {
    formatNumberAsCurrency,
    getCountryFlagEmoji,
    prettifyNumber,
} from '@/Resources/utils/currency';
import { UserAssetInfo } from '@/app/User/userSchema';
import { TWO } from '@/constants/numbers';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';

type BankInfo = {
    bankName: string;
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

    return `🔔 New transaction initiated.\n\n🧾 *Summary*:\nBuy ${tokenAmount} ${assetName} on ${assetNetwork} with ${fiatToPayFormatted}\n\n-------------------------------------------------------\n💳 *Payment Details*.\n-------------------------------------------------------\n\n*\`Account Number\`* ${bankInfo.accountNumber}\n\n*\`Account Name\`* ${bankInfo.accountName}\n\n*\`Bank Name\`* ${bankInfo.bankName}\n\n*\`Amount\`* ${fiatToPayFormatted}\n\n-------------------------------------------------------\n_After payment, we'll send you updates on your transaction's status._\n-------------------------------------------------------`;
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

    return `🔔 New transaction initiated.\n\n🧾 *Summary*:\nBuy ${tokenAmount} ${assetName} on ${assetNetwork} with ${fiatToPayFormatted}\n\n-------------------------------------------------------\n💳 *MoMo Details*.\n-------------------------------------------------------\n\n*\`Phone Number\`* ${momoDetails.accountNumber}\n\n*\`Full Name\`* ${momoDetails.accountName}\n\n*\`Mobile Provider\`* ${momoDetails.bankName}\n\n*\`Amount\`* ${fiatToPayFormatted}\n\n-------------------------------------------------------\n_Please follow the instructions on your phone to complete the transaction._\n-------------------------------------------------------`;
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

const EMOJIS_FOR_NETWORKS: Record<SupportedChain | ExtendedWalletSupportedNetworks, string> = {
    Ethereum: '🔷',
    Optimism: '🎯',
    Polygon: '💜',
    Base: '🔵',
    Tron: '🟠',
    Bep20: '🟡',
    Solana: '🟢',
};

export function generateAssetBalanceMessage(
    assetInfo: UserAssetInfo,
    fiatConfig?: {
        localCurrencySymbol: string;
        countryCode: string;
        conversionRate: number;
    }
) {
    const { assetName, assetNetwork, usdDisplayBalance, tokenBalance } = assetInfo;

    const tokenBalanceNumber = Number(tokenBalance);
    const assetBalance = prettifyNumber(tokenBalanceNumber, TWO);
    const localCurrencyBalance = fiatConfig
        ? formatNumberAsCurrency(
              tokenBalanceNumber * fiatConfig.conversionRate,
              fiatConfig.localCurrencySymbol
          )
        : '';

    const localCurrencyEquivalent = fiatConfig
        ? `${getCountryFlagEmoji(fiatConfig.countryCode)} *Value:* ${localCurrencyBalance}`
        : '';

    const assetLabel = `${assetName} on ${assetNetwork}`;

    return `_*${EMOJIS_FOR_NETWORKS[assetNetwork]} ${assetLabel}*_\n- *Balance:* ${assetBalance}\n- *USD Value:*  ${usdDisplayBalance}${localCurrencyEquivalent ? `\n- ${localCurrencyEquivalent}` : ''}`;
}
