import { fiatramps } from '@/proto/fiatramps/v1/service';
import FiatRampsServiceClient = fiatramps.v1.FiatRampsServiceClient;
import * as grpc from '@grpc/grpc-js';

const servicePort = 50051;
const internalServiceDns = 'globachain-ramps-service';
const serviceAddress = `${internalServiceDns}:${servicePort}`;

// Create a client
export const client = new FiatRampsServiceClient(serviceAddress, grpc.credentials.createInsecure());
