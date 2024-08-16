import { TEN, TWO } from '@/constants/numbers';
import { parseNumber } from 'libphonenumber-js';
import metadata from 'libphonenumber-js/metadata.min.json';

export const formatNumberAsCurrency = (number: number, currency: string): string => {
    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    });

    return formatter.format(defaultAmountFixer(number));
};

export const prettifyNumber = (number: number, maximumFractionDigits = TWO): string => {
    const formatter = new Intl.NumberFormat('en-US', {
        maximumFractionDigits,
    });

    return formatter.format(number);
};

export const fixNumber = (number: number, decimalPlaces: number): number => {
    return Number(number.toFixed(decimalPlaces));
};

export const defaultAmountFixer = (number: number): number => fixNumber(number, TWO);

// Convert a decimal number to a string, ensuring that the radix is 10
export const decimalToString = (number: number): string => {
    return number.toString(TEN);
};

export const getCountryFlagEmoji = (countryCode: string): string => {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map((char) => char.charCodeAt(0) + 127397);

    return String.fromCodePoint(...codePoints);
};

export const getUserCountryCodeFromPhoneNumber = (phoneNumber: string) => {
    const phoneNumberObj = parseNumber(`+${phoneNumber}`);

    if ('country' in phoneNumberObj) {
        return phoneNumberObj.country;
    }

    throw new Error('Invalid phone number');
};
