import { removeExcessSpaces, arrangeNameAlphabetically } from '@/resources/utils/transformers';

type UserBioData = {
    name: string;
    dateOfBirth: string;
};

export type KycInfoToReview = {
    bvn: UserBioData;
    nin: UserBioData;
};

type KycDecision = 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'AUTO_REJECT';
type ReviewableResult = {
    recordsMatch: false;
    diffRatio: number;
    decision: KycDecision;
    needResolution: Record<keyof UserBioData, boolean>;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};

export type KycReviewResult =
    | {
          recordsMatch: true;
          decision: 'AUTO_APPROVE';
      }
    | ReviewableResult;

// Conservative thresholds - recommended for financial services
const CONSERVATIVE_THRESHOLDS = {
    AUTO_APPROVE: 0.0, // Exact match only
    MANUAL_REVIEW: 0.1, // Any difference > 10% needs review
    AUTO_REJECT: 0.5, // Auto-reject if > 50% different
} as const;

// Configuration
const KYC_CONFIG = {
    // Use conservative by default for KYC
    thresholds: CONSERVATIVE_THRESHOLDS,

    // Weight factors for different mismatches
    weights: {
        NAME_ONLY_MISMATCH: 0.6, // Name mismatch alone
        DOB_ONLY_MISMATCH: 0.8, // DOB mismatch is more serious
        BOTH_MISMATCH: 1.0, // Both fields mismatch
    },
} as const;

/**
 * Determines KYC decision based on diff ratio and risk factors
 */
const determineKycDecision = (
    diffRatio: number,
    needResolution: Record<keyof UserBioData, boolean>
): { decision: KycDecision; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' } => {
    // Apply additional risk weighting based on what fields don't match
    let adjustedDiffRatio = diffRatio;

    const nameNeedsResolution = needResolution.name;
    const dobNeedsResolution = needResolution.dateOfBirth;

    if (nameNeedsResolution && dobNeedsResolution) {
        // Both fields mismatch - highest risk
        adjustedDiffRatio *= KYC_CONFIG.weights.BOTH_MISMATCH;
    } else if (dobNeedsResolution) {
        // DOB mismatch only - higher risk than name mismatch
        adjustedDiffRatio *= KYC_CONFIG.weights.DOB_ONLY_MISMATCH;
    } else if (nameNeedsResolution) {
        // Name mismatch only - moderate risk
        adjustedDiffRatio *= KYC_CONFIG.weights.NAME_ONLY_MISMATCH;
    }

    // Determine decision based on adjusted ratio
    if (adjustedDiffRatio <= KYC_CONFIG.thresholds.MANUAL_REVIEW) {
        return { decision: 'MANUAL_REVIEW', riskLevel: 'LOW' };
    } else if (adjustedDiffRatio <= KYC_CONFIG.thresholds.AUTO_REJECT) {
        return { decision: 'MANUAL_REVIEW', riskLevel: dobNeedsResolution ? 'HIGH' : 'MEDIUM' };
    } else {
        return { decision: 'AUTO_REJECT', riskLevel: 'HIGH' };
    }
};

/**
 * Enhanced KYC comparison with decision engine
 */
export const compareUserKycInfoWithDecision = (info: KycInfoToReview): KycReviewResult => {
    const { bvn, nin } = info;

    const [cleanedBvnName, cleanedNinName] = [
        removeExcessSpaces(bvn.name),
        removeExcessSpaces(nin.name),
    ];

    const namesMatch = compareStringsCaseInsentitive(cleanedBvnName, cleanedNinName);
    const dateOfBirthsMatch = compareStringsCaseInsentitive(
        bvn.dateOfBirth.trim(),
        nin.dateOfBirth.trim()
    );

    if (namesMatch && dateOfBirthsMatch) {
        return {
            recordsMatch: true,
            decision: 'AUTO_APPROVE',
        };
    }

    // Calculate similarities
    const nameSimilarity = calculateNameSimilarity(cleanedBvnName, cleanedNinName);
    const dateSimilarity = dateOfBirthsMatch ? 1.0 : 0.0;

    // Overall similarity (weighted: names 80%, dates 20%)
    const overallSimilarity = nameSimilarity * 0.8 + dateSimilarity * 0.2;
    const diffRatio = 1 - overallSimilarity;

    const needResolution = {
        name: !namesMatch,
        dateOfBirth: !dateOfBirthsMatch,
    };

    const { decision, riskLevel } = determineKycDecision(diffRatio, needResolution);

    return {
        recordsMatch: false,
        diffRatio,
        decision,
        riskLevel,
        needResolution,
    };
};

/**
 * Calculate similarity between two alphabetically arranged names
 */
const calculateNameSimilarity = (name1: string, name2: string): number => {
    const cleanName1 = arrangeNameAlphabetically(removeExcessSpaces(name1));
    const cleanName2 = arrangeNameAlphabetically(removeExcessSpaces(name2));

    if (compareStringsCaseInsentitive(cleanName1, cleanName2)) {
        return 1.0;
    }

    const words1 = cleanName1
        .toLowerCase()
        .split(' ')
        .filter((w) => w.length > 0);
    const words2 = cleanName2
        .toLowerCase()
        .split(' ')
        .filter((w) => w.length > 0);

    if (words1.length === 0 || words2.length === 0) {
        return 0;
    }

    const wordSimilarity = calculateWordSetSimilarity(words1, words2);
    const charSimilarity = calculateLevenshteinSimilarity(cleanName1, cleanName2);

    return wordSimilarity * 0.7 + charSimilarity * 0.3;
};

const calculateWordSetSimilarity = (words1: string[], words2: string[]): number => {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter((word) => set2.has(word)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
};

const calculateLevenshteinSimilarity = (str1: string, str2: string): number => {
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1.0 : 1 - distance / maxLength;
};

const levenshteinDistance = (str1: string, str2: string): number => {
    const matrix = Array(str2.length + 1)
        .fill(null)
        .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + indicator
            );
        }
    }

    return matrix[str2.length][str1.length];
};

const compareStringsCaseInsentitive = (string1: string, string2: string): boolean => {
    return string1.toLowerCase() === string2.toLowerCase();
};

type MessageType = 'user' | 'admin';

interface KycMessage {
    type: MessageType;
    title: string;
    message: string;
    metadata?: {
        userPhoneNumber?: string;
        timestamp: string;
        diffRatio: number;
        mismatchedFields: string[];
    };
}

/**
 * Generate user-facing message for AUTO_REJECT decision
 */
const generateUserMessage = (result: ReviewableResult, userPhoneNumber: string): KycMessage => {
    const mismatchedFields = Object.entries(result.needResolution)
        .filter(([_, needsResolution]) => needsResolution)
        .map(([field, _]) => field);

    const isNameMismatch = mismatchedFields.includes('name');
    const isDobMismatch = mismatchedFields.includes('dateOfBirth');

    let issueDescription = '';

    if (isNameMismatch && isDobMismatch) {
        issueDescription = "your name and date of birth don't match between your BVN and NIN";
    } else if (isNameMismatch) {
        issueDescription = 'your name is different on your BVN and NIN';
    } else if (isDobMismatch) {
        issueDescription = 'your date of birth is different on your BVN and NIN';
    } else {
        issueDescription = "your BVN and NIN information don't match";
    }

    const message = `Verification needed! 🔍\n\nWe noticed ${issueDescription}. Don't worry - this is usually easy to fix!\n\nOur support team can help you sort this out quickly. Just type **/support** and we'll get you verified! ✅`;

    return {
        type: 'user',
        title: 'Quick Fix Needed',
        message,
        metadata: {
            userPhoneNumber,
            timestamp: new Date().toISOString(),
            diffRatio: result.diffRatio,
            mismatchedFields,
        },
    };
};

const generateAdminMessage = (
    result: ReviewableResult,
    userInfo: KycInfoToReview,
    userPhoneNumber: string
): KycMessage => {
    const mismatchedFields = Object.entries(result.needResolution)
        .filter(([_, needsResolution]) => needsResolution)
        .map(([field, _]) => field);

    const diffPercentage = (result.diffRatio * 100).toFixed(1);

    const formatFieldComparison = (field: keyof UserBioData) => {
        return `${field.toUpperCase()}: "${userInfo.bvn[field]}" vs "${userInfo.nin[field]}"`;
    };

    const mismatches = mismatchedFields
        .map((field) => formatFieldComparison(field as keyof UserBioData))
        .join('\n');

    const riskIndicators = [];
    if (result.diffRatio > 0.8) riskIndicators.push('Very high difference ratio');
    if (mismatchedFields.includes('dateOfBirth')) riskIndicators.push('Date of birth mismatch');
    if (mismatchedFields.length > 1) riskIndicators.push('Multiple field mismatches');

    const message = `KYC AUTO-REJECT ALERT\n\nUser Phone Number: ${userPhoneNumber}\nDifference Ratio: ${diffPercentage}%\nRisk Level: ${result.riskLevel}\nMismatched Fields: ${mismatchedFields.join(', ')}\n\nCOMPARISON DETAILS:\n${mismatches}\n\nRISK INDICATORS:\n${riskIndicators.map((indicator) => `• ${indicator}`).join('\n')}\n\nNEXT STEPS:\n• User has been notified to use /support command\n• Manual review may be required if user contacts support\n• Consider flagging for potential data quality issues`;

    return {
        type: 'admin',
        title: `KYC Auto-Reject: User ${userPhoneNumber}`,
        message,
        metadata: {
            userPhoneNumber,
            timestamp: new Date().toISOString(),
            diffRatio: result.diffRatio,
            mismatchedFields,
        },
    };
};

/**
 * Generate both user and admin messages for AUTO_REJECT scenarios
 */
export const generateKycRejectMessages = (
    result: KycReviewResult,
    userInfo: KycInfoToReview,
    userId: string
): { userMessage: KycMessage; adminMessage: KycMessage } => {
    if (result.decision !== 'AUTO_REJECT') {
        throw new Error(
            'generateKycRejectMessages should only be called for AUTO_REJECT decisions'
        );
    }

    return {
        userMessage: generateUserMessage(result, userId),
        adminMessage: generateAdminMessage(result, userInfo, userId),
    };
};
