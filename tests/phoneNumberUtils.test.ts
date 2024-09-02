import {
    getPhoneNumberObject,
    cleanPhoneNumberInput,
    validatePhoneNumber,
} from '../src/Resources/utils/phone-numbers';

describe('Phone number utils', () => {
    it('Should standardise phone number', () => {
        const phoneNumber = '08143100808';
        const standardizedPhoneNumber = '8143100808';

        const phoneNumberWithPlusAndCountryCode = `+234${phoneNumber}`;
        const phoneNumberWithCountryCode = `234${phoneNumber}`;
        const expectedStandardizedPhoneNumber = '23408143100808';

        expect(cleanPhoneNumberInput(phoneNumber)).toBe(standardizedPhoneNumber);
        expect(cleanPhoneNumberInput(phoneNumberWithPlusAndCountryCode)).toBe(
            expectedStandardizedPhoneNumber
        );
        expect(cleanPhoneNumberInput(phoneNumberWithCountryCode)).toBe(
            expectedStandardizedPhoneNumber
        );
    });
    it('Should get phone number object', () => {
        const phoneNumber = '2348143100808';

        const phoneIsValid = validatePhoneNumber(phoneNumber);
        console.log(getPhoneNumberObject(phoneNumber));
        const phoneNumberObject = getPhoneNumberObject(phoneNumber);

        expect(phoneIsValid).toBeTruthy();
        expect(phoneNumberObject).toBeDefined();
    });
});
