// src/services/secretStore.js
// Agent API key 等 secret 的加密存储后端（REQ-AGENT-001 AC2 / 签核决策 5：
// key 不落 settings.json 明文、不进日志）。
//
// 生产（Electron main）：src/main/main.js 在 app ready 后注入 safeStorage 后端
// （macOS Keychain / Windows DPAPI / Linux libsecret），key 以密文落 settings.json。
// 无 Electron 环境（纯 Node 单元测试 / headless）：回退内置 fake 后端——确定性
// 可逆混淆，仅保证「settings.json 无明文 key」契约，不做真实加密（与 tech-design
// 风险表「safeStorage 不可用则降级」一致）。
//
// ADR-009：本模块无顶层 env/磁盘/electron 读取；后端由调用方显式注入，绝不
// import electron（单元测试在无 Electron 环境直接 import，见 updates.js 同款约束）。

const FAKE_PREFIX = "opc-fake:v1:";

function createFakeBackend() {
  return {
    encrypt(plaintext) {
      return FAKE_PREFIX + Buffer.from(String(plaintext), "utf8").toString("base64");
    },
    decrypt(ciphertext) {
      if (typeof ciphertext !== "string" || !ciphertext.startsWith(FAKE_PREFIX)) {
        const err = new Error("E-SECRET-DECRYPT: unsupported ciphertext format");
        err.code = "E-SECRET-DECRYPT";
        throw err;
      }
      return Buffer.from(ciphertext.slice(FAKE_PREFIX.length), "base64").toString("utf8");
    }
  };
}

let backend = createFakeBackend();

// 注入加密后端（生产：Electron safeStorage；测试：可注入自定义 fake）。
export function setSecretBackend(custom) {
  backend = custom;
  return backend;
}

export function encryptSecret(plaintext) {
  return backend.encrypt(plaintext);
}

export function decryptSecret(ciphertext) {
  return backend.decrypt(ciphertext);
}
