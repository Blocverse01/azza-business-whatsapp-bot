import { getXataClient } from './xata';
import {getXataClient as getXataClient2} from './db-client-2'

const xata = getXataClient();
const fiatRampsXata = getXataClient2();

export const dbClient = xata.db;
export const sqlClient = xata.sql;

export const fiatRampsDbClient = fiatRampsXata.db;