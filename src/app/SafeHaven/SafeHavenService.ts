import env from "@/constants/env";
import axios from 'axios';
import slugify from 'slugify';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import {AuthTokenResponse, AccessTokenResult, SupportedBankResponse} from './SafeHaveSchema'

class SafeHaveService {

    private static readonly GRANT_TYPE = 'client_credentials';
    private static readonly  CLIENT_ASSERTION_TYPE =  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    private static readonly SAVEHAVEN_BASE_URL = env.SAVEHAVEN_BASE_URL;
    private static readonly SAVEHAVEN_CLIENT_ID= env.SAVEHAVEN_CLIENT_ID;
    private static readonly SAVEHAVEN_CLIENT_ASSERTION = env.SAVEHAVEN_CLIENT_ASSERTION;
    private static readonly SAVEHAVEN_ACCOUNT_NUMBER = '0117226117';

    private static accessToken: string | null = null;
    private static tokenExpiry: number | null = null; 
    private static ibsClientId: string | null = null;


    public static async generateAccessToken(): Promise<AccessTokenResult> {
        try {

            const currentTime = Date.now(); 

            if (this.accessToken && this.tokenExpiry && currentTime < this.tokenExpiry) {
                return {
                    access_token: this.accessToken,
                    ibs_client_id: this.ibsClientId as string,
                };
            }

            const payload = {
                grant_type : this.GRANT_TYPE,
                client_assertion_type : this.CLIENT_ASSERTION_TYPE,
                client_id : this.SAVEHAVEN_CLIENT_ID,
                client_assertion : this.SAVEHAVEN_CLIENT_ASSERTION
            };

            const response = await axios.post<AuthTokenResponse>(
                `${this.SAVEHAVEN_BASE_URL}/oauth2/token`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            const { ibs_client_id, access_token, expires_in } = response.data;

            this.accessToken = access_token;
            this.ibsClientId = ibs_client_id;
            this.tokenExpiry = Date.now() + expires_in * 1000;

            return {
                access_token,
                ibs_client_id
            };

        } catch (error) {
            await logServiceError(error, 'Error generating SavaHaven access token');
            throw error;
        }
    }


    public static async getSupportedBanks() : Promise<SupportedBankResponse[]> {
        
        try {

            const authTokenData = await this.generateAccessToken();
            
            const response = await axios.get<SupportedBankResponse[]>(
                `${this.SAVEHAVEN_BASE_URL}/oauth2/token`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization' :  `Bearer ${authTokenData.access_token}`,
                        'ClientID' : `${authTokenData.ibs_client_id}`
                    },
                }
            );

            const supportedBanks: SupportedBankResponse[] = response.data;

            supportedBanks.map(bank => ({
                name : bank.name,
                slug : slugify(bank.name, { lower: true, replacement: '-' }),
                bankCode : bank.bankCode,
              }));

            return supportedBanks;

        } catch (error) {
            await logServiceError(error, 'Error generating SavaHaven access token');
            throw error;
        }

    }



}

export default SafeHaveService