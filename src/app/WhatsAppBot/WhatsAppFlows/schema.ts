import { z } from "zod";

export const emailSchema = z.string().email('Invalid email address');
export const bvnSchema = z.string().length(11, 'BVN must be 11 digits');

export const bvnKycVerificationSchema = z.object({
    bvn: bvnSchema,
    email: emailSchema,
});
