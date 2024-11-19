import { Request } from 'express';

// Guards for ensuring that the request has the expected properties
// This is useful for ensuring that the request has the expected properties
// before using them in the controller

const requestDecryptedDataFlowExchange = (req: Request) => {
    const dataFlowExchange = req.decryptedFlowDataExchange;

    if (!dataFlowExchange) {
        throw new Error('No decrypted data flow exchange found in request');
    }

    return dataFlowExchange;
};

// Add more request guards as needed

export { requestDecryptedDataFlowExchange };
