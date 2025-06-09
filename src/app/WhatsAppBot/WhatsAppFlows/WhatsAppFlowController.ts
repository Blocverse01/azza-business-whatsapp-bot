import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import WhatsAppBotAddBeneficiaryFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotAddBeneficiaryFlowService';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotOffRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOffRampFlowService';
import WhatsAppBotOnRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOnRampFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import WhatsAppBotTransferToWalletFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransferToWalletFlowService';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { requestDecryptedDataFlowExchange } from '@/resources/requestHelpers/requestPropsGuard';
import type { Request, Response } from 'express';
import BvnKycVerificationFlow from './BvnKycVerificationFlow';
import WhatsappBotAccountStatementFlowService from './WhatsappBotAccountStatementFlowService';

export default class WhatsAppFlowController {
    public static async offrampFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response = await WhatsAppBotOffRampFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async addBeneficiaryFlowDataExchange(req: Request, res: Response) {
        try {

            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotAddBeneficiaryFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async transferToWalletFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotTransferToWalletFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async onRampFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response = await WhatsAppBotOnRampFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async transactionConfirmationFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotTransactionConfirmationFlowService.receiveDataExchange(
                    decryptedBody
                );

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async setTransactionPinFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotSetupTransactionPinFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async changeTransactionPinFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotChangeTransactionPinFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async resetTransactionPinFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotResetTransactionPinFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async bvnKycVerificationFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await BvnKycVerificationFlow.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async accountStatementFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsappBotAccountStatementFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }
}
