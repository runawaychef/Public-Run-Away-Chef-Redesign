// ==================== БАНК: ПОСТУПЛЕНИЯ ====================
// Экран «Поступления»: платежи из банка, их сортировка и зачёт на счета (функция bank-sync).
// Зависит от: db, currentOrgId, customers, t(), escapeHtml, formatMoney, formatDateDMY, showInfo, showConfirm,
//             showLoading, hideLoading, closeModal, loadAllData, _formatDocNumber (documents.js).
// Права и тариф проверяет сервер; здесь только показ. Секретов в браузере нет.

const bankState = {
    conn: null,        // строка bank_connections или null
    role: null,        // роль в организации
    protectedOrg: false,
    tab: 'review',
    rows: [],
    counts: { review: 0, other: 0 },
    sheet: null,       // состояние окна «Другой счёт»
};

// ---------- обмен с сервером ----------
async function bankCall(body) {
    const { data, error } = await db.functions.invoke('bank-sync', { body: { org_id: currentOrgId, ...body } });
    if (error) {
        let code = 'ERROR';
        try { const j = await error.context.json(); if (j && j.error) code = j.error; } catch (e) { /* без тела */ }
        return { ok: false, error: code };
    }
    return data || { ok: false, error: 'ERROR' };
}

function bankErrText(code) {
    const map = { PLAN_REQUIRED: 'bank_err_plan', FORBIDDEN: 'bank_err_forbidden', NO_AUTH: 'bank_err_forbidden',
        ALREADY_APPLIED: 'bank_err_already', NO_MANUAL_PAYMENT: 'bank_err_nomanual', AMBIGUOUS: 'bank_err_nomanual', LINK_FAILED: 'bank_err_nomanual', NOT_APPLIED: 'bank_err_already', OVER_REMAINING: 'bank_err_over', OVER_TX_AMOUNT: 'bank_err_over' };
    return t(map[code] || 'bank_err_generic');
}

// ---------- состояние и кнопка в «Заказах» ----------
async function bankRefreshState() {
    try {
        const { data: au } = await db.auth.getUser();
        const uid = au && au.user ? au.user.id : null;
        if (!uid || !currentOrgId) { bankState.fresh = true; return bankApplyButton(); }
        const [m, c] = await Promise.all([
            db.from('memberships').select('role').eq('org_id', currentOrgId).eq('user_id', uid).maybeSingle(),
            db.from('bank_connections').select('id, bank_name, account_iban, valid_until, status, last_sync_at, last_error, psu_type, auto_apply').eq('org_id', currentOrgId).order('created_at', { ascending: false }).limit(1),
        ]);
        bankState.role = m && m.data ? m.data.role : null;
        bankState.conn = c && c.data && c.data[0] ? c.data[0] : null;
        if (bankState.conn && ['owner', 'manager'].includes(bankState.role)) {
            const { count } = await db.from('bank_transactions').select('id', { count: 'exact', head: true })
                .eq('org_id', currentOrgId).in('match_status', ['new', 'needs_review']);
            bankState.counts.review = count || 0;
        }
        bankState.fresh = true;
    } catch (e) {
        console.error('Банк: не удалось обновить состояние', e);
    }
    bankApplyButton();
}

function bankApplyButton() {
    // До первого ответа сервера берём запомненное состояние, чтобы кнопка появлялась сразу
    let show, n, until = null, owner = false;
    if (bankState.fresh) {
        show = !!bankState.conn && bankState.conn.status !== 'revoked' && ['owner', 'manager'].includes(bankState.role);
        n = bankState.counts.review;
        until = show && bankState.conn.valid_until ? bankState.conn.valid_until : null;
        owner = bankState.role === 'owner';
        try { localStorage.setItem('bank_ui_cache', JSON.stringify({ show, n, until, owner })); } catch (e) { /* без хранилища */ }
    } else {
        try { const c = JSON.parse(localStorage.getItem('bank_ui_cache') || 'null'); show = !!(c && c.show); n = (c && c.n) || 0; until = c && c.until || null; owner = !!(c && c.owner); } catch (e) { show = false; n = 0; }
    }
    const pill = document.getElementById('ordersBankWrap');
    if (pill) pill.classList.toggle('hidden', !show);
    const badge = document.getElementById('ordersBankBadge');
    if (badge) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.toggle('hidden', !(show && n > 0));
    }
    // Срок доступа: точка на кнопке и плашка на экране «Заказы» за 7 дней и меньше
    const left = show && until ? Math.ceil((new Date(until).getTime() - Date.now()) / 86400000) : null;
    const warn = left != null && left <= 7 && (bankState.fresh ? bankPlanOk() : true);
    const dot = document.getElementById('ordersBankDot');
    if (dot) { dot.classList.toggle('hidden', !warn); dot.style.background = left != null && left <= 0 ? '#c0654f' : '#d9a441'; }
    bankRenderNotice(warn && !!bankState.fresh, left, owner); // текст нужен переводам: только после ответа сервера
}
function bankTodayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function bankRenderNotice(warn, left, owner) {
    const box = document.getElementById('ordersBankNotice');
    if (!box) return;
    let hidden = false;
    try { hidden = localStorage.getItem('bank_notice_hidden') === bankTodayKey(); } catch (e) { /* без хранилища */ }
    if (!warn || hidden) { box.innerHTML = ''; return; }
    const expired = left <= 0;
    const msg = expired ? t('bank_notice_expired') : t('bank_expiring').replace('{n}', left);
    const stripe = expired ? '#c0654f' : '#d9a441';
    const action = owner
        ? `<button type="button" onclick="openBankSettings()" style="${_bk.btn1} margin-top:8px;">${escapeHtml(t('bank_notice_extend'))}</button>`
        : `<div style="font-size:12px; color:#6b675d; margin-top:2px;">${escapeHtml(t('bank_notice_ask_owner'))}</div>`;
    box.innerHTML = bankCard(stripe, `<div style="display:flex; gap:8px; justify-content:space-between;"><div style="font-size:13px; font-weight:700; color:#3c3a34; line-height:1.35;">${escapeHtml(msg)}</div><button type="button" aria-label="×" onclick="bankHideNotice()" style="border:0; background:transparent; color:#a29c8c; font-size:18px; line-height:1; padding:0 2px;">×</button></div>${action}`, 8);
}
function bankHideNotice() {
    try { localStorage.setItem('bank_notice_hidden', bankTodayKey()); } catch (e) { /* без хранилища */ }
    const box = document.getElementById('ordersBankNotice');
    if (box) box.innerHTML = '';
}

// ---------- раздел ----------
async function openBankSection() {
    if (!bankState.conn || bankState.conn.status === 'revoked') return;
    bankState.tab = bankState.counts.review > 0 ? 'review' : 'other';
    closeModal();
    document.getElementById('bankModal').style.display = 'flex';
    if (typeof positionOrdersViewToggle === 'function') positionOrdersViewToggle();
    await bankLoadTab();
}

function closeBankSection() {
    document.getElementById('bankModal').style.display = 'none';
    if (typeof positionOrdersViewToggle === 'function') positionOrdersViewToggle();
    bankRefreshState();
}

async function bankSetTab(tab) {
    bankState.tab = tab;
    await bankLoadTab();
}

async function bankLoadTab() {
    const body = document.getElementById('bankBody');
    if (!body) return;
    bankRender(true);
    const r = await bankCall({ action: 'list', tab: bankState.tab });
    if (!r.ok) {
        body.innerHTML = `<p style="font-size:13px; color:#a3493d; padding:8px 4px;">${escapeHtml(bankErrText(r.error))}</p>`;
        return;
    }
    bankState.rows = r.rows || [];
    bankState.counts = r.counts || bankState.counts;
    bankApplyButton();
    bankRender(false);
}

// ---------- отрисовка ----------
function bankFmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const today = new Date();
    const hm = d.toLocaleTimeString(typeof currentLang !== 'undefined' ? currentLang : 'en', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? `${t('bank_today')} ${hm}` : `${formatDateDMY(d.toISOString().slice(0, 10))} ${hm}`;
}

function bankDaysLeft() {
    const v = bankState.conn && bankState.conn.valid_until;
    if (!v) return null;
    return Math.ceil((new Date(v).getTime() - Date.now()) / 86400000);
}

function bankWhy(r) {
    const k = {
        amount_differs: 'bank_why_amount', number_found_amount_differs_unknown_payer: 'bank_why_amount',
        payer_other_customer_amount_differs: 'bank_why_amount', amount_differs_foreign_series: 'bank_why_amount',
        amount_over_remaining: 'bank_why_over', payer_other_customer: 'bank_why_payer',
        number_amount_match_unverified_payer: 'bank_why_unverified', foreign_series_amount_match: 'bank_why_foreign',
        payer_amount_several_candidates: 'bank_why_several', amount_matches_snapshot_not_live: 'bank_why_snapshot',
    }[r.why];
    return k ? t(k) : '';
}

function bankInvLabel(i) {
    const n = _formatDocNumber('invoice', i.number) || i.number;
    return i.kind === 'cons' ? `${t('bank_cons_word')} ${n}` : n;
}

function bankTag(r) {
    if (r.reason === 'invoice_already_paid') return t('bank_tag_paid');
    if (r.reason === 'foreign_series_amount_differs' || r.reason === 'number_not_ours_or_closed') return t('bank_tag_foreign');
    return t('bank_tag_nomatch');
}

function bankTarget(x) {
    const [kind, v] = [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)];
    if (kind === 'cons') return `${t('bank_cons_word')} ${_formatDocNumber('invoice', v) || v}`;
    if (kind === 'inv') return _formatDocNumber('invoice', v) || v;
    return t('bank_order_no').replace('{n}', v);
}

const _bk = {
    btn1: 'border:0; background:#7c9473; color:#fff; border-radius:10px; padding:7px 12px; font-size:11.5px; font-weight:700; font-family:inherit; box-shadow:0 1px 2px rgba(0,0,0,.12); cursor:pointer;',
    btn2: 'border:0; background:#e3e8df; color:#4f6349; border-radius:10px; padding:7px 12px; font-size:11.5px; font-weight:700; font-family:inherit; cursor:pointer;',
    btn3: 'border:0; background:transparent; color:#9a9488; padding:7px 8px; font-size:12px; font-weight:500; font-family:inherit; cursor:pointer;',
    danger: 'border:0; background:#c0685c; color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.12); border-radius:10px; padding:7px 12px; font-size:11.5px; font-weight:700; font-family:inherit; cursor:pointer;',
};

// Карточка со цветной полосой слева (как карточки заказов)
function bankCard(stripe, inner, mb) {
    return `<div style="background:#fff; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,.08); display:flex; overflow:hidden; margin-bottom:${mb == null ? 10 : mb}px;"><div style="width:5px; background:${stripe}; flex:none;"></div><div style="flex:1; padding:12px; min-width:0;">${inner}</div></div>`;
}

function bankRender(loading) {
    const box = document.getElementById('bankBody');
    const sub = document.getElementById('bankSubtitle');
    if (!box) return;
    const conn = bankState.conn;
    if (sub && conn) sub.textContent = `${conn.bank_name || ''} …${String(conn.account_iban || '').slice(-4)} · ${t('bank_loaded')} ${bankFmtWhen(conn.last_sync_at)}`;

    const tabs = [['review', t('bank_tab_review'), bankState.counts.review], ['other', t('bank_tab_other'), bankState.counts.other],
        ['closed', t('bank_tab_closed'), null], ['hidden', t('bank_tab_hidden'), null]]
        .map(([k, l, n]) => {
            const on = bankState.tab === k;
            const label = n ? `${l} · ${n}` : l;
            return `<button type="button" onclick="bankSetTab('${k}')" style="font-size:12px; border-radius:999px; padding:5px 10px; white-space:nowrap; ${on ? 'background:#7c9473; border:1px solid #7c9473; color:#fff; font-weight:700;' : 'background:#fff; border:1px solid #e3ddcc; color:#4f6349;'}">${escapeHtml(label)}</button>`;
        }).join('');

    let html = '';
    const left = bankDaysLeft();
    if (left != null && left <= 30) {
        html += bankCard('#d9a441', `<div style="font-size:13px; font-weight:700; color:#7a5a00;">${escapeHtml(left > 0 ? t('bank_expiring').replace('{n}', left) : t('bank_expired'))}</div>
            <button type="button" onclick="bankOpenSettings()" style="${_bk.btn1} margin-top:8px;">${escapeHtml(t('bank_reconfirm_now'))}</button>`);
    }
    html += `<div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:center; margin-top:8px;">${tabs}</div>`;

    if (loading) { box.innerHTML = html + `<p style="font-size:13px; color:#a29c8c; padding:12px 4px;">${escapeHtml(t('common_loading'))}</p>`; return; }

    const tab = bankState.tab;
    const hintTxt = tab === 'other' ? t('bank_other_hint') : tab === 'hidden' ? t('bank_hidden_hint') : tab === 'review' ? t('bank_review_hint') : '';
    if (hintTxt) html += `<div style="font-size:12px; color:#6b675d; background:#fff; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,.08); padding:10px 12px; margin:10px 0; line-height:1.45;">${escapeHtml(hintTxt)}</div>`;
    else html += '<div style="height:10px;"></div>';
    if (!bankState.rows.length) {
        html += `<p style="font-size:13px; color:#a29c8c; padding:8px 4px;">${escapeHtml(t('bank_empty_' + tab))}</p>`;
    } else if (tab === 'review') {
        html += bankState.rows.map(bankCardReview).join('');
    } else {
        html += bankState.rows.map((r, i) => bankRowCompact(r, i)).join('');
    }
    box.innerHTML = html;
}

function bankHead(r) {
    const rem = String(r.remittance || '').replace(/\s+/g, ' ').trim();
    return `<div style="display:flex; justify-content:space-between; gap:8px;"><div style="font-size:13px; font-weight:700; color:#3c3a34; min-width:0; overflow-wrap:anywhere;">${escapeHtml(r.payer || '—')}</div><div style="font-size:14px; font-weight:700; color:#3c3a34; white-space:nowrap;">${formatMoney(r.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin-top:1px; overflow-wrap:anywhere;">${escapeHtml(formatDateDMY(r.date))}${rem ? ' · ' + escapeHtml(rem.slice(0, 80)) : ''}</div>`;
}

function bankCardReview(r) {
    const hasProposal = r.allocations && r.allocations.length;
    const sure = hasProposal && r.verdict === 'auto' || (hasProposal && !bankWhy(r));
    let prop = '';
    if (r.invoices && r.invoices.length) {
        prop = `<div style="font-size:12px; color:#4f6349; margin-top:4px;">→ ${escapeHtml(r.invoices.map(bankInvLabel).join(', '))}${r.customer ? ' · ' + escapeHtml(r.customer) : ''}</div>`;
    }
    const why = bankWhy(r);
    const whyHtml = why ? `<div style="font-size:12px; color:#a3493d; margin-top:3px;">${escapeHtml(why)}</div>` : '';
    return bankCard(sure ? '#7c9473' : '#d9a441', `${bankHead(r)}${prop}${whyHtml}
        <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
            ${hasProposal ? `<button type="button" onclick="bankConfirm('${r.id}')" style="${_bk.btn1}">${escapeHtml(t('bank_btn_apply'))}</button>` : ''}
            <button type="button" onclick="bankOpenSheet('${r.id}')" style="${hasProposal ? _bk.btn2 : _bk.btn1}">${escapeHtml(t('bank_btn_other'))}</button>
            <button type="button" onclick="bankHide('${r.id}')" style="${_bk.btn3} margin-left:auto;">${escapeHtml(t('bank_btn_hide'))}</button>
        </div>`);
}

function bankTagHtml(text, green) {
    return `<span style="font-size:11px; font-weight:500; background:${green ? '#e3e8df' : '#eef2ea'}; color:${green ? '#4f6349' : '#6b675d'}; border-radius:6px; padding:2px 7px;">${escapeHtml(text)}</span>`;
}

function bankRowCompact(r) {
    let tagLine = '', actions = '', stripe = '#cfc9b8', confirmBtn = '';
    if (bankState.tab === 'other') {
        tagLine = bankTagHtml(bankTag(r));
        if (r.can_confirm) confirmBtn = `<button type="button" onclick="bankConfirmManual('${r.id}')" style="${_bk.btn1}">${escapeHtml(t('bank_btn_confirm_bank'))}</button>`;
        actions = `<button type="button" onclick="bankOpenSheet('${r.id}')" style="${_bk.btn2} margin-left:auto;">${escapeHtml(t('bank_btn_apply'))}</button><button type="button" onclick="bankHide('${r.id}')" style="${_bk.btn3}">${escapeHtml(t('bank_btn_hide'))}</button>`;
    } else if (bankState.tab === 'closed') {
        stripe = '#7c9473';
        tagLine = bankTagHtml(r.status === 'auto_matched' ? t('bank_closed_auto') : r.reason === 'confirmed_manual_payment' ? t('bank_closed_confirmed') : t('bank_closed_you'), true);
        actions = `<button type="button" onclick="bankUndo('${r.id}')" style="${_bk.danger} margin-left:auto;">${escapeHtml(t('bank_btn_undo'))}</button>`;
    } else {
        actions = `<button type="button" onclick="bankUnhide('${r.id}')" style="${_bk.btn2} margin-left:auto;">${escapeHtml(t('bank_btn_unhide'))}</button>`;
    }
    const closedTo = bankState.tab === 'closed' && r.targets && r.targets.length ? escapeHtml(t('bank_closed_to').replace('{target}', r.targets.map(bankTarget).join(', '))) : '';
    const rem = String(r.remittance || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const sub = `${escapeHtml(formatDateDMY(r.date))} · ${bankState.tab === 'closed' ? closedTo : escapeHtml(rem)}`;
    return bankCard(stripe, `<div style="display:flex; justify-content:space-between; gap:8px;"><div style="font-size:13px; font-weight:700; color:#3c3a34; min-width:0; overflow-wrap:anywhere;">${escapeHtml(r.payer || '—')}</div><div style="font-size:14px; font-weight:700; color:#3c3a34; white-space:nowrap;">${formatMoney(r.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin-top:1px; overflow-wrap:anywhere;">${sub}</div>
        ${confirmBtn ? `<div style="margin-top:6px;">${tagLine}</div><div style="display:flex; align-items:center; margin-top:8px; gap:8px;">${confirmBtn}${actions}</div>`
            : `<div style="display:flex; align-items:center; margin-top:6px; gap:8px;">${tagLine || '<span></span>'}${actions}</div>`}`, 8);
}

// ---------- действия ----------
async function bankAfterChange(reloadApp) {
    await bankLoadTab();
    if (reloadApp && typeof loadAllData === 'function') { try { await loadAllData(true); } catch (e) { /* список обновится позже */ } }
}

async function bankConfirm(txId, allocations) {
    showLoading();
    const r = await bankCall({ action: 'confirm', tx_id: txId, ...(allocations ? { allocations } : {}) });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); await bankAfterChange(false); return false; }
    await bankAfterChange(true);
    return true;
}

async function bankHide(txId) {
    showLoading();
    const r = await bankCall({ action: 'hide', tx_id: txId });
    hideLoading();
    if (!r.ok) await showInfo(bankErrText(r.error));
    await bankAfterChange(false);
}

async function bankUnhide(txId) {
    showLoading();
    const r = await bankCall({ action: 'unhide', tx_id: txId });
    hideLoading();
    if (!r.ok) await showInfo(bankErrText(r.error));
    await bankAfterChange(false);
}

async function bankConfirmManual(txId) {
    showLoading();
    const r = await bankCall({ action: 'confirm_manual', tx_id: txId });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); await bankAfterChange(false); return; }
    await bankAfterChange(true);
}
async function bankUndo(txId) {
    const row = bankState.rows.find((x) => x.id === txId);
    if (!row) return;
    const c = row.reason === 'confirmed_manual_payment';
    const text = `${t(c ? 'bank_undo_title_c' : 'bank_undo_title')}\n\n${t(c ? 'bank_undo_text_c' : 'bank_undo_text').replace('{sum}', formatMoney(row.amount)).replace('{payer}', row.payer || '—')}`;
    if (!(await showConfirm(text))) return;
    showLoading();
    const r = await bankCall({ action: 'undo', tx_id: txId });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); await bankAfterChange(false); return; }
    await bankAfterChange(true);
}

async function bankRefreshNow() {
    showLoading();
    const r = await bankCall({ action: 'sync', connection_id: bankState.conn && bankState.conn.id });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); return; }
    await bankRefreshState();
    await bankLoadTab();
}

function bankOpenSettings() {
    if (typeof openBankSettings === 'function') openBankSettings();
}

// ---------- окно «Другой счёт» ----------
function _bankSortedCustomers() {
    return (typeof customers !== 'undefined' ? customers : []).filter((c) => c && c.name).slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function bankOpenSheet(txId) {
    const row = bankState.rows.find((x) => x.id === txId);
    if (!row) return;
    bankState.sheet = { row, customerId: row.customer_id || null, invoices: [], sel: {}, loading: false };
    document.getElementById('bankSheetModal').style.display = 'flex';
    if (bankState.sheet.customerId) await bankSheetLoad(); else bankSheetRender();
}

function bankSheetClose() {
    document.getElementById('bankSheetModal').style.display = 'none';
    bankState.sheet = null;
}

async function bankSheetPickCustomer(id) {
    const s = bankState.sheet;
    if (!s) return;
    s.customerId = id ? Number(id) : null;
    s.sel = {};
    s.invoices = [];
    if (s.customerId) await bankSheetLoad(); else bankSheetRender();
}

async function bankSheetLoad() {
    const s = bankState.sheet;
    s.loading = true; bankSheetRender();
    const r = await bankCall({ action: 'open_invoices', customer_id: s.customerId });
    if (!bankState.sheet) return;
    s.loading = false;
    if (!r.ok) { s.invoices = []; bankSheetRender(); await showInfo(bankErrText(r.error)); return; }
    s.invoices = r.invoices || [];
    // Заранее отмечаем предложение сервера
    const prop = (s.row.invoices || []);
    for (const inv of s.invoices) {
        if (prop.some((p) => p.kind === inv.kind && p.number === inv.number)) s.sel[inv.kind + inv.ref_id] = true;
    }
    bankSheetAutoFill();
    bankSheetRender();
}

function _bankKey(inv) { return inv.kind + inv.ref_id; }

// Суммы по отмеченным счетам: по порядку, пока хватает денег платежа
function bankSheetAutoFill() {
    const s = bankState.sheet;
    let leftC = Math.round(s.row.amount * 100);
    s.amt = {};
    for (const inv of s.invoices) {
        if (!s.sel[_bankKey(inv)]) continue;
        const take = Math.min(leftC, Math.round(inv.remaining * 100));
        s.amt[_bankKey(inv)] = take;
        leftC -= take;
    }
}

function bankSheetToggle(key) {
    const s = bankState.sheet;
    if (s.sel[key]) delete s.sel[key]; else s.sel[key] = true;
    bankSheetAutoFill();
    bankSheetRender();
}

function bankSheetSetAmount(key, val) {
    const s = bankState.sheet;
    const inv = s.invoices.find((i) => _bankKey(i) === key);
    let c = Math.round(parseFloat(String(val).replace(',', '.')) * 100);
    if (!Number.isFinite(c) || c < 0) c = 0;
    c = Math.min(c, Math.round(inv.remaining * 100));
    s.amt[key] = c;
    bankSheetRender(true);
}

function _bankSheetTotals() {
    const s = bankState.sheet;
    const payC = Math.round(s.row.amount * 100);
    const doneC = Object.keys(s.sel).reduce((a, k) => a + (s.amt[k] || 0), 0);
    return { payC, doneC, leftC: payC - doneC };
}

function bankSheetRender(keepFocus) {
    const s = bankState.sheet;
    const box = document.getElementById('bankSheetBody');
    if (!s || !box) return;
    const custOpts = [`<option value="">${escapeHtml(t('bank_sheet_pick'))}</option>`].concat(
        _bankSortedCustomers().map((c) => `<option value="${c.id}" ${c.id === s.customerId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)).join('');
    const rem = String(s.row.remittance || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    let list = '';
    if (!s.customerId) list = '';
    else if (s.loading) list = `<p style="font-size:13px; color:#a29c8c;">${escapeHtml(t('common_loading'))}</p>`;
    else if (!s.invoices.length) list = `<p style="font-size:13px; color:#6b675d;">${escapeHtml(t('bank_sheet_none'))}</p>`;
    else {
        list = s.invoices.map((inv) => {
            const k = _bankKey(inv), on = !!s.sel[k];
            const title = inv.kind === 'order_only' ? t('bank_order_no').replace('{n}', inv.number) : bankInvLabel(inv);
            const sub2 = inv.kind === 'order_only' ? ` <span style="font-weight:400; color:#a29c8c;">· ${escapeHtml(t('bank_sheet_noinv'))}</span>` : '';
            return `<div style="border:${on ? '2px solid #7c9473' : '1px solid #e3ddcc'}; border-radius:12px; padding:10px; background:${on ? '#f6f9f3' : '#fff'}; margin-bottom:8px;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <button type="button" aria-label="${escapeHtml(title)}" onclick="bankSheetToggle('${k}')" style="width:26px; height:26px; flex:none; border-radius:6px; ${on ? 'background:#7c9473; border:2px solid #7c9473; color:#fff;' : 'background:#fff; border:2px solid #cfc9b8;'} display:flex; align-items:center; justify-content:center;">${on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : ''}</button>
                    <div style="flex:1; min-width:0;"><div style="font-size:13px; font-weight:700;">${escapeHtml(title)}${sub2}</div><div style="font-size:12px; color:#6b675d;">${escapeHtml(t('bank_sheet_due').replace('{sum}', formatMoney(inv.remaining)))}</div></div>
                    <input type="text" inputmode="decimal" id="bankAmt_${k}" ${on ? '' : 'disabled'} value="${on ? ((s.amt[k] || 0) / 100).toFixed(2) : '0.00'}" onchange="bankSheetSetAmount('${k}', this.value)" style="width:78px; text-align:right; font-size:13px; font-weight:700; padding:6px 8px; border:1px solid ${on ? '#cfd8c9' : '#e3ddcc'}; border-radius:8px; background:${on ? '#fff' : '#faf8f3'};">
                </div></div>`;
        }).join('');
    }
    const T = _bankSheetTotals();
    const canApply = T.doneC > 0 && T.leftC >= 0;
    box.innerHTML = `
        <div style="width:40px; height:4px; border-radius:2px; background:#d9d4c4; margin:0 auto 10px;"></div>
        <div style="display:flex; justify-content:space-between; align-items:baseline;"><div style="font-size:15px; font-weight:600; color:#3c3a34;">${escapeHtml(t('bank_sheet_title'))}</div><div style="font-size:16px; font-weight:700; color:#4f6349;">${formatMoney(s.row.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin:2px 0 10px; overflow-wrap:anywhere;">${escapeHtml(s.row.payer || '—')} · ${escapeHtml(formatDateDMY(s.row.date))}${rem ? ' · «' + escapeHtml(rem) + '»' : ''}</div>
        <div style="font-size:12px; color:#6b675d; margin-bottom:4px;">${escapeHtml(t('bank_sheet_customer'))}</div>
        <select onchange="bankSheetPickCustomer(this.value)" style="width:100%; height:40px; border:1px solid #e3ddcc; border-radius:10px; padding:0 10px; font-size:13px; background:#fff; margin-bottom:10px;">${custOpts}</select>
        ${s.customerId ? `<div style="font-size:12px; color:#6b675d; margin-bottom:6px;">${escapeHtml(t('bank_sheet_open'))}</div>` : ''}
        ${list}
        <div style="background:#f4f1ea; border-radius:12px; padding:10px 12px; font-size:13px; line-height:1.6; margin-top:6px;">
            <div style="display:flex; justify-content:space-between;"><span>${escapeHtml(t('bank_sheet_payment'))}</span><b>${formatMoney(T.payC / 100)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span>${escapeHtml(t('bank_sheet_applied'))}</span><b>${formatMoney(T.doneC / 100)}</b></div>
            <div style="display:flex; justify-content:space-between; ${T.leftC !== 0 ? 'color:#a3493d;' : ''}"><span>${escapeHtml(t('bank_sheet_left'))}</span><b>${formatMoney(T.leftC / 100)}</b></div>
            ${T.leftC > 0 ? `<div style="font-size:11px; color:#6b675d; margin-top:4px;">${escapeHtml(t('bank_sheet_left_note'))}</div>` : ''}
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" onclick="bankSheetClose()" style="${_bk.btn2} flex:1; padding:12px;">${escapeHtml(t('common_cancel'))}</button>
            <button type="button" ${canApply ? '' : 'disabled'} onclick="bankSheetApply()" style="flex:2; border:0; background:${canApply ? '#7c9473' : '#cfc9b8'}; color:#fff; border-radius:10px; padding:12px; font-size:13px; font-weight:700; font-family:inherit;">${escapeHtml(t('bank_sheet_apply').replace('{sum}', formatMoney(T.doneC / 100)))}</button>
        </div>`;
}

async function bankSheetApply() {
    const s = bankState.sheet;
    if (!s) return;
    const T = _bankSheetTotals();
    if (T.doneC <= 0 || T.leftC < 0) return;
    // Сумму по счёту раскладываем на его заказы: от старых к новым (порядок задаёт сервер)
    const allocations = [];
    for (const inv of s.invoices) {
        const k = _bankKey(inv);
        if (!s.sel[k]) continue;
        let leftC = s.amt[k] || 0;
        for (const o of inv.orders) {
            const take = Math.min(leftC, Math.round(o.remaining * 100));
            if (take > 0) allocations.push({ order_id: o.order_id, amount: take / 100 });
            leftC -= take;
        }
    }
    if (!allocations.length) return;
    const txId = s.row.id;
    bankSheetClose();
    await bankConfirm(txId, allocations);
}

// ==================== НАСТРОЙКИ → БАНК ====================
function bankPlanOk() { return currentOrgPlan === 'full' || bankState.protectedOrg; }

async function bankLoadProtected() {
    try {
        const { data } = await db.from('organizations').select('is_protected').eq('id', currentOrgId).maybeSingle();
        bankState.protectedOrg = !!(data && data.is_protected);
    } catch (e) { /* без права читать признак считаем обычной организацией */ }
}

async function openBankSettings() {
    closeModal();
    document.getElementById('bankSettingsModal').style.display = 'flex';
    document.getElementById('bankSettingsBody').innerHTML = `<p style="font-size:13px; color:#a29c8c; padding:12px 4px;">${escapeHtml(t('common_loading'))}</p>`;
    await Promise.all([bankRefreshState(), bankLoadProtected()]);
    bankSettingsRender();
}

function closeBankSettings() {
    document.getElementById('bankSettingsModal').style.display = 'none';
    if (typeof openSettingsModal === 'function') openSettingsModal();
}

function bankSettingsRender() {
    const box = document.getElementById('bankSettingsBody');
    if (!box) return;
    const conn = bankState.conn && bankState.conn.status !== 'revoked' ? bankState.conn : null;
    const owner = bankState.role === 'owner';
    const planOk = bankPlanOk();
    let html = '';

    if (conn) {
        const left = bankDaysLeft();
        const expired = left != null && left <= 0;
        const dot = expired || conn.status !== 'active' ? '#c0654f' : planOk ? '#7c9473' : '#d9a441';
        const until = conn.valid_until ? formatDateDMY(String(conn.valid_until).slice(0, 10)) : '—';
        const title = !planOk ? t('bank_set_paused') : expired ? t('bank_set_expired_title') : t('bank_set_connected');
        let info = `<div style="font-size:13px; margin-top:6px; color:#3c3a34;">${escapeHtml(conn.bank_name || '')} · …${escapeHtml(String(conn.account_iban || '').slice(-4))}</div>
            <div style="font-size:12px; color:#a29c8c; margin-top:2px;">${escapeHtml(t('bank_set_until').replace('{date}', until))}${left != null && left > 0 ? ' · ' + escapeHtml(t('bank_set_days_left').replace('{n}', left)) : ''}<br>${escapeHtml(t('bank_set_last_sync'))} ${escapeHtml(bankFmtWhen(conn.last_sync_at))}</div>`;
        if (!planOk) info += `<div style="font-size:12px; color:#6b675d; margin-top:6px; line-height:1.45;">${escapeHtml(t('bank_set_paused_text'))}</div>`;
        let auto = '';
        if (owner && planOk) {
            const on = !!conn.auto_apply;
            auto = `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:10px; padding-top:10px; border-top:1px solid #f0ebde;">
                <div style="min-width:0;"><div style="font-size:13px; font-weight:700; color:#3c3a34;">${escapeHtml(t('bank_set_auto'))}</div><div style="font-size:12px; color:#6b675d; margin-top:2px; line-height:1.4;">${escapeHtml(on ? t('bank_set_auto_on') : t('bank_set_auto_off'))}</div></div>
                <button type="button" role="switch" aria-checked="${on}" aria-label="${escapeHtml(t('bank_set_auto'))}" onclick="bankToggleAuto()" style="width:44px; height:26px; border-radius:13px; border:0; background:${on ? '#7c9473' : '#cfc9b8'}; position:relative; flex:none; cursor:pointer;"><span style="position:absolute; top:3px; left:${on ? 21 : 3}px; width:20px; height:20px; border-radius:50%; background:#fff; transition:left .15s;"></span></button></div>`;
        }
        let btns = '';
        if (planOk) btns += `<button type="button" onclick="bankConnect('${conn.psu_type || 'personal'}')" style="${_bk.btn2}">${escapeHtml(t('bank_set_reconfirm'))}</button>`;
        else btns += `<button type="button" onclick="bankOpenPlans()" style="${_bk.btn1}">${escapeHtml(t('bank_set_plans'))}</button>`;
        if (owner) btns += `<button type="button" onclick="bankDisconnect()" style="${_bk.danger}">${escapeHtml(t('bank_set_disconnect'))}</button>`;
        html += bankCard(dot, `<div style="display:flex; align-items:center; gap:8px;"><div style="width:10px; height:10px; border-radius:50%; background:${dot};"></div><div style="font-size:14px; font-weight:700; color:#3c3a34;">${escapeHtml(title)}</div></div>${info}${auto}<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">${btns}</div>`);
        if (left != null && left > 0 && left <= 30 && planOk) {
            html += bankCard('#d9a441', `<div style="font-size:13px; font-weight:700; color:#7a5a00;">${escapeHtml(t('bank_expiring').replace('{n}', left))}</div><div style="font-size:12px; color:#6b675d; margin-top:4px; line-height:1.45;">${escapeHtml(t('bank_set_expiring_text'))}</div><button type="button" onclick="bankConnect('${conn.psu_type || 'personal'}')" style="${_bk.btn1} margin-top:8px;">${escapeHtml(t('bank_reconfirm_now'))}</button>`);
        }
    } else if (planOk) {
        if (!owner) {
            html += bankCard('#cfc9b8', `<div style="font-size:13px; color:#6b675d;">${escapeHtml(t('bank_set_owner_only'))}</div>`);
        } else {
            const psu = bankState.psu || 'personal';
            const chip = (k, l) => `<button type="button" onclick="bankPickPsu('${k}')" style="flex:1; font-size:12px; border-radius:999px; padding:7px 10px; ${psu === k ? 'background:#7c9473; border:1px solid #7c9473; color:#fff; font-weight:700;' : 'background:#fff; border:1px solid #e3ddcc; color:#4f6349;'}">${escapeHtml(l)}</button>`;
            html += bankCard('#cfc9b8', `<div style="display:flex; align-items:center; gap:8px;"><div style="width:10px; height:10px; border-radius:50%; background:#cfc9b8;"></div><div style="font-size:14px; font-weight:700; color:#3c3a34;">${escapeHtml(t('bank_set_not_connected'))}</div></div>
                <div style="font-size:12px; color:#6b675d; margin-top:6px; line-height:1.5;">${escapeHtml(t('bank_set_intro'))}</div>
                <div style="display:flex; gap:6px; margin-top:10px;">${chip('personal', t('bank_set_personal'))}${chip('business', t('bank_set_business'))}</div>
                <button type="button" onclick="bankConnect('${psu}')" style="${_bk.btn1} margin-top:10px; width:100%; padding:10px;">${escapeHtml(t('bank_set_connect'))}</button>
                <div style="font-size:11px; color:#a29c8c; margin-top:6px; line-height:1.4;">${escapeHtml(t('bank_set_connect_note'))}</div>`);
        }
    } else {
        html += bankCard('#cfc9b8', `<div style="display:flex; align-items:center; gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9488" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg><div style="font-size:14px; font-weight:700; color:#3c3a34;">${escapeHtml(t('bank_set_locked'))}</div></div>
            <div style="font-size:12px; color:#6b675d; margin-top:6px; line-height:1.5;">${escapeHtml(t('bank_set_locked_text'))}</div>
            <button type="button" onclick="bankOpenPlans()" style="${_bk.btn2} margin-top:8px;">${escapeHtml(t('bank_set_plans'))}</button>`);
    }
    box.innerHTML = html;
}

function bankPickPsu(k) { bankState.psu = k; bankSettingsRender(); }

function bankOpenPlans() {
    document.getElementById('bankSettingsModal').style.display = 'none';
    if (typeof openPlanModal === 'function') openPlanModal();
}

async function bankConnect(psu) {
    try { localStorage.setItem('bank_sync_pending', JSON.stringify({ psu })); } catch (e) { /* без памяти браузера тип счёта по умолчанию — личный */ }
    showLoading();
    const r = await bankCall({ action: 'connect_start', psu_type: psu });
    hideLoading();
    if (!r.ok || !r.url) { await showInfo(bankErrText(r.error)); return; }
    location.href = r.url;
}

async function bankToggleAuto() {
    const conn = bankState.conn;
    if (!conn) return;
    const want = !conn.auto_apply;
    if (want && !(await showConfirm(t('bank_set_auto_confirm')))) return;
    showLoading();
    const r = await bankCall({ action: 'set_auto_apply', connection_id: conn.id, value: want });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); return; }
    conn.auto_apply = !!r.auto_apply;
    bankSettingsRender();
}

async function bankDisconnect() {
    const conn = bankState.conn;
    if (!conn) return;
    if (!(await showConfirm(t('bank_set_disconnect_confirm')))) return;
    showLoading();
    const r = await bankCall({ action: 'disconnect', connection_id: conn.id });
    hideLoading();
    if (!r.ok) { await showInfo(bankErrText(r.error)); return; }
    bankState.conn = null;
    bankState.counts = { review: 0, other: 0 };
    bankApplyButton();
    bankSettingsRender();
}

// Сразу показать кнопку по запомненному состоянию (до ответа сервера)
try { bankApplyButton(); } catch (e) { /* DOM ещё не готов */ }
