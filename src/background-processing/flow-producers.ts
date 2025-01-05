import { connectionConfig } from '@/background-processing/redis-connection-config';
import { FlowProducer } from 'bullmq';

export const offrampFlowProducer = new FlowProducer({ connection: connectionConfig });
