import { z } from 'zod';

export const TemplateNameSchema = z.enum(['bvn_kyc_reminder']);
export const TemplateBaseSchema = z.object({
    name: TemplateNameSchema,
    language: z.object({ code: z.string() }),
    components: z.array(
        z
            .object({
                type: z.enum(['header', 'body', 'button']),
                parameters: z.array(z.record(z.unknown())),
            })
            .and(z.record(z.unknown()))
    ),
});

export const TemplateMessageBaseSchema = z.object({
    messaging_product: z.literal('whatsapp'),
    recipient_type: z.literal('individual'),
    to: z.string(),
    type: z.literal('template'),
    template: TemplateBaseSchema,
});

export type TemplateMessageBase = z.infer<typeof TemplateMessageBaseSchema>;
export type Template = z.infer<typeof TemplateBaseSchema>;
