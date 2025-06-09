import { z } from "zod";

export const emailSchema = z.string().email('Invalid email address');
export const bvnSchema = z.string().length(11, 'BVN must be 11 digits');

export const bvnKycVerificationSchema = z.object({
    bvn: bvnSchema,
    email: emailSchema,
});


export const accountStatementDateRangeSchema = z.object({
    start_date: z.string().min(1, { message: "Start date is required" }),
    end_date: z.string().min(1, { message: "End date is required" })
});


export const extractIdFromString = (data: { input: string, key: 'networkId' | 'seerbitId' | 'nameEnquiryReference' }): string => {

    const { input, key } = data;

    const defaultValue = ''

    const regex = new RegExp(`${key}:([^:]+)`);

    const match = input.match(regex);

    return match && match[1] ? match[1] : defaultValue;
}