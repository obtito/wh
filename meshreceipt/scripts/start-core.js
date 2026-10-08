import { createApp } from '../server/index.js';

const env = { ...process.env, MESHRECEIPT_CORE_ONLY: '1' };
const { server } = await createApp({ env });
const port = Number(env.PORT || 4318);
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`MeshReceipt core: http://127.0.0.1:${server.address().port}`));
