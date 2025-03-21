import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { formatDate } from 'date-fns';
import { prettifyNumber } from '@/resources/utils/currency';
import FiatRampService from '../FiatRamp/FiatRampService';

function encodeFontToBase64(filePath: string) {
    try {
        return `data:font/woff2;base64,${fs.readFileSync(filePath).toString('base64')}`;
    } catch (error) {
        console.error(`Error encoding font at ${filePath}:`, error);
        return ''; // Fallback to empty string
    }
}

function encodeToBase64(filePath: string) {
    try {
        return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
    } catch (error) {
        console.error(`Error encoding image at ${filePath}:`, error);
        return ''; // Fallback to empty string
    }
}

export const generateRatesCard = async (
    rates: Array<{ locale: string; code: string; buy: number; sell: number }>
) => {
    const browser = await puppeteer.launch();
    const [page, countries] = await Promise.all([
        browser.newPage(),
        FiatRampService.getSupportedCurrencies(),
    ]);

    // Set viewport for the image
    await page.setViewport({
        width: 1080,
        height: 884,
        deviceScaleFactor: 4, // Higher resolution
    });

    // Load the rates template
    let template = fs.readFileSync(path.join(__dirname, 'templates/rates.html'), 'utf8');

    // Prepare data for the template
    const transactionDate = formatDate(new Date(), 'do MMMM, yyyy');
    const fontBase64 = encodeFontToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity.Extrabold.woff2')
    );
    const font2Base64 = encodeFontToBase64(
        path.join(__dirname, 'templates/fonts/Subjectivity-Super.woff2')
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg1.png')
    );
    const coinLeftBase64 = encodeToBase64(path.join(__dirname, 'templates/images/coin-left.png'));
    const coinRightBase64 = encodeToBase64(path.join(__dirname, 'templates/images/coin-right.png'));
    const instagramIconBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/instagram-icon.png')
    );
    const xIconBase64 = encodeToBase64(path.join(__dirname, 'templates/images/x-icon.png'));

    // Generate the HTML for the rates table
    const ratesHtml = rates
        .map((rate) => {
            const country = countries.find(
                (c) => c.code.toLowerCase() === rate.locale.toLowerCase()
            );

            return `
                <div class="flex flex-col gap-[0.88px] pl-[35.07px]">
                    <div class="flex items-baseline gap-2">
                        <img src="${country?.flag}" class="h-[35px] w-[35px] rounded-full" />
                        <span class="font-subjectivity font-[800] text-[35.12px] leading-[46.83px] tracking-[-2.93px]">${rate.code}/USD</span>
                    </div>
                    <div class="font-subjectivity font-[800] text-[35.12px] leading-[46.83px] tracking-[-2.93px]">
                        ${prettifyNumber(rate.buy, 2)}
                    </div>
                    <div class="font-subjectivity font-[800] text-[35.12px] leading-[46.83px] tracking-[-2.93px]">
                        ${prettifyNumber(rate.sell, 2)}
                    </div>
                </div>
            `;
        })
        .join('');

    // Replace placeholders in the template
    template = template
        .replace('url(./fonts/Subjectivity.Extrabold.woff2)', `url(${fontBase64})`)
        .replace('url(./fonts/Subjectivity-Super.woff2)', `url(${font2Base64})`)
        .replace('url(./images/pattern-bg1.png)', `url(${patternBgBase64})`)
        .replace('./images/coin-left.png', `${coinLeftBase64}`)
        .replace('./images/coin-right.png', `${coinRightBase64}`)
        .replace('./images/instagram-icon.png', `${instagramIconBase64}`)
        .replace('./images/x-icon.png', `${xIconBase64}`)
        .replaceAll('{{transactionDate}}', transactionDate)
        .replaceAll('{{ratesHtml}}', ratesHtml);

    // Set the content in Puppeteer
    await page.setContent(template, { waitUntil: 'networkidle0' });

    // Capture the image
    const imageBinary = await page.screenshot({
        encoding: 'binary',
        omitBackground: false,
        type: 'png',
        fullPage: true,
    });

    await browser.close();

    return imageBinary;
};
