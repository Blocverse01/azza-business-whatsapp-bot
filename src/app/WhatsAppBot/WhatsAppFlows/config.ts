import { FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { PHONE_NUMBER_IDS } from '@/config/whatsAppPhoneNumbers';

export type PhoneNumberId = (typeof PHONE_NUMBER_IDS)[keyof typeof PHONE_NUMBER_IDS];

type Flows =
    | 'ONRAMP'
    | 'OFFRAMP'
    | 'TRANSFER'
    | 'ADD_BENEFICIARY'
    | 'TRANSACTION_CONFIRMATION'
    | 'SET_TRANSACTION_PIN'
    | 'CHANGE_TRANSACTION_PIN'
    | 'RESET_TRANSACTION_PIN'
    | 'BVN_KYC_VERIFICATION'
    | 'ACCOUNT_STATEMENT';

export type FlowConfig = {
    flowId: string;
    flowMode: FlowMode;
};

type FlowConfigs = {
    [key in Flows]: {
        [key in PhoneNumberId]: FlowConfig; // WA_PHONE_NUMBER_ID -> Flow ID, Flow Mode
    };
};

const flowConfigs: FlowConfigs = {
    ONRAMP: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '1357797448894975',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '8811472538928692',
            flowMode: 'published',
        },
    },
    OFFRAMP: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '2073254229862862',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1264192347996610',
            flowMode: 'published',
        },
    },
    TRANSFER: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '464881709776668',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1282536476102435',
            flowMode: 'published',
        },
    },
    ADD_BENEFICIARY: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '597553076140311',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '890929746531950',
            flowMode: 'published',
        },
    },
    TRANSACTION_CONFIRMATION: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '921577032733495',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '570618359103734',
            flowMode: 'published',
        },
    },
    SET_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '952767080217721',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1085794556420284',
            flowMode: 'published',
        },
    },
    CHANGE_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '520973614271230',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '588962750198700',
            flowMode: 'published',
        },
    },
    RESET_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '492902789785189',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1224675291952815',
            flowMode: 'published',
        },
    },
    BVN_KYC_VERIFICATION: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '963781129073791',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '2005170979976527',
            flowMode: 'published',
        },
    },
    ACCOUNT_STATEMENT: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '1459758905009704',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1459758905009704',
            flowMode: 'published',
        },
    },
};

export const getFlowConfig = (flow: Flows, phoneNumberId: PhoneNumberId) => {
    return flowConfigs[flow][phoneNumberId];
};
