// A script to generate a base64 string from an input.

import { convertBase64ToAsciiString } from '../src/resources/utils/encryption';
import * as process from 'node:process';

const input = process.argv[2];

if (!input) {
    console.error('No input provided');
    process.exit(1);
}

const base64ToAsciiString = convertBase64ToAsciiString(input);

console.log(`Copy converted Ascii string below:\n${base64ToAsciiString}`);
