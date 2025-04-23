import { encodeToBase64 } from '@/resources/utils/encoding';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { readFile } from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

type RankCardGeneratorParams = {
    stats: {
        totalVolume: string;
        highestTrade: string;
        numberOfTransactions: string;
        frequentChain: AllSupportedBlockchains;
    };
    rank: 'odogwu' | 'azzaman' | 'jagaban' | 'hustler';
    displayName: string;
};

const TEMPLATE_PATHS: Record<
    RankCardGeneratorParams['rank'],
    {
        html: string;
        customEllipse: string;
    }
> = {
    odogwu: {
        html: 'odogwu-rank.html',
        customEllipse: 'ellipse-4-op.png',
    },
    hustler: {
        html: 'hustler-rank.html',
        customEllipse: 'ellipse-3-op.png',
    },
    azzaman: {
        html: 'azzaman-rank.html',
        customEllipse: 'ellipse-16-op.png',
    },
    jagaban: {
        html: 'jagaban-rank.html',
        customEllipse: 'ellipse-12-op.png',
    },
};

enum TemplatePlaceHolder {
    FREQUENT_CHAIN = '{frequentChain}',
    HIGHEST_TRADE = '{highestTrade}',
    NUM_OF_TRADES = '{numberOfTrades}',
    BLOCKCHAIN_LOGO = '{blockchainLogo}',
    DISPLAY_NAME = '{displayName}',
    TRADING_VOLUME = '{tradingVolume}',
}

export const generateTradingRankCard = async (params: RankCardGeneratorParams) => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Increase resolution
    await page.setViewport({
        width: 1080,
        height: 1080,
        deviceScaleFactor: 4, // Higher resolution
    });

    const templateConfig = TEMPLATE_PATHS[params.rank];
    let template = await readFile(path.join(__dirname, `templates/${templateConfig.html}`), 'utf8');

    const subjectivityEBBase64 = encodeToBase64(
        path.join(
            __dirname,
            '../../../resources/image-generation/fonts/Subjectivity.Extrabold.woff2'
        ),
        'font/woff2'
    );
    const subjectivityMBase64 = encodeToBase64(
        path.join(__dirname, '../../../resources/image-generation/fonts/Subjectivity-Medium.woff2'),
        'font/woff2'
    );
    const subjectivitySBase64 = encodeToBase64(
        path.join(__dirname, '../../../resources/image-generation/fonts/Subjectivity-Super.woff2'),
        'font/woff2'
    );
    const patternBgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/pattern-bg.png'),
        'image/png'
    );
    const ellipseBase64 = encodeToBase64(
        path.join(__dirname, `templates/images/${templateConfig.customEllipse}`),
        'image/png'
    );
    const frequentChainSvg = await getBlockchainLogoSvg(params.stats.frequentChain);

    template = template
        .replaceAll(TemplatePlaceHolder.HIGHEST_TRADE, params.stats.highestTrade)
        .replaceAll(TemplatePlaceHolder.NUM_OF_TRADES, params.stats.numberOfTransactions)
        .replaceAll(TemplatePlaceHolder.FREQUENT_CHAIN, params.stats.frequentChain)
        .replaceAll(TemplatePlaceHolder.TRADING_VOLUME, params.stats.totalVolume)
        .replaceAll(TemplatePlaceHolder.BLOCKCHAIN_LOGO, frequentChainSvg)
        .replaceAll(TemplatePlaceHolder.DISPLAY_NAME, params.displayName)
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
        .replace(`url(./images/${templateConfig.customEllipse})`, `url(${ellipseBase64})`);

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

const getBlockchainLogoSvg = async (blockchain: string) => {
    const filePath = path.join(
        __dirname,
        `../../../resources/image-generation/blockchain-logos`,
        `${blockchain.toLowerCase()}.svg`
    );

    return await readFile(filePath, 'utf8');
};
