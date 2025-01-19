import {
    ChangeTransactionPinParams,
    changeTransactionPinParamsSchema,
    type SetTransactionPinParams,
    setTransactionPinParamsSchema,
} from '@/app/azza/azza.schema';
import userServiceV2 from '@/runtime/user';

export const setTransactionPin = async (params: SetTransactionPinParams) => {
    const validParams = setTransactionPinParamsSchema.parse(params);

    const user = await userServiceV2.getUserById(validParams.userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.transactionPinHash) {
        throw new Error('Transaction pin already set');
    }

    const updateRecord = await userServiceV2.storeUserTransactionPin(
        user,
        params.newPinHash,
        params.encryptedSecurityQuestions
    );

    if (!updateRecord) {
        throw new Error('Transaction pin not set');
    }

    return {
        pinSet: true,
    };
};

export const changeTransactionPin = async (params: ChangeTransactionPinParams) => {
    const { newPinHash } = params;

    const validParams = changeTransactionPinParamsSchema.parse(params);

    const user = await userServiceV2.getUserById(validParams.userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (!user.transactionPinHash) {
        throw new Error('Transaction pin has not been set');
    }

    // Update user's transaction pin
    const updatedRecord = await userServiceV2.updateUserTransactionPin(user, newPinHash);

    if (!updatedRecord) {
        throw new Error('Transaction pin not set');
    }

    return {
        pinChanged: true,
    };
};
