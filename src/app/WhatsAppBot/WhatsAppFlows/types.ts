import { WhatsAppInteractiveMessage } from '@/app/WhatsAppBot/WhatsAppBotType';

export type FlowMode = Required<
    WhatsAppInteractiveMessage['interactive']['action']
>['parameters']['mode'];

export type DropdownOption = {
    title: string;
    id: string;
    description?: string;
};

export type FeedbackScreenPayload = {
    feedback_title: string;
    feedback_message: string;
    feedback_sub_message: string;
    footer_cta_text: string;
    icon_src: string; // base64 encoded image
};
