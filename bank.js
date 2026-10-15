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
        ALREADY_APPLIED: 'bank_err_already', NOT_APPLIED: 'bank_err_already', OVER_REMAINING: 'bank_err_over', OVER_TX_AMOUNT: 'bank_err_over' };
    return t(map[code] || 'bank_err_generic');
}

// ---------- состояние и кнопка в «Заказах» ----------
async function bankRefreshState() {
    try {
        const { data: au } = await db.auth.getUser();
        const uid = au && au.user ? au.user.id : null;
        if (!uid || !currentOrgId) return bankApplyButton();
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
    } catch (e) {
        console.error('Банк: не удалось обновить состояние', e);
    }
    bankApplyButton();
}

function bankApplyButton() {
    const show = !!bankState.conn && ['owner', 'manager'].includes(bankState.role);
    const pill = document.getElementById('ordersBankPill');
    if (pill) pill.classList.toggle('hidden', !show);
    const badge = document.getElementById('ordersBankBadge');
    if (badge) {
        const n = bankState.counts.review;
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.toggle('hidden', !(show && n > 0));
    }
}

// ---------- раздел ----------
async function openBankSection() {
    if (!bankState.conn) return;
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
    card: 'background:#fff; border-radius:14px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,.08); margin-bottom:10px;',
    btn1: 'border:0; background:#7c9473; color:#fff; border-radius:10px; height:40px; padding:0 14px; font:500 13px Roboto,sans-serif;',
    btn2: 'border:1px solid #7c9473; background:#fff; color:#4f6349; border-radius:10px; height:40px; padding:0 12px; font:500 13px Roboto,sans-serif;',
    btn3: 'border:0; background:transparent; color:#6b675d; height:40px; padding:0 8px; font:500 13px Roboto,sans-serif;',
    danger: 'border:1px solid #e3c9c2; background:#fff; color:#a3493d; border-radius:8px; height:32px; padding:0 10px; font:500 12px Roboto,sans-serif;',
};

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
            return `<button type="button" onclick="bankSetTab('${k}')" style="border-radius:999px; padding:7px 12px; font-size:13px; white-space:nowrap; ${on ? 'background:#4f6349; color:#fff; border:1px solid #4f6349; font-weight:500;' : 'background:#fff; color:#4f6349; border:1px solid #cfd8c9;'}">${escapeHtml(label)}</button>`;
        }).join('');

    let html = '';
    const left = bankDaysLeft();
    if (left != null && left <= 30) {
        html += `<div style="background:#fdf3dc; border:1px solid #ecd9a4; border-radius:14px; padding:10px 12px; margin-bottom:10px; font-size:13px; color:#7a5a00; font-weight:500;">${escapeHtml(left > 0 ? t('bank_expiring').replace('{n}', left) : t('bank_expired'))}
            <div style="margin-top:6px;"><button type="button" onclick="bankOpenSettings()" style="${_bk.btn1}">${escapeHtml(t('bank_reconfirm_now'))}</button></div></div>`;
    }
    html += `<div style="display:flex; gap:6px; overflow-x:auto; margin-bottom:10px;">${tabs}</div>`;

    if (loading) { box.innerHTML = html + `<p style="font-size:13px; color:#a29c8c; padding:8px 4px;">${escapeHtml(t('common_loading'))}</p>`; return; }

    const tab = bankState.tab;
    if (tab === 'other') html += `<p style="font-size:12px; color:#6b675d; line-height:1.45; padding:0 4px; margin-bottom:10px;">${escapeHtml(t('bank_other_hint'))}</p>`;
    if (tab === 'hidden') html += `<p style="font-size:12px; color:#6b675d; line-height:1.45; padding:0 4px; margin-bottom:10px;">${escapeHtml(t('bank_hidden_hint'))}</p>`;
    if (!bankState.rows.length) {
        html += `<p style="font-size:13px; color:#a29c8c; padding:8px 4px;">${escapeHtml(t('bank_empty_' + tab))}</p>`;
    } else if (tab === 'review') {
        html += bankState.rows.map(bankCardReview).join('');
    } else {
        html += `<div style="background:#fff; border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,.08); overflow:hidden;">${bankState.rows.map((r, i) => bankRowCompact(r, i)).join('')}</div>`;
    }
    box.innerHTML = html;
}

function bankHead(r) {
    const rem = String(r.remittance || '').replace(/\s+/g, ' ').trim();
    return `<div style="display:flex; justify-content:space-between; gap:8px;"><div style="font-size:13px; font-weight:500; min-width:0; overflow-wrap:anywhere;">${escapeHtml(r.payer || '—')}</div><div style="font-size:14px; font-weight:700; color:#4f6349; white-space:nowrap;">${formatMoney(r.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin-top:1px; overflow-wrap:anywhere;">${escapeHtml(formatDateDMY(r.date))}${rem ? ' · ' + escapeHtml(rem.slice(0, 80)) : ''}</div>`;
}

function bankCardReview(r) {
    const hasProposal = r.allocations && r.allocations.length;
    let prop = '';
    if (r.invoices && r.invoices.length) {
        prop = `<div style="font-size:13px; margin-top:6px;">→ <b>${escapeHtml(r.invoices.map(bankInvLabel).join(', '))}</b>${r.customer ? ' · ' + escapeHtml(r.customer) : ''}</div>`;
    }
    const why = bankWhy(r);
    const whyHtml = why ? `<div style="font-size:12px; color:#a3493d; margin-top:4px;">${escapeHtml(why)}</div>` : '';
    return `<div style="${_bk.card}">${bankHead(r)}${prop}${whyHtml}
        <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
            ${hasProposal ? `<button type="button" onclick="bankConfirm('${r.id}')" style="${_bk.btn1}">${escapeHtml(t('bank_btn_apply'))}</button>` : ''}
            <button type="button" onclick="bankOpenSheet('${r.id}')" style="${hasProposal ? _bk.btn2 : _bk.btn1}">${escapeHtml(t('bank_btn_other'))}</button>
            <button type="button" onclick="bankHide('${r.id}')" style="${_bk.btn3}; margin-left:auto;">${escapeHtml(t('bank_btn_hide'))}</button>
        </div></div>`;
}

function bankRowCompact(r, i) {
    const border = i < bankState.rows.length - 1 ? 'border-bottom:1px solid #eee;' : '';
    let tagLine = '', action = '';
    if (bankState.tab === 'other') {
        tagLine = `<span style="font-size:11px; background:#eef2ea; color:#6b675d; border-radius:6px; padding:2px 7px;">${escapeHtml(bankTag(r))}</span>`;
        action = `<span><button type="button" onclick="bankOpenSheet('${r.id}')" style="${_bk.btn3}; height:32px;">${escapeHtml(t('bank_btn_apply'))}</button><button type="button" onclick="bankHide('${r.id}')" style="${_bk.btn3}; height:32px;">${escapeHtml(t('bank_btn_hide'))}</button></span>`;
    } else if (bankState.tab === 'closed') {
        const who = r.status === 'auto_matched' ? t('bank_closed_auto') : t('bank_closed_you');
        tagLine = `<span style="font-size:11px; background:#eef2ea; color:#4f6349; border-radius:6px; padding:2px 7px;">${escapeHtml(who)}</span>`;
        action = `<button type="button" onclick="bankUndo('${r.id}')" style="${_bk.danger}">${escapeHtml(t('bank_btn_undo'))}</button>`;
    } else {
        action = `<button type="button" onclick="bankUnhide('${r.id}')" style="${_bk.btn3}; height:32px;">${escapeHtml(t('bank_btn_unhide'))}</button>`;
    }
    const targets = bankState.tab === 'closed' && r.targets && r.targets.length ? ' · ' + escapeHtml(t('bank_closed_to').replace('{target}', r.targets.map(bankTarget).join(', '))) : '';
    return `<div style="padding:10px 12px; ${border}">
        <div style="display:flex; justify-content:space-between; gap:8px;"><div style="font-size:13px; font-weight:500; min-width:0; overflow-wrap:anywhere;">${escapeHtml(r.payer || '—')}</div><div style="font-size:13px; font-weight:700; color:#4f6349; white-space:nowrap;">${formatMoney(r.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin-top:1px; overflow-wrap:anywhere;">${escapeHtml(formatDateDMY(r.date))}${bankState.tab === 'closed' ? targets : (r.remittance ? ' · ' + escapeHtml(String(r.remittance).replace(/\s+/g, ' ').slice(0, 60)) : '')}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:8px;">${tagLine || '<span></span>'}${action}</div></div>`;
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

async function bankUndo(txId) {
    const row = bankState.rows.find((x) => x.id === txId);
    if (!row) return;
    const text = `${t('bank_undo_title')}\n\n${t('bank_undo_text').replace('{sum}', formatMoney(row.amount)).replace('{payer}', row.payer || '—')}`;
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
        <div style="display:flex; justify-content:space-between; align-items:baseline;"><div style="font-size:15px; font-weight:700;">${escapeHtml(t('bank_sheet_title'))}</div><div style="font-size:16px; font-weight:700; color:#4f6349;">${formatMoney(s.row.amount)}</div></div>
        <div style="font-size:12px; color:#a29c8c; margin:2px 0 10px; overflow-wrap:anywhere;">${escapeHtml(s.row.payer || '—')} · ${escapeHtml(formatDateDMY(s.row.date))}${rem ? ' · «' + escapeHtml(rem) + '»' : ''}</div>
        <div style="font-size:12px; color:#6b675d; margin-bottom:4px;">${escapeHtml(t('bank_sheet_customer'))}</div>
        <select onchange="bankSheetPickCustomer(this.value)" style="width:100%; height:42px; border:1px solid #e3ddcc; border-radius:10px; padding:0 10px; font-size:13px; background:#fff; margin-bottom:10px;">${custOpts}</select>
        ${s.customerId ? `<div style="font-size:12px; color:#6b675d; margin-bottom:6px;">${escapeHtml(t('bank_sheet_open'))}</div>` : ''}
        ${list}
        <div style="background:#f4f1ea; border-radius:12px; padding:10px 12px; font-size:13px; line-height:1.6; margin-top:6px;">
            <div style="display:flex; justify-content:space-between;"><span>${escapeHtml(t('bank_sheet_payment'))}</span><b>${formatMoney(T.payC / 100)}</b></div>
            <div style="display:flex; justify-content:space-between;"><span>${escapeHtml(t('bank_sheet_applied'))}</span><b>${formatMoney(T.doneC / 100)}</b></div>
            <div style="display:flex; justify-content:space-between; ${T.leftC !== 0 ? 'color:#a3493d;' : ''}"><span>${escapeHtml(t('bank_sheet_left'))}</span><b>${formatMoney(T.leftC / 100)}</b></div>
            ${T.leftC > 0 ? `<div style="font-size:11px; color:#6b675d; margin-top:4px;">${escapeHtml(t('bank_sheet_left_note'))}</div>` : ''}
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" onclick="bankSheetClose()" style="flex:1; border:1px solid #7c9473; background:#fff; color:#4f6349; border-radius:12px; height:46px; font:500 15px Roboto,sans-serif;">${escapeHtml(t('common_cancel'))}</button>
            <button type="button" ${canApply ? '' : 'disabled'} onclick="bankSheetApply()" style="flex:2; border:0; background:${canApply ? '#7c9473' : '#cfc9b8'}; color:#fff; border-radius:12px; height:46px; font:500 15px Roboto,sans-serif;">${escapeHtml(t('bank_sheet_apply').replace('{sum}', formatMoney(T.doneC / 100)))}</button>
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
