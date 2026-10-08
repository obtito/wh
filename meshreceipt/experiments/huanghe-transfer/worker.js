import { createTask } from './delivery.js';

process.once('message', async options => {
  try { process.send({ ok: true, result: await createTask(options) }); }
  catch (error) { process.send({ ok: false, error: error.message }); }
  finally { process.disconnect(); }
});
