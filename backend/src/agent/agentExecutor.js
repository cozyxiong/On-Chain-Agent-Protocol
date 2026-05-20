import { execFile } from "node:child_process";
import {
  prepareAgentIntentBatchExecutionTransaction,
  prepareAgentIntentExecutionTransaction
} from "../wallet/transactionBuilder.js";
import { createUniswapService } from "../uniswap/uniswapService.js";

export function createAgentExecutor(options = {}) {
  const uniswap = options.uniswap ?? createUniswapService(options.uniswapOptions ?? {});

  return {
    async status() {
      return {
        agentAddress: await configuredAgentAddress()
      };
    },

    async executeAgentIntent(input) {
      await assertConfiguredAgent(input.agent);
      const prepared = await prepareAgentIntentExecutionTransaction(input, uniswap);
      const txHash = await broadcastAgentTx(prepared.tx);
      return resultFromPrepared(prepared, txHash);
    },

    async executeBatchAgentIntents(input) {
      await assertConfiguredAgent(input.agent);
      const prepared = await prepareAgentIntentBatchExecutionTransaction(input, uniswap);
      const txHash = await broadcastAgentTx(prepared.tx);
      return resultFromPrepared(prepared, txHash);
    }
  };
}

function resultFromPrepared(prepared, txHash) {
  return {
    ...prepared,
    primaryTxHash: txHash,
    transactions: [
      {
        label: prepared.description,
        hash: txHash,
        etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
      }
    ]
  };
}

function broadcastAgentTx(tx) {
  const privateKey = configuredAgentPrivateKey();
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!privateKey || !rpcUrl) {
    badRequest("AGENT_PRIVATE_KEY/PRIVATE_KEY and SEPOLIA_RPC_URL are required for agent scheduled execution");
  }

  return new Promise((resolve, reject) => {
    execFile(
      "cast",
      [
        "send",
        tx.to,
        tx.data,
        "--rpc-url",
        rpcUrl,
        "--private-key",
        privateKey,
        "--json"
      ],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          const payload = JSON.parse(stdout);
          resolve(payload.transactionHash ?? payload.hash);
        } catch {
          const match = stdout.match(/0x[a-fA-F0-9]{64}/);
          if (!match) {
            reject(new Error("Agent broadcast did not return a transaction hash"));
            return;
          }
          resolve(match[0]);
        }
      }
    );
  });
}

async function assertConfiguredAgent(requestedAgent) {
  assertAddress(requestedAgent, "agent");
  const actualAgent = await configuredAgentAddress();
  if (actualAgent.toLowerCase() !== requestedAgent.toLowerCase()) {
    badRequest(
      `Configured backend Agent signer is ${actualAgent}, but this Smart Account authorization is for ${requestedAgent}. Authorize ${actualAgent} or set AGENT_PRIVATE_KEY for ${requestedAgent}.`
    );
  }
}

function configuredAgentAddress() {
  const privateKey = configuredAgentPrivateKey();
  if (!privateKey) {
    badRequest("AGENT_PRIVATE_KEY/PRIVATE_KEY is required to derive the backend agent address");
  }

  return new Promise((resolve, reject) => {
    execFile(
      "cast",
      ["wallet", "address", "--private-key", privateKey],
      { windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        const address = stdout.trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          reject(new Error("Could not derive backend agent address"));
          return;
        }
        resolve(address);
      }
    );
  });
}

function configuredAgentPrivateKey() {
  return process.env.AGENT_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
}

function assertAddress(value, field) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? "")) {
    badRequest(`${field} must be an EVM address`);
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
