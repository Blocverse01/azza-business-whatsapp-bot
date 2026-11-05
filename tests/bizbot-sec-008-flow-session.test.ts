import {
    FLOW_STEPS,
    assertClaimedUserMatchesSession,
    assertResetPinNewPinAllowed,
    bindFlowRequest,
    consumeFlowSession,
    createMemoryFlowSessionStore,
    issueFlowToken,
    requireActiveFlowSession,
    setFlowSessionStore,
} from '@/app/WhatsAppBot/WhatsAppFlows/flowSession';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';

describe('BIZBOT-SEC-008 flow session binding', () => {
    const userId = 'user-victim';
    const presentedUserId = convertAsciiStringToBase64(userId);

    beforeEach(() => {
        setFlowSessionStore(createMemoryFlowSessionStore());
    });

    afterEach(() => {
        setFlowSessionStore(undefined);
    });

    it('fails NEW_PIN without a questions_passed session', async () => {
        const flowToken = await issueFlowToken({
            userId,
            presentedUserId,
            flow: 'RESET_TRANSACTION_PIN',
            step: FLOW_STEPS.ANSWER_SECURITY_QUESTIONS,
        });
        const session = await requireActiveFlowSession(flowToken, 'RESET_TRANSACTION_PIN');

        expect(() => assertResetPinNewPinAllowed(session)).toThrow(
            /Security questions have not been verified/
        );

        await expect(
            bindFlowRequest(
                {
                    flow_token: flowToken,
                    data: {
                        user_id: presentedUserId,
                        new_pin: '1234',
                        confirm_new_pin: '1234',
                    },
                },
                'RESET_TRANSACTION_PIN',
                { requiredStep: FLOW_STEPS.QUESTIONS_PASSED }
            )
        ).rejects.toThrow(/Security questions have not been verified/);
    });

    it('rejects a mismatched user_id vs session', async () => {
        const flowToken = await issueFlowToken({
            userId,
            presentedUserId,
            flow: 'RESET_TRANSACTION_PIN',
            step: FLOW_STEPS.QUESTIONS_PASSED,
        });
        const session = await requireActiveFlowSession(flowToken, 'RESET_TRANSACTION_PIN');
        const attackerId = convertAsciiStringToBase64('user-attacker');

        expect(() => assertClaimedUserMatchesSession(attackerId, session)).toThrow(
            /user_id does not match flow session/
        );

        await expect(
            bindFlowRequest(
                {
                    flow_token: flowToken,
                    data: { user_id: attackerId },
                },
                'RESET_TRANSACTION_PIN'
            )
        ).rejects.toThrow(/user_id does not match flow session/);
    });

    it('rejects a replayed flow_token', async () => {
        const flowToken = await issueFlowToken({
            userId,
            presentedUserId,
            flow: 'RESET_TRANSACTION_PIN',
            step: FLOW_STEPS.QUESTIONS_PASSED,
        });

        await consumeFlowSession(flowToken);

        await expect(requireActiveFlowSession(flowToken, 'RESET_TRANSACTION_PIN')).rejects.toThrow(
            /already used/
        );
        await expect(
            bindFlowRequest(
                {
                    flow_token: flowToken,
                    data: { user_id: presentedUserId },
                },
                'RESET_TRANSACTION_PIN'
            )
        ).rejects.toThrow(/already used/);
    });
});
