const referralCodeRegex = /Ref:\s*#([a-z0-9]+)/i;
const _referralCodeRegex = /(?:Ref:\s*)?#([a-z0-9]+)/i; 

export const extractReferralCodeFromMessage = (message: string): string | null => {
  const match = _referralCodeRegex.exec(message);
  return match ? match[1] : null;
};