import {
    AllSupportedBlockchains,
    isEvmCompatibleBlockchain,
} from '@/resources/web3/core/blockchains';

export const getDefaultParamsForNetworkFeeQuery = (network: AllSupportedBlockchains) => {
    const amount = 1;
    let recipient = '';

    if (isEvmCompatibleBlockchain(network)) {
        recipient = '0x557e17a790C85D867813Fd9446A5263307A44Ca7';
    } else if (network === 'Solana') {
        recipient = '5KtbAZXnGWdQ9H1RLptyLz2tLKNtsk1agXqfQiri7irg';
    } else if (network === 'Tron') {
        recipient = 'TGZntn1ErdAGZnMRsNRciDtGEQj2DAsDSq';
    }

    return {
        amount,
        recipient,
    };
};
