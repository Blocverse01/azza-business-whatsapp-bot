import { encodeToBase64 } from '@/resources/utils/encoding';
import fs from 'fs';
import { readFile } from 'fs/promises';
import path from "path";
import puppeteer from "puppeteer";



export const generateReferralCard = async (params: { referralCode: string, displayName: string, qrCode: string }) => {


    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set viewport for the image
    await page.setViewport({
        width: 1080,
        height: 884,
        deviceScaleFactor: 4, // Higher resolution
    });

    let template = await readFile(path.join(__dirname, `templates/referral-card.html`), 'utf8');

    const subjectivityEBBase64 = encodeToBase64(
        path.join(
            __dirname,
            '../../resources/image-generation/fonts/Subjectivity.Extrabold.woff2'
        ),
        'font/woff2'
    );
    const subjectivityMBase64 = encodeToBase64(
        path.join(__dirname, '../../resources/image-generation/fonts/Subjectivity-Medium.woff2'),
        'font/woff2'
    );
    const subjectivitySBase64 = encodeToBase64(
        path.join(__dirname, '../../resources/image-generation/fonts/Subjectivity-Super.woff2'),
        'font/woff2'
    );

    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );

    const coinLeftBase64 = encodeToBase64(path.join(__dirname, 'templates/images/usdt-logo.png'), 'image/png');
    const coinRightBase64 = encodeToBase64(path.join(__dirname, 'templates/images/usdc-logo.png'), 'image/png');

    const qrCodeBase64 = params.qrCode

    template = template
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Super.woff2)',
            `url(${subjectivitySBase64})`
        )
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Medium.woff2)',
            `url(${subjectivityMBase64})`
        )
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Extrabold.woff2)',
            `url(${subjectivityEBBase64})`
        )
        .replace('url(./images/pattern-bg.png)', `url(${patternBgBase64})`)
        .replace('./images/usdt-logo.png', `${coinLeftBase64}`)
        .replace('./images/usdc-logo.png', `${coinRightBase64}`)
        .replace('./images/qr-code.png', `${qrCodeBase64}`)
        .replaceAll('{displayName}', params.displayName)
        .replaceAll('{referralCode}', params.referralCode)


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

}


export const generateReferralStats = async (params: { totalReferred: string, displayName: string }) => {


    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set viewport for the image
    await page.setViewport({
        width: 1080,
        height: 884,
        deviceScaleFactor: 4, // Higher resolution
    });

    let template = await readFile(path.join(__dirname, `templates/referral-stats.html`), 'utf8');

    const subjectivityEBBase64 = encodeToBase64(
        path.join(
            __dirname,
            '../../resources/image-generation/fonts/Subjectivity.Extrabold.woff2'
        ),
        'font/woff2'
    );
    const subjectivityMBase64 = encodeToBase64(
        path.join(__dirname, '../../resources/image-generation/fonts/Subjectivity-Medium.woff2'),
        'font/woff2'
    );
    const subjectivitySBase64 = encodeToBase64(
        path.join(__dirname, '../../resources/image-generation/fonts/Subjectivity-Super.woff2'),
        'font/woff2'
    );

    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );

    const referredBase64 = encodeToBase64(path.join(__dirname, 'templates/images/referred.png'), 'image/png');

    template = template
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Super.woff2)',
            `url(${subjectivitySBase64})`
        )
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Medium.woff2)',
            `url(${subjectivityMBase64})`
        )
        .replace(
            'url(../../../../resources/image-generation/fonts/Subjectivity-Extrabold.woff2)',
            `url(${subjectivityEBBase64})`
        )
        .replace('url(./images/pattern-bg.png)', `url(${patternBgBase64})`)
        .replace('./images/referred.png', `${referredBase64}`)
        .replaceAll('{displayName}', params.displayName)
        .replaceAll('{totalReferred}', params.totalReferred)


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

}