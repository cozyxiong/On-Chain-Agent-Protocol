import { loadEnv } from "./config/loadEnv.js";
import { createBackendServer } from "./server.js";

loadEnv();

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const server = createBackendServer();

server.listen(port, () => {
  console.log(`AAP backend listening on http://localhost:${port}`);
});
