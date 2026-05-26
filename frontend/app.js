const state = {
  apiBase: localStorage.getItem("aap.apiBase") ?? "http://localhost:8787",
  history: JSON.parse(localStorage.getItem("aap.executionHistory") ?? "[]"),
  lastIntent: null,
  metrics: null,
  walletConnected: false,
  platformAgentAddress: "",
  autoRefreshTimer: null,
  autoRefreshing: false,
  receiptTimers: new Set(),
  scheduleTimers: new Set(),
  authorizations: JSON.parse(localStorage.getItem("aap.agentAuthorizations") ?? "[]")
};

const FINAL_STATUSES = new Set(["SUCCESS", "FAILED"]);
const SCHEDULED_STATUSES = new Set(["SCHEDULED", "AUTHORIZED", "READY_FOR_RELAYER", "WAITING_SIGNATURE"]);
const KNOWN_TOKENS = ["ETH", "WETH", "USDC"];
const SMART_ACCOUNT_FACTORY = "0xA1E3DE4e214E0C58cc45013717970b5Af72B4216";
const DEFAULT_SMART_ACCOUNT_SALT = "0x01";
const WILDCARD_TARGET = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const EIP712_DOMAIN = {
  name: "AAP Intent Protocol",
  version: "1",
  chainId: 11155111,
  verifyingContract: "0x0000000000000000000000000000000000000000"
};
const EIP712_TYPES = {
  ScheduledWorkflow: [
    { name: "userId", type: "string" },
    { name: "agentId", type: "string" },
    { name: "smartAccount", type: "address" },
    { name: "runAt", type: "uint256" },
    { name: "intervalSeconds", type: "uint256" },
    { name: "actionsJson", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" }
  ]
};

const el = {
  backendStatus: document.querySelector("#backendStatus"),
  backendLabel: document.querySelector("#backendLabel"),
  connectWalletButton: document.querySelector("#connectWalletButton"),
  aiMessage: document.querySelector("#aiMessage"),
  userId: document.querySelector("#userId"),
  agentId: document.querySelector("#agentId"),
  ownerWallet: document.querySelector("#ownerWallet"),
  smartAccount: document.querySelector("#smartAccount"),
  smartAccountStatus: document.querySelector("#smartAccountStatus"),
  smartAccountBalance: document.querySelector("#smartAccountBalance"),
  fundAmount: document.querySelector("#fundAmount"),
  fundSmartAccountButton: document.querySelector("#fundSmartAccountButton"),
  agentControlsPanel: document.querySelector("#agentControlsPanel"),
  agentAddress: document.querySelector("#agentAddress"),
  platformAgentStatus: document.querySelector("#platformAgentStatus"),
  authorizedTarget: document.querySelector("#authorizedTarget"),
  permissionLimitEth: document.querySelector("#permissionLimitEth"),
  unlimitedAuthorizationToggle: document.querySelector("#unlimitedAuthorizationToggle"),
  revokeAgentButton: document.querySelector("#revokeAgentButton"),
  revokeTargetButton: document.querySelector("#revokeTargetButton"),
  revokeAuthorizationSelect: document.querySelector("#revokeAuthorizationSelect"),
  executionMode: document.querySelector("#executionMode"),
  useAgentWalletToggle: document.querySelector("#useAgentWalletToggle"),
  createSmartAccountButton: document.querySelector("#createSmartAccountButton"),
  authorizeAgentButton: document.querySelector("#authorizeAgentButton"),
  sendIntentButton: document.querySelector("#sendIntentButton"),
  aiResult: document.querySelector("#aiResult"),
  fundAgentPanel: document.querySelector("#fundAgentPanel"),
  messages: document.querySelector("#messages"),
  historyRows: document.querySelector("#historyRows"),
  metricsCards: document.querySelector("#metricsCards"),
  metricsUpdated: document.querySelector("#metricsUpdated"),
  batchMetricRows: document.querySelector("#batchMetricRows")
};

document.querySelector("#parseIntentButton").addEventListener("click", previewIntent);
document.querySelector("#sendIntentButton").addEventListener("click", sendMessage);
document.querySelector("#refreshButton").addEventListener("click", refresh);
el.connectWalletButton.addEventListener("click", connectWallet);
el.createSmartAccountButton.addEventListener("click", createSmartAccount);
el.fundSmartAccountButton.addEventListener("click", fundSmartAccount);
el.authorizeAgentButton.addEventListener("click", authorizeAgent);
el.revokeAgentButton.addEventListener("click", () => revokeAgentAuthorization({ mode: "agent" }));
el.revokeTargetButton.addEventListener("click", () => revokeAgentAuthorization({ mode: "target" }));
el.revokeAuthorizationSelect.addEventListener("change", updateRevokePreview);
el.unlimitedAuthorizationToggle.addEventListener("change", handleUnlimitedAuthorizationToggle);
el.smartAccount.addEventListener("input", () => {
  refreshSmartAccountBalance().catch(() => {});
  renderAuthorizationOptions();
});
document.querySelectorAll(".amount-chip").forEach((button) => {
  button.addEventListener("click", () => {
    el.fundAmount.value = button.dataset.fundAmount;
    el.fundAmount.focus();
  });
});
el.agentAddress.addEventListener("input", renderAuthorizationOptions);
el.smartAccount.addEventListener("input", renderAuthorizationOptions);
el.useAgentWalletToggle.addEventListener("change", () => {
  el.executionMode.value = el.useAgentWalletToggle.checked ? "agent" : "owner";
  updateFundPanelVisibility();
  appendMessage(
    "assistant",
    el.useAgentWalletToggle.checked
      ? "Agent Wallet execution enabled. Create and fund your Smart Account, then authorize the platform Agent once."
      : "Agent Wallet execution disabled. Your connected EOA wallet will sign intents directly."
  );
});
document.querySelectorAll(".template-button").forEach((button) => {
  button.addEventListener("click", () => applyTemplate(button.dataset.template));
});
el.aiMessage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

await refresh();
updateFundPanelVisibility();
updateRevokePreview();
renderAuthorizationOptions();
syncAuthorizationModeFields();
startAutoRefresh();

const templates = {
  transfer:
    "Send [amount] ETH on Sepolia to [recipient address].",
  scheduled:
    "Send [amount] ETH on Sepolia to [recipient address] at [time].",
  swap:
    "Swap [amount] [token in] to [token out] on Sepolia with [slippage]% slippage.",
  rebalance:
    "Rebalance my portfolio to [WETH target]% WETH and [USDC target]% USDC on Sepolia."
};

async function connectWallet() {
  if (!window.ethereum) {
    appendMessage("assistant", "No injected wallet was found. Install MetaMask or paste a smart account address.");
    return;
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (accounts?.[0]) {
    el.ownerWallet.value = accounts[0];
    state.walletConnected = true;
    el.connectWalletButton.textContent = `Connected ${short(accounts[0])}`;
    appendMessage("assistant", `Connected wallet ${short(accounts[0])}.`);
    await syncDefaultSmartAccount();
    await refreshSmartAccountBalance();
  }
}

async function createSmartAccount() {
  if (!state.walletConnected || !/^0x[a-fA-F0-9]{40}$/.test(el.ownerWallet.value)) {
    appendMessage("assistant", "Please connect your owner wallet first.");
    return;
  }

  let submitted = false;
  try {
    el.createSmartAccountButton.disabled = true;
    el.createSmartAccountButton.textContent = "Creating...";
    const predicted = await predictDefaultSmartAccount();
    el.smartAccount.value = predicted.smartAccount;
    updateRevokePreview();
    renderAuthorizationOptions();
    await refreshSmartAccountBalance();

    if (await isContractDeployed(predicted.smartAccount)) {
      appendMessage("assistant", `Your Agent smart account already exists: ${short(predicted.smartAccount)}.`);
      await syncDefaultSmartAccount();
      return;
    }

    const prepared = await api("/wallet/prepare-create-smart-account", {
      method: "POST",
      body: {
        owner: el.ownerWallet.value,
        factory: SMART_ACCOUNT_FACTORY,
        salt: DEFAULT_SMART_ACCOUNT_SALT
      }
    });

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.tx]
    });
    submitted = true;

    appendMessage(
      "assistant",
      `Smart account creation submitted: ${short(txHash)}. Predicted smart account: ${short(predicted.smartAccount)}.`
    );
    renderTxLinks([
      {
        label: "Create Smart Account",
        hash: txHash,
        etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
      }
    ]);
    waitForReceipt(txHash).finally(() => {
      syncDefaultSmartAccount().catch(() => {});
    });
  } catch (error) {
    appendMessage("assistant", `Smart account creation failed: ${error.message}`);
  } finally {
    if (submitted) {
      el.smartAccountStatus.textContent = "Creation pending";
      el.createSmartAccountButton.disabled = true;
      el.createSmartAccountButton.textContent = "Creation Pending";
      return;
    }
    await syncDefaultSmartAccount().catch(() => {
      el.createSmartAccountButton.disabled = false;
      el.createSmartAccountButton.textContent = "Create Smart Account";
    });
  }
}

async function fundSmartAccount() {
  if (!ensureOwnerWalletConnected()) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(el.smartAccount.value)) {
    appendMessage("assistant", "Create or paste an Agent smart account before funding it.");
    return;
  }

  let valueHex;
  try {
    valueHex = ethToWeiHex(el.fundAmount.value);
  } catch (error) {
    appendMessage("assistant", error.message);
    return;
  }

  try {
    el.fundSmartAccountButton.disabled = true;
    el.fundSmartAccountButton.textContent = "Funding...";
    appendMessage(
      "assistant",
      `Please confirm a funding transfer from your connected wallet to Agent Account ${short(el.smartAccount.value)}.`
    );

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: el.ownerWallet.value,
          to: el.smartAccount.value,
          value: valueHex
        }
      ]
    });

    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: "agent-funding",
      status: "PENDING",
      primaryTxHash: txHash,
      transactions: [
        {
          label: "Fund Agent Account",
          hash: txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
        }
      ]
    };
    state.history.unshift(record);
    state.history = state.history.slice(0, 25);
    localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    renderTxLinks(record.transactions);
    renderHistory();
    appendMessage("assistant", `Funding transaction submitted: ${short(txHash)}. Waiting for Sepolia confirmation...`);
    trackTransaction(record.id).finally(() => {
      refreshSmartAccountBalance().catch(() => {});
    });
  } catch (error) {
    appendMessage("assistant", `Funding failed: ${error.message}`);
  } finally {
    el.fundSmartAccountButton.disabled = false;
    el.fundSmartAccountButton.textContent = "Fund";
  }
}

async function authorizeAgent(options = {}) {
  if (!ensureWalletConnected()) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(el.smartAccount.value)) {
    appendMessage("assistant", "Create or paste a smart account address before authorizing an agent.");
    return;
  }
  if (!ensurePlatformAgentLoaded()) {
    return;
  }
  const unlimited = Boolean(options.unlimited);
  const target = unlimited ? WILDCARD_TARGET : el.authorizedTarget.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
    appendMessage("assistant", "Enter a valid authorized target contract or recipient address.");
    return;
  }
  if (el.smartAccount.value.toLowerCase() === el.agentAddress.value.toLowerCase()) {
    appendMessage(
      "assistant",
      "The platform Agent address should be separate from your Smart Account. Please check backend Agent configuration."
    );
  }

  const maxValueWei = unlimited
    ? MAX_UINT256
    : ethToWeiDecimal(el.permissionLimitEth.value || "0.01");
  const validUntil = unlimited
    ? 4102444800
    : Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  try {
    el.authorizeAgentButton.disabled = true;
    el.authorizeAgentButton.textContent = unlimited ? "Enabling..." : "Authorizing...";
    const prepared = await api("/wallet/prepare-authorize-agent", {
      method: "POST",
      body: {
        owner: el.ownerWallet.value,
        smartAccount: el.smartAccount.value,
        agent: el.agentAddress.value,
        target,
        maxValueWei,
        validUntil
      }
    });

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.tx]
    });

    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: "authorize-agent",
      status: "PENDING",
      primaryTxHash: txHash,
      transactions: [
        {
          label: "Authorize Agent",
          hash: txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
        }
      ]
    };
    state.history.unshift(record);
    localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    saveAuthorizationRecord({
      smartAccount: el.smartAccount.value,
      owner: el.ownerWallet.value,
      agent: el.agentAddress.value,
      target,
      maxValueWei,
      unlimited,
      validUntil,
      txHash
    });
    renderHistory();
    renderTxLinks(record.transactions);
    appendMessage(
      "assistant",
      unlimited
        ? `Unlimited Agent authorization submitted: ${short(txHash)}. Waiting for Sepolia confirmation...`
        : `Limited Agent authorization submitted: ${short(txHash)}. Waiting for Sepolia confirmation...`
    );
    trackTransaction(record.id);
  } catch (error) {
    appendMessage("assistant", `Agent authorization failed: ${error.message}`);
    if (unlimited) {
      el.unlimitedAuthorizationToggle.checked = false;
      syncAuthorizationModeFields();
    }
  } finally {
    el.authorizeAgentButton.disabled = false;
    syncAuthorizationModeFields();
  }
}

async function revokeAgentAuthorization(options = {}) {
  if (!ensureWalletConnected()) return;
  const selected = selectedAuthorizationRecord();
  const targetMode = options.mode === "target";
  const smartAccount = targetMode ? selected?.smartAccount : el.smartAccount.value;
  const agent = targetMode ? selected?.agent : el.agentAddress.value;

  if (!/^0x[a-fA-F0-9]{40}$/.test(smartAccount)) {
    appendMessage("assistant", "Create or paste a smart account address before revoking authorization.");
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(agent)) {
    appendMessage("assistant", "Platform Agent address is not loaded. Check backend Agent configuration.");
    return;
  }
  if (targetMode && (!selected || isWildcardTarget(selected.target))) {
    appendMessage("assistant", "Select a specific target authorization to revoke.");
    return;
  }

  const confirmed = window.confirm(
    [
      targetMode ? "Revoke this target permission?" : "Revoke this Agent authorization?",
      "",
      `Smart Account: ${smartAccount}`,
      `Platform Agent: ${agent}`,
      targetMode ? `Authorized target: ${selected.target}` : null,
      targetMode ? `Limit: ${authorizationLimitLabel(selected)}` : null,
      "",
      targetMode
        ? "This will revoke only the selected target permission."
        : "This will disable that agent from executing through this smart account."
    ].filter(Boolean).join("\n")
  );
  if (!confirmed) {
    return;
  }

  try {
    const activeButton = targetMode ? el.revokeTargetButton : el.revokeAgentButton;
    activeButton.disabled = true;
    activeButton.textContent = "Revoking...";
    const prepared = await api(targetMode ? "/wallet/prepare-revoke-agent-target" : "/wallet/prepare-revoke-agent", {
      method: "POST",
      body: {
        owner: el.ownerWallet.value,
        smartAccount,
        agent,
        target: selected?.target
      }
    });

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.tx]
    });

    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: targetMode ? "revoke-agent-target" : "revoke-agent",
      status: "PENDING",
      primaryTxHash: txHash,
      transactions: [
        {
          label: targetMode ? "Revoke Agent Target" : "Revoke Agent Authorization",
          hash: txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
        }
      ]
    };
    state.history.unshift(record);
    state.history = state.history.slice(0, 25);
    localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    if (targetMode) {
      removeAuthorizationRecord(selected.id);
    } else {
      removeAuthorizationRecords(smartAccount, agent);
    }
    renderHistory();
    el.unlimitedAuthorizationToggle.checked = false;
    appendMessage("assistant", `Agent authorization revoke submitted: ${short(txHash)}. Waiting for Sepolia confirmation...`);
    trackTransaction(record.id);
  } catch (error) {
    appendMessage("assistant", `Agent authorization revoke failed: ${error.message}`);
  } finally {
    el.revokeAgentButton.disabled = false;
    el.revokeAgentButton.textContent = "Revoke Agent";
    el.revokeTargetButton.disabled = false;
    el.revokeTargetButton.textContent = "Revoke Target";
    updateRevokePreview();
  }
}

async function handleUnlimitedAuthorizationToggle() {
  syncAuthorizationModeFields();
  if (el.unlimitedAuthorizationToggle.checked) {
    await authorizeAgent({ unlimited: true });
  } else {
    await revokeAgentAuthorization({ mode: "agent" });
  }
}

function syncAuthorizationModeFields() {
  const unlimited = Boolean(el.unlimitedAuthorizationToggle?.checked);
  if (!el.authorizedTarget || !el.permissionLimitEth || !el.authorizeAgentButton) return;
  el.authorizedTarget.disabled = unlimited;
  el.permissionLimitEth.disabled = unlimited;
  el.authorizedTarget.placeholder = unlimited ? "All targets" : "Authorized target";
  el.authorizeAgentButton.textContent = unlimited ? "Authorize Unlimited" : "Authorize Limited";
}

function applyTemplate(kind) {
  el.aiMessage.value = templates[kind] ?? "";
  el.aiMessage.focus();
  el.aiMessage.setSelectionRange(el.aiMessage.value.length, el.aiMessage.value.length);
  el.aiResult.classList.add("hidden");
  document.querySelector("#parseIntentButton").textContent = "Preview";
}

async function previewIntent() {
  const message = el.aiMessage.value.trim();
  if (!message) return;

  if (!el.aiResult.classList.contains("hidden")) {
    el.aiResult.classList.add("hidden");
    document.querySelector("#parseIntentButton").textContent = "Preview";
    return;
  }

  setBusy(true, "Parsing...");

  try {
    const result = await parseIntent(message);
    state.lastIntent = result.valid ? result.intent : null;
    el.aiResult.textContent = JSON.stringify(result, null, 2);
    el.aiResult.classList.remove("hidden");
    document.querySelector("#parseIntentButton").textContent = "Hide JSON";

    if (result.valid) {
      document.querySelector("#parseIntentButton").textContent = "Hide JSON";
    } else {
      document.querySelector("#parseIntentButton").textContent = "Hide JSON";
    }
  } catch (error) {
    el.aiResult.textContent = JSON.stringify({ error: error.message }, null, 2);
    el.aiResult.classList.remove("hidden");
    document.querySelector("#parseIntentButton").textContent = "Hide JSON";
  } finally {
    setBusy(false);
  }
}

async function sendMessage() {
  if (!ensureWalletConnected()) {
    return;
  }

  const message = el.aiMessage.value.trim();
  if (!message) return;

  appendMessage("user", message);
  el.aiMessage.value = "";
  state.lastIntent = null;
  el.aiResult.classList.add("hidden");
  document.querySelector("#parseIntentButton").textContent = "Preview";
  await executeIntent(message);
}

async function executeIntent(message) {
  setBusy(true, "Executing...");

  try {
    const handled = await handleDirectCommand(message);
    if (handled) return;

    appendMessage("assistant", "Parsing your intent...");
    const parsed = await parseIntent(message);
    if (!parsed.valid || !parsed.intent) {
      appendMessage("assistant", `Cannot execute yet: ${(parsed.errors ?? []).join("; ")}`);
      return;
    }

    state.lastIntent = parsed.intent;
    el.aiResult.classList.add("hidden");
    document.querySelector("#parseIntentButton").textContent = "Preview";

    if (shouldScheduleIntent(parsed.intent, message)) {
      await scheduleIntentWorkflow(parsed.intent);
      return;
    }

    if (hasActionWorkflow(parsed.intent)) {
      await executeImmediateWorkflow(parsed.intent, message);
      return;
    }

    appendMessage("assistant", `Parsed a ${parsed.intent.intentType} intent. Preparing a wallet transaction...`);

    const forceOwnerFunding = isSmartAccountFundingIntent(parsed.intent);
    if (forceOwnerFunding) {
      appendMessage(
        "assistant",
        "Detected a funding transfer to your Agent smart account. I will use your connected EOA wallet for this funding transaction."
      );
    }

    if (el.executionMode.value === "agent" && !forceOwnerFunding) {
      await executeAgentIntentViaBackend(parsed.intent);
    } else {
      const prepared = await prepareOwnerExecution(parsed.intent);
      await submitPreparedWalletTransactions(prepared, "Transaction submitted");
    }
  } catch (error) {
    appendMessage("assistant", `Execution failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function prepareOwnerExecution(intent) {
  return api("/wallet/prepare-transaction", {
    method: "POST",
    body: {
      intent,
      walletAddress: el.ownerWallet.value
    }
  });
}

async function prepareAgentExecution(intent) {
  if (!isValidAddress(el.agentAddress.value)) {
    throw new Error("Platform Agent address is not loaded. Check backend Agent configuration.");
  }

  const permission = await ensureActiveAgentAuthorization();
  const prepared = await api("/wallet/prepare-agent-intent-execution", {
    method: "POST",
    body: {
      intent,
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  ensurePermissionCoversCall(permission, prepared.call ?? prepared);
  return prepared;
}

async function executeAgentIntentViaBackend(intent) {
  if (!isValidAddress(el.agentAddress.value)) {
    throw new Error("Platform Agent address is not loaded. Check backend Agent configuration.");
  }
  await prepareAgentExecution(intent);
  appendMessage("assistant", "Platform Agent is authorized. The backend Agent will submit this transaction without another wallet signature.");
  const executed = await api("/agent/execute-intent", {
    method: "POST",
    body: {
      intent,
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  recordBackendAgentExecution(executed);
}

async function executeAgentBatchViaBackend(intents) {
  if (!isValidAddress(el.agentAddress.value)) {
    throw new Error("Platform Agent address is not loaded. Check backend Agent configuration.");
  }
  await prepareAgentBatchExecution(intents);
  appendMessage("assistant", `Platform Agent is authorized. The backend Agent will submit one batch transaction for ${intents.length} action(s).`);
  const executed = await api("/agent/execute-batch-intents", {
    method: "POST",
    body: {
      intents,
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  recordBackendAgentExecution(executed);
}

function recordBackendAgentExecution(executed) {
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: executed.kind,
    status: "PENDING",
    primaryTxHash: executed.primaryTxHash,
    batchSize: executed.batchSize,
    estimatedSeparateGas: executed.estimatedSeparateGas,
    executionMode: "agent",
    transactions: executed.transactions ?? [
      {
        label: executed.description,
        hash: executed.primaryTxHash,
        etherscanUrl: `https://sepolia.etherscan.io/tx/${executed.primaryTxHash}`
      }
    ]
  };
  state.history.unshift(record);
  state.history = state.history.slice(0, 25);
  localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
  renderHistory();
  renderTxLinks(record.transactions);
  appendMessage("assistant", `Agent transaction submitted: ${short(record.primaryTxHash)}. Waiting for Sepolia confirmation...`);
  trackTransaction(record.id);
  window.alert(`Agent transaction submitted.\n\nPrimary tx:\n${record.primaryTxHash}`);
}

async function prepareAgentBatchExecution(intents) {
  if (!isValidAddress(el.agentAddress.value)) {
    throw new Error("Platform Agent address is not loaded. Check backend Agent configuration.");
  }

  const permission = await ensureActiveAgentAuthorization();
  const prepared = await api("/wallet/prepare-agent-intent-batch-execution", {
    method: "POST",
    body: {
      intents,
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  for (const call of prepared.calls ?? []) {
    ensurePermissionCoversCall(permission, call);
  }
  return prepared;
}

async function ensureActiveAgentAuthorization() {
  const permission = await api("/wallet/agent-permission", {
    method: "POST",
    body: {
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  const now = Math.floor(Date.now() / 1000);
  if (!permission.active || Number(permission.validUntil ?? 0) < now) {
    throw new Error("Agent authorization is not active. Authorize this agent again or turn off Agent Wallet mode.");
  }
  return permission;
}

function ensurePermissionCoversCall(permission, call) {
  const target = String(call?.target ?? "").toLowerCase();
  const allowedTarget = String(permission.target ?? "").toLowerCase();
  const wildcardTarget = "0x0000000000000000000000000000000000000000";
  if (allowedTarget && allowedTarget !== wildcardTarget && allowedTarget !== target) {
    throw new Error(
      `Agent authorization target mismatch. Authorized target is ${short(permission.target)}, but this action calls ${short(call?.target)}.`
    );
  }

  const value = parseBigIntValue(call?.value ?? "0");
  const maxValue = parseBigIntValue(permission.maxValueWei ?? "0");
  if (value > maxValue) {
    throw new Error(
      `Agent authorization value limit exceeded. This action needs ${weiToEth(value)} ETH, but the limit is ${weiToEth(maxValue)} ETH.`
    );
  }
}

function parseBigIntValue(value) {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0");
  return text.startsWith("0x") ? BigInt(text) : BigInt(text);
}

async function handleDirectCommand(message) {
  const queryKind = classifyQuery(message);
  if (queryKind === "balance") {
    await showBalances(message);
    return true;
  }
  if (queryKind === "history") {
    showExecutionHistorySummary();
    return true;
  }
  if (queryKind === "permission") {
    await showAgentPermission();
    return true;
  }

  const spotIntent = parseSpotIntent(message);
  if (spotIntent === false) {
    return true;
  }
  if (spotIntent) {
    await executePreparedIntent(spotIntent, "Parsed a spot buy/sell request. Preparing a Uniswap swap transaction...");
    return true;
  }

  return false;
}

function classifyQuery(message) {
  const text = message.toLowerCase();
  if (/\b(balance|asset|assets)\b/.test(text) || text.includes("余额") || text.includes("资产")) return "balance";
  if (/\b(history|records?|executions?)\b/.test(text) || text.includes("历史") || text.includes("记录")) return "history";
  if (/\b(permission|authorization|authorized)\b/.test(text) || text.includes("权限") || text.includes("授权")) return "permission";
  return null;
}

async function showBalances(message) {
  appendMessage("assistant", "Checking Sepolia balances...");
  const address = extractAddress(message) ?? el.ownerWallet.value;
  const tokens = extractRequestedTokens(message);
  const result = await api("/wallet/balances", {
    method: "POST",
    body: { address, tokens }
  });
  const lines = result.balances.map((balance) => `${balance.symbol}: ${balance.formatted}`);
  appendMessage("assistant", `Balances for ${short(result.address)} on Sepolia:\n${lines.join("\n")}`);
}

function showExecutionHistorySummary() {
  if (!state.history.length) {
    appendMessage("assistant", "No execution history yet.");
    return;
  }

  const lines = state.history.slice(0, 8).map((record, index) => {
    const ref = record.primaryTxHash ? short(record.primaryTxHash) : record.scheduledAt ? new Date(record.scheduledAt).toLocaleString() : "-";
    return `${index + 1}. ${record.type} ${displayStatus(record.status)} ${ref}`;
  });
  appendMessage("assistant", `Recent execution history:\n${lines.join("\n")}`);
}

async function showAgentPermission() {
  if (!/^0x[a-fA-F0-9]{40}$/.test(el.smartAccount.value)) {
    appendMessage("assistant", "Open Advanced Agent Wallet and enter a smart account address first.");
    return;
  }
  if (!ensurePlatformAgentLoaded()) {
    return;
  }

  appendMessage("assistant", "Checking current Smart Account permission for the platform Agent...");
  const permission = await api("/wallet/agent-permission", {
    method: "POST",
    body: {
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value
    }
  });
  const expires = permission.validUntil ? new Date(permission.validUntil * 1000).toLocaleString() : "-";
  appendMessage(
    "assistant",
    [
      `Agent permission for ${short(permission.agent)}:`,
      `Active: ${permission.active ? "yes" : "no"}`,
      `Target: ${short(permission.target)}`,
      `Max value: ${weiToEth(permission.maxValueWei)} ETH`,
      `Valid until: ${expires}`
    ].join("\n")
  );
}

async function executePreparedIntent(intent, intro) {
  appendMessage("assistant", intro);
  const forceOwnerFunding = isSmartAccountFundingIntent(intent);
  if (forceOwnerFunding) {
    appendMessage(
      "assistant",
      "Detected a funding transfer to your Agent smart account. I will use your connected EOA wallet for this funding transaction."
    );
  }
  if (el.executionMode.value === "agent" && !forceOwnerFunding) {
    await executeAgentIntentViaBackend(intent);
  } else {
    const prepared = await prepareOwnerExecution(intent);
    await submitPreparedWalletTransactions(prepared, "Spot transaction submitted");
  }
}

async function submitPreparedWalletTransactions(prepared, submittedLabel) {
  const preparedTransactions = Array.isArray(prepared.transactions) && prepared.transactions.length
    ? prepared.transactions
    : [
        {
          label: prepared.description,
          description: prepared.description,
          tx: prepared.tx
        }
      ];
  const transactions = [];

  for (const [index, item] of preparedTransactions.entries()) {
    appendMessage(
      "assistant",
      `Please review and sign transaction ${index + 1}/${preparedTransactions.length}: ${item.description ?? item.label ?? prepared.description}.`
    );
    const hash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [item.tx]
    });
    transactions.push({
      label: item.label ?? item.description ?? prepared.description,
      hash,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${hash}`
    });
  }

  const primaryTxHash = transactions.at(-1)?.hash;
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: prepared.kind,
    status: "PENDING",
    primaryTxHash,
    transactions,
    plan: prepared.plan
  };
  state.history.unshift(record);
  state.history = state.history.slice(0, 25);
  localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
  renderTxLinks(record.transactions);
  renderHistory();
  appendMessage("assistant", `${submittedLabel}. Primary transaction: ${short(primaryTxHash)}. Waiting for Sepolia confirmation...`);
  trackTransaction(record.id);
  window.alert(`Wallet transaction submitted.\n\nPrimary tx:\n${primaryTxHash}`);
}

function parseSpotIntent(message) {
  const text = message.trim();
  const buy = text.match(/\bbuy\s+([a-zA-Z0-9]{2,12}|0x[a-fA-F0-9]{40})\s+with\s+(\d+(?:\.\d+)?)\s+([a-zA-Z0-9]{2,12}|0x[a-fA-F0-9]{40})\b/i);
  if (buy) {
    return swapIntent({
      tokenIn: buy[3],
      tokenOut: buy[1],
      amountIn: buy[2]
    });
  }

  const sell = text.match(/\bsell\s+(\d+(?:\.\d+)?)\s+([a-zA-Z0-9]{2,12}|0x[a-fA-F0-9]{40})\s+(?:for|to)\s+([a-zA-Z0-9]{2,12}|0x[a-fA-F0-9]{40})\b/i);
  if (sell) {
    return swapIntent({
      tokenIn: sell[2],
      tokenOut: sell[3],
      amountIn: sell[1]
    });
  }

  if (/\b(buy|sell)\b/i.test(text)) {
    appendMessage("assistant", "For spot trading, include an amount. Try: buy USDC with 0.0005 ETH, or sell 1 USDC for ETH.");
    return false;
  }

  return null;
}

function swapIntent({ tokenIn, tokenOut, amountIn }) {
  return {
    intentType: "swap",
    userId: el.userId.value,
    agentId: el.agentId.value,
    smartAccount: el.smartAccount.value || el.ownerWallet.value,
    tokenIn: normalizeTokenSymbol(tokenIn),
    tokenOut: normalizeTokenSymbol(tokenOut),
    amountIn: String(amountIn),
    slippageBps: 50,
    deadlineMinutes: 20
  };
}

function extractRequestedTokens(message) {
  const tokens = new Set();
  for (const token of KNOWN_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
      tokens.add(token);
    }
  }
  const addresses = message.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  for (const address of addresses.slice(1)) {
    tokens.add(address);
  }
  return [...tokens];
}

function extractAddress(message) {
  return (message.match(/0x[a-fA-F0-9]{40}/) ?? [null])[0];
}

function normalizeTokenSymbol(value) {
  const text = String(value);
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : text.toUpperCase();
}

function shouldScheduleIntent(intent, message = "") {
  if (intent.intentType !== "scheduled") return false;
  if (!isExplicitScheduleRequest(intent, message)) return false;
  if (!intent.runAt) return false;
  return new Date(intent.runAt).getTime() > Date.now();
}

function hasActionWorkflow(intent) {
  return Array.isArray(intent.payload?.actions) && intent.payload.actions.length > 0;
}

function isExplicitScheduleRequest(intent, message) {
  if (intent.taskType === "repeated") return true;
  const text = String(message ?? "").toLowerCase();
  return (
    /\b(schedule|scheduled|at\s+\d{1,2}(:\d{2})?|today|tomorrow|later|after\s+\d+|in\s+\d+\s*(minute|minutes|hour|hours))\b/.test(text) ||
    /定时|计划|稍后|今天|明天|分钟后|小时后/.test(text)
  );
}

async function executeImmediateWorkflow(intent, message = "") {
  const actions = scheduledActions({
    ...intent,
    sourceMessage: message,
    runAt: new Date().toISOString(),
    intervalSeconds: 0
  });
  if (!actions.length) {
    appendMessage("assistant", "I found multiple actions, but none of them can be executed yet.");
    return;
  }

  appendMessage(
    "assistant",
    `Parsed ${actions.length} immediate action(s). Because no schedule time was provided, I will execute them now.`
  );

  if (el.executionMode.value === "agent") {
    await executeImmediateAgentBatch(actions);
    return;
  }

  const records = [];
  for (const [index, action] of actions.entries()) {
    const prepared =
      el.executionMode.value === "agent"
        ? await prepareAgentExecution(action.intent)
        : await prepareOwnerExecution(action.intent);

    appendMessage(
      "assistant",
      `Please review and sign action ${index + 1}/${actions.length}: ${prepared.description}.`
    );
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.tx]
    });

    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: prepared.kind,
      status: "PENDING",
      primaryTxHash: txHash,
      transactions: [
        {
          label: prepared.description,
          hash: txHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
        }
      ],
      sequence: index + 1,
      sequenceTotal: actions.length
    };
    records.push(record);
    state.history.unshift(record);
    state.history = state.history.slice(0, 25);
    localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    renderHistory();
    trackTransaction(record.id);
  }

  renderTxLinks(records.flatMap((record) => record.transactions));
  appendMessage(
    "assistant",
    `Submitted ${records.length} immediate transaction(s). For gas-saving one-transaction batching, enable Advanced Agent Wallet and authorize the platform Agent.`
  );
}

async function executeImmediateAgentBatch(actions) {
  const intents = actions.map((action) => action.intent);
  await executeAgentBatchViaBackend(intents);
}

async function scheduleIntentWorkflow(intent) {
  const actions = scheduledActions(intent);
  if (!actions.length) {
    appendMessage("assistant", "This scheduled intent has no executable actions.");
    return;
  }

  const now = Date.now();
  const earliestRunAt = Math.min(...actions.map((action) => new Date(action.runAt).getTime()));
  if (earliestRunAt < now - 60_000) {
    appendMessage(
      "assistant",
      `That schedule time has already passed (${new Date(earliestRunAt).toLocaleString()}). Please choose a future time and send the intent again.`
    );
    return;
  }

  const signedWorkflow =
    el.executionMode.value === "owner" ? await signScheduledWorkflowIntent(intent) : null;
  if (!signedWorkflow && el.executionMode.value === "agent") {
    ensureAgentScheduleReady();
  }
  const workflowActions = signedWorkflow?.actions ?? actions;

  const records = workflowActions.map((action, index) => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    scheduledAt: action.runAt,
    type: `scheduled-${action.intent.intentType}`,
    status: signedWorkflow ? "AUTHORIZED" : "SCHEDULED",
    primaryTxHash: null,
    transactions: [],
    intent: action.intent,
    executionMode: el.executionMode.value,
    coordinatorManaged: Boolean(signedWorkflow) || el.executionMode.value === "agent",
    signedAuthorization: action.signedAuthorization ?? null,
    escrowAddress: signedWorkflow?.escrowAddress ?? null,
    batchGroupId: null,
    sequence: index + 1,
    sequenceTotal: workflowActions.length
  }));

  state.history.unshift(...records);
  state.history = state.history.slice(0, 25);
  localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
  renderHistory();
  if (signedWorkflow) {
    await registerCoordinatorJobs(records);
  } else if (el.executionMode.value === "agent") {
    await registerAgentCoordinatorJobs(records);
  } else {
    resumeScheduledJobs();
  }

  const scheduleText = records
    .map((record) => `${record.sequence}. ${record.type.replace("scheduled-", "")} at ${new Date(record.scheduledAt).toLocaleString()}`)
    .join("; ");
  appendMessage(
    "assistant",
    signedWorkflow
      ? `Authorized ${records.length} scheduled action(s) with EIP-712 signatures and escrow settlement: ${scheduleText}.`
      : `Scheduled ${records.length} agent action(s): ${scheduleText}. The authorized platform Agent will execute when each action is due.`
  );
}

async function registerCoordinatorJobs(records) {
  const jobs = records.map((record) => ({
    jobId: record.id,
    kind: "signed-call",
    batchGroupId: record.id,
    runAt: record.scheduledAt,
    status: "QUEUED",
    payload: {
      call: record.signedAuthorization.call,
      executionData: record.signedAuthorization.executionData,
      signature: record.signedAuthorization.signature
    }
  }));

  await api("/coordinator/jobs", {
    method: "POST",
    body: { jobs }
  });
  appendMessage("assistant", `Registered ${jobs.length} signed action(s) with the backend coordinator worker.`);
}

async function registerAgentCoordinatorJobs(records) {
  const batchGroupId = crypto.randomUUID();
  const jobs = records.map((record) => ({
    jobId: record.id,
    kind: "agent-call",
    batchGroupId,
    runAt: record.scheduledAt,
    status: "QUEUED",
    payload: {
      smartAccount: el.smartAccount.value,
      agent: el.agentAddress.value,
      intent: record.intent
    }
  }));

  await api("/coordinator/jobs", {
    method: "POST",
    body: { jobs }
  });
  appendMessage("assistant", `Registered ${jobs.length} agent action(s) with the backend coordinator worker.`);
}

function ensureAgentScheduleReady() {
  if (!ensureExecutionReady("agent")) {
    throw new Error("Connect an owner wallet and set an Agent smart account before scheduling agent execution.");
  }
  if (!isValidAddress(el.agentAddress.value)) {
    throw new Error("Platform Agent address is not loaded. Check backend Agent configuration.");
  }
}

async function signScheduledWorkflowIntent(intent) {
  const owner = el.ownerWallet.value;
  const prepared = await api("/settlement/prepare-scheduled-workflow", {
    method: "POST",
    body: {
      owner,
      intent
    }
  });

  appendMessage("assistant", "Please sign each scheduled action. These EIP-712 signatures do not spend gas.");
  const signedActions = [];
  for (const action of prepared.actions) {
    const dataHash = await keccak256(action.executionData);
    action.call.dataHash = dataHash;
    action.typedData.message.dataHash = dataHash;
    const signature = await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [owner, JSON.stringify(action.typedData)]
    });
    signedActions.push({
      runAt: action.runAt,
      intent: action.intent,
      signedAuthorization: {
        mode: "eip712-signed-call",
        escrowAddress: prepared.escrowAddress,
        call: action.call,
        executionData: action.executionData,
        typedData: action.typedData,
        signature
      }
    });
  }

  if (prepared.depositTx) {
    appendMessage("assistant", `Please fund escrow with ${weiToEth(prepared.escrowValueWei)} ETH for scheduled execution.`);
    const depositHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.depositTx]
    });
    const depositRecord = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: "escrow-deposit",
      status: "PENDING",
      primaryTxHash: depositHash,
      transactions: [
        {
          label: "Fund signed intent escrow",
          hash: depositHash,
          etherscanUrl: `https://sepolia.etherscan.io/tx/${depositHash}`
        }
      ]
    };
    state.history.unshift(depositRecord);
    localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    renderHistory();
    trackTransaction(depositRecord.id);
  }

  return {
    escrowAddress: prepared.escrowAddress,
    actions: signedActions
  };
}

async function keccak256(hexData) {
  if (window.ethereum) {
    return window.ethereum.request({
      method: "web3_sha3",
      params: [hexData]
    });
  }
  throw new Error("A wallet provider is required to hash signed intent calldata");
}

function scheduledActions(intent) {
  const baseRunAt = intent.runAt ? new Date(intent.runAt) : new Date();
  const intervalSeconds = Number.isFinite(Number(intent.intervalSeconds))
    ? Number(intent.intervalSeconds)
    : 60;

  if (Array.isArray(intent.payload?.actions) && intent.payload.actions.length > 0) {
    return intent.payload.actions
      .map((action, index) => {
        const runAt = new Date(baseRunAt.getTime() + index * intervalSeconds * 1000).toISOString();
        const executable = actionToIntent(action, intent, index);
        return executable ? { runAt, intent: executable } : null;
      })
      .filter(Boolean);
  }

  const executable = actionToIntent(intent.payload ?? {}, intent, 0);
  return executable ? [{ runAt: baseRunAt.toISOString(), intent: executable }] : [];
}

function actionToIntent(action, parentIntent, index = 0) {
  const type = inferActionType(action, parentIntent);

  if (type === "transfer") {
    return {
      intentType: "transfer",
      userId: parentIntent.userId,
      agentId: parentIntent.agentId,
      smartAccount: parentIntent.smartAccount,
      token: firstPresent(action.token, action.asset, action.tokenSymbol, parentIntent.token, "ETH"),
      amount: decimalString(firstPresent(
        action.amount,
        action.value,
        action.quantity,
        parentIntent.amount,
        extractAmountForAction(parentIntent.sourceMessage ?? "", "transfer", index)
      )),
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
        parentIntent.payload?.target,
        extractAddress(parentIntent.sourceMessage ?? "")
      )
    };
  }

  if (type === "swap") {
    return {
      intentType: "swap",
      userId: parentIntent.userId,
      agentId: parentIntent.agentId,
      smartAccount: parentIntent.smartAccount,
      tokenIn: firstPresent(action.tokenIn, action.fromToken, action.sellToken, parentIntent.tokenIn, "ETH"),
      tokenOut: firstPresent(action.tokenOut, action.toToken, action.buyToken, parentIntent.tokenOut, "USDC"),
      amountIn: decimalString(firstPresent(
        action.amountIn,
        action.amount,
        action.value,
        parentIntent.amountIn,
        extractAmountForAction(parentIntent.sourceMessage ?? "", "swap", index)
      )),
      slippageBps: firstPresent(action.slippageBps, parentIntent.slippageBps, 50),
      deadlineMinutes: firstPresent(action.deadlineMinutes, parentIntent.deadlineMinutes, 20)
    };
  }

  return null;
}

function inferActionType(action, parentIntent) {
  const explicit = String(action.type ?? action.intentType ?? "").toLowerCase();
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

function decimalString(value) {
  if (value === null || value === undefined) return value;
  return String(value);
}

function extractAmountForAction(message, type, index = 0) {
  const text = String(message ?? "");
  if (!text) return null;
  const keywordPattern = type === "swap"
    ? /\b(?:swap|buy|sell)\b[^0-9]*(\d+(?:\.\d+)?)/ig
    : /\b(?:send|transfer)\b[^0-9]*(\d+(?:\.\d+)?)/ig;
  const keywordMatches = [...text.matchAll(keywordPattern)].map((match) => match[1]);
  if (keywordMatches.length > 0) {
    return keywordMatches[Math.min(index, keywordMatches.length - 1)];
  }
  const amounts = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:ETH|WETH|USDC)?\b/ig)].map((match) => match[1]);
  return amounts[Math.min(index, amounts.length - 1)] ?? null;
}

function weiToEth(value) {
  const wei = BigInt(value ?? "0");
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function formatEthBalance(value) {
  const wei = typeof value === "string" && value.startsWith("0x") ? BigInt(value) : BigInt(value ?? "0");
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function ethToWeiHex(value) {
  return `0x${ethToWei(value).toString(16)}`;
}

function ethToWeiDecimal(value) {
  return ethToWei(value).toString();
}

function ethToWei(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new Error("Enter a valid ETH amount with up to 18 decimals.");
  }

  const [whole, fraction = ""] = text.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (wei <= 0n) {
    throw new Error("Funding amount must be greater than 0 ETH.");
  }
  return wei;
}

function resumeScheduledJobs() {
  state.history
    .filter((record) => record.executionMode !== "owner")
    .filter((record) => !record.coordinatorManaged)
    .filter((record) => SCHEDULED_STATUSES.has(normalizeStatus(record.status)) && record.intent && record.scheduledAt)
    .forEach((record) => scheduleRecordTimer(record));
}

function scheduleRecordTimer(record) {
  if (state.scheduleTimers.has(record.id)) return;

  const delayMs = Math.max(0, new Date(record.scheduledAt).getTime() - Date.now());
  state.scheduleTimers.add(record.id);
  window.setTimeout(() => {
    state.scheduleTimers.delete(record.id);
    executeScheduledRecord(record.id);
  }, delayMs);
}

async function executeScheduledRecord(recordId) {
  const record = state.history.find((item) => item.id === recordId);
  if (!record || !SCHEDULED_STATUSES.has(normalizeStatus(record.status))) return;
  if (record.coordinatorManaged) return;

  if (record.executionMode === "owner" && record.signedAuthorization) {
    updateRecordStatus(recordId, "READY_FOR_RELAYER");
    appendMessage(
      "assistant",
      `Signed intent is due: ${record.type.replace("scheduled-", "")}. Relayer is submitting the escrow execution transaction...`
    );
    try {
      const executed = await api("/settlement/execute-signed-call", {
        method: "POST",
        body: {
          signedCall: record.signedAuthorization.call,
          executionData: record.signedAuthorization.executionData,
          signature: record.signedAuthorization.signature
        }
      });
      updateRecord(recordId, {
        type: executed.kind,
        status: "PENDING",
        primaryTxHash: executed.primaryTxHash,
        transactions: executed.transactions
      });
      renderTxLinks(executed.transactions);
      appendMessage("assistant", `Relayer transaction submitted: ${short(executed.primaryTxHash)}.`);
      trackTransaction(recordId);
    } catch (error) {
      updateRecordStatus(recordId, "FAILED");
      appendMessage("assistant", `Relayer execution failed: ${error.message}`);
    }
    return;
  }

  if (!ensureExecutionReady(record.executionMode ?? "owner")) {
    updateRecordStatus(recordId, "WAITING_SIGNATURE");
    appendMessage("assistant", `Scheduled ${record.type.replace("scheduled-", "")} is due. Connect your wallet to sign it.`);
    return;
  }

  updateRecordStatus(recordId, "WAITING_SIGNATURE");
  appendMessage("assistant", `Scheduled ${record.type.replace("scheduled-", "")} is due. Please review and sign in your wallet.`);

  try {
    const prepared =
      record.executionMode === "agent"
        ? await prepareAgentExecution(record.intent)
        : await prepareOwnerExecution(record.intent);

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [prepared.tx]
    });

    const transactions = [
      {
        label: prepared.description,
        hash: txHash,
        etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`
      }
    ];
    updateRecord(recordId, {
      type: prepared.kind,
      status: "PENDING",
      primaryTxHash: txHash,
      transactions
    });
    renderTxLinks(transactions);
    appendMessage("assistant", `Scheduled transaction submitted: ${short(txHash)}. Waiting for Sepolia confirmation...`);
    trackTransaction(recordId);
  } catch (error) {
    updateRecordStatus(recordId, "FAILED");
    appendMessage("assistant", `Scheduled execution failed: ${error.message}`);
  }
}

function dueSignedBatch(record) {
  const now = Date.now();
  return state.history.filter((candidate) => {
    if (candidate.executionMode !== "owner" || !candidate.signedAuthorization) return false;
    if (!SCHEDULED_STATUSES.has(normalizeStatus(candidate.status))) return false;
    if (new Date(candidate.scheduledAt).getTime() > now) return false;
    if (record.batchGroupId && candidate.batchGroupId !== record.batchGroupId) return false;
    return true;
  });
}

async function executeSignedBatch(records) {
  for (const record of records) {
    updateRecordStatus(record.id, "READY_FOR_RELAYER");
  }
  appendMessage("assistant", `Relayer is submitting one batch transaction for ${records.length} due signed intents...`);

  try {
    const executed = await api("/settlement/execute-batch-signed-calls", {
      method: "POST",
      body: {
        calls: records.map((record) => record.signedAuthorization.call),
        executionData: records.map((record) => record.signedAuthorization.executionData),
        signatures: records.map((record) => record.signedAuthorization.signature)
      }
    });

    for (const record of records) {
      updateRecord(record.id, {
        type: executed.kind,
        status: "PENDING",
        primaryTxHash: executed.primaryTxHash,
        transactions: executed.transactions
      });
      trackTransaction(record.id);
    }
    renderTxLinks(executed.transactions);
    appendMessage("assistant", `Batch relayer transaction submitted: ${short(executed.primaryTxHash)}.`);
  } catch (error) {
    for (const record of records) {
      updateRecordStatus(record.id, "FAILED");
    }
    appendMessage("assistant", `Batch relayer execution failed: ${error.message}`);
  }
}

async function currentWalletAddress() {
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return accounts?.[0] ?? "";
}

function ensureWalletConnected() {
  return ensureExecutionReady(el.executionMode.value);
}

function ensureOwnerWalletConnected() {
  if (state.walletConnected && /^0x[a-fA-F0-9]{40}$/.test(el.ownerWallet.value)) {
    return true;
  }

  appendMessage("assistant", "Please connect your owner wallet first.");
  return false;
}

function ensureExecutionReady(mode) {
  const hasOwner = state.walletConnected && /^0x[a-fA-F0-9]{40}$/.test(el.ownerWallet.value);
  const hasSmartAccount = /^0x[a-fA-F0-9]{40}$/.test(el.smartAccount.value);
  const hasPlatformAgent = isValidAddress(el.agentAddress.value);

  if (mode === "owner" && hasOwner) {
    return true;
  }

  if (mode === "agent" && hasOwner && hasSmartAccount && hasPlatformAgent) {
    return true;
  }

  appendMessage(
    "assistant",
    mode === "agent"
      ? "Please connect an owner wallet, create a Smart Account, and wait for the platform Agent address to load before agent execution."
      : "Please connect an owner wallet before executing an intent."
  );
  return false;
}

function ensurePlatformAgentLoaded() {
  if (isValidAddress(el.agentAddress.value)) {
    return true;
  }
  appendMessage("assistant", "Platform Agent address is not loaded. Check that the backend is running and configured with AGENT_PRIVATE_KEY.");
  return false;
}

function isValidAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "").trim());
}

function updateFundPanelVisibility() {
  if (!el.agentControlsPanel) return;
  el.agentControlsPanel.classList.toggle("hidden", el.executionMode.value !== "agent");
  updateRevokePreview();
}

function updateRevokePreview() {
  const selected = selectedAuthorizationRecord();
  if (selected) {
    el.revokeTargetButton.disabled = isWildcardTarget(selected.target);
  } else {
    el.revokeTargetButton.disabled = true;
  }
}

function saveAuthorizationRecord(record) {
  const normalized = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    smartAccount: record.smartAccount,
    owner: record.owner,
    agent: record.agent,
    target: record.target,
    maxValueWei: String(record.maxValueWei),
    unlimited: Boolean(record.unlimited),
    validUntil: record.validUntil,
    txHash: record.txHash
  };
  state.authorizations = [
    normalized,
    ...state.authorizations.filter(
      (item) =>
        !(
          item.smartAccount?.toLowerCase() === normalized.smartAccount.toLowerCase() &&
          item.owner?.toLowerCase() === normalized.owner.toLowerCase() &&
          item.agent?.toLowerCase() === normalized.agent.toLowerCase() &&
          item.target?.toLowerCase() === normalized.target.toLowerCase()
        )
    )
  ].slice(0, 20);
  localStorage.setItem("aap.agentAuthorizations", JSON.stringify(state.authorizations));
  renderAuthorizationOptions();
}

function removeAuthorizationRecords(smartAccount, agent) {
  const normalizedSmart = smartAccount.toLowerCase();
  const normalizedAgent = agent.toLowerCase();
  state.authorizations = state.authorizations.filter(
    (item) =>
      item.smartAccount?.toLowerCase() !== normalizedSmart ||
      item.agent?.toLowerCase() !== normalizedAgent
  );
  localStorage.setItem("aap.agentAuthorizations", JSON.stringify(state.authorizations));
  renderAuthorizationOptions();
}

function removeAuthorizationRecord(id) {
  state.authorizations = state.authorizations.filter((item) => item.id !== id);
  localStorage.setItem("aap.agentAuthorizations", JSON.stringify(state.authorizations));
  renderAuthorizationOptions();
}

function renderAuthorizationOptions() {
  if (!el.revokeAuthorizationSelect) return;
  const owner = el.ownerWallet.value.trim().toLowerCase();
  const currentSmart = el.smartAccount.value.trim().toLowerCase();
  const currentAgent = el.agentAddress.value.trim().toLowerCase();

  if (!state.walletConnected || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    el.revokeAuthorizationSelect.innerHTML = `<option value="">Connect wallet to view authorizations</option>`;
    updateRevokePreview();
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(currentSmart)) {
    el.revokeAuthorizationSelect.innerHTML = `<option value="">Create or select a smart account first</option>`;
    updateRevokePreview();
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(currentAgent)) {
    el.revokeAuthorizationSelect.innerHTML = `<option value="">Platform Agent unavailable</option>`;
    updateRevokePreview();
    return;
  }
  const usable = currentAuthorizationRecords();
  if (!usable.length) {
    el.revokeAuthorizationSelect.innerHTML = `<option value="">No saved authorizations</option>`;
    updateRevokePreview();
    return;
  }

  el.revokeAuthorizationSelect.innerHTML = usable
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(short(item.target))} / ${escapeHtml(authorizationLimitLabel(item))}</option>`
    )
    .join("");
  updateRevokePreview();
}

function selectedAuthorizationRecord() {
  if (!state.walletConnected) return null;
  const id = el.revokeAuthorizationSelect?.value;
  return currentAuthorizationRecords().find((item) => item.id === id) ?? null;
}

function currentAuthorizationRecords() {
  const owner = el.ownerWallet.value.trim().toLowerCase();
  const currentSmart = el.smartAccount.value.trim().toLowerCase();
  const currentAgent = el.agentAddress.value.trim().toLowerCase();
  if (
    !/^0x[a-fA-F0-9]{40}$/.test(owner) ||
    !/^0x[a-fA-F0-9]{40}$/.test(currentSmart) ||
    !/^0x[a-fA-F0-9]{40}$/.test(currentAgent)
  ) {
    return [];
  }
  return state.authorizations.filter(
    (item) =>
      item.owner?.toLowerCase() === owner &&
      item.smartAccount?.toLowerCase() === currentSmart &&
      item.agent?.toLowerCase() === currentAgent
  );
}

function authorizationLimitLabel(record) {
  return record.unlimited ? "unlimited" : `${weiToEth(record.maxValueWei)} ETH`;
}

function isWildcardTarget(target) {
  return String(target ?? "").toLowerCase() === "0x0000000000000000000000000000000000000000";
}

async function syncDefaultSmartAccount() {
  if (!el.smartAccountStatus) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(el.ownerWallet.value)) {
    el.smartAccount.value = "";
    updateRevokePreview();
    renderAuthorizationOptions();
    el.smartAccountStatus.textContent = "Connect wallet to discover";
    el.createSmartAccountButton.disabled = true;
    el.createSmartAccountButton.textContent = "Create Smart Account";
    return;
  }

  try {
    el.smartAccountStatus.textContent = "Discovering...";
    el.createSmartAccountButton.disabled = true;
    const predicted = await predictDefaultSmartAccount();
    el.smartAccount.value = predicted.smartAccount;
    updateRevokePreview();
    renderAuthorizationOptions();
    const deployed = await isContractDeployed(predicted.smartAccount);
    el.smartAccountStatus.textContent = deployed ? "Created" : "Not created";
    el.createSmartAccountButton.disabled = deployed;
    el.createSmartAccountButton.textContent = deployed ? "Smart Account Ready" : "Create Smart Account";
    await refreshSmartAccountBalance();
  } catch {
    el.smartAccountStatus.textContent = "Unavailable";
    el.createSmartAccountButton.disabled = false;
    el.createSmartAccountButton.textContent = "Create Smart Account";
  }
}

async function predictDefaultSmartAccount() {
  return api("/wallet/predict-smart-account", {
    method: "POST",
    body: {
      owner: el.ownerWallet.value,
      factory: SMART_ACCOUNT_FACTORY,
      salt: DEFAULT_SMART_ACCOUNT_SALT
    }
  });
}

async function isContractDeployed(address) {
  if (!window.ethereum || !/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
  const code = await window.ethereum.request({
    method: "eth_getCode",
    params: [address, "latest"]
  });
  return Boolean(code && code !== "0x");
}

async function refreshSmartAccountBalance() {
  if (!el.smartAccountBalance) return;
  const address = el.smartAccount.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    el.smartAccountBalance.textContent = "Balance: -- ETH";
    return;
  }

  try {
    const balanceHex = window.ethereum
      ? await window.ethereum.request({ method: "eth_getBalance", params: [address, "latest"] })
      : (await api("/wallet/balances", { method: "POST", body: { address, tokens: [] } })).balances?.[0]?.raw;
    el.smartAccountBalance.textContent = `Balance: ${formatEthBalance(balanceHex)} ETH`;
  } catch {
    el.smartAccountBalance.textContent = "Balance: unavailable";
  }
}

function isSmartAccountFundingIntent(intent) {
  const smartAccount = el.smartAccount.value.trim().toLowerCase();
  const recipient = String(intent?.recipient ?? intent?.payload?.recipient ?? "").toLowerCase();
  const token = String(intent?.token ?? intent?.payload?.token ?? "ETH").toUpperCase();
  return (
    el.executionMode.value === "agent" &&
    String(intent?.intentType ?? "").toLowerCase() === "transfer" &&
    /^0x[a-f0-9]{40}$/.test(smartAccount) &&
    recipient === smartAccount &&
    token === "ETH"
  );
}

async function parseIntent(message) {
  return api("/ai/parse-intent", {
    method: "POST",
    body: {
      message,
      createIntent: false,
      context: context()
    }
  });
}

async function refresh() {
  try {
    const health = await api("/health");
    el.backendStatus.className = "status-dot online";
    el.backendLabel.textContent = `${health.service} online`;
  } catch {
    el.backendStatus.className = "status-dot offline";
    el.backendLabel.textContent = "Backend offline";
  }

  await syncPlatformAgent();
  await syncCoordinatorJobs();
  await checkPendingReceiptsOnce();
  await syncDefaultSmartAccount();
  await refreshSmartAccountBalance();
  await loadMetrics();
  renderHistory();
  resumePendingReceipts();
  resumeScheduledJobs();
}

async function syncPlatformAgent() {
  if (!el.agentAddress) return;
  try {
    const result = await api("/agent/status");
    const agentAddress = result.agentAddress ?? "";
    if (!isValidAddress(agentAddress)) {
      throw new Error("Invalid platform Agent address");
    }
    state.platformAgentAddress = agentAddress;
    el.agentAddress.value = agentAddress;
    el.agentAddress.readOnly = true;
    el.agentAddress.classList.add("readonly-input");
    if (el.platformAgentStatus) {
      el.platformAgentStatus.textContent = `Backend signer ${short(agentAddress)}`;
    }
  } catch {
    state.platformAgentAddress = "";
    el.agentAddress.value = "";
    el.agentAddress.readOnly = true;
    el.agentAddress.classList.add("readonly-input");
    if (el.platformAgentStatus) {
      el.platformAgentStatus.textContent = "Backend Agent unavailable";
    }
  } finally {
    renderAuthorizationOptions();
    updateRevokePreview();
  }
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;
  state.autoRefreshTimer = window.setInterval(() => {
    autoRefresh().catch(() => {});
  }, 6_000);
}

async function autoRefresh() {
  if (state.autoRefreshing) return;
  state.autoRefreshing = true;
  try {
    await syncCoordinatorJobs();
    await checkPendingReceiptsOnce();
    await refreshSmartAccountBalance();
    await loadMetrics();
    renderHistory();
  } finally {
    state.autoRefreshing = false;
  }
}

async function loadMetrics() {
  try {
    const result = await api("/metrics");
    state.metrics = result.metrics;
    renderMetrics();
  } catch {
    state.metrics = null;
    renderMetrics();
  }
}

async function syncCoordinatorJobs() {
  try {
    const result = await api("/coordinator/jobs");
    const byId = new Map((result.jobs ?? []).map((job) => [job.jobId, job]));
    let changed = false;
    state.history = state.history.map((record) => {
      const job = byId.get(record.id);
      if (!job) return record;
      changed = true;
      return {
        ...record,
        status: mapCoordinatorStatus(job.status),
        primaryTxHash: job.txHash ?? record.primaryTxHash,
        receipt: job.receipt ?? record.receipt
      };
    });
    if (changed) {
      localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
    }
  } catch {
    // The UI can still use local history if the coordinator endpoint is unavailable.
  }
}

function mapCoordinatorStatus(status) {
  if (status === "QUEUED") return "AUTHORIZED";
  if (status === "EXECUTING") return "READY_FOR_RELAYER";
  if (status === "SUBMITTED") return "PENDING";
  return status;
}

function renderHistory() {
  if (!state.history.length) {
    el.historyRows.innerHTML = `<tr><td colspan="4">No executions yet</td></tr>`;
    return;
  }

  el.historyRows.innerHTML = state.history
    .map(
      (record) => `
        <tr>
          <td>${new Date(record.createdAt).toLocaleString()}</td>
          <td>${escapeHtml(record.type)}</td>
          <td><span class="pill ${statusClass(record.status)}">${escapeHtml(displayStatus(record.status))}</span></td>
          <td>${renderHistoryLink(record)}</td>
        </tr>
      `
    )
    .join("");
}

function renderMetrics() {
  const metrics = mergeLocalBatchMetrics(state.metrics?.coordinator);
  const aggregation = state.metrics?.aggregation;
  if (!metrics) {
    el.metricsUpdated.textContent = "Metrics unavailable";
    el.metricsCards.innerHTML = metricCards([
      ["Jobs", "-", "Coordinator API unavailable"],
      ["Success", "-", "No live data"],
      ["Failure rate", "-", "No live data"],
      ["Gas saved", "-", "No live data"]
    ]);
    if (el.batchMetricRows) {
      el.batchMetricRows.innerHTML = "";
    }
    return;
  }

  el.metricsUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  el.metricsCards.innerHTML = metricCards([
    ["Total jobs", formatNumber(metrics.totalJobs), `${formatNumber(metrics.queuedJobs)} queued, ${formatNumber(metrics.submittedJobs)} pending confirmation`],
    ["Success", formatNumber(metrics.successfulJobs), `${formatNumber(metrics.failedJobs)} failed jobs`],
    ["Failure rate", formatPercent(metrics.failureRate), "Failed / terminal jobs"],
    ["Avg batch size", formatDecimal(metrics.averageBatchSize), `${formatNumber(metrics.totalBatchTransactions)} on-chain batch txs`],
    ["Throughput", `${formatThroughput(metrics.throughputPerMinute)}/min`, "Confirmed jobs"],
    ["Avg latency", formatDuration(metrics.averageLatencyMs), "Due time to confirmation"],
    ["No-batch gas", formatNumber(metrics.estimatedNonBatchedGas), "Estimated separate execution cost"],
    ["Batch gas saved", formatGasSaved(metrics), `${formatPercent(metrics.estimatedGasSavedPercent)} estimated saving`],
    ["Match rate", formatPercent(aggregation?.latestMatchRate ?? 0), aggregation?.latestPlanType ?? "No aggregation plan"],
    ["Matched volume", `$${formatDecimal(aggregation?.latestMatchedVolumeUsd ?? 0)}`, `${formatNumber(aggregation?.latestMatchedPairs ?? 0)} matched pair(s)`],
    ["External route", `$${formatDecimal(aggregation?.latestExternalRoutedVolumeUsd ?? 0)}`, `${formatNumber(aggregation?.totalPlans ?? 0)} plan(s) built`]
  ]);

  if (!el.batchMetricRows) {
    return;
  }

  const rows = metrics.batchTransactions ?? [];
  if (!rows.length) {
    el.batchMetricRows.innerHTML = "";
    return;
  }

  el.batchMetricRows.innerHTML = rows
    .map(
      (batch) => `
        <tr>
          <td>${formatNumber(batch.size)}</td>
          <td><span class="pill ${statusClass(batch.status)}">${escapeHtml(displayStatus(batch.status))}</span></td>
          <td>${formatNumber(batch.gasUsed)}</td>
          <td>${formatNumber(batch.estimatedNonBatchedGas)}</td>
        </tr>
      `
    )
    .join("");
}

function mergeLocalBatchMetrics(coordinatorMetrics) {
  if (!coordinatorMetrics) return null;
  const local = localBatchMetrics();
  if (local.totalJobs === 0) return coordinatorMetrics;

  const totalJobs = coordinatorMetrics.totalJobs + local.totalJobs;
  const successfulJobs = coordinatorMetrics.successfulJobs + local.successfulJobs;
  const failedJobs = coordinatorMetrics.failedJobs + local.failedJobs;
  const terminalJobs = successfulJobs + failedJobs;
  const batchTransactions = [
    ...(coordinatorMetrics.batchTransactions ?? []),
    ...local.batchTransactions
  ].sort((a, b) => b.size - a.size);
  const confirmedTxs = batchTransactions.filter((tx) => Number(tx.gasUsed) > 0);
  const estimatedNonBatchedGas =
    coordinatorMetrics.estimatedNonBatchedGas + local.estimatedNonBatchedGas;
  const actualBatchGas = coordinatorMetrics.actualBatchGas + local.actualBatchGas;
  const estimatedGasSaved = Math.max(0, estimatedNonBatchedGas - actualBatchGas);

  return {
    ...coordinatorMetrics,
    totalJobs,
    queuedJobs: coordinatorMetrics.queuedJobs + local.queuedJobs,
    submittedJobs: coordinatorMetrics.submittedJobs + local.submittedJobs,
    successfulJobs,
    failedJobs,
    failureRate: terminalJobs === 0 ? 0 : failedJobs / terminalJobs,
    totalBatchTransactions: coordinatorMetrics.totalBatchTransactions + local.totalBatchTransactions,
    averageBatchSize: averageNumber(batchTransactions.map((tx) => tx.size)),
    throughputPerMinute: averageNumber([
      coordinatorMetrics.throughputPerMinute,
      local.throughputPerMinute
    ].filter((value) => value > 0)),
    averageLatencyMs: averageNumber([
      coordinatorMetrics.averageLatencyMs,
      local.averageLatencyMs
    ].filter((value) => value > 0)),
    estimatedNonBatchedGas,
    actualBatchGas,
    estimatedGasSaved,
    estimatedGasSavedPercent:
      estimatedNonBatchedGas === 0 ? 0 : estimatedGasSaved / estimatedNonBatchedGas,
    batchTransactions: confirmedTxs.concat(batchTransactions.filter((tx) => Number(tx.gasUsed) === 0)).slice(0, 12)
  };
}

function localBatchMetrics() {
  const batchRecords = state.history.filter((record) => Number(record.batchSize ?? 0) > 1);
  const successful = batchRecords.filter((record) => normalizeStatus(record.status) === "SUCCESS");
  const failed = batchRecords.filter((record) => normalizeStatus(record.status) === "FAILED");
  const submitted = batchRecords.filter((record) => normalizeStatus(record.status) === "PENDING");
  const latencies = successful
    .map((record) => new Date(record.confirmedAt).getTime() - new Date(record.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  const batchTransactions = batchRecords.map((record) => {
    const gasUsed = parseGasValue(record.receipt?.gasUsed);
    const estimatedNonBatchedGas = Number(record.estimatedSeparateGas ?? Number(record.batchSize) * 120_000);
    return {
      txHash: record.primaryTxHash,
      size: Number(record.batchSize),
      status: normalizeStatus(record.status),
      gasUsed,
      estimatedNonBatchedGas,
      latencyMs: 0,
      jobIds: [record.id],
      source: "smart-account"
    };
  });
  const confirmed = batchTransactions.filter((tx) => tx.gasUsed > 0);

  return {
    totalJobs: batchRecords.reduce((sum, record) => sum + Number(record.batchSize), 0),
    queuedJobs: 0,
    submittedJobs: submitted.reduce((sum, record) => sum + Number(record.batchSize), 0),
    successfulJobs: successful.reduce((sum, record) => sum + Number(record.batchSize), 0),
    failedJobs: failed.reduce((sum, record) => sum + Number(record.batchSize), 0),
    totalBatchTransactions: batchRecords.length,
    throughputPerMinute: computeLocalThroughputPerMinute(successful),
    averageLatencyMs: averageNumber(latencies),
    estimatedNonBatchedGas: confirmed.reduce((sum, tx) => sum + tx.estimatedNonBatchedGas, 0),
    actualBatchGas: confirmed.reduce((sum, tx) => sum + tx.gasUsed, 0),
    batchTransactions
  };
}

function computeLocalThroughputPerMinute(records) {
  const jobs = records.reduce((sum, record) => sum + Number(record.batchSize ?? 1), 0);
  if (jobs === 0) return 0;
  const times = records
    .flatMap((record) => [record.createdAt, record.confirmedAt])
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (times.length < 2) return jobs;
  const windowMs = Math.max(...times) - Math.min(...times);
  return windowMs > 0 ? jobs / (windowMs / 60_000) : jobs;
}

function metricCards(items) {
  return items
    .map(
      ([label, value, detail]) => `
        <div class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>
      `
    )
    .join("");
}

function renderHistoryLink(record) {
  if (record.primaryTxHash) {
    return `<a href="https://sepolia.etherscan.io/tx/${escapeHtml(record.primaryTxHash)}" target="_blank" rel="noreferrer">${escapeHtml(short(record.primaryTxHash))}</a>`;
  }

  if (record.signedAuthorization?.signature) {
    return `<span class="muted-cell">signature ${escapeHtml(short(record.signedAuthorization.signature))}</span>`;
  }

  if (record.scheduledAt) {
    return `<span class="muted-cell">${escapeHtml(new Date(record.scheduledAt).toLocaleString())}</span>`;
  }

  return `<span class="muted-cell">-</span>`;
}

function resumePendingReceipts() {
  state.history
    .filter((record) => !FINAL_STATUSES.has(normalizeStatus(record.status)) && record.primaryTxHash)
    .forEach((record) => trackTransaction(record.id));
}

async function checkPendingReceiptsOnce() {
  const pending = state.history.filter((record) => {
    if (!record.primaryTxHash) return false;
    if (FINAL_STATUSES.has(normalizeStatus(record.status))) return false;
    if (state.receiptTimers.has(record.id)) return false;
    return true;
  });

  let changed = false;
  for (const record of pending) {
    const receipt = await getReceipt(record.primaryTxHash);
    if (!receipt) continue;
    const status = receipt.status === "0x1" ? "SUCCESS" : "FAILED";
    updateRecordStatus(record.id, status, receipt);
    changed = true;
  }

  if (changed) {
    renderHistory();
  }
}

async function trackTransaction(recordId) {
  if (state.receiptTimers.has(recordId)) return;
  const record = state.history.find((item) => item.id === recordId);
  if (!record?.primaryTxHash || FINAL_STATUSES.has(normalizeStatus(record.status))) return;

  updateRecordStatus(recordId, "PENDING");
  state.receiptTimers.add(recordId);

  try {
    const receipt = await waitForReceipt(record.primaryTxHash);
    const status = receipt?.status === "0x1" ? "SUCCESS" : "FAILED";
    updateRecordStatus(recordId, status, receipt);
    appendMessage(
      "assistant",
      status === "SUCCESS"
        ? `Transaction confirmed on Sepolia: ${short(record.primaryTxHash)}.`
        : `Transaction was mined but failed on Sepolia: ${short(record.primaryTxHash)}.`
    );
  } catch (error) {
    updateRecordStatus(recordId, "PENDING");
    appendMessage("assistant", `Still waiting for Sepolia confirmation: ${short(record.primaryTxHash)}.`);
  } finally {
    state.receiptTimers.delete(recordId);
  }
}

async function waitForReceipt(txHash, attempts = 30, delayMs = 4000) {
  for (let index = 0; index < attempts; index += 1) {
    const receipt = await getReceipt(txHash);
    if (receipt) return receipt;
    await delay(delayMs);
  }
  throw new Error("Timed out waiting for transaction receipt");
}

async function getReceipt(txHash) {
  try {
    const result = await api(`/wallet/transaction-receipt?hash=${encodeURIComponent(txHash)}`);
    return result.receipt;
  } catch {
    // Fall back to the injected wallet provider if the backend RPC is unavailable.
  }

  if (!window.ethereum) return null;
  return window.ethereum.request({
    method: "eth_getTransactionReceipt",
    params: [txHash]
  });
}

function updateRecordStatus(recordId, status, receipt = null) {
  updateRecord(recordId, {
    status,
    confirmedAt: FINAL_STATUSES.has(status) ? new Date().toISOString() : undefined,
    receipt: summarizeReceipt(receipt)
  });
}

function updateRecord(recordId, patch) {
  state.history = state.history.map((record) =>
    record.id === recordId
      ? {
          ...record,
          ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
        }
      : record
  );
  localStorage.setItem("aap.executionHistory", JSON.stringify(state.history));
  renderHistory();
  if (state.metrics) {
    renderMetrics();
  }
}

function summarizeReceipt(receipt) {
  if (!receipt) return null;
  return {
    transactionHash: receipt.transactionHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  };
}

function normalizeStatus(status) {
  return status === "SUBMITTED" ? "PENDING" : String(status ?? "PENDING").toUpperCase();
}

function displayStatus(status) {
  return normalizeStatus(status);
}

function statusClass(status) {
  const normalized = normalizeStatus(status).toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "failed") return "failed";
  if (normalized === "scheduled") return "scheduled";
  if (normalized === "authorized") return "authorized";
  if (normalized === "ready_for_relayer") return "ready";
  if (normalized === "waiting_signature") return "waiting";
  return "pending";
}

function formatNumber(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
}

function formatDecimal(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

function formatThroughput(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  if (numeric < 0.01) return "<0.01";
  return formatDecimal(numeric);
}

function formatPercent(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0%";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric * 100)}%`;
}

function formatDuration(value) {
  const ms = Number(value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${formatDecimal(ms / 1000)} s`;
  return `${formatDecimal(ms / 60_000)} min`;
}

function formatGasSaved(metrics) {
  if (Number(metrics.actualBatchGas ?? 0) <= 0) return "Awaiting receipts";
  return formatNumber(metrics.estimatedGasSaved);
}

function averageNumber(values) {
  const usable = values.map(Number).filter((value) => Number.isFinite(value));
  if (!usable.length) return 0;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function parseGasValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value);
  if (text.startsWith("0x")) return Number.parseInt(text, 16);
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function renderTxLinks(transactions) {
  // Transaction hashes live in Recent Results to keep the chat composer compact.
}

function appendMessage(role, text) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.innerHTML = `<strong>${role === "user" ? "You" : "Agent"}</strong><p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`;
  el.messages.appendChild(node);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function setBusy(isBusy, label = "Execute Intent") {
  el.sendIntentButton.disabled = isBusy;
  el.sendIntentButton.textContent = isBusy ? label : "Send";
}

async function api(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}

function context() {
  const now = new Date();
  return {
    userId: el.userId.value,
    agentId: el.agentId.value,
    smartAccount: el.smartAccount.value || el.ownerWallet.value,
    currentTimeIso: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    timezoneOffsetMinutes: -now.getTimezoneOffset()
  };
}

function short(value) {
  const text = String(value ?? "");
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
