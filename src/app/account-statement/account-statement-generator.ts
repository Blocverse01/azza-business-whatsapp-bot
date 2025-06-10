import { readFile } from 'fs/promises';
import path from "path";
import puppeteer from "puppeteer";
import { capitalizeWords, getAllUserTransactionsByDateRange } from './queue-utils';
import { UserV2Record } from '@/db/xata';
import { formatDate } from 'date-fns';
import { prettifyNumber } from '@/resources/utils/currency';
import { encodeToBase64 } from '@/resources/utils/encoding';

export const generateAccountStatementPdf = async (params: {
    startDate: string, endDate: string, user: UserV2Record
}) => {

    const { startDate, endDate, user } = params

    const data = await getAllUserTransactionsByDateRange({ startDate, endDate, user });

    if (data.transactions.length === 0) return;

    const { user: _user } = data;

    const year = formatDate(new Date(), 'yyyy');

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    let template = await readFile(path.join(__dirname, `templates/account-statement.html`), 'utf8');

    const userDetails = `<div
        class="w-[894px] mx-auto bg-[#F5F5F5] rounded-[15px] p-6 space-y-6"
      >
        <div class="flex justify-between items-start">
          <div>
            <p class="text-gray-500 text-sm">Account Statement for:</p>
            <p class="text-xl font-semibold text-gray-900">${_user.fullName}</p>
          </div>
          <div>
            <p class="text-gray-500 text-sm">Phone Number:</p>
            <p class="text-base text-gray-800 font-medium">+${_user.phoneNumber}</p>
          </div>
        </div>

        <hr class="border-dashed border-gray-300" />

        <div class="grid grid-cols-3 gap-4">
          <div>
            <p class="text-gray-500 text-sm">Statement Period:</p>
            <p class="text-base text-gray-800 font-medium">
             ${formatDate(startDate, 'LLL, dd y')} to ${formatDate(endDate, 'LLL, dd y')}
            </p>
          </div>
          <div>
            <p class="text-gray-500 text-sm">Transaction Vol:</p>
            <p class="text-base text-gray-800 font-medium">$ ${prettifyNumber(_user.totalVolumeUsd)}</p>
          </div>
          <div>
            <p class="text-gray-500 text-sm">Number of Trades:</p>
            <p class="text-base text-gray-800 font-medium">${prettifyNumber(_user.totalTrades)}</p>
          </div>
        </div>

        <hr class="border-dashed border-gray-300" />

        <div>
          <p class="text-gray-500 text-sm">Address:</p>
          <p class="text-base text-gray-800 font-medium">
            ${_user.address}
          </p>
        </div>
      </div>`

    const TxTablesRows = data.transactions.map(tx => `
        <tr class="rounded-lg">
          <td class="px-4 py-3 w-[150px]">
            <div>${tx.date}</div>
            <div class="text-xs text-gray-500 pt-[5px]">${tx.time}</div>
          </td>
          <td class="px-4 py-3">${tx.type}</td>
         <td class="px-4 py-3 w-[200px]">
            <div class="flex items-center gap-2 font-semibold ">
                <span>${prettifyNumber(parseFloat(tx.amount))} ${tx.token}</span>
                <span class="inline-block bg-[#D6D6FB80] border-[0.5px] font-medium text-[10px] border-[#BBBAF8]  px-2 py-0.5 rounded-full">${tx.chain}</span>
            </div>
         </td>
          <td class="px-4 py-3">
             ${tx.recipient.type === 'Wallet'
            ? `
                <div class="text-sm break-all w-[200px]">${tx.recipient.walletAddress}</div>
                `
            : `
                <div class="text-sm">${tx.recipient.accountNumber}</div>
                <div class="text-xs text-gray-500">${capitalizeWords(tx.recipient.bankName)} • ${capitalizeWords(tx.recipient.accountName)}</div>
                `
        }
          </td>
          <td class="px-4 py-3 text-sm text-gray-600">${tx.reference}</td>
        </tr>
      `).join('');

    const bgBase64 = encodeToBase64(
        path.join(__dirname, 'templates/images/bg.png'),
        'image/png'
    );

    template = template
        .replaceAll('{transactionsRows}', TxTablesRows)
        .replaceAll('{userDetails}', userDetails)
        .replaceAll('{year}', year)
        .replace('url(./images/bg.png)', `url(${bgBase64})`)

    // Set the content in Puppeteer
    await page.setContent(template, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div 
                style="
                font-size:10px;
                width:100%;
                padding: 28px 29px;
                display: flex;
                background-color: #FAFAFA;
                justify-content: space-between;
                align-items: center;
                 -webkit-print-color-adjust: exact;">

                <svg
                width="82"
                height="34"
                viewBox="0 0 72 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                >
                <path
                    d="M0 0H70.2538L71.2467 24L65.2396 22.9105H0V0Z"
                    fill="#3430E9"
                />
                <path
                    d="M53.9319 5.3553L52.7084 12.9037H55.1969L53.9319 5.3553ZM56.2545 18.7101L56.0056 17.0719H51.8997L51.6508 18.7101L45.3467 18.7309L48.5195 3.73779H59.3651L62.5586 18.7101H56.2545Z"
                    fill="white"
                />
                <path
                    d="M32.8711 10.2908L42.5761 8.38295H33.0785V3.73779H45.272V12.1779L35.878 14.0857H45.4794V18.7309H32.8711V10.2908Z"
                    fill="white"
                />
                <path
                    d="M19.4863 10.2908L29.1914 8.38295H19.6937V3.73779H31.8872V12.1779L22.4932 14.0857H32.0946V18.7309H19.4863V10.2908Z"
                    fill="white"
                />
                <path
                    d="M10.9759 5.3553L9.75237 12.9037H12.2408L10.9759 5.3553ZM13.2984 18.7101L13.0496 17.0719H8.94361L8.69476 18.7101L2.39062 18.7309L5.56343 3.73779H16.409L19.6026 18.7101H13.2984Z"
                    fill="white"
                />
                </svg>
                <span>Generated on ${formatDate(new Date(), 'LLL, dd y')}</span>
            </div>`,
        footerTemplate: `<div style="font-size:10px; color: #aaa; width:100%; text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
        margin: {
            top: '35mm',
            bottom: '15mm',
            left: '10mm',
            right: '10mm'
        },
    });

    await browser.close();

    return pdfBuffer;

}