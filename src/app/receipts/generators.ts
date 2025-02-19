import { OfframpTransactionRecord } from '@/app/FiatRamp/fiatRampSchema';
import { getCountryFlagEmoji, prettifyNumber } from '@/resources/utils/currency';
import { TokenIconURIs } from '@/resources/web3/core/tokens';
import { formatDate } from 'date-fns';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

export const generateOfframpToBankRecipientReceipt = async (
    offrampTransaction: OfframpTransactionRecord
) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/offramp.html'), 'utf8');

    const createdAtString = formatDate(offrampTransaction.createdAt, 'dd/MM/yyyy HH:mm a');
    const tokenIconUrl = TokenIconURIs[offrampTransaction.tokenSymbol.toUpperCase()];

    template = template
        .replaceAll('{{tokenSymbol}}', offrampTransaction.tokenSymbol.toUpperCase())
        .replaceAll('{{tokenAmount}}', prettifyNumber(offrampTransaction.usdAmount, 4))
        .replaceAll('{{fiatAmount}}', prettifyNumber(offrampTransaction.localAmount, 2))
        .replaceAll('{{fiatCurrencySymbol}}', offrampTransaction.localCurrencySymbol)
        .replaceAll(
            '{{fiatCurrencyIcon}}',
            getCountryFlagEmoji(offrampTransaction.destination.country)
        )
        .replaceAll('{{recipientBankName}}', offrampTransaction.destination.networkName)
        .replaceAll('{{recipientAccountName}}', offrampTransaction.destination.accountName)
        .replaceAll('{{recipientAccountNumber}}', offrampTransaction.destination.accountNumber)
        .replaceAll('{{transactionFee}}', offrampTransaction.transactionFeeUsd.toString())
        .replaceAll('{{transactionDate}}', createdAtString)
        .replaceAll('{{tokenIcon}}', tokenIconUrl);

    await page.setContent(template, { waitUntil: 'networkidle0' });

    // Capture the receipt as an image
    const imageBinary = await page.screenshot({
        encoding: 'binary',
        optimizeForSpeed: true,
        type: 'png',
        fullPage: true,
    });
    await browser.close();

    return imageBinary;
};
