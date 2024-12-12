import { PHONE_NUMBER_IDS } from '@/config/whatsAppPhoneNumbers';
import { FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';

export type PhoneNumberId = (typeof PHONE_NUMBER_IDS)[keyof typeof PHONE_NUMBER_IDS];

type Flows =
    | 'ONRAMP'
    | 'OFFRAMP'
    | 'TRANSFER'
    | 'ADD_BENEFICIARY'
    | 'TRANSACTION_CONFIRMATION'
    | 'SET_TRANSACTION_PIN'
    | 'CHANGE_TRANSACTION_PIN'
    | 'RESET_TRANSACTION_PIN';

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
            flowId: '1264192347996610',
            flowMode: 'published',
        },
    },
    TRANSFER: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '464881709776668',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1282536476102435',
            flowMode: 'published',
        },
    },
    ADD_BENEFICIARY: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '597553076140311',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '890929746531950',
            flowMode: 'published',
        },
    },
    TRANSACTION_CONFIRMATION: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '921577032733495',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '570618359103734',
            flowMode: 'published',
        },
    },
    SET_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '952767080217721',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1085794556420284',
            flowMode: 'published',
        },
    },
    CHANGE_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '520973614271230',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '588962750198700',
            flowMode: 'published',
        },
    },
    RESET_TRANSACTION_PIN: {
        [PHONE_NUMBER_IDS.TEST_PHONE_NUMBER_ID]: {
            flowId: '492902789785189',
            flowMode: 'draft',
        },
        [PHONE_NUMBER_IDS.AZZA_BY_BLOCVERSE_PHONE_NUMBER_ID]: {
            flowId: '1224675291952815',
            flowMode: 'published',
        },
    },
};

export const getFlowConfig = (flow: Flows, phoneNumberId: PhoneNumberId) => {
    return flowConfigs[flow][phoneNumberId];
};
