import { OfframpTransactionRecord, OnrampTransactionRecord } from '@/app/FiatRamp/fiatRampSchema';
import { prettifyNumber } from '@/resources/utils/currency';
import { truncate } from '@/resources/utils/transformers';
import { formatDate } from 'date-fns';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import FiatRampService from '../FiatRamp/FiatRampService';
import { NgnVasSettlementTransactionRecord } from '@/db/xata';
import { NetworkLogos, NetworkTitle } from '../NigeriaBanks/SafeHaven/WhitelistedVasServices';

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
        height: 744,
        deviceScaleFactor: 3, // Higher resolution
    });

    const country = countries.find(
        (c) => c.code.toLowerCase() === offrampTransaction.destination.country.toLowerCase()
    );

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/offramp.html'), 'utf8');

    const transactionDate = formatDate(offrampTransaction.createdAt, 'dd/MM/yyyy');
    const transactionTime = formatDate(offrampTransaction.createdAt, 'HH:mm a');
    const tokenIconBase64 = encodeToBase64(
        path.join(
            __dirname,
            `templates/images/crypto-logos/${offrampTransaction.tokenSymbol.toLowerCase()}.svg`
        ),
        'image/svg+xml'
    );
    const fontBase64 = encodeToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2'),
        'font/woff2'
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );

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
        .replaceAll('{{transactionDate}}', transactionDate)
        .replaceAll('{{transactionTime}}', transactionTime)
        .replaceAll('{{tokenIcon}}', tokenIconBase64);

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

export const generatePizzaPaymentReceipt = async (offrampTransaction: OfframpTransactionRecord) => {
    const browser = await puppeteer.launch();
    const [page, countries] = await Promise.all([
        browser.newPage(),
        FiatRampService.getSupportedCurrencies(),
    ]);

    // Increase resolution
    await page.setViewport({
        width: 390,
        height: 744,
        deviceScaleFactor: 3, // Higher resolution
    });

    const country = countries.find(
        (c) => c.code.toLowerCase() === offrampTransaction.destination.country.toLowerCase()
    );

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/offramp-pizza.html'), 'utf8');

    const transactionDate = formatDate(offrampTransaction.createdAt, 'dd/MM/yyyy');
    const transactionTime = formatDate(offrampTransaction.createdAt, 'HH:mm a');
    const tokenIconBase64 = encodeToBase64(
        path.join(
            __dirname,
            `templates/images/crypto-logos/${offrampTransaction.tokenSymbol.toLowerCase()}.svg`
        ),
        'image/svg+xml'
    );
    const fontBase64 = encodeToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2'),
        'font/woff2'
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );
    const pizzaAssets = {
        topLeft: encodeToBase64(
            path.join(__dirname, 'templates/images/pizza-receipt/pizza-receipt-tl.png'),
            'image/png'
        ),
        topRight: encodeToBase64(
            path.join(__dirname, 'templates/images/pizza-receipt/pizza-receipt-tr.png'),
            'image/png'
        ),
        pizzaSlice: encodeToBase64(
            path.join(__dirname, 'templates/images/pizza-receipt/pizza-slice.png'),
            'image/png'
        ),
        pizzaSlice2: encodeToBase64(
            path.join(__dirname, 'templates/images/pizza-receipt/pizza-slice-2.png'),
            'image/png'
        ),
        bottomGroup: encodeToBase64(
            path.join(__dirname, 'templates/images/pizza-receipt/bottom-group.png'),
            'image/png'
        ),
    };

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
        .replaceAll('{{transactionDate}}', transactionDate)
        .replaceAll('{{transactionTime}}', transactionTime)
        .replaceAll('{{tokenIcon}}', tokenIconBase64)
        .replace('images/pizza-receipt/pizza-receipt-tl.png', pizzaAssets.topLeft)
        .replace('images/pizza-receipt/pizza-receipt-tr.png', pizzaAssets.topRight)
        .replace('images/pizza-receipt/pizza-slice.png', pizzaAssets.pizzaSlice)
        .replace('images/pizza-receipt/pizza-slice-2.png', pizzaAssets.pizzaSlice2)
        .replace('images/pizza-receipt/bottom-group.png', pizzaAssets.bottomGroup);

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

export const generateOfframpReceipt = async (offrampTransaction: OfframpTransactionRecord) => {
    return await generateOfframpToBankRecipientReceipt(offrampTransaction);
};

export const generateOnrampReceipt = async (onrampTransaction: OnrampTransactionRecord) => {
    const browser = await puppeteer.launch();
    const [page, countries] = await Promise.all([
        browser.newPage(),
        FiatRampService.getSupportedCurrencies(),
    ]);

    // Increase resolution
    await page.setViewport({
        width: 390,
        height: 660,
        deviceScaleFactor: 3, // Higher resolution
    });

    const country = countries.find(
        (c) => c.code.toLowerCase() === onrampTransaction.collectionCountry.toLowerCase()
    );

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/onramp.html'), 'utf8');

    const transactionDate = formatDate(onrampTransaction.createdAt, 'dd/MM/yyyy');
    const transactionTime = formatDate(onrampTransaction.createdAt, 'HH:mm a');
    const tokenIconBase64 = encodeToBase64(
        path.join(
            __dirname,
            `templates/images/crypto-logos/${onrampTransaction.tokenSymbol.toLowerCase()}.svg`
        ),
        'image/svg+xml'
    );
    const fontBase64 = encodeToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2'),
        'font/woff2'
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );

    template = template
        .replace('url(./fonts/Subjectivity.Extrabold.woff2)', `url(${fontBase64})`)
        .replace('url(./images/pattern-bg.png)', `url(${patternBgBase64})`)
        .replaceAll('{{tokenSymbol}}', onrampTransaction.tokenSymbol.toUpperCase())
        .replaceAll(
            '{{tokenAmount}}',
            prettifyNumber(onrampTransaction.tokenAmount ?? onrampTransaction.usdAmount, 4)
        )
        .replaceAll('{{fiatAmount}}', prettifyNumber(onrampTransaction.localAmount, 2))
        .replaceAll('{{fiatCurrencySymbol}}', onrampTransaction.localCurrencySymbol)
        .replaceAll('{{fiatCurrencyIcon}}', country?.flag ?? '')
        .replaceAll('{{walletAddress}}', truncate(onrampTransaction.destinationWalletAddress, 16))
        .replaceAll('{{blockchainNetwork}}', onrampTransaction.blockchainNetwork)
        .replaceAll(
            '{{transactionFee}}',
            onrampTransaction.transactionFeeInToken?.toString() ??
                onrampTransaction.transactionFeeUsd.toString()
        )
        .replaceAll('{{transactionDate}}', transactionDate)
        .replaceAll('{{transactionTime}}', transactionTime)
        .replaceAll('{{tokenIcon}}', tokenIconBase64);

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


export const generateBillPaymentReceipt = async (ngnVasTransaction: NgnVasSettlementTransactionRecord) => {
    const browser = await puppeteer.launch();
    const [page, countries] = await Promise.all([
        browser.newPage(),
        FiatRampService.getSupportedCurrencies(),
    ]);

    // Increase resolution
    await page.setViewport({
        width: 390,
        height: 660,
        deviceScaleFactor: 3, // Higher resolution
    });

    const country = countries.find(
        (c) => c.code.toLowerCase() === ngnVasTransaction?.country!.toLowerCase()
    );

    // Load the receipt template
    let template = fs.readFileSync(path.join(__dirname, 'templates/bill-payment.html'), 'utf8');

    const transactionDate = formatDate(ngnVasTransaction?.xata.createdAt!, 'dd/MM/yyyy');
    const transactionTime = formatDate(ngnVasTransaction?.xata.createdAt!, 'HH:mm a');
    const tokenIconBase64 = encodeToBase64(
        path.join(
            __dirname,
            `templates/images/crypto-logos/${ngnVasTransaction?.tokenSymbol!.toLowerCase()}.svg`
        ),
        'image/svg+xml'
    );
    const fontBase64 = encodeToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2'),
        'font/woff2'
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );

    const fiatAmount = prettifyNumber(ngnVasTransaction?.localAmount!, 2);
    const bundleCode = `${ngnVasTransaction?.bundleCode} - ${ngnVasTransaction?.localCurrencySymbol!} ${prettifyNumber(ngnVasTransaction?.localAmount!, 2)}`;
    const distributionIcon = NetworkLogos[ngnVasTransaction.distributionName as NetworkTitle];

    template = template
        .replace('url(./fonts/Subjectivity.Extrabold.woff2)', `url(${fontBase64})`)
        .replace('url(./images/pattern-bg.png)', `url(${patternBgBase64})`)
        .replaceAll('{{tokenSymbol}}', ngnVasTransaction?.tokenSymbol!.toUpperCase())
        .replaceAll('{{tokenAmount}}', prettifyNumber(ngnVasTransaction?.usdAmount!, 4))
        .replaceAll('{{fiatAmount}}', fiatAmount)
        .replaceAll('{{fiatCurrencySymbol}}', ngnVasTransaction?.localCurrencySymbol!)
        .replaceAll('{{fiatCurrencyIcon}}', country?.flag ?? '')
        .replaceAll('{{transactionDate}}', transactionDate)
        .replaceAll('{{transactionTime}}', transactionTime)
        .replaceAll('{{recipientAccountNumber}}', ngnVasTransaction.recipientPhoneNumber!)
        .replaceAll('{{distributionName}}', ngnVasTransaction.distributionName!)
        .replaceAll('{{tokenIcon}}', tokenIconBase64)
        .replaceAll('{{transactionType}}', ngnVasTransaction.transactionType === 'airtime' ? 'Airtime' : 'Data Bundle')
        .replaceAll('{{bundleCodeOrAmount}}', ngnVasTransaction.transactionType === 'airtime' ? `${ngnVasTransaction?.localCurrencySymbol!} ${fiatAmount}` : bundleCode)
        .replaceAll('{{distributionIcon}}', `data:image/png;base64,${distributionIcon}`)


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

function encodeToBase64(filePath: string, fileType: string) {
    return `data:${fileType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}
