import { getUserCountryCodeFromPhoneNumberOrThrow } from '../src/Resources/utils/currency';

describe('Currency Utils', () => {
    it('can get user country code from phone number', () => {
        const phoneNumber = '2348143100808';

        const countryCode = getUserCountryCodeFromPhoneNumberOrThrow(phoneNumber);

        expect(countryCode).toBe('NG');
    });
});
