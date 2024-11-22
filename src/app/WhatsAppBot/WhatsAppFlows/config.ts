import { PHONE_NUMBER_IDS } from '@/config/whatsAppPhoneNumbers';
import { FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';

export type PhoneNumberId = (typeof PHONE_NUMBER_IDS)[keyof typeof PHONE_NUMBER_IDS];

type Flows =
    | 'ONRAMP'
    | 'OFFRAMP'
    | 'TRANSFER'
    | 'ADD_BENEFICIARY'
    | 'TRANSACTION_CONFIRMATION'
    | 'SET_TRANSACTION_PIN';

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
            flowId: '457607423727887',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1207890117023139',
            flowMode: 'published',
        },
    },
    OFFRAMP: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '1011245846972252',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1558631018412295',
            flowMode: 'published',
        },
    },
    TRANSFER: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '464881709776668',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '879860527466643',
            flowMode: 'published',
        },
    },
    ADD_BENEFICIARY: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '482861261039877',
            flowMode: 'published',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '409232385504910',
            flowMode: 'published',
        },
    },
    TRANSACTION_CONFIRMATION: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '921577032733495',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '550125967814940',
            flowMode: 'published',
        },
    },
    SET_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '952767080217721',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '533365456277285',
            flowMode: 'published',
        },
    },
};

export const getFlowConfig = (flow: Flows, phoneNumberId: PhoneNumberId) => {
    return flowConfigs[flow][phoneNumberId];
};
