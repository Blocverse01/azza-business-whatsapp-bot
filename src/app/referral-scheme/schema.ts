import { z } from "zod";

export const RegisterReferralInputSchema = z.object({
    refereeId: z.string(),
    referralSchemeId: z.string(),
});

///////////////////
// Derived Types
//////////////////
export type RegisterReferralInput = z.infer<typeof RegisterReferralInputSchema>;