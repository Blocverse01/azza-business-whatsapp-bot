import {
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

    const updateRecord = await UserService.storeNewTransactionPin(
        user,
        params.pin,
        params.securityQuestions
    );

    if (!updateRecord) {
        throw new Error('Transaction pin not set');
    }

    return {
        pinSet: true,
    };
};
