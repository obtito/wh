import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'ethers';
import { compileRegistry } from './compile-contract.js';

const attester = process.argv[2] ? getAddress(process.argv[2]) : '';
const artifact = await compileRegistry();
await build({
  configFile: false,
  root: fileURLToPath(new URL('../web/', import.meta.url)),
  publicDir: false,
  base: '/testnet/',
  define: { __REGISTRY__: JSON.stringify(artifact), __ATTESTER__: JSON.stringify(attester) },
  build: {
    outDir: fileURLToPath(new URL('../dist/testnet/', import.meta.url)),
    emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('../web/testnet-deploy.html', import.meta.url)) },
  },
});
console.log('Prepared http://127.0.0.1:4318/testnet/testnet-deploy.html — no transaction sent.');
