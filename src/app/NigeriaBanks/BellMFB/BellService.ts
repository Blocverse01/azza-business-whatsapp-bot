import env from "@/constants/env";
import { logServiceError } from "@/resources/requestHelpers/handleRequestError";
import axios from "axios";
import { AccessTokenResult, BellOfframpSettlement, GenerateTokenResponse } from "./BellSchema";
import SafeHavenService from "../SafeHaven/SafeHavenService";
import { HttpException } from "@/resources/exceptions/HttpException";
import logger from "@/resources/logger";
import { OK } from "@/constants/status-codes";



class BellService {

    private static readonly BELL_BASED_URL = env.BELL_BASED_URL
    private static readonly BELL_CONSUMER_KEY = env.BELL_CONSUMER_KEY
    private static readonly BELL_CONSUMER_SECRET = env.BELL_CONSUMER_SECRET
    private static accessToken: string | null = null;
    private static tokenExpiry: number | null = null;
    private static EXPIRY_BUFFER_SECONDS = 30


    public static async generateAccessToken(): Promise<AccessTokenResult> {
        try {
            const currentTime = Date.now();

            if (this.accessToken && this.tokenExpiry && currentTime < this.tokenExpiry - (this.EXPIRY_BUFFER_SECONDS * 1000)) {
                return {
                    access_token: this.accessToken
                };
            }

            const response = await axios.post<GenerateTokenResponse>(
                `${this.BELL_BASED_URL}/generate-token`,
                {},
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'consumerKey': this.BELL_CONSUMER_KEY,
                        'consumerSecret': this.BELL_CONSUMER_SECRET,
                        'validityTime': 50
                    },
                }
            );

            const { token, expiry } = response.data;

            this.accessToken = token;
            this.tokenExpiry = Date.now() + Number(expiry) * 60 * 1000;

            return {
                access_token: token
            };
        } catch (error) {
            await logServiceError(error, 'Error generating BellMFB access token');
            throw error;
        }
    }

    public static async processOffRampPaymentWithBell(params: {
        senderName: string;
        beneficiaryBankCode: string;
        amountToSend: number;
        beneficiaryAccountNumber: string;
        sequenceId: string;
    }) {
        try {
            const {
                senderName,
                sequenceId,
                beneficiaryBankCode,
                amountToSend,
                beneficiaryAccountNumber,
            } = params;

            const authTokenData = await this.generateAccessToken();

            const payload = {
                beneficiaryBankCode: beneficiaryBankCode,
                beneficiaryAccountNumber: beneficiaryAccountNumber,
                amount: amountToSend,
                narration: 'AZZA',
                reference: sequenceId,
                senderName: senderName
            };

            const response = await axios.post(`${this.BELL_BASED_URL}/transfers`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authTokenData.access_token}`
                },
            });

            const { data, statusCode, message } = response.data;

            void logger.info(
                `Processing bell off-ramp transaction of ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, sequenceId : ${sequenceId}`
            );

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            void logger.info(
                `Successfully sent ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, sequenceId: ${sequenceId}`
            );

            return {
                sequenceId: sequenceId,
                sessionId: data.sessionId,
            };
        } catch (error) {
            await logServiceError(error, 'Error processing bell Off-Ramp Transaction');
            throw error;
        }
    }



}

export default BellService;