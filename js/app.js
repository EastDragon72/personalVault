/*
 * app.js
 * 개인정보 보관함 - 메인 애플리케이션 로직
 *
 * 이 파일 하나로 화면 전환(첫 실행 / 로그인 / 목록 / 입력)과
 * 자동 잠금, 내보내기/가져오기 흐름을 모두 담당한다.
 * 서버 통신은 전혀 없으며 모든 데이터는 이 기기의 localStorage에만 저장된다.
 */

(() => {
  const AUTO_LOCK_MS = 10 * 60 * 1000; // 10분

  const app = document.getElementById("app");
  const importFileInput = document.getElementById("importFileInput");

  // ---- 메모리 상태 (잠기면 즉시 초기화된다) ----
  let screen = "loading";      // loading | setup | login | main | edit
  let vaultKey = null;         // CryptoKey (복호화된 상태에서만 존재)
  let saltB64 = null;
  let items = [];              // [{category, title, content}]
  let searchQuery = "";
  let editingIndex = null;     // null = 새 항목, 숫자 = 수정 중인 인덱스
  let editDraft = { category: "", title: "", content: "" };
  let editOriginalJSON = "";
  let loginError = "";
  let setupError = "";
  let importError = "";
  let pendingImportRecord = null;
  let autoLockTimer = null;
  let expandedCategories = new Set(); // 트리에서 펼쳐진 분류 이름들

  // ---------------- 아이콘 (작은 라인 아이콘) ----------------

  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2.4v-.2a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.56-1.03H6v-2.4h.2A1.7 1.7 0 0 0 7.76 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-1.7.06.06A1.7 1.7 0 0 0 11 6.08V6h2.4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06A1.7 1.7 0 0 0 17.66 10a1.7 1.7 0 0 0 1.56 1.03h.2v2.4h-.2A1.7 1.7 0 0 0 19.4 15z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  };

  // ---------------- 자동 잠금 ----------------

  function resetAutoLockTimer() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    if (screen === "main" || screen === "edit") {
      autoLockTimer = setTimeout(lockVault, AUTO_LOCK_MS);
    }
  }

  ["click", "keydown", "input", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, () => resetAutoLockTimer(), { passive: true });
  });

  function lockVault() {
    vaultKey = null;
    items = [];
    searchQuery = "";
    editingIndex = null;
    loginError = "";
    expandedCategories = new Set();
    screen = "login";
    render();
  }

  // ---------------- 저장 ----------------

  async function persistItems() {
    const { ivB64, cipherB64 } = await PVCrypto.encryptJSON(vaultKey, items);
    PVStorage.saveVaultRecord({
      saltB64,
      ivB64,
      cipherB64,
      updatedAt: new Date().toISOString()
    });
  }

  // ---------------- 화면 전환 ----------------

  function goMain() {
    screen = "main";
    editingIndex = null;
    render();
    resetAutoLockTimer();
  }

  function openNewItem() {
    editingIndex = null;
    editDraft = { category: "", title: "", content: "" };
    editOriginalJSON = JSON.stringify(editDraft);
    screen = "edit";
    render();
  }

  function openEditItem(idx) {
    editingIndex = idx;
    editDraft = { ...items[idx] };
    editOriginalJSON = JSON.stringify(editDraft);
    screen = "edit";
    render();
  }

  function isEditDirty() {
    return JSON.stringify(editDraft) !== editOriginalJSON;
  }

  function tryLeaveEdit() {
    if (isEditDirty()) {
      showModal(`
        <p>저장하지 않은 내용이 있습니다. 나가시겠습니까?</p>
        <div class="btn-row">
          <button class="btn" id="mCancel">취소</button>
          <button class="btn btn-danger" id="mLeave">나가기</button>
        </div>
      `, () => {
        document.getElementById("mCancel").onclick = closeModal;
        document.getElementById("mLeave").onclick = () => { closeModal(); goMain(); };
      });
    } else {
      goMain();
    }
  }

  // ---------------- 닫기 ----------------

  function closeApp() {
    showModal(`
      <p>개인정보 보관함을 닫습니다.<br>다시 열려면 이 창을 닫아주세요.</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="mOk">확인</button>
      </div>
    `, () => {
      document.getElementById("mOk").onclick = () => {
        closeModal();
        window.close();
      };
    });
  }

  // ---------------- 모달 ----------------

  function showModal(innerHTML, afterRender) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modalOverlay";
    overlay.innerHTML = `<div class="modal-box">${innerHTML}</div>`;
    document.body.appendChild(overlay);
    if (afterRender) afterRender();
  }

  function closeModal() {
    const el = document.getElementById("modalOverlay");
    if (el) el.remove();
  }

  // ---------------- 렌더링 ----------------

  function render() {
    if (screen === "setup") return renderSetup();
    if (screen === "login") return renderLogin();
    if (screen === "main") return renderMain();
    if (screen === "edit") return renderEdit();
  }

  function renderSetup() {
    app.innerHTML = `
      <div class="screen center">
        <div class="center-title">
          <h1>개인정보 보관함</h1>
          <p>처음 사용하시나요?<br>보관함을 보호할 비밀번호를 설정하세요.</p>
        </div>
        <label for="pw1">비밀번호</label>
        <input type="password" id="pw1" autocomplete="new-password">
        <label for="pw2">비밀번호 확인</label>
        <input type="password" id="pw2" autocomplete="new-password">
        <div class="error-msg" id="setupErr">${setupError}</div>
        <button class="btn btn-primary" id="createBtn">보관함 만들기</button>
        <button class="btn" id="closeBtn">닫기</button>
      </div>
    `;
    document.getElementById("createBtn").onclick = handleCreateVault;
    document.getElementById("closeBtn").onclick = closeApp;
    document.getElementById("pw2").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleCreateVault();
    });
  }

  async function handleCreateVault() {
    const pw1 = document.getElementById("pw1").value;
    const pw2 = document.getElementById("pw2").value;
    if (!pw1 || !pw2) {
      setupError = "비밀번호를 입력해주세요.";
      return renderSetup();
    }
    if (pw1 !== pw2) {
      setupError = "비밀번호가 일치하지 않습니다.";
      return renderSetup();
    }
    setupError = "";
    const { key, saltB64: newSalt } = await PVCrypto.deriveKeyForNewVault(pw1);
    vaultKey = key;
    saltB64 = newSalt;
    items = [];
    await persistItems();
    goMain();
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="screen center">
        <div class="center-title">
          <h1>개인정보 보관함</h1>
        </div>
        <label for="pwLogin">비밀번호</label>
        <input type="password" id="pwLogin" autocomplete="current-password">
        <div class="error-msg" id="loginErr">${loginError}</div>
        <button class="btn btn-primary" id="openBtn">열기</button>
        <button class="btn" id="closeBtnLogin">닫기</button>
      </div>
    `;
    document.getElementById("openBtn").onclick = handleLogin;
    document.getElementById("closeBtnLogin").onclick = closeApp;
    const pwEl = document.getElementById("pwLogin");
    pwEl.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
    pwEl.focus();
  }

  async function handleLogin() {
    const pw = document.getElementById("pwLogin").value;
    const record = PVStorage.loadVaultRecord();
    if (!pw || !record) {
      loginError = "비밀번호를 입력해주세요.";
      return renderLogin();
    }
    try {
      const key = await PVCrypto.deriveKeyFromSalt(pw, record.saltB64);
      const decrypted = await PVCrypto.decryptJSON(key, record.ivB64, record.cipherB64);
      vaultKey = key;
      saltB64 = record.saltB64;
      items = decrypted;
      loginError = "";
      goMain();
    } catch (e) {
      loginError = "비밀번호가 올바르지 않습니다.";
      renderLogin();
    }
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (item.category || "").toLowerCase().includes(s) ||
      (item.title || "").toLowerCase().includes(s) ||
      (item.content || "").toLowerCase().includes(s)
    );
  }

  // 분류별로 묶어서 트리 구조를 만든다.
  function buildTree(query) {
    const withIdx = items.map((it, idx) => ({ ...it, _idx: idx }));
    const filtered = query ? withIdx.filter((it) => matchesSearch(it, query)) : withIdx;

    const groups = new Map(); // categoryName -> [items]
    filtered.forEach((it) => {
      const cat = (it.category || "").trim() || "미분류";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(it);
    });

    const categoryNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "ko"));
    return categoryNames.map((cat) => ({
      category: cat,
      items: groups.get(cat).sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"))
    }));
  }

  function toggleCategory(cat) {
    if (expandedCategories.has(cat)) {
      expandedCategories.delete(cat);
    } else {
      expandedCategories.add(cat);
    }
    renderMain();
  }

  function renderMain() {
    const isSearching = !!searchQuery;
    const tree = buildTree(searchQuery);

    // 검색 중에는 결과가 있는 분류를 자동으로 펼쳐서 보여준다.
    const isExpanded = (cat) => (isSearching ? true : expandedCategories.has(cat));

    let treeHTML;
    if (!tree.length) {
      treeHTML = `<div class="empty-state">${items.length ? "검색 결과가 없습니다." : "저장된 항목이 없습니다.<br>오른쪽 위 ＋ 버튼으로 추가해보세요."}</div>`;
    } else {
      treeHTML = tree.map((group) => {
        const open = isExpanded(group.category);
        const itemsHTML = open
          ? group.items.map((it) => `
              <div class="tree-item" data-idx="${it._idx}">
                <span class="ti-title">${escapeHTML(it.title || "(제목 없음)")}</span>
                <span class="ti-preview">${escapeHTML(firstLines(it.content))}</span>
              </div>
            `).join("")
          : "";
        return `
          <div class="tree-category">
            <div class="tree-cat-header" data-cat="${escapeAttr(group.category)}">
              <span class="chevron ${open ? "open" : ""}">${ICONS.chevronRight}</span>
              ${ICONS.folder}
              <span class="cat-name">${escapeHTML(group.category)}</span>
              <span class="cat-count">${group.items.length}</span>
            </div>
            <div class="tree-items">${itemsHTML}</div>
          </div>
        `;
      }).join("");
    }

    app.innerHTML = `
      <div class="topbar">
        <div class="side"></div>
        <h1>개인정보 보관함</h1>
        <div class="side" style="justify-content:flex-end">
          <button class="icon-round" id="closeBtnMain" title="닫기">${ICONS.close}</button>
        </div>
      </div>
      <div class="search-wrap">
        <input type="text" id="searchInput" placeholder="분류, 제목, 내용 검색" value="${escapeAttr(searchQuery)}">
      </div>
      <div class="icon-toolbar">
        <button class="icon-round primary" id="newItemBtn" title="새 항목">${ICONS.plus}</button>
        <button class="icon-round" id="exportBtn" title="내보내기">${ICONS.download}</button>
        <button class="icon-round" id="importBtn" title="가져오기">${ICONS.upload}</button>
        <button class="icon-round" id="lockBtn" title="잠금">${ICONS.lock}</button>
      </div>
      <div class="list" id="listWrap">${treeHTML}</div>
    `;

    document.getElementById("closeBtnMain").onclick = closeApp;
    document.getElementById("newItemBtn").onclick = openNewItem;
    document.getElementById("exportBtn").onclick = handleExport;
    document.getElementById("importBtn").onclick = () => importFileInput.click();
    document.getElementById("settingsBtn").onclick = showSettings;
    document.getElementById("lockBtn").onclick = lockVault;

    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      renderMain();
      const el = document.getElementById("searchInput");
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });

    document.querySelectorAll(".tree-cat-header").forEach((header) => {
      header.onclick = () => toggleCategory(header.dataset.cat);
    });
    document.querySelectorAll(".tree-item").forEach((row) => {
      row.onclick = () => openEditItem(parseInt(row.dataset.idx, 10));
    });
  }

  function renderEdit() {
    const isNew = editingIndex === null;
    app.innerHTML = `
      <div class="topbar">
        <div class="side">
          <button class="icon-round" id="backBtn" title="뒤로가기">${ICONS.arrowLeft}</button>
        </div>
        <h1>${isNew ? "새 항목" : "항목 수정"}</h1>
        <div class="side" style="justify-content:flex-end">
          <button class="icon-round" id="closeBtnEdit" title="닫기">${ICONS.close}</button>
        </div>
      </div>
      <div class="screen">
        <label for="fCategory">분류</label>
        <input type="text" id="fCategory" value="${escapeAttr(editDraft.category)}" placeholder="예: 금융, 쇼핑, 사이트, 자동차...">
        <label for="fTitle">제목</label>
        <input type="text" id="fTitle" value="${escapeAttr(editDraft.title)}" placeholder="예: 국민은행, 쿠팡...">
        <label for="fContent">내용</label>
        <textarea id="fContent" placeholder="아이디, 비밀번호, 메모 등 자유롭게 입력">${escapeHTML(editDraft.content)}</textarea>

        <button class="btn btn-primary" id="saveBtn">저장</button>
        <button class="btn" id="cancelBtn">취소</button>
        ${isNew ? "" : `<button class="btn btn-danger" id="deleteBtn">삭제</button>`}
      </div>
    `;

    document.getElementById("backBtn").onclick = tryLeaveEdit;
    document.getElementById("closeBtnEdit").onclick = closeApp;
    document.getElementById("cancelBtn").onclick = tryLeaveEdit;

    const fCategory = document.getElementById("fCategory");
    const fTitle = document.getElementById("fTitle");
    const fContent = document.getElementById("fContent");
    fCategory.oninput = () => (editDraft.category = fCategory.value);
    fTitle.oninput = () => (editDraft.title = fTitle.value);
    fContent.oninput = () => (editDraft.content = fContent.value);

    document.getElementById("saveBtn").onclick = handleSaveItem;

    if (!isNew) {
      document.getElementById("deleteBtn").onclick = handleDeleteItem;
    }
  }

  async function handleSaveItem() {
    const draft = {
      category: editDraft.category.trim(),
      title: editDraft.title.trim(),
      content: editDraft.content
    };
    if (editingIndex === null) {
      items.push(draft);
    } else {
      items[editingIndex] = draft;
    }
    await persistItems();
    goMain();
  }

  function handleDeleteItem() {
    showModal(`
      <p>이 항목을 삭제할까요?</p>
      <div class="btn-row">
        <button class="btn" id="mCancel">취소</button>
        <button class="btn btn-danger" id="mDelete">삭제</button>
      </div>
    `, () => {
      document.getElementById("mCancel").onclick = closeModal;
      document.getElementById("mDelete").onclick = async () => {
        items.splice(editingIndex, 1);
        closeModal();
        await persistItems();
        goMain();
      };
    });
  }

  // ---------------- 설정 / 비밀번호 변경 ----------------

  function showSettings() {
    showModal(`
      <h2 style="margin-top:0">설정</h2>
      <button class="btn btn-primary" id="changePwBtn">비밀번호 변경</button>
      <button class="btn" id="mClose">닫기</button>
    `, () => {
      document.getElementById("changePwBtn").onclick = showChangePassword;
      document.getElementById("mClose").onclick = closeModal;
    });
  }

  function showChangePassword() {
    closeModal();
    showModal(`
      <h2 style="margin-top:0">비밀번호 변경</h2>
      <label for="currentPw">현재 비밀번호</label>
      <input type="password" id="currentPw" autocomplete="current-password">
      <label for="newPw">새 비밀번호</label>
      <input type="password" id="newPw" autocomplete="new-password">
      <label for="newPw2">새 비밀번호 확인</label>
      <input type="password" id="newPw2" autocomplete="new-password">
      <div class="error-msg" id="changePwErr"></div>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn" id="changePwCancel">취소</button>
        <button class="btn btn-primary" id="changePwConfirm">변경</button>
      </div>
    `, () => {
      document.getElementById("changePwCancel").onclick = closeModal;
      document.getElementById("changePwConfirm").onclick = handleChangePassword;
      document.getElementById("currentPw").focus();
      document.querySelectorAll("#modalOverlay input").forEach(el => {
        el.addEventListener("keydown", e => { if (e.key === "Enter") handleChangePassword(); });
      });
    });
  }

  async function handleChangePassword() {
    const currentPw = document.getElementById("currentPw").value;
    const newPw = document.getElementById("newPw").value;
    const newPw2 = document.getElementById("newPw2").value;
    const err = document.getElementById("changePwErr");
    if (!currentPw || !newPw || !newPw2) {
      err.textContent = "모든 비밀번호를 입력해주세요.";
      return;
    }
    if (newPw !== newPw2) {
      err.textContent = "새 비밀번호가 일치하지 않습니다.";
      return;
    }
    if (newPw.length < 4) {
      err.textContent = "새 비밀번호는 4자 이상 입력해주세요.";
      return;
    }

    const record = PVStorage.loadVaultRecord();
    if (!record) {
      err.textContent = "보관함 정보를 찾을 수 없습니다.";
      return;
    }

    try {
      // 현재 비밀번호가 맞는지 기존 데이터를 복호화해서 확인합니다.
      const currentKey = await PVCrypto.deriveKeyFromSalt(currentPw, record.saltB64);
      const decrypted = await PVCrypto.decryptJSON(currentKey, record.ivB64, record.cipherB64);

      // 새 비밀번호용 새 salt와 키를 생성하고 데이터를 다시 암호화합니다.
      const { key: newKey, saltB64: newSalt } = await PVCrypto.deriveKeyForNewVault(newPw);
      const { ivB64: newIv, cipherB64: newCipher } = await PVCrypto.encryptJSON(newKey, decrypted);

      PVStorage.saveVaultRecord({
        saltB64: newSalt,
        ivB64: newIv,
        cipherB64: newCipher,
        updatedAt: new Date().toISOString()
      });

      vaultKey = newKey;
      saltB64 = newSalt;
      items = decrypted;
      closeModal();
      showModal(`
        <p><strong>비밀번호가 변경되었습니다.</strong><br>다음부터 새 비밀번호를 사용하세요.</p>
        <div class="btn-row"><button class="btn btn-primary" id="pwDone">확인</button></div>
      `, () => { document.getElementById("pwDone").onclick = closeModal; });
    } catch (e) {
      err.textContent = "현재 비밀번호가 올바르지 않습니다.";
    }
  }

  // ---------------- 내보내기 / 가져오기 ----------------

  function handleExport() {
    const record = PVStorage.loadVaultRecord();
    if (!record) return;
    const backup = {
      app: "personal-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      saltB64: record.saltB64,
      ivB64: record.ivB64,
      cipherB64: record.cipherB64
    };
    const blob = new Blob([JSON.stringify(backup)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `개인정보보관함_${dateStr}.pvb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  importFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    importFileInput.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.saltB64 || !parsed.ivB64 || !parsed.cipherB64) {
        throw new Error("invalid file");
      }
      pendingImportRecord = parsed;
      importError = "";
      showImportPasswordModal();
    } catch (err) {
      showModal(`
        <p>백업 파일 또는 비밀번호가 올바르지 않습니다.</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="mOk">확인</button>
        </div>
      `, () => { document.getElementById("mOk").onclick = closeModal; });
    }
  });

  function showImportPasswordModal() {
    showModal(`
      <p>가져올 백업 파일의 비밀번호를 입력하세요.<br>
      확인 시 현재 보관함 데이터가 백업 내용으로 대체됩니다.</p>
      <input type="password" id="importPw" autocomplete="off">
      <div class="error-msg" id="importErr">${importError}</div>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn" id="mCancel">취소</button>
        <button class="btn btn-primary" id="mImport">가져오기</button>
      </div>
    `, () => {
      document.getElementById("mCancel").onclick = () => { pendingImportRecord = null; closeModal(); };
      document.getElementById("mImport").onclick = handleConfirmImport;
      const pwEl = document.getElementById("importPw");
      pwEl.focus();
      pwEl.addEventListener("keydown", (e) => { if (e.key === "Enter") handleConfirmImport(); });
    });
  }

  async function handleConfirmImport() {
    const pw = document.getElementById("importPw").value;
    try {
      const key = await PVCrypto.deriveKeyFromSalt(pw, pendingImportRecord.saltB64);
      const decrypted = await PVCrypto.decryptJSON(key, pendingImportRecord.ivB64, pendingImportRecord.cipherB64);
      // 성공: 저장소를 백업 내용으로 교체
      PVStorage.saveVaultRecord({
        saltB64: pendingImportRecord.saltB64,
        ivB64: pendingImportRecord.ivB64,
        cipherB64: pendingImportRecord.cipherB64,
        updatedAt: new Date().toISOString()
      });
      vaultKey = key;
      saltB64 = pendingImportRecord.saltB64;
      items = decrypted;
      pendingImportRecord = null;
      closeModal();
      goMain();
    } catch (err) {
      importError = "백업 파일 또는 비밀번호가 올바르지 않습니다.";
      closeModal();
      showImportPasswordModal();
    }
  }

  // ---------------- 유틸 ----------------

  function firstLines(content) {
    if (!content) return "";
    return content.split("\n")[0];
  }

  function escapeHTML(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, "&quot;");
  }

  // ---------------- 시작 ----------------

  function init() {
    screen = PVStorage.vaultExists() ? "login" : "setup";
    render();
  }

  init();
})();
