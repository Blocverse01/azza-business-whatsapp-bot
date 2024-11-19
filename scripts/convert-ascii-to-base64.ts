// A script to generate a base64 string from an input.

import { convertAsciiStringToBase64 } from '../src/resources/utils/encryption';
import * as process from 'node:process';

const input = process.argv[2];

if (!input) {
    console.error('No input provided');
    process.exit(1);
}

const base64String = convertAsciiStringToBase64(input);

console.log(`Copy converted Base64 string below:\n${base64String}`);
