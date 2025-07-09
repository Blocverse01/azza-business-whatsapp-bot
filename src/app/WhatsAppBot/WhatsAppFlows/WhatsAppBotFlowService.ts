import { DropdownOption } from "./types";



class WhatsAppBotFlowService {

    public static determineSelectedAccountType(
        account_type: string,
        account_types: Array<DropdownOption>
    ) {
        const selectedAccountType = account_types.find((type) => type.id === account_type);

        if (!selectedAccountType) {
            throw new Error('Invalid account type');
        }

        return {
            accountType: selectedAccountType.title.toLowerCase().includes('bank')
                ? 'bank'
                : 'phone',
            channelId: selectedAccountType.id,
        };
    }

    public static determineSelectedBank(bank: string, supported_banks: Array<DropdownOption>) {
        const selectedBank = supported_banks.find((type) => type.id === bank);

        if (!selectedBank) {
            throw new Error('Invalid bank');
        }

        return {
            bankName: selectedBank.title,
            networkId: selectedBank.id,
        };
    }

    public static determineSelectedMobileProvider(
        mobileProvider: string,
        supportedMobileProviders: Array<Required<DropdownOption>>
    ) {
        const selectedMobileProvider = supportedMobileProviders.find(
            (type) => type.id === mobileProvider
        );

        if (!selectedMobileProvider) {
            throw new Error('Invalid account type');
        }

        return {
            providerName: selectedMobileProvider.title,
            networkId: selectedMobileProvider.id,
            providerCode: selectedMobileProvider.description,
        };
    }

}

export default WhatsAppBotFlowService;