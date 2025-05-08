import { ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import azzaWalletManager from '@/runtime/wallet';

type SupportedAssetFilters = {
    action?: ExploreAssetActions;
};

export function getSupportedAssetAndNetworksText(filter: SupportedAssetFilters = {}) {
    const supportedAssets = azzaWalletManager.getSupportedAssets();
    const supportedTokenNames = supportedAssets.map((asset) => asset.tokenName);

    const uniqueSupportedTokenNames = Array.from(new Set(supportedTokenNames));

    return uniqueSupportedTokenNames
        .map((tokenName) => {
            const supportedNetworks = supportedAssets
                .filter(
                    (asset) =>
                        asset.tokenName === tokenName &&
                        (!filter.action || asset.supportedAssetActions.includes(filter.action))
                )
                .map((asset) => asset.network);
            return supportedNetworks.length > 0
                ? `- ${tokenName}: ${supportedNetworks.join(', ')}`
                : '';
        })
        .filter(Boolean)
        .join('\n');
}

export function getUserReferralStatsMessageText(displayName?: string) {
    return [
        `Click the button below to check your referral stats.`,
    ].join('\n');
}

export function getFirstTimeUserMessageText(displayName: string) {
    return [
        `Hi ${displayName}!👋 Welcome to Azza.`,
        `Azza can help you send, receive and manage crypto easily.`,
        `Click on "Create wallet" to create a wallet to get started. Don’t forget to save my contact as AZZA`,
    ].join('\n');
}

export function getWalletCreationSuccessMessageText() {
    return [
        `Your wallet is ready! 🎉 Now, let’s secure it with a PIN.`,
        `Click on "Set PIN" to create your 4-digit transaction PIN.`,
        `This keeps your wallet safe and only accessible to you. 🔒`,
    ].join('\n');
}

export function getTransactionPinSetMessageText() {
    return `All set! 🎉 Now your wallet is secure. Keep your PIN private- it’s your key to staying secure.`;
}

const majorActionLines = [
    '✅ Buy crypto – Say "I want to buy crypto" or type /buy',
    '✅ Sell crypto – Say "I want to sell crypto" or type /sell',
    '✅ Deposit crypto – Say "I want to deposit crypto" or type /deposit',
    '✅ Withdraw crypto – Say "I want to withdraw crypto" or type /withdraw',
    '✅ Swap crypto – Say "I want to swap crypto" or type /swap',
];

export function getPossibleBotActionsMessageText() {
    return [`Here is what you can do with AZZA.\n`, ...majorActionLines].join('\n');
}

export function getWelcomeBackMessageText() {
    return [
        `Hi there! How can I assist you with your wallet today? 😊\n`,
        `*Here are the things I can help you with:*`,
        ...majorActionLines,
    ].join('\n');
}

export function getHelpMessageText() {
    return [
        `✅ Balance – Say “check balance” or /balance`,
        `✅ Buy crypto – Say “buy crypto” or /buy`,
        `✅ Change PIN – Say “change pin” or /change_pin`,
        `✅ Check rates – Say “rates” or /rates`,
        `✅ Deposit crypto – Say “deposit crypto” or /deposit`,
        `✅ Help – Say “help” or /help`,
        `✅ Manage assets – Say “manage assets” or /my_assets`,
        //`✅ Make payment- Say “payment” or “/payment”`,
        `✅ Reset PIN – Say “reset pin” or /reset_pin`,
        `✅ Sell crypto – Say “sell crypto” or  /sell`,
        `✅ Swap crypto – Say “swap crypto” or /swap`,
        `✅ Withdraw crypto – Say “withdraw crypto” or  /withdraw`,
    ].join('\n');
}

const SUPPORT_CONTACTS = [
    {
        name: 'Victor',
        phone: '+234 814 684 3432',
    },
    {
        name: 'TC',
        phone: '+234 811 585 7771',
    },
    {
        name: 'Josh',
        phone: '+234 814 310 0808',
    },
    {
        name: 'Logan',
        phone: '+234 902 147 5610',
    },
];

export function getSupportContactsMessageText() {
    return [
        `Need help? Reach out to any of these numbers:\n`,
        ...SUPPORT_CONTACTS.map((contact) => `💬${contact.name}: ${contact.phone}`),
    ].join('\n');
}
