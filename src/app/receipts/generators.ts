import { OfframpTransactionRecord } from '@/app/FiatRamp/fiatRampSchema';
import { prettifyNumber } from '@/resources/utils/currency';
import { TokenIconURIs } from '@/resources/web3/core/tokens';
import { formatDate } from 'date-fns';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import FiatRampService from '../FiatRamp/FiatRampService';

export const generateOfframpToBankRecipientReceipt = async (
    offrampTransaction: OfframpTransactionRecord
) => {
    const browser = await puppeteer.launch();
    const [page, countries] = await Promise.all([
        browser.newPage(),
        FiatRampService.getSupportedCurrencies(),
    ]);

    // Increase resolution
    await page.setViewport({
        width: 390,
        height: 804,
        deviceScaleFactor: 3, // Higher resolution
    });

    const country = countries.find(
        (c) => c.code.toLowerCase() === offrampTransaction.destination.country.toLowerCase()
    );

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/offramp.html'), 'utf8');

    const createdAtString = formatDate(offrampTransaction.createdAt, 'dd/MM/yyyy HH:mm a');
    const tokenIconUrl = TokenIconURIs[offrampTransaction.tokenSymbol.toUpperCase()];
    const fontBase64 = encodeFontToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2')
    );
    const patternBgBase64 = encodeToBase64(path.join(__dirname, 'templates/images/pattern-bg.png'));

    template = template
        .replace('url(./fonts/Subjectivity.Extrabold.woff2)', `url(${fontBase64})`)
        .replace('url(./images/pattern-bg.png)', `url(${patternBgBase64})`)
        .replaceAll('{{tokenSymbol}}', offrampTransaction.tokenSymbol.toUpperCase())
        .replaceAll('{{tokenAmount}}', prettifyNumber(offrampTransaction.usdAmount, 4))
        .replaceAll('{{fiatAmount}}', prettifyNumber(offrampTransaction.localAmount, 2))
        .replaceAll('{{fiatCurrencySymbol}}', offrampTransaction.localCurrencySymbol)
        .replaceAll('{{fiatCurrencyIcon}}', country?.flag ?? '')
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
        omitBackground: false,
        type: 'png',
        fullPage: true,
    });
    await browser.close();

    return imageBinary;
};

function encodeFontToBase64(filePath: string) {
    return `data:font/woff2;base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function encodeToBase64(filePath: string) {
    return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
}
