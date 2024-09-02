import { CountryCode, isValidPhoneNumber } from 'libphonenumber-js';
import parsePhoneNumber from 'libphonenumber-js/core';
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

export const cleanPhoneNumberInput = (phoneNumber: string) => {
    // Remove all non-numeric characters and leading zeroes
    return phoneNumber.replace(/\D/g, '').replace(/^0+/, '');
};
