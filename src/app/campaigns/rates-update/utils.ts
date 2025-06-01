import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { generateRatesCard } from '@/app/rate-card/generators';
import { sendWhatsappBroadcastMessage } from '@/app/WhatsAppBot/messagingQueueHelpers';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { WhatsAppMessageType } from '@/app/WhatsAppBot/WhatsAppBotType';
import { queues } from '@/background-processing/queues';
import { QueueNames } from '@/background-processing/types';
import { TECHNICAL_SUPPORT_NUMBERS } from '@/config/support';
import env from '@/constants/env';
import { TWO } from '@/constants/numbers';
import { dbClient } from '@/db/dbClient';
import {
    getCountryFlagEmoji,
    getUserCountryCodeFromPhoneNumberOrThrow,
    prettifyNumber,
} from '@/resources/utils/currency';
import { type ConnectionOptions, Worker } from 'bullmq';

type Rate = Awaited<ReturnType<typeof FiatRampService.getAllRates>>[number];

const placeTargetLocaleAsFirstItem = (locale: string, rates: Array<Rate>) => {
    const targetLocalRate = rates.find(
        (rate) => rate.locale.toLowerCase() === locale.toLowerCase()
    );
    const targetLocalRateIndex = targetLocalRate ? rates.indexOf(targetLocalRate) : undefined;

    if (targetLocalRateIndex !== undefined && targetLocalRateIndex >= 0 && targetLocalRate) {
        rates.splice(targetLocalRateIndex, 1);
        rates.unshift(targetLocalRate);
    }

    return rates;
};

const prepareRateCardAndMessage = async (rates: Array<Rate>, businessPhoneNumberId: string) => {
    const ratesText = `Hey {{firstName}}! 🚀\n\nFresh rates just dropped:\n${rates.map((rate) => `${getCountryFlagEmoji(rate.locale)} ${rate.code}/USD\nBuy: ${prettifyNumber(rate.buy, TWO)}\nSell: ${prettifyNumber(rate.sell, TWO)}\n--------------------------`).join('\n')}\n\n⚡ *Ready to trade? Reply with /buy or /sell to get started!*`;
    const imageBinary = await generateRatesCard(rates);

    const imageFile = new File([Buffer.from(imageBinary)], 'rates_card.png', { type: 'image/png' });
    const mediaResponse = await WhatsAppBotService.uploadImageToWhatsapp(
        businessPhoneNumberId,
        imageFile
    );

    return {
        ratesText,
        rateCardMedia: mediaResponse,
        firstLocale: rates[0].locale,
    };
};

const prepareRateCardAndMesssageForLocaleGroups = async (rates: Array<Rate>) => {
    const uniqueLocales = Array.from(new Set(rates.map((rate) => rate.locale)));
    const promises = uniqueLocales.map((locale) =>
        prepareRateCardAndMessage(
            placeTargetLocaleAsFirstItem(locale, rates),
            env.WA_PHONE_NUMBER_ID
        )
    );

    const results = await Promise.all(promises);
    return results.reduce(
        (acc, { ratesText, rateCardMedia, firstLocale }) => {
            acc[firstLocale] = {
                ratesText,
                rateCardMedia,
            };
            return acc;
        },
        {} as Record<string, { ratesText: string; rateCardMedia: { id: string } | null }>
    );
};

// Helper function to get first name only
const getFirstNameOnly = (fullName: string): string => {
    return fullName?.trim().split(/\s+/)[0] || 'there';
};

const handleRatesUpdate = async () => {
    const rates = await FiatRampService.getAllRates();
    const [ratesByLocaleGroup, users] = await Promise.all([
        prepareRateCardAndMesssageForLocaleGroups(rates),
        dbClient.user_v2
            .filter({
                primaryWhatsappPhoneNumber: {
                    $any: TECHNICAL_SUPPORT_NUMBERS,
                },
            })
            .select(['primaryWhatsappPhoneNumber', 'firstName'])
            .getAll(),
    ]);

    const messages = users.map(
        (user) =>
            new Promise((resolve) => {
                const phoneNumber = user.primaryWhatsappPhoneNumber;
                const userCountryCode = getUserCountryCodeFromPhoneNumberOrThrow(phoneNumber);
                const rateConfig = ratesByLocaleGroup[userCountryCode];
                const firstName = getFirstNameOnly(user.firstName ?? '');
                const personalizedText = rateConfig?.ratesText.replace('{{firstName}}', firstName);

                const messageType = rateConfig?.rateCardMedia
                    ? ('image' as const)
                    : WhatsAppMessageType.TEXT;
                const messagePayload = rateConfig?.rateCardMedia
                    ? {
                          id: rateConfig.rateCardMedia.id,
                          caption: personalizedText,
                      }
                    : {
                          preview_url: false,
                          body: personalizedText,
                      };

                resolve(
                    sendWhatsappBroadcastMessage({
                        message: {
                            messaging_product: 'whatsapp',
                            recipient_type: 'individual',
                            to: phoneNumber,
                            type: messageType,
                            [messageType]: messagePayload,
                        },
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                    })
                );
            })
    );

    await Promise.all(messages);
};

export const prepareRatesUpdateQueue = async () => {
    await queues.dailyRatesUpdate.upsertJobScheduler(
        'daily-rates-update',
        {
            every: 5 * 60 * 1000, // Job will repeat every 5 minutes for testing
            //pattern: '0 12 * * *'
        },
        {
            name: 'daily-rates-update',
        }
    );
};

export const createRatesUpdateWorker = (connection: ConnectionOptions) => {
    return new Worker(
        QueueNames.dailyRatesUpdate,
        async () => {
            await handleRatesUpdate();
        },
        {
            connection,
        }
    );
};
