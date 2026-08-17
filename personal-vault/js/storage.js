/*
 * storage.js
 * 모든 데이터는 브라우저의 localStorage(이 기기)에만 저장된다.
 * 서버 전송, 외부 네트워크 요청이 전혀 없다.
 */

const PVStorage = (() => {
  const KEY = "pv_vault_v1";

  // record: { saltB64, ivB64, cipherB64, updatedAt }
  function loadVaultRecord() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveVaultRecord(record) {
    localStorage.setItem(KEY, JSON.stringify(record));
  }

  function vaultExists() {
    return !!loadVaultRecord();
  }

  function clearVault() {
    localStorage.removeItem(KEY);
  }

  return { loadVaultRecord, saveVaultRecord, vaultExists, clearVault };
})();
