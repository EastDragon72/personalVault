/*
 * crypto.js
 * 표준 웹 암호화 API(Web Crypto API)만 사용한다.
 * - 키 유도: PBKDF2 (SHA-256, 150000회 반복)
 * - 암호화: AES-GCM 256bit
 * 자체 암호 알고리즘을 새로 만들지 않는다.
 */

const PVCrypto = (() => {

  const PBKDF2_ITERATIONS = 150000;

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function randomBytes(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
  }

  async function deriveKey(password, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // saltB64가 없으면 새 salt를 생성해서 { key, saltB64 } 반환
  async function deriveKeyForNewVault(password) {
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt);
    return { key, saltB64: bufToBase64(salt) };
  }

  async function deriveKeyFromSalt(password, saltB64) {
    const salt = new Uint8Array(base64ToBuf(saltB64));
    return deriveKey(password, salt);
  }

  async function encryptJSON(key, obj) {
    const iv = randomBytes(12);
    const enc = new TextEncoder();
    const plaintext = enc.encode(JSON.stringify(obj));
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    return {
      ivB64: bufToBase64(iv),
      cipherB64: bufToBase64(cipherBuf)
    };
  }

  // 복호화 실패(비밀번호 오류 / 손상된 파일) 시 예외를 던진다.
  async function decryptJSON(key, ivB64, cipherB64) {
    const iv = new Uint8Array(base64ToBuf(ivB64));
    const cipherBuf = base64ToBuf(cipherB64);
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBuf
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(plainBuf));
  }

  return {
    deriveKeyForNewVault,
    deriveKeyFromSalt,
    encryptJSON,
    decryptJSON
  };
})();
