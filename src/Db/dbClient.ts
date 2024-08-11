import { getXataClient } from "./xata";

const xata = getXataClient();

export const dbClient = xata.db;
export const sqlClient = xata.sql;