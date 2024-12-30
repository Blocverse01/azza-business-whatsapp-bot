import { CountryCode, isValidPhoneNumber } from 'libphonenumber-js';
import parsePhoneNumber, { getCountryCallingCode } from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.min.json';

const PLUS_SIGN = '+';

export const validatePhoneNumber = (
    phoneNumber: string,
    countryCode: CountryCode | undefined = undefined
) => {
    return isValidPhoneNumber(`${PLUS_SIGN}${cleanPhoneNumberInput(phoneNumber)}`, countryCode);
};

export const getPhoneNumberObject = (phoneNumber: string) => {
    return parsePhoneNumber(`${PLUS_SIGN}${cleanPhoneNumberInput(phoneNumber)}`, metadata);
};

export const getCountryCallingCodeDigits = (countryCode: CountryCode) =>
    getCountryCallingCode(countryCode, metadata);

export const cleanPhoneNumberInput = (phoneNumber: string) => {
    // Remove all non-numeric characters and leading zeroes
    return phoneNumber.replace(/\D/g, '').replace(/^0+/, '');
};

export const standardizePhoneNumber = (phoneNumber: string, countryCode: CountryCode) => {
    const cleanedPhoneNumber = cleanPhoneNumberInput(phoneNumber);
    const countryCallingCode = getCountryCallingCodeDigits(countryCode);

    if (isValidPhoneNumber(cleanedPhoneNumber, countryCode)) {
        if (cleanedPhoneNumber.startsWith(countryCallingCode)) {
            const partsAfterCountryCode = cleanedPhoneNumber.slice(countryCallingCode.length);

            if (partsAfterCountryCode.startsWith('0')) {
                return validatePhoneOutput(
                    `${PLUS_SIGN}${countryCallingCode}${partsAfterCountryCode.slice(1)}`,
                    countryCode
                );
            }

            return validatePhoneOutput(`${PLUS_SIGN}${cleanedPhoneNumber}`, countryCode);
        }
        if (cleanedPhoneNumber.startsWith('0')) {
            return validatePhoneOutput(
                `${PLUS_SIGN}${countryCallingCode}${cleanedPhoneNumber.slice(1)}`,
                countryCode
            );
        }
        return validatePhoneOutput(
            `${PLUS_SIGN}${countryCallingCode}${cleanedPhoneNumber}`,
            countryCode
        );
    }

    return validatePhoneOutput(phoneNumber, countryCode);
};

class PhoneNumberError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PhoneNumberError';
    }
}

function validatePhoneOutput(phoneNumber: string, countryCode: CountryCode) {
    if (!isValidPhoneNumber(phoneNumber, countryCode)) {
        throw new PhoneNumberError(
            `Invalid phone number: ${phoneNumber} for country code: ${countryCode}`
        );
    }

    return phoneNumber.replace(/\s/g, '');
}

type StandardizePhoneNumberOutput = [string, null] | [null, { message: string }];

export const standardizePhoneNumberOrReturnError = (
    phoneNumber: string,
    countryCode: CountryCode
): StandardizePhoneNumberOutput => {
    try {
        return [standardizePhoneNumber(phoneNumber, countryCode), null];
    } catch (error) {
        if (error instanceof PhoneNumberError) {
            return [null, { message: error.message }];
        }
        return [null, { message: 'An error occurred while standardizing phone number' }];
    }
};
