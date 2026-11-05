import { HttpException } from '@/resources/exceptions/HttpException';
import { convertBase64ToAsciiString, generateRandomHexString } from '@/resources/utils/encryption';
import { safeCompare } from '@/resources/utils/safeCompare';
import { SIXTEEN } from '@/constants/numbers';

export type FlowName =
    | 'ONRAMP'
    | 'OFFRAMP'
    | 'TRANSFER'
    | 'ADD_BENEFICIARY'
    | 'TRANSACTION_CONFIRMATION'
    | 'SET_TRANSACTION_PIN'
    | 'CHANGE_TRANSACTION_PIN'
    | 'RESET_TRANSACTION_PIN'
    | 'BVN_KYC_VERIFICATION'
    | 'ACCOUNT_STATEMENT'
    | 'NGN_AIRTIME'
    | 'NGN_DATA_BUNDLE'
    | 'AGENT_OFFRAMP'
    | 'KYC_RESOLUTION';

export const FLOW_STEPS = {
    INIT: 'init',
    ANSWER_SECURITY_QUESTIONS: 'ANSWER_SECURITY_QUESTIONS',
    QUESTIONS_PASSED: 'questions_passed',
    COMPLETED: 'completed',
} as const;

export type FlowSession = {
    userId: string;
    presentedUserId: string;
    flow: FlowName;
    step: string;
    exp: number;
    consumed?: boolean;
};

export type FlowSessionStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
    incr(key: string): Promise<number>;
    expire(key: string, ttlSeconds: number): Promise<unknown>;
};

export class FlowSessionError extends HttpException {
    constructor(message: string, status = 403) {
        super(status, message);
        this.name = 'FlowSessionError';
    }
}

export const FLOW_SESSION_TTL_SECONDS = 30 * 60;
export const FLOW_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const FLOW_MAX_PIN_ATTEMPTS = 5;
export const FLOW_MAX_SECURITY_QUESTION_ATTEMPTS = 5;

const SESSION_KEY_PREFIX = 'flow_session:';
const PIN_RL_PREFIX = 'flow_rl:pin:';
const SQ_RL_PREFIX = 'flow_rl:security_question:';

let storeOverride: FlowSessionStore | undefined;

export function flowSessionKey(flowToken: string): string {
    return `${SESSION_KEY_PREFIX}${flowToken}`;
}

export function setFlowSessionStore(store: FlowSessionStore | undefined): void {
    storeOverride = store;
}

export function createMemoryFlowSessionStore(): FlowSessionStore {
    const values = new Map<string, { value: string; expiresAt?: number }>();

    const read = (key: string): string | null => {
        const entry = values.get(key);
        if (!entry) {
            return null;
        }
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            values.delete(key);
            return null;
        }
        return entry.value;
    };

    return {
        async get(key) {
            return read(key);
        },
        async set(key, value, _expiryMode, ttlSeconds) {
            values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        },
        async del(key) {
            values.delete(key);
        },
        async incr(key) {
            const current = Number(read(key) ?? '0');
            const next = current + 1;
            const existing = values.get(key);
            values.set(key, {
                value: String(next),
                expiresAt: existing?.expiresAt,
            });
            return next;
        },
        async expire(key, ttlSeconds) {
            const entry = values.get(key);
            if (entry) {
                entry.expiresAt = Date.now() + ttlSeconds * 1000;
            }
        },
    };
}

async function getStore(): Promise<FlowSessionStore> {
    if (storeOverride) {
        return storeOverride;
    }

    const { default: redis } = await import('@/cache/redis');
    return redis;
}

export async function createFlowSession(params: {
    userId: string;
    presentedUserId: string;
    flow: FlowName;
    step?: string;
    flowToken?: string;
    ttlSeconds?: number;
}): Promise<string> {
    const flowToken = params.flowToken ?? generateRandomHexString(SIXTEEN);
    const ttlSeconds = params.ttlSeconds ?? FLOW_SESSION_TTL_SECONDS;
    const session: FlowSession = {
        userId: params.userId,
        presentedUserId: params.presentedUserId,
        flow: params.flow,
        step: params.step ?? FLOW_STEPS.INIT,
        exp: Date.now() + ttlSeconds * 1000,
        consumed: false,
    };

    const store = await getStore();
    await store.set(flowSessionKey(flowToken), JSON.stringify(session), 'EX', ttlSeconds);
    return flowToken;
}

export async function issueFlowToken(params: {
    userId: string;
    presentedUserId: string;
    flow: FlowName;
    step?: string;
    token?: string;
}): Promise<string> {
    return createFlowSession({
        userId: params.userId,
        presentedUserId: params.presentedUserId,
        flow: params.flow,
        step: params.step,
        flowToken: params.token,
    });
}

export async function getFlowSession(flowToken: string): Promise<FlowSession | null> {
    const store = await getStore();
    const raw = await store.get(flowSessionKey(flowToken));
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as FlowSession;
    } catch {
        return null;
    }
}

export async function persistFlowSession(
    flowToken: string,
    session: FlowSession,
    ttlSeconds = FLOW_SESSION_TTL_SECONDS
): Promise<void> {
    const store = await getStore();
    const remainingMs = session.exp - Date.now();
    const ttl = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : ttlSeconds;
    await store.set(flowSessionKey(flowToken), JSON.stringify(session), 'EX', ttl);
}

export async function updateFlowSessionStep(flowToken: string, step: string): Promise<FlowSession> {
    const session = await requireActiveFlowSession(flowToken);
    session.step = step;
    await persistFlowSession(flowToken, session);
    return session;
}

export async function consumeFlowSession(flowToken: string): Promise<void> {
    const session = await getFlowSession(flowToken);
    if (!session) {
        return;
    }
    session.consumed = true;
    session.step = FLOW_STEPS.COMPLETED;
    await persistFlowSession(flowToken, session);
}

function decodePossibleUserId(value: string): string {
    try {
        const decoded = convertBase64ToAsciiString(value);
        return decoded || value;
    } catch {
        return value;
    }
}

export function claimedUserMatchesSession(claimedUserId: string, session: FlowSession): boolean {
    if (safeCompare(claimedUserId, session.userId) || safeCompare(claimedUserId, session.presentedUserId)) {
        return true;
    }

    const decodedClaimed = decodePossibleUserId(claimedUserId);
    return (
        safeCompare(decodedClaimed, session.userId) ||
        safeCompare(decodedClaimed, session.presentedUserId)
    );
}

export function assertClaimedUserMatchesSession(
    claimedUserId: string | undefined,
    session: FlowSession
): void {
    if (claimedUserId === undefined) {
        return;
    }

    if (!claimedUserMatchesSession(claimedUserId, session)) {
        throw new FlowSessionError('user_id does not match flow session');
    }
}

export function assertResetPinNewPinAllowed(session: FlowSession): void {
    if (session.step !== FLOW_STEPS.QUESTIONS_PASSED) {
        throw new FlowSessionError('Security questions have not been verified');
    }
}

export async function requireActiveFlowSession(
    flowToken: string,
    expectedFlow?: FlowName
): Promise<FlowSession> {
    const session = await getFlowSession(flowToken);

    if (!session) {
        throw new FlowSessionError('Invalid or expired flow token');
    }

    if (session.consumed) {
        throw new FlowSessionError('Flow token already used');
    }

    if (Date.now() > session.exp) {
        throw new FlowSessionError('Flow session expired');
    }

    if (expectedFlow && session.flow !== expectedFlow) {
        throw new FlowSessionError('Invalid flow token');
    }

    return session;
}

function overwriteBoundUserIds(
    data: Record<string, unknown> | undefined,
    session: FlowSession
): void {
    if (!data) {
        return;
    }

    if ('user_id' in data) {
        data.user_id = session.presentedUserId;
    }

    const details = data.transaction_details;
    if (details && typeof details === 'object' && details !== null && 'userId' in details) {
        (details as { userId: string }).userId = session.presentedUserId;
    }
}

export async function bindFlowRequest(
    requestBody: {
        flow_token: string;
        data?: Record<string, unknown>;
    },
    expectedFlow: FlowName,
    options?: { requiredStep?: string }
): Promise<FlowSession> {
    const session = await requireActiveFlowSession(requestBody.flow_token, expectedFlow);
    const data = requestBody.data;
    const claimedIds: string[] = [];

    if (typeof data?.user_id === 'string') {
        claimedIds.push(data.user_id);
    }

    const details = data?.transaction_details;
    if (details && typeof details === 'object' && details !== null) {
        const userId = (details as { userId?: unknown }).userId;
        if (typeof userId === 'string') {
            claimedIds.push(userId);
        }
    }

    for (const claimed of claimedIds) {
        assertClaimedUserMatchesSession(claimed, session);
    }

    if (options?.requiredStep && session.step !== options.requiredStep) {
        if (options.requiredStep === FLOW_STEPS.QUESTIONS_PASSED) {
            assertResetPinNewPinAllowed(session);
        } else {
            throw new FlowSessionError('Flow step is not allowed');
        }
    }

    overwriteBoundUserIds(data, session);
    return session;
}

async function consumeRateLimit(
    prefix: string,
    userId: string,
    maxAttempts: number
): Promise<void> {
    const store = await getStore();
    const key = `${prefix}${userId}`;
    const attempts = await store.incr(key);

    if (attempts === 1) {
        await store.expire(key, FLOW_RATE_LIMIT_WINDOW_SECONDS);
    }

    if (attempts > maxAttempts) {
        throw new FlowSessionError('Too many attempts', 429);
    }
}

export async function assertPinAttemptAllowed(userId: string): Promise<void> {
    await consumeRateLimit(PIN_RL_PREFIX, userId, FLOW_MAX_PIN_ATTEMPTS);
}

export async function assertSecurityQuestionAttemptAllowed(userId: string): Promise<void> {
    await consumeRateLimit(SQ_RL_PREFIX, userId, FLOW_MAX_SECURITY_QUESTION_ATTEMPTS);
}
