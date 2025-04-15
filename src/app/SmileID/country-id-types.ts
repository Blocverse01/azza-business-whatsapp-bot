import { CountryCode } from 'libphonenumber-js/types';

type SmileIdType = {
    country: CountryCode;
    id_type: string;
    verification_method: 'enhanced_kyc' | 'basic_kyc' | 'doc_verification' | 'biometric_kyc';
};

const COUNTRY_ID_LIST: Array<SmileIdType> = [
    {
        country: 'KE',
        id_type: 'NATIONAL_ID',
        verification_method: 'biometric_kyc',
    },
    {
        country: 'KE',
        id_type: 'PASSPORT',
        verification_method: 'biometric_kyc',
    },
    {
        country: 'NG',
        id_type: 'NIN_V2',
        verification_method: 'biometric_kyc',
    },
    // {
    //     country: 'NG',
    //     id_type: 'PASSPORT',
    //     verification_method: 'doc_verification',
    // },
];

export const getIdList = (countryCode?: CountryCode) => {
    if (countryCode) {
        return COUNTRY_ID_LIST.filter((id) => id.country === countryCode);
    }

    return COUNTRY_ID_LIST;
};
