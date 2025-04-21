const referralCodeRegex = /Ref:\s*#([a-z0-9]+)/i;

export const extractReferralCodeFromMessage = (message: string): string | null => {
  const match = referralCodeRegex.exec(message);
  return match ? match[1] : null;
};