import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { resolveToken, toBaseUnits } from "../tokens/tokenRegistry.js";
import { createUniswapService } from "../uniswap/uniswapService.js";

const SEPOLIA_CHAIN_ID = 11155111;

export function createSettlementService(options = {}) {
  const uniswap = options.uniswap ?? createUniswapService(options.uniswapOptions ?? {});
  const escrowAddress = options.escrowAddress ?? process.env.SIGNED_INTENT_ESCROW_ADDRESS ?? "";

  return {
    async prepareScheduledWorkflow(input) {
      assertAddress(input.owner, "owner");
      assertAddress(escrowAddress, "signedIntentEscrow");
      const intent = input.intent;
      const actions = await scheduledActionsToSignedCalls(intent, {
        owner: input.owner,
        escrowAddress,
        uniswap
      });
      const escrowValueWei = actions.reduce((sum, action) => sum + BigInt(action.call.value), 0n);

      return {
        kind: "signed-intent-workflow",
        escrowAddress,
        escrowValueWei: escrowValueWei.toString(),
        depositTx:
          escrowValueWei > 0n
            ? {
                from: input.owner,
                to: escrowAddress,
                value: toHex(escrowValueWei),
                data: encodeDepositFor(input.owner)
              }
            : null,
        actions
      };
    },

    prepareExecuteSignedCall(input) {
      assertAddress(input.relayer, "relayer");
      assertAddress(escrowAddress, "signedIntentEscrow");
      return {
        kind: "execute-signed-call",
        description: "Relayer executes an authorized signed intent from escrow",
        tx: {
          from: input.relayer,
          to: escrowAddress,
          value: "0x0",
          data: encodeExecuteSignedCall(input.signedCall, input.executionData, input.signature)
        }
      };
    },

    prepareExecuteBatchSignedCalls(input) {
      assertAddress(input.relayer, "relayer");
      assertAddress(escrowAddress, "signedIntentEscrow");
      const calls = input.calls ?? [];
      const executionData = input.executionData ?? [];
      const signatures = input.signatures ?? [];
      return {
        kind: "execute-batch-signed-calls",
        description: `Relayer executes ${calls.length} authorized signed intents from escrow`,
        tx: {
          from: input.relayer,
          to: escrowAddress,
          value: "0x0",
          data: encodeExecuteBatchSignedCalls(calls, executionData, signatures)
        }
      };
    },

    async executeSignedCall(input) {
      const relayer = input.relayer ?? process.env.RELAYER_ADDRESS ?? input.signedCall?.owner;
      const prepared = this.prepareExecuteSignedCall({ ...input, relayer });
      const txHash = await broadcastPreparedTx(prepared.tx);
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
    },

    async executeBatchSignedCalls(input) {
      const relayer = input.relayer ?? process.env.RELAYER_ADDRESS ?? input.calls?.[0]?.owner;
      const prepared = this.prepareExecuteBatchSignedCalls({ ...input, relayer });
      const txHash = await broadcastPreparedTx(prepared.tx);
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
  };
}

async function scheduledActionsToSignedCalls(intent, options) {
  const baseRunAt = new Date(intent.runAt);
  const intervalSeconds = Number(intent.intervalSeconds ?? 60);
  const actions = Array.isArray(intent.payload?.actions) ? intent.payload.actions : [intent.payload];

  const prepared = [];
  for (let index = 0; index < actions.length; index += 1) {
    const executable = actionToIntent(actions[index], intent);
    const executionCall = await executionCallFor(executable, options);
    const runAtSeconds = Math.floor((baseRunAt.getTime() + index * intervalSeconds * 1000) / 1000);
    const signedCall = {
      owner: options.owner,
      target: executionCall.target,
      value: String(executionCall.value),
      dataHash: keccak256Hex(executionCall.data),
      runAt: String(runAtSeconds),
      deadline: String(runAtSeconds + Math.max(3600, actions.length * 600)),
      nonce: randomBytes32()
    };

    prepared.push({
      index: index + 1,
      description: describeIntent(executable),
      intent: executable,
      runAt: new Date(runAtSeconds * 1000).toISOString(),
      call: signedCall,
      executionData: executionCall.data,
      typedData: typedDataFor(options.escrowAddress, signedCall)
    });
  }

  return prepared;
}

function actionToIntent(action, parentIntent) {
  const type = inferActionType(action ?? {}, parentIntent);

  if (type === "transfer") {
    return {
      intentType: "transfer",
      token: firstPresent(action.token, action.asset, action.tokenSymbol, parentIntent.token, "ETH"),
      amount: decimalString(firstPresent(action.amount, action.value, action.quantity, parentIntent.amount)),
      recipient: firstPresent(
        action.recipient,
        action.to,
        action.toAddress,
        action.address,
        action.target,
        action.recipientAddress,
        action.receiver,
        action.destination,
        parentIntent.recipient,
        parentIntent.payload?.recipient,
        parentIntent.payload?.to,
        parentIntent.payload?.target
      )
    };
  }

  if (type === "swap") {
    return {
      intentType: "swap",
      tokenIn: firstPresent(action.tokenIn, action.fromToken, action.sellToken, parentIntent.tokenIn, "ETH"),
      tokenOut: firstPresent(action.tokenOut, action.toToken, action.buyToken, parentIntent.tokenOut, "USDC"),
      amountIn: decimalString(firstPresent(action.amountIn, action.amount, action.value, parentIntent.amountIn)),
      slippageBps: firstPresent(action.slippageBps, parentIntent.slippageBps, 50),
      deadlineMinutes: firstPresent(action.deadlineMinutes, parentIntent.deadlineMinutes, 20)
    };
  }

  badRequest(`Unsupported scheduled action type: ${type || "unknown"}`);
}

function inferActionType(action, parentIntent) {
  const explicit = String(action.intentType ?? action.type ?? "").toLowerCase();
  if (explicit) return explicit;
  if (firstPresent(action.tokenIn, action.tokenOut, action.fromToken, action.toToken, action.buyToken, action.sellToken)) {
    return "swap";
  }
  if (
    firstPresent(action.recipient, action.to, action.toAddress, action.address, action.target, action.recipientAddress, action.receiver, action.destination) &&
    firstPresent(action.amount, action.value, action.quantity)
  ) {
    return "transfer";
  }
  return String(parentIntent.taskType ?? "").toLowerCase();
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

async function executionCallFor(intent, options) {
  if (intent.intentType === "transfer") {
    const token = resolveToken(intent.token);
    if (!token.native) {
      badRequest("Default EIP-712 settlement currently supports native ETH transfers only");
    }
    assertAddress(intent.recipient, "recipient");
    return {
      target: intent.recipient,
      value: toBaseUnits(intent.amount, token.decimals).toString(),
      data: "0x"
    };
  }

  if (intent.intentType === "swap") {
    const prepared = await options.uniswap.prepareSwapExecution({
      ...intent,
      smartAccount: options.escrowAddress
    });
    return {
      target: prepared.executionCall.target,
      value: String(prepared.executionCall.value ?? "0"),
      data: prepared.executionCall.data
    };
  }

  badRequest(`Unsupported settlement intent type: ${intent.intentType}`);
}

function typedDataFor(escrowAddress, signedCall) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      SignedCall: [
        { name: "owner", type: "address" },
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "dataHash", type: "bytes32" },
        { name: "runAt", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "SignedCall",
    domain: {
      name: "AAP Intent Protocol",
      version: "1",
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract: escrowAddress
    },
    message: signedCall
  };
}

function encodeDepositFor(owner) {
  return `0xaa67c919${padAddress(owner)}`;
}

function encodeExecuteSignedCall(signedCall, executionData, signature) {
  const data = cleanHex(executionData);
  const sig = cleanHex(signature);
  const head =
    "0xceb31efe" +
    padAddress(signedCall.owner) +
    padAddress(signedCall.target) +
    padUint(signedCall.value) +
    cleanHex(signedCall.dataHash).padStart(64, "0") +
    padUint(signedCall.runAt) +
    padUint(signedCall.deadline) +
    cleanHex(signedCall.nonce).padStart(64, "0") +
    padUint(9 * 32) +
    padUint(9 * 32 + dynamicBytesLength(data)) +
    encodeBytes(data) +
    encodeBytes(sig);
  return head;
}

function encodeExecuteBatchSignedCalls(calls, executionData, signatures) {
  if (calls.length !== executionData.length || calls.length !== signatures.length) {
    badRequest("Batch signed calls, data, and signatures length mismatch");
  }

  const callsArray = encodeSignedCallArray(calls);
  const dataArray = encodeBytesArray(executionData.map(cleanHex));
  const sigArray = encodeBytesArray(signatures.map(cleanHex));
  return `0xc3de3b18${padUint(96)}${padUint(96 + dynamicBytesLength(callsArray))}${padUint(96 + dynamicBytesLength(callsArray) + dynamicBytesLength(dataArray))}${encodeBytes(callsArray)}${encodeBytes(dataArray)}${encodeBytes(sigArray)}`;
}

function encodeSignedCallArray(calls) {
  return `${padUint(calls.length)}${calls
    .map(
      (call) =>
        `${padAddress(call.owner)}${padAddress(call.target)}${padUint(call.value)}${cleanHex(call.dataHash).padStart(64, "0")}${padUint(call.runAt)}${padUint(call.deadline)}${cleanHex(call.nonce).padStart(64, "0")}`
    )
    .join("")}`;
}

function encodeBytesArray(items) {
  const headSize = items.length * 32;
  let tail = "";
  const offsets = [];
  for (const item of items) {
    offsets.push(headSize + tail.length / 2);
    tail += encodeBytes(item);
  }
  return `${padUint(items.length)}${offsets.map(padUint).join("")}${tail}`;
}

function encodeBytes(cleanData) {
  return `${padUint(cleanData.length / 2)}${cleanData.padEnd(Math.ceil(cleanData.length / 64) * 64, "0")}`;
}

function dynamicBytesLength(cleanData) {
  return 32 + Math.ceil(cleanData.length / 64) * 32;
}

function describeIntent(intent) {
  if (intent.intentType === "transfer") {
    return `Transfer ${intent.amount} ${intent.token} to ${intent.recipient}`;
  }
  return `Swap ${intent.amountIn} ${intent.tokenIn} to ${intent.tokenOut}`;
}

function keccak256Hex() {
  return `0x${"0".repeat(64)}`;
}

function randomBytes32() {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

function decimalString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function padAddress(address) {
  return cleanHex(address).padStart(64, "0");
}

function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function toHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function cleanHex(value) {
  return String(value ?? "").replace(/^0x/, "");
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

function broadcastPreparedTx(tx) {
  const privateKey = process.env.RELAYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!privateKey || !rpcUrl) {
    badRequest("RELAYER_PRIVATE_KEY/PRIVATE_KEY and SEPOLIA_RPC_URL are required for relayer execution");
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
            reject(new Error("Relayer broadcast did not return a transaction hash"));
            return;
          }
          resolve(match[0]);
        }
      }
    );
  });
}
