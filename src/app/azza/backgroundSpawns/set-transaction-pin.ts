import { SetTransactionPinParams } from '@/app/azza/azza.schema';
import { setTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logSync } from '@/resources/logger';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';

const setTransactionParams: SetTransactionPinParams = JSON.parse(process.argv[2]);

async function executeScript(params: SetTransactionPinParams) {
    const userId = convertBase64ToAsciiString(params.userId);

    try {
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(userId, '🚀 Securing your account 🔐...')
        );

        const response = await setTransactionPin(params);

        if (response.pinSet) {
            const possibleActions = [
                { emoji: '🔁', description: 'Transfer assets to contacts and wallet addresses' },
                { emoji: '📈', description: 'Check your wallet balance' },
                { emoji: '💰', description: 'Deposit crypto into your wallet' },
            ];

            const actionsList = possibleActions
                .map((action) => `• ${action.emoji} ${action.description}`)
                .join('\n');

            const message = MessageGenerators.generateTextMessage(
                userId,
                `✅ *Transaction PIN successfully updated!*\n\n🔒 _Keep it safe—your PIN is personal and should not be shared._\n\nHere's what you can do next on Azza:\n\n${actionsList}\n\n💬 Type *help* to ask the bot for guidance or try slash commands like */transfer*, */balance*, or */deposit* to get started!`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            return;
        }
    } catch (error) {
        logSync('error', 'Error setting transaction PIN', { error });

        const message = MessageGenerators.generateTextMessage(
            userId,
            `An error occurred while setting transaction pin. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
}

void executeScript(setTransactionParams);
