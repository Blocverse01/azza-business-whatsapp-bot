import { fiatramps } from '@/proto/fiatramps/v1/service';
import FiatRampsServiceClient = fiatramps.v1.FiatRampsServiceClient;
import * as grpc from '@grpc/grpc-js';
import env from '@/constants/env';

const servicePort = 50051;
const internalServiceDns = env.TESTING_GRPC_SERVICE
    ? 'localhost'
    : 'fiat-ramps-service';
const serviceAddress = `${internalServiceDns}:${servicePort}`;

// Create a client
export const client = new FiatRampsServiceClient(serviceAddress, grpc.credentials.createInsecure());
