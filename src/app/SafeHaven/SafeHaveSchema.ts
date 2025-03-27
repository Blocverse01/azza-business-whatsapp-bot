export interface AuthTokenResponse {
    access_token: string;
    client_id: string;
    token_type: "Bearer";
    expires_in: number;
    refresh_token: string;
    ibs_client_id: string;
    ibs_user_id: string;
}

export interface SupportedBankResponse {
    name: string;
    alias: string[];
    routingKey: string;
    logoImage: string | null;
    bankCode: string;
    categoryId: string;
    nubanCode: string | null;
  }
  
export interface AccessTokenResult {
    access_token: string;
    ibs_client_id: string;
}

export interface SupportedBankResult {
    name : string,
    slug : string
    bankCode : string,
}
