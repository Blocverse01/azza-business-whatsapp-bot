import {
    ChangeTransactionPinParams,
    changeTransactionPinParamsSchema,
    type SetTransactionPinParams,
    setTransactionPinParamsSchema,
} from '@/app/azza/azza.schema';
import UserService from '@/app/User/UserService';

export const setTransactionPin = async (params: SetTransactionPinParams) => {
    const validParams = setTransactionPinParamsSchema.parse(params);

    const user = await UserService.getUserByPhoneNumber(validParams.userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.transactionPinHash) {
        throw new Error('Transaction pin already set');
    }

    const updateRecord = await UserService.background_storeNewTransactionPin(
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

    const user = await UserService.getUserByPhoneNumber(validParams.userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (!user.transactionPinHash) {
        throw new Error('Transaction pin has not been set');
    }

    // Update user's transaction pin
    const updatedRecord = await UserService.updateTransactionPin(user, newPinHash);

    if (!updatedRecord) {
        throw new Error('Transaction pin not set');
    }

    return {
        pinChanged: true,
    };
};
