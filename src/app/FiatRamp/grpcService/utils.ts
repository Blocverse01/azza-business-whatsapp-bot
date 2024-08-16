import grpc from '@grpc/grpc-js';

type UnaryMethod<RequestType, ResponseType> = (
    request: RequestType,
    callback: (error: grpc.ServiceError | null, response: ResponseType) => void
) => void;

export function promisifyUnary<ClientType, RequestType, ResponseType>(
    client: ClientType,
    methodName: keyof ClientType
): (request: RequestType) => Promise<ResponseType> {
    return (request: RequestType) => {
        return new Promise((resolve, reject) => {
            const method = client[methodName] as UnaryMethod<RequestType, ResponseType>;
            method.call(client, request, (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            });
        });
    };
}
