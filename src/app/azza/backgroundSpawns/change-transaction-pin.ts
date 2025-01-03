import { ChangeTransactionPinParams } from '@/app/azza/azza.schema';
import { changeTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logSync } from '@/resources/logger';

const changeTransactionPinParams: ChangeTransactionPinParams = JSON.parse(process.argv[2]);

export const executeScript = async (params: ChangeTransactionPinParams) => {
    try {
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                params.userId,
                '🚀 Updating your Transaction PIN 🔐...'
            )
        );

        const response = await changeTransactionPin(params);

        if (response.pinChanged) {
            const possibleActions = [
                { emoji: '🔁', description: 'Transfer assets to contacts and wallet addresses' },
                { emoji: '📈', description: 'Check your wallet balance' },
                { emoji: '💰', description: 'Deposit crypto into your wallet' },
            ];

            const actionsList = possibleActions
                .map((action) => `• ${action.emoji} ${action.description}`)
                .join('\n');

            const message = MessageGenerators.generateTextMessage(
                params.userId,
                `✅ *Transaction PIN successfully updated!*\n\n🔒 _Keep it safe—your PIN is personal and should not be shared._\n\nHere's what you can do next on Azza:\n\n${actionsList}\n\n💬 Type *help* to ask the bot for guidance or try slash commands like */transfer*, */balance*, or */deposit* to get started!`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            return;
        }

        return;
    } catch (error) {
        logSync('error', 'Error changing transaction PIN', { error });

        const message = MessageGenerators.generateTextMessage(
            params.userId,
            `An error occurred while changing transaction pin. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
};

void executeScript(changeTransactionPinParams);
