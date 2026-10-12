import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(projectDirectory, 'frontend');
const outputDirectory = path.join(projectDirectory, 'dist');

// Vercel receives only this generated static directory. The Node/Oracle source
// remains outside the deployed output and cannot be selected as an entrypoint.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
console.log('Prepared static TRUSTYDB console in dist/.');
