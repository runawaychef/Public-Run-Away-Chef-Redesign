// ==================== НОВЫЙ РАЗДЕЛ «ДОКУМЕНТЫ» — шаг 1: главный экран (31.10.2026) ====================
// Раздел «Документы» (новый, 1.11.2026): доступен всем при включённом учёте документов. documents.js остаётся как источник данных (_docsLoad и др.), его страница из интерфейса отключена.
// Новый раздел ТОЛЬКО ЧИТАЕТ: данные грузит старая функция _docsLoad() (documents.js), статусы считает
// _docsInvStatus() оттуда же. Ничего не пишет в базу.
// Главный документ для пекаря — заказ: «К выставлению» считается по заказам (orderNeedsInvoice, orders.js),
// остальные плитки — по документам (счета, сводные, накладные).
// Откат: убрать кнопку #docs2Btn и страницу #docs2HomePage из index.html, блок CSS DOCS2, <script> documents2.js,
// строку в refreshDocsVisibility (payments.js), строки docs2 в helpers.js (_appPageShowTop).
// Следующие шаги: страницы плиток (Ждут оплаты / Просрочено / Оплачены / К выставлению / Накладные / Все документы).
// Зависит от: _docsLoad, _docsAll, _docsInvStatus, _docsDayDiff (documents.js), orders, orderNeedsInvoice,
//             orderGrandTotal, docsEnabled, _anyIssuedDocs (payments.js), formatMoney, getLocalDateStr,
//             openAppPage (helpers.js), showLoading/hideLoading/showInfo, escapeHtml, t.

// Кому показывать раздел «Документы»: всем, у кого включён учёт документов (режим «По счёту») или уже есть выставленные документы.
// С 1.11.2026 — для всех организаций; старый раздел из «Заказов» отключён (код documents.js остаётся как источник данных).
function docs2Allowed() {
    const on = (typeof docsEnabled === 'function' && docsEnabled()) || (typeof _anyIssuedDocs === 'function' && _anyIssuedDocs());
    return !!on;
}

function refreshDocs2Visibility() {
    const b = document.getElementById('docs2Btn');
    if (b) b.classList.toggle('hidden', !docs2Allowed());
}

async function openDocs2Home() {
    if (!docs2Allowed()) return;
    showLoading();
    try {
        await _docsLoad();
    } catch (e) {
        console.error('Документы 2: ошибка загрузки', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    await _d2LoadPaid();
    hideLoading();
    openAppPage('docs2HomePage');
    docs2RenderHome();
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2HomePage = () => docs2RenderHome();

// Реальные поступления денег за текущий месяц — по дате платежа (order_payments.paid_at), а не по дате документа.
// null — не удалось загрузить (плитка покажет прочерк).
// Текущий и прошлый месяц (YYYY-MM) по локальной дате
function _d2Months() {
    const p = String(getLocalDateStr(0)).split('-').map(Number);
    const cur = p[0] + '-' + String(p[1]).padStart(2, '0');
    const pd = new Date(p[0], p[1] - 2, 1);
    const prev = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0');
    return { cur, prev };
}
let _d2Paid = null;
async function _d2LoadPaid() {
    _d2Paid = null;
    try {
        const mm = _d2Months();
        const { data, error } = await db.from('order_payments').select('amount, paid_at')
            .eq('org_id', currentOrgId).gte('paid_at', mm.prev + '-01').limit(5000);
        if (error) throw error;
        let c = 0, n = 0, pc = 0;
        (data || []).forEach(p => {
            const m = String(p.paid_at || '').slice(0, 7), cc = Math.round(Number(p.amount || 0) * 100);
            if (m === mm.cur) { c += cc; n++; } else if (m === mm.prev) { pc += cc; }
        });
        _d2Paid = { c, n, pc };
    } catch (e) {
        console.error('Документы 2: ошибка загрузки платежей', e);
    }
}

function docs2Soon() { showInfo(t('docs2_next_step')); }

// Число и валюта: «259.08 €» → 259.08 + маленькая «€» (как в плитках «Статистики»)
function _d2Money(c) {
    const s = formatMoney((c || 0) / 100);
    const i = s.lastIndexOf(' ');
    return i < 0 ? escapeHtml(s) : escapeHtml(s.slice(0, i)) + '<small>&nbsp;' + escapeHtml(s.slice(i + 1)) + '</small>';
}

const _D2_ICONS = {
    plus:  '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 15h6M13 12v6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.8L16 9.5"/>',
    dn:    '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    all:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    half:  '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    exp:   '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 15v4h14v-4"/>'
};
function _d2Icon(key) {
    return `<svg class="dashboard-card__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_D2_ICONS[key]}</svg>`;
}

// Плитка 8-шт. главного экрана: заголовок (+ число-значок справа), крупное значение по центру, подвал «слева — справа».
// footR выводится как простой текст (без разметки).
function _d2Tile(o) {
    const pill = (o.pill !== undefined && o.pill !== null && o.pill !== '') ? `<span class="d2pill">${escapeHtml(String(o.pill))}</span>` : '';
    const cap = o.cap ? `<span class="dc-cap">${escapeHtml(o.cap)}</span>` : '';
    const mid = o.mid ? `<span class="d2mid">${escapeHtml(o.mid)}</span>` : '';
    return `<div class="dashboard-card dc2 d2t${o.cls ? ' ' + o.cls : ''}" role="button" tabindex="0" onclick="${o.click || 'docs2Soon()'}">
        <div class="dashboard-card__hd ${o.color}">${_d2Icon(o.icon)}<span class="dashboard-card__label">${escapeHtml(o.label)}</span>${pill}</div>
        <div class="dc-val${mid ? ' d2col' : ''}"><span class="dashboard-card__value">${o.value}</span>${cap}${mid}</div>
        <div class="dc-foot"><span>${escapeHtml(o.footL || '')}</span><em>${escapeHtml(o.footR || '')}</em></div>
    </div>`;
}

// ---- Неоплаченные заказы (главный документ — заказ). Считается так же, как «Ждут оплаты» в Дашборде:
// сохранённые заказы, не оплаченные полностью; сумма — остаток (заказ минус внесённые платежи). ----
function _d2Unpaid() {
    const today = getLocalDateStr(0);
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    const out = [];
    (typeof orders !== 'undefined' ? orders : []).forEach(o => {
        if (!isOrderSaved(o)) return;
        const st = getOrderPaymentStatus(o);
        if (st.status === 'paid') return;
        const remC = Math.max(0, Math.round(st.grandAmt * 100) - Math.round(st.paidAmt * 100));
        const cons = docs.find(x => x.kind === 'cons' && !x.cancelled && (x.memberIds || []).indexOf(o.id) >= 0) || null;
        const inv = cons ? null : (docs.find(x => x.kind === 'inv' && x.orderId === o.id && !x.cancelled) || null);
        // Срок оплаты: у выставленного счёта — срок из документа (сводного или обычного), иначе срок, заданный в заказе
        const due = (cons && cons.due) || (inv && inv.due) || o.due_date || null;
        const over = !!due && due < today;
        out.push({ o, remC, paidC: Math.round(st.paidAmt * 100), partial: st.status === 'partial', over, due,
            overDays: over ? _docsDayDiff(due, today) : 0, cons, inv });
    });
    return out;
}

function docs2RenderHome() {
    const box = document.getElementById('docs2Home');
    if (!box) return;
    const today = getLocalDateStr(0);
    const ym = _d2Months().cur;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];

    // ---- Неоплаченные заказы: «в срок» и «просрочено» (как в Дашборде) ----
    const over = { n: 0, c: 0, maxDays: 0 };
    const wait = { n: 0, c: 0 };
    const part = { n: 0, c: 0, paidC: 0 };
    _d2Unpaid().forEach(u => {
        if (u.over) { over.n++; over.c += u.remC; over.maxDays = Math.max(over.maxDays, u.overDays); }
        else { wait.n++; wait.c += u.remC; }
        if (u.partial) { part.n++; part.c += u.remC; part.paidC += u.paidC; }
    });
    let dnMonth = 0, dnUnsent = 0, lastDn = '', total = 0, totDn = 0, totInv = 0;
    // Заказы, вошедшие в действующий сводный счёт: их отдельный счёт (старые заказы) в суммах не учитываем — иначе заказ считается дважды
    const inCons = new Set();
    docs.forEach(d => { if (d.kind === 'cons' && !d.cancelled) (d.memberIds || []).forEach(id => inCons.add(id)); });
    docs.forEach(d => {
        if (d.cancelled) return;
        if (!(d.kind === 'inv' && inCons.has(d.orderId))) { total++; if (d.kind === 'dn') totDn++; else totInv++; }
        if (d.kind === 'dn') {
            if (String(d.date).slice(0, 7) === ym) { dnMonth++; if (!d.sentAt && !d.deleted) dnUnsent++; }
            if (String(d.rawNumber || '') > lastDn) lastDn = String(d.rawNumber || '');
            return;
        }
        if (d.kind === 'inv' && inCons.has(d.orderId)) return;
        const st = _docsInvStatus(d, today);
        if (!st) return;
        if (st.paid) return;
    });

    // ---- Не отправлены: неоплаченные заказы, у которых счёт (свой или сводный) выставлен, но не отправлен клиенту ----
    const unsentL = _d2Unsent();
    const unsent = unsentL.length, unsentC = unsentL.reduce((s, u) => s + u.remC, 0);

    // ---- Заказы без счёта (главный документ — заказ) ----
    const todo = (typeof orders !== 'undefined' ? orders : []).filter(o => typeof orderNeedsInvoice === 'function' && orderNeedsInvoice(o));
    let todoSumC = 0;
    todo.forEach(o => { todoSumC += Math.round(orderGrandTotal(o) * 100); });
    const plain = c => formatMoney((c || 0) / 100);
    const shortDate = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] : ''; };

    const tiles = [
        _d2Tile({ color: 'dash-c-day', icon: 'plus', label: t('docs2_todo_t'), value: String(todo.length), click: "openDocs2Todo()", cap: todo.length ? t('docs2_todo_cap') : '',
                  footL: todo.length ? t('docs2_todo_sum') : t('docs2_todo_ok'), footR: todo.length ? plain(todoSumC) : '' }),
        _d2Tile({ color: 'dash-c-day', icon: 'alert', label: t('docs2_tosend_t'), value: String(unsent), click: "openDocs2Unsent()", cap: unsent ? t('docs2_unsent_cap') : '',
                  footL: unsent ? t('docs2_todo_sum') : '', footR: unsent ? plain(unsentC) : '' }),
        _d2Tile({ color: 'dash-c-tom', icon: 'clock', label: t('docs_tile_wait'), value: _d2Money(wait.c + over.c), pill: wait.n + over.n, click: "openDocs2Wait('all')",
                  mid: part.n ? t('docs2_partial_line').replace('{n}', part.n) : '',
                  footL: over.n ? t('docs2_over_short') : '', footR: over.n ? plain(over.c) : '' }),
        _d2Tile({ color: 'dash-c-acc', icon: 'check', label: t('docs_tile_paid'), value: _d2Paid ? _d2Money(_d2Paid.c) : '&mdash;', pill: _d2Paid ? _d2Paid.n : '', click: "openDocs2Paid()",
                  footL: _d2Paid ? t('docs2_prev_month') : '', footR: _d2Paid ? plain(_d2Paid.pc) : '' }),
        _d2Tile({ color: 'dash-c-stock', icon: 'dn', label: t('docs_type_dn'), value: String(dnMonth), cap: t('docs2_this_month'),
                  footL: dnUnsent ? t('docs2_dn_unsent').replace('{n}', dnUnsent) : (lastDn ? t('docs2_last') : ''), footR: dnUnsent ? '' : lastDn, click: "openDocs2Dn()" }),
        _d2Tile({ color: 'dash-c-rev', icon: 'all', label: t('docs2_all'), value: String(total), click: "openDocs2All()", footL: total ? t('docs2_all_foot').replace('{i}', totInv).replace('{d}', totDn) : '' }),
        _d2Tile({ color: 'dash-c-stock', icon: 'exp', label: t('docs2_export'), value: '&mdash;', footL: t('docs2_export_sub'), footR: t('docs2_soon'), cls: 'docs2-soon sth-wide' })
    ].join('');

    box.innerHTML = `<div class="dashboard-grid stats-home-grid docs2-grid">${tiles}
        <div class="sth-info"><i>i</i><ul><li>${escapeHtml(t('docs2_info'))}</li></ul></div></div>`;
}


// ==================== Страница «Ждут оплаты / Просрочено» (1.11.2026) ====================
// Список неоплаченных заказов по клиентам. Клиент сворачивается/разворачивается; режим «свёрнуто/развёрнуто» запоминается.
// Нажатие на заказ — открывает карточку заказа (оплата принимается там).
const _D2_BAR_ICONS = {
    cust: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .7 3.5 2.4 3.5 5.5"/></svg>',
    per:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    exp:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l5-5 5 5M7 16l5 5 5-5"/></svg>',
    half: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    col:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5 5-5M7 20l5-5 5 5"/></svg>'
};
let _d2W = { mode: 'all', part: false, cust: '', period: '', open: new Set() };
function _d2View() { try { return localStorage.getItem('docs2_wait_view') === 'expanded' ? 'expanded' : 'collapsed'; } catch (e) { return 'collapsed'; } }
function _d2SetView(v) { try { localStorage.setItem('docs2_wait_view', v); } catch (e) {} }

function _d2GroupKey(u) { return String(u.o.customer_id || ('n:' + (u.o.customer || ''))); }

// Применить сохранённый режим к набору раскрытых клиентов (развёрнуто — все; свёрнуто — никого, кроме единственного клиента)
function _d2ApplyView(groupKeys) {
    _d2W.open = new Set();
    if (_d2View() === 'expanded' || groupKeys.length === 1) groupKeys.forEach(k => _d2W.open.add(k));
}

async function openDocs2Wait(mode, part) {
    if (!docs2Allowed()) return;
    _d2W.mode = mode === 'over' ? 'over' : (mode === 'wait' ? 'wait' : 'all');
    _d2W.part = !!part;
    _d2W.cust = '';
    _d2W.period = '';
    openAppPage('docs2WaitPage');
    docs2RenderWait(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2WaitPage = () => docs2RenderWait(false);

function docs2WaitSet(field, v) {
    _d2W[field] = v;
    docs2RenderWait(true);
}
function docs2WaitPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    docs2WaitSet(field === 'per' ? 'period' : 'cust', v);
}
function docs2WaitToggle(key) {
    if (_d2W.open.has(key)) _d2W.open.delete(key); else _d2W.open.add(key);
    docs2RenderWait(false);
}
function docs2WaitToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderWait(true);
}
// Возврат из заказа в ту страницу «Документов», откуда его открыли (по образцу возврата в просмотр документа / карточку позиции)
const _D2_SUB_PAGES = ['docs2WaitPage', 'docs2PaidPage', 'docs2TodoPage', 'docs2UnsentPage', 'docs2DnPage', 'docs2AllPage'];
let _d2Return = null;
function docs2ReturnPending() { return !!_d2Return; }
function forgetDocs2Return() { _d2Return = null; }
function docs2OpenOrder(orderId) {
    let from = null;
    if (typeof isAppPageOpen === 'function') _D2_SUB_PAGES.forEach(id => { if (!from && isAppPageOpen(id)) from = id; });
    if (typeof closeAllAppPages === 'function') closeAllAppPages();
    if (typeof showTab === 'function') showTab('orders');
    _d2Return = from ? { page: from } : null; // после showTab — он сбрасывает память
    if (typeof openOrderDetail === 'function') openOrderDetail(orderId);
}
async function returnToDocs2() {
    const r = _d2Return;
    _d2Return = null;
    if (!r || !docs2Allowed()) return false;
    showLoading();
    try {
        await _docsLoad();
        await _d2LoadPaid();
        if (r.page === 'docs2PaidPage') await _d2FetchPaidRows();
    } catch (e) {
        console.error('Документы 2: ошибка загрузки при возврате', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return true;
    }
    hideLoading();
    openAppPage('docs2HomePage');
    docs2RenderHome();
    openAppPage(r.page);
    const rr = { docs2WaitPage: docs2RenderWait, docs2PaidPage: docs2RenderPaid, docs2TodoPage: docs2RenderTodo,
        docs2UnsentPage: docs2RenderUnsent, docs2DnPage: docs2RenderDn, docs2AllPage: docs2RenderAll }[r.page];
    if (rr) rr(false);
    return true;
}

function docs2RenderWait(reapplyView) {
    const box = document.getElementById('docs2Wait');
    if (!box) return;
    const today = getLocalDateStr(0);
    const all = _d2Unpaid();
    // Фильтры клиент/период действуют на плитки-переключатели и на список; статус выбирается переключателем
    const ymOf = u => String(u.o.date || '').slice(0, 7);
    const base = all.filter(u => (!_d2W.cust || _d2GroupKey(u) === _d2W.cust) && (!_d2W.period || ymOf(u) === _d2W.period) && (!_d2W.part || u.partial));
    const wait = base.filter(u => !u.over), over = base.filter(u => u.over);
    const sum = a => a.reduce((s, u) => s + u.remC, 0);
    const list = _d2W.mode === 'over' ? over : (_d2W.mode === 'wait' ? wait : base);

    // Группы по клиентам, самый большой долг сверху
    const groups = new Map();
    list.forEach(u => {
        const k = _d2GroupKey(u);
        if (!groups.has(k)) groups.set(k, { key: k, name: u.o.customer || t('orders_no_customer'), items: [], sumC: 0 });
        const g = groups.get(k); g.items.push(u); g.sumC += u.remC;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) _d2ApplyView(gl.map(g => g.key));

    // Выпадающие списки (механизм «Заказов»): клиенты и месяцы по всем неоплаченным заказам, выбор один
    const custMap = new Map();
    all.forEach(u => custMap.set(_d2GroupKey(u), u.o.customer || t('orders_no_customer')));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2WaitPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2DdCust'), ddP = document.getElementById('docs2DdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2W.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2W.cust)).join('');
    const yms = [...new Set(all.map(ymOf).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2W.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2W.period)).join('');

    const chip = (mode, label, arr, red) => `<button type="button" class="d2chip${_d2W.mode === mode ? ' on' : ''}${red ? ' red' : ''}" onclick="docs2WaitSet('mode','${mode}')">
        <small>${escapeHtml(label)}</small><b>${arr.length}</b><span>${escapeHtml(formatMoney(sum(arr) / 100))}</span></button>`;
    const expanded = _d2View() === 'expanded';

    const row = u => {
        const o = u.o;
        const doc = u.cons ? t('docs2_in_cons').replace('{n}', u.cons.number) : (u.inv ? u.inv.number : t('docs2_no_inv'));
        const d = u.cons || u.inv;
        const gold = x => `<span class="d2gold">${escapeHtml(x)}</span>`;
        let st = '';
        if (d) st = d.sentAt ? escapeHtml(t('docs_sent_on').replace('{d}', _docsShortDate(d.sentAt))) : gold(t('docs_not_sent_cap'));
        if (u.partial) st += (st ? ' · ' : '') + gold(t('docs_partial'));
        let due = '';
        if (u.over) due = `<div class="red">${escapeHtml(t('docs_overdue_days').replace('{n}', u.overDays))}</div>`;
        else if (u.due) due = `<div>${escapeHtml(t('docs_due_till').replace('{d}', _docsShortDate(u.due + 'T12:00:00')))}</div>`;
        return `<div class="d2o" onclick="docs2OpenOrder(${o.id})"><div class="l">
            <div class="a">${escapeHtml(t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)))}</div>
            <div class="b">${escapeHtml(formatDateDMY(o.date))} · ${escapeHtml(doc)}</div>
            ${st ? `<div class="c">${st}</div>` : ''}</div>
            <div class="r"><b>${escapeHtml(formatMoney(u.remC / 100))}</b>${due}</div></div>`;
    };
    const order = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.o.date).localeCompare(String(b.o.date));
    const groupHtml = gl.map(g => {
        const open = _d2W.open.has(g.key);
        const body = open ? g.items.slice().sort(order).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2WaitToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${g.items.length} ${escapeHtml(nWord(g.items.length, 'word_orders'))}</small></div>
            <span class="sm${_d2W.mode === 'over' ? ' red' : ''}">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    box.innerHTML = `<div class="d2chips">${chip('all', t('docs2_chip_all'), base, false)}${chip('wait', t('docs2_in_term'), wait, false)}${chip('over', t('docs_tile_over'), over, true)}</div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2W.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2W.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button>
            <button type="button" class="view-toggle-btn${_d2W.part ? ' active' : ''}" onclick="docs2WaitSet('part', !_d2W.part)" title="${escapeHtml(t('docs2_partial_t'))}">${_D2_BAR_ICONS.half}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2WaitToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_wait_empty'))}</p>`}`;
}

// ==================== Страница «Оплачены» (1.11.2026) ====================
// Реальные поступления (order_payments.paid_at) за выбранный месяц (по умолчанию текущий), по клиентам.
// Нажатие на платёж — открывает заказ.
let _d2PRows = [];
let _d2P = { cust: '', period: '', open: new Set() };

async function _d2FetchPaidRows() {
    const { data, error } = await db.from('order_payments').select('id, order_id, amount, paid_at, consolidated_invoice_id')
        .eq('org_id', currentOrgId).order('paid_at', { ascending: false }).limit(5000);
    if (error) throw error;
    _d2PRows = data || [];
}
async function openDocs2Paid() {
    if (!docs2Allowed()) return;
    showLoading();
    try {
        await _d2FetchPaidRows();
    } catch (e) {
        console.error('Документы 2: ошибка загрузки платежей', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    _d2P.cust = '';
    _d2P.period = _d2Months().cur;
    openAppPage('docs2PaidPage');
    docs2RenderPaid(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2PaidPage = () => docs2RenderPaid(false);

function docs2PaidPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2P[field === 'per' ? 'period' : 'cust'] = v;
    docs2RenderPaid(true);
}
function docs2PaidToggle(key) {
    if (_d2P.open.has(key)) _d2P.open.delete(key); else _d2P.open.add(key);
    docs2RenderPaid(false);
}
function docs2PaidToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderPaid(true);
}

function docs2RenderPaid(reapplyView) {
    const box = document.getElementById('docs2Paid');
    if (!box) return;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    const ordById = new Map((typeof orders !== 'undefined' ? orders : []).map(o => [o.id, o]));
    const rows = _d2PRows.map(p => {
        const o = ordById.get(p.order_id) || null;
        const key = o ? String(o.customer_id || ('n:' + (o.customer || ''))) : 'x';
        const name = o ? (o.customer || t('orders_no_customer')) : t('orders_no_customer');
        return { p, o, key, name, c: Math.round(Number(p.amount || 0) * 100), ym: String(p.paid_at || '').slice(0, 7) };
    });
    const base = rows.filter(r => (!_d2P.cust || r.key === _d2P.cust) && (!_d2P.period || r.ym === _d2P.period));
    const sumC = base.reduce((s, r) => s + r.c, 0);

    const groups = new Map();
    base.forEach(r => {
        if (!groups.has(r.key)) groups.set(r.key, { key: r.key, name: r.name, items: [], sumC: 0 });
        const g = groups.get(r.key); g.items.push(r); g.sumC += r.c;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) {
        _d2P.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1) gl.forEach(g => _d2P.open.add(g.key));
    }

    // Выпадающие списки: клиенты и месяцы по всем платежам; текущий месяц есть всегда
    const custMap = new Map();
    rows.forEach(r => custMap.set(r.key, r.name));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2PaidPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2PdCust'), ddP = document.getElementById('docs2PdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2P.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2P.cust)).join('');
    const yms = [...new Set(rows.map(r => r.ym).concat([_d2Months().cur]).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2P.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2P.period)).join('');

    const expanded = _d2View() === 'expanded';
    const row = r => {
        const o = r.o;
        const cons = o ? docs.find(x => x.kind === 'cons' && !x.cancelled && (x.memberIds || []).indexOf(o.id) >= 0) : null;
        const inv = (o && !cons) ? docs.find(x => x.kind === 'inv' && x.orderId === o.id && !x.cancelled) : null;
        const doc = cons ? t('docs2_in_cons').replace('{n}', cons.number) : (inv ? inv.number : '');
        const oname = o ? t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)) : '—';
        const click = o ? ` onclick="docs2OpenOrder(${o.id})"` : '';
        return `<div class="d2o"${click}><div class="l">
            <div class="a">${escapeHtml(oname)}</div>
            <div class="b">${escapeHtml(formatDateDMY(String(r.p.paid_at || '').slice(0, 10)))}${doc ? ' · ' + escapeHtml(doc) : ''}</div></div>
            <div class="r"><b>${escapeHtml(formatMoney(r.c / 100))}</b></div></div>`;
    };
    const groupHtml = gl.map(g => {
        const open = _d2P.open.has(g.key);
        const body = open ? g.items.slice().sort((a, b) => String(b.p.paid_at).localeCompare(String(a.p.paid_at))).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2PaidToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${escapeHtml(t('docs2_pays_line').replace('{n}', g.items.length))}</small></div>
            <span class="sm">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    box.innerHTML = `<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(t('docs2_received') + ' \u00b7 ' + t('docs2_pays_line').replace('{n}', base.length))}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b></div></div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2P.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2PdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2P.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2PdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2PaidToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_paid_empty'))}</p>`}`;
}

// ==================== Страница «К выставлению» (1.11.2026) ====================
// Заказы без счёта по клиентам (та же логика, что во вкладке старого раздела). Выставление — через окно отправки документа.
let _d2T = { cust: '', period: '', open: new Set() };

function openDocs2Todo() {
    if (!docs2Allowed()) return;
    _d2T.cust = '';
    _d2T.period = '';
    openAppPage('docs2TodoPage');
    docs2RenderTodo(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2TodoPage = () => docs2RenderTodo(false);

function docs2TodoPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2T[field === 'per' ? 'period' : 'cust'] = v;
    docs2RenderTodo(true);
}
function docs2TodoToggle(key) {
    if (_d2T.open.has(key)) _d2T.open.delete(key); else _d2T.open.add(key);
    docs2RenderTodo(false);
}
function docs2TodoToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderTodo(true);
}
function docs2TodoIssue(orderId, cons) {
    if (typeof openSendDocumentSheet === 'function') openSendDocumentSheet(orderId, 'invoice', cons ? { preferCons: true } : undefined);
}

function docs2RenderTodo(reapplyView) {
    const box = document.getElementById('docs2Todo');
    if (!box) return;
    const all = (typeof orders !== 'undefined' ? orders : []).filter(o => typeof orderNeedsInvoice === 'function' && orderNeedsInvoice(o));
    const ymOf = o => String(o.date || '').slice(0, 7);
    const keyOf = o => String(o.customer_id || ('n:' + (o.customer || '')));
    const base = all.filter(o => (!_d2T.cust || keyOf(o) === _d2T.cust) && (!_d2T.period || ymOf(o) === _d2T.period));
    const totC = o => Math.round(orderGrandTotal(o) * 100);
    const sumC = base.reduce((s, o) => s + totC(o), 0);

    // Группы клиент + год (сводный счёт — только из заказов одного года)
    const byG = new Map();
    base.forEach(o => {
        const name = o.customer || t('orders_no_customer');
        const yr = String(o.date || '').slice(0, 4);
        const k = keyOf(o) + '|' + yr;
        if (!byG.has(k)) byG.set(k, { key: k, name, yr, items: [], sumC: 0 });
        const g = byG.get(k); g.items.push(o); g.sumC += totC(o);
    });
    const gl = [...byG.values()].sort((a, b) => b.sumC - a.sumC);
    const yrsByName = {};
    gl.forEach(g => { (yrsByName[g.name] = yrsByName[g.name] || new Set()).add(g.yr); });
    gl.forEach(g => { g.title = yrsByName[g.name].size > 1 && g.yr ? g.name + ' · ' + g.yr : g.name; });
    if (reapplyView) {
        _d2T.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1) gl.forEach(g => _d2T.open.add(g.key));
    }

    const custMap = new Map();
    all.forEach(o => custMap.set(keyOf(o), o.customer || t('orders_no_customer')));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2TodoPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2TdCust'), ddP = document.getElementById('docs2TdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2T.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2T.cust)).join('');
    const yms = [...new Set(all.map(ymOf).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2T.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2T.period)).join('');

    const expanded = _d2View() === 'expanded';
    const row = o => `<div class="d2o"><div class="l" onclick="docs2OpenOrder(${o.id})">
            <div class="a">${escapeHtml(t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)))}</div>
            <div class="b">${escapeHtml(formatDateDMY(o.date))}</div></div>
            <div class="r"><b>${escapeHtml(formatMoney(totC(o) / 100))}</b></div>
            <button type="button" class="d2btn" onclick="docs2TodoIssue(${o.id}, false)">${escapeHtml(t('docs_todo_issue_short'))}</button></div>`;
    const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.id - b.id);
    const groupHtml = gl.map(g => {
        const open = _d2T.open.has(g.key);
        const body = open ? g.items.slice().sort(byDate).map(row).join('') : '';
        const consBtn = g.items.length > 1 ? `<button type="button" class="d2btn on" onclick="event.stopPropagation(); docs2TodoIssue(${g.items.slice().sort(byDate)[0].id}, true)">${escapeHtml(t('docs_todo_issue'))}</button>` : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2TodoToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.title)}</b><small>${g.items.length} ${escapeHtml(nWord(g.items.length, 'word_orders'))} · ${escapeHtml(formatMoney(g.sumC / 100))}</small></div>${consBtn}</div>${body}</div>`;
    }).join('');

    let banner = '';
    const nowD = typeof orgNowDate === 'function' ? orgNowDate() : new Date();
    if (nowD.getMonth() === 11 && nowD.getDate() >= 15) {
        const left = all.filter(o => String(o.date || '').slice(0, 4) === String(nowD.getFullYear())).length;
        if (left) banner = `<div class="d2warn">${escapeHtml(t('docs_year_end_banner').replace('{n}', left))}</div>`;
    }

    box.innerHTML = `${banner}<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(t('docs_tab_todo') + ' · ' + base.length + ' ' + nWord(base.length, 'word_orders'))}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b></div></div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2T.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2TdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2T.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2TdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2TodoToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml + `<div class="d2hint">${escapeHtml(t('docs_todo_hint'))}</div>` : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs_todo_empty'))}</p>`}`;
}


// ==================== Страница «Не отправлены» (1.11.2026) ====================
// Заказы (по заказам, как и остальное): счёт выставлен, но клиенту не отправлен; заказ ещё не оплачен полностью.
// Оплаченные без отметки отправки сюда не попадают. Накладные не учитываются (не обязательный документ).
function _d2Unsent() {
    return _d2Unpaid().filter(u => { const d = u.cons || u.inv; return !!d && !d.sentAt; });
}
let _d2U = { cust: '', period: '', open: new Set() };

function openDocs2Unsent() {
    if (!docs2Allowed()) return;
    _d2U.cust = '';
    _d2U.period = '';
    openAppPage('docs2UnsentPage');
    docs2RenderUnsent(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2UnsentPage = () => docs2RenderUnsent(false);

function docs2UnsentPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2U[field === 'per' ? 'period' : 'cust'] = v;
    docs2RenderUnsent(true);
}
function docs2UnsentToggle(key) {
    if (_d2U.open.has(key)) _d2U.open.delete(key); else _d2U.open.add(key);
    docs2RenderUnsent(false);
}
function docs2UnsentToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderUnsent(true);
}
function docs2UnsentSend(orderId, cons) {
    if (typeof openSendDocumentSheet === 'function') openSendDocumentSheet(orderId, 'invoice', cons ? { preferCons: true } : undefined);
}

function docs2RenderUnsent(reapplyView) {
    const box = document.getElementById('docs2Unsent');
    if (!box) return;
    const all = _d2Unsent();
    const ymOf = u => String(u.o.date || '').slice(0, 7);
    const base = all.filter(u => (!_d2U.cust || _d2GroupKey(u) === _d2U.cust) && (!_d2U.period || ymOf(u) === _d2U.period));
    const sumC = base.reduce((s, u) => s + u.remC, 0);

    const groups = new Map();
    base.forEach(u => {
        const k = _d2GroupKey(u);
        if (!groups.has(k)) groups.set(k, { key: k, name: u.o.customer || t('orders_no_customer'), items: [], sumC: 0 });
        const g = groups.get(k); g.items.push(u); g.sumC += u.remC;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) {
        _d2U.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1) gl.forEach(g => _d2U.open.add(g.key));
    }

    const custMap = new Map();
    all.forEach(u => custMap.set(_d2GroupKey(u), u.o.customer || t('orders_no_customer')));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2UnsentPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2UdCust'), ddP = document.getElementById('docs2UdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2U.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2U.cust)).join('');
    const yms = [...new Set(all.map(ymOf).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2U.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2U.period)).join('');

    const expanded = _d2View() === 'expanded';
    const row = u => {
        const o = u.o;
        const doc = u.cons ? t('docs2_in_cons').replace('{n}', u.cons.number) : u.inv.number;
        return `<div class="d2o"><div class="l" onclick="docs2OpenOrder(${o.id})">
            <div class="a">${escapeHtml(t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)))}</div>
            <div class="b">${escapeHtml(formatDateDMY(o.date))} \u00b7 ${escapeHtml(doc)}</div></div>
            <div class="r"><b>${escapeHtml(formatMoney(u.remC / 100))}</b></div>
            <button type="button" class="d2btn" onclick="docs2UnsentSend(${o.id}, ${u.cons ? 'true' : 'false'})">${escapeHtml(t('docs_send'))}</button></div>`;
    };
    const byDate = (a, b) => String(a.o.date || '').localeCompare(String(b.o.date || '')) || (a.o.id - b.o.id);
    const groupHtml = gl.map(g => {
        const open = _d2U.open.has(g.key);
        const body = open ? g.items.slice().sort(byDate).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2UnsentToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${g.items.length} ${escapeHtml(nWord(g.items.length, 'word_orders'))}</small></div>
            <span class="sm">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    box.innerHTML = `<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(t('docs2_tosend_t') + ' \u00b7 ' + base.length + ' ' + nWord(base.length, 'word_orders'))}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b></div></div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2U.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2UdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2U.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2UdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2UnsentToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_unsent_empty'))}</p>`}`;
}


// ==================== Страница «Накладные» (1.11.2026) ====================
// Выставленные накладные (по клиентам; период по умолчанию — текущий месяц). Кнопка «Не отправлены» оставляет неотправленные.
// Кнопка «Без накладной» переключает список на заказы без накладной — оттуда накладную можно выставить.
const _D2_DN_ICONS = {
    unsent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.2"/></svg>',
    nodn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/></svg>'
};
let _d2D = { cust: '', period: '', unsent: false, nodn: false, open: new Set() };

function openDocs2Dn() {
    if (!docs2Allowed()) return;
    _d2D.cust = '';
    _d2D.period = _d2Months().cur;
    _d2D.unsent = false;
    _d2D.nodn = false;
    openAppPage('docs2DnPage');
    docs2RenderDn(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2DnPage = () => docs2RenderDn(false);

function docs2DnPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2D[field === 'per' ? 'period' : 'cust'] = v;
    docs2RenderDn(true);
}
function docs2DnFlag(field) {
    // «Не отправлены» и «Без накладной» не сочетаются: включая одну, выключаем другую
    const on = !_d2D[field];
    _d2D.unsent = false; _d2D.nodn = false;
    _d2D[field] = on;
    docs2RenderDn(true);
}
function docs2DnToggle(key) {
    if (_d2D.open.has(key)) _d2D.open.delete(key); else _d2D.open.add(key);
    docs2RenderDn(false);
}
function docs2DnToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderDn(true);
}
function docs2DnIssue(orderId) {
    if (typeof openSendDocumentSheet === 'function') openSendDocumentSheet(orderId, 'delivery_note');
}

function docs2RenderDn(reapplyView) {
    const box = document.getElementById('docs2Dn');
    if (!box) return;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    // Единый вид элемента: { key (клиент), name, ym, o (заказ), id, c (сумма), number, date, sent }
    let items;
    if (_d2D.nodn) {
        items = (typeof orders !== 'undefined' ? orders : []).filter(o => isOrderSaved(o) && !o.dn_no).map(o => ({
            key: String(o.customer_id || ('n:' + (o.customer || ''))), name: o.customer || t('orders_no_customer'),
            ym: String(o.date || '').slice(0, 7), oid: o.id, onum: o.order_number, c: Math.round(orderGrandTotal(o) * 100), date: o.date, number: '', sent: true }));
    } else {
        items = docs.filter(d => d.kind === 'dn' && !d.cancelled && !d.deleted).map(d => ({
            key: String(d.custId || ('n:' + (d.custName || ''))), name: d.custName || t('orders_no_customer'),
            ym: String(d.date || '').slice(0, 7), oid: d.orderId, onum: d.orderNumber, c: d.sumC || 0, date: d.date, number: d.number, sent: !!d.sentAt }));
        if (_d2D.unsent) items = items.filter(x => !x.sent);
    }
    const all = items;
    const base = all.filter(x => (!_d2D.cust || x.key === _d2D.cust) && (!_d2D.period || x.ym === _d2D.period));
    const sumC = base.reduce((s, x) => s + x.c, 0);

    const groups = new Map();
    base.forEach(x => {
        if (!groups.has(x.key)) groups.set(x.key, { key: x.key, name: x.name, items: [], sumC: 0 });
        const g = groups.get(x.key); g.items.push(x); g.sumC += x.c;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) {
        _d2D.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1) gl.forEach(g => _d2D.open.add(g.key));
    }

    const custMap = new Map();
    all.forEach(x => custMap.set(x.key, x.name));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2DnPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2DnCust'), ddP = document.getElementById('docs2DnPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2D.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2D.cust)).join('');
    const yms = [...new Set(all.map(x => x.ym).concat([_d2Months().cur]).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2D.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2D.period)).join('');

    const expanded = _d2View() === 'expanded';
    const gold = x => `<span class="d2gold">${escapeHtml(x)}</span>`;
    const row = x => {
        const oname = t('docs2_order').replace('{n}', x.onum || ('#' + x.oid));
        if (_d2D.nodn) {
            return `<div class="d2o"><div class="l" onclick="docs2OpenOrder(${x.oid})">
                <div class="a">${escapeHtml(oname)}</div><div class="b">${escapeHtml(formatDateDMY(x.date))}</div></div>
                <div class="r"><b>${escapeHtml(formatMoney(x.c / 100))}</b></div>
                <button type="button" class="d2btn" onclick="docs2DnIssue(${x.oid})">${escapeHtml(t('docs2_dn_btn'))}</button></div>`;
        }
        return `<div class="d2o" onclick="docs2OpenOrder(${x.oid})"><div class="l">
            <div class="a">${escapeHtml(x.number || '')}</div>
            <div class="b">${escapeHtml(formatDateDMY(x.date))} \u00b7 ${escapeHtml(oname)}</div>
            ${x.sent ? '' : `<div class="c">${gold(t('docs2_dn_not_sent'))}</div>`}</div>
            <div class="r"><b>${escapeHtml(formatMoney(x.c / 100))}</b></div></div>`;
    };
    const byDate = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.oid - a.oid);
    const groupHtml = gl.map(g => {
        const open = _d2D.open.has(g.key);
        const body = open ? g.items.slice().sort(byDate).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2DnToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${escapeHtml(_d2D.nodn ? (g.items.length + ' ' + nWord(g.items.length, 'word_orders')) : (t('docs2_dn_word') + ': ' + g.items.length))}</small></div>
            <span class="sm">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    const lbl = _d2D.nodn ? t('docs2_dn_none_t') : (_d2D.unsent ? t('docs2_dn_unsent_t') : t('docs_type_dn'));
    const cntTxt = _d2D.nodn ? (base.length + ' ' + nWord(base.length, 'word_orders')) : (t('docs2_dn_word') + ': ' + base.length);
    box.innerHTML = `<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(lbl + ' \u00b7 ' + cntTxt)}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b></div></div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2D.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DnCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2D.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DnPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button>
            <button type="button" class="view-toggle-btn${_d2D.unsent ? ' active' : ''}" onclick="docs2DnFlag('unsent')" title="${escapeHtml(t('docs2_dn_unsent_t'))}">${_D2_DN_ICONS.unsent}</button>
            <button type="button" class="view-toggle-btn${_d2D.nodn ? ' active' : ''}" onclick="docs2DnFlag('nodn')" title="${escapeHtml(t('docs2_dn_none_t'))}">${_D2_DN_ICONS.nodn}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2DnToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t(_d2D.nodn ? 'docs2_dn_none_empty' : 'docs2_dn_empty'))}</p>`}`;
}


// ==================== Страница «Все документы» (1.11.2026) ====================
// Реестр выставленных документов: счета, сводные счета, накладные. Счета, вошедшие в сводный, отдельно не показываются.
// Поиск по номеру и клиенту (при поиске период не ограничивает), фильтры: клиент, период (по умолчанию текущий месяц), тип, статус.
const _D2_ALL_ICONS = {
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    st: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>'
};
let _d2A = { q: '', cust: '', period: '', type: '', st: '', open: new Set(), cons: new Set() };

function openDocs2All() {
    if (!docs2Allowed()) return;
    _d2A = { q: '', cust: '', period: _d2Months().cur, type: '', st: '', open: new Set(), cons: new Set() };
    openAppPage('docs2AllPage');
    docs2RenderAll(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2AllPage = () => docs2RenderAll(false);

function docs2AllPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2A[field === 'per' ? 'period' : field] = v;
    docs2RenderAll(true);
}
function docs2AllToggle(key) {
    if (_d2A.open.has(key)) _d2A.open.delete(key); else _d2A.open.add(key);
    docs2RenderAll(false);
}
function docs2AllToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderAll(true);
}
function docs2AllSearch(v) {
    _d2A.q = v;
    docs2RenderAll(true, true);
}
function docs2AllOpen(oid) { if (oid) docs2OpenOrder(oid); }
function docs2AllCons(key) {
    if (_d2A.cons.has(key)) _d2A.cons.delete(key); else _d2A.cons.add(key);
    docs2RenderAll(false);
}

function docs2RenderAll(reapplyView, keepFocus) {
    const box = document.getElementById('docs2All');
    if (!box) return;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    const inCons = new Set();
    docs.forEach(d => { if (d.kind === 'cons' && !d.cancelled) (d.memberIds || []).forEach(id => inCons.add(id)); });
    const norm = typeof _docsNorm === 'function' ? _docsNorm : (x => String(x || '').toLowerCase());
    const all = docs.filter(d => !d.cancelled && !d.deleted && !(d.kind === 'inv' && inCons.has(d.orderId))).map(d => ({
        d, key: String(d.custId || ('n:' + (d.custName || ''))), name: d.custName || t('orders_no_customer'),
        ym: String(d.date || '').slice(0, 7), c: d.sumC || 0,
        oid: d.kind === 'cons' ? d.liveMemberId : d.orderId }));
    const q = norm(_d2A.q);
    const stOk = x => {
        const d = x.d;
        if (!_d2A.st) return true;
        if (_d2A.st === 'unsent') return !d.sentAt;
        if (d.kind === 'dn') return false;
        if (_d2A.st === 'paid') return d.pay === 'paid';
        return d.pay === 'unpaid' || d.pay === 'partial';
    };
    const base = all.filter(x => (!q || norm(x.d.number).includes(q) || norm(x.name).includes(q))
        && (!_d2A.cust || x.key === _d2A.cust)
        && (q || !_d2A.period || x.ym === _d2A.period)
        && (!_d2A.type || (_d2A.type === 'dn' ? x.d.kind === 'dn' : x.d.kind !== 'dn'))
        && stOk(x));
    const sumC = base.reduce((s, x) => s + x.c, 0);

    const groups = new Map();
    base.forEach(x => {
        if (!groups.has(x.key)) groups.set(x.key, { key: x.key, name: x.name, items: [], sumC: 0 });
        const g = groups.get(x.key); g.items.push(x); g.sumC += x.c;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) {
        _d2A.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1 || q) gl.forEach(g => _d2A.open.add(g.key));
    }

    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2AllPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const custMap = new Map();
    all.forEach(x => custMap.set(x.key, x.name));
    const set = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    set('docs2AdCust', opt('cust', '', t('docs_customer_all'), !_d2A.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2A.cust)).join(''));
    const yms = [...new Set(all.map(x => x.ym).concat([_d2Months().cur]).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    set('docs2AdPer', opt('per', '', t('docs_period_all'), !_d2A.period) + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2A.period)).join(''));
    set('docs2AdType', opt('type', '', t('docs_type_all'), !_d2A.type) + opt('type', 'inv', t('docs_type_inv'), _d2A.type === 'inv') + opt('type', 'dn', t('docs_type_dn'), _d2A.type === 'dn'));
    set('docs2AdSt', opt('st', '', t('docs_type_all'), !_d2A.st) + opt('st', 'paid', t('docs_tile_paid'), _d2A.st === 'paid')
        + opt('st', 'unpaid', t('docs2_unpaid_t'), _d2A.st === 'unpaid') + opt('st', 'unsent', t('docs2_unsent_t'), _d2A.st === 'unsent'));

    const expanded = _d2View() === 'expanded';
    const gold = x => `<span class="d2gold">${escapeHtml(x)}</span>`;
    const row = x => {
        const d = x.d;
        const what = d.kind === 'cons' ? t('docs2_cons_n').replace('{n}', d.memberCount || (d.memberIds || []).length)
            : t('docs2_order').replace('{n}', d.orderNumber || ('#' + d.orderId));
        let st = [];
        if (d.kind !== 'dn') {
            if (d.pay === 'paid') st.push(escapeHtml(t('docs2_st_paid')));
            else if (d.pay === 'partial') st.push(gold(t('docs_partial')));
            else if (d.pay === 'unpaid') st.push(escapeHtml(t('docs2_st_unpaid')));
        }
        if (!d.sentAt) st.push(gold(t('docs_not_sent_cap')));
        const isCons = d.kind === 'cons';
        const cOpen = isCons && _d2A.cons.has(d.key);
        const main = `<div class="d2o" onclick="${isCons ? "docs2AllCons(\'" + escapeHtml(d.key) + "\')" : 'docs2AllOpen(' + (x.oid || 0) + ')'}"><div class="l">
            <div class="a">${escapeHtml(d.number || '')}</div>
            <div class="b">${escapeHtml(formatDateDMY(d.date))} \u00b7 ${escapeHtml(what)}</div>
            ${st.length ? `<div class="c">${st.join(' \u00b7 ')}</div>` : ''}</div>
            <div class="r"><b>${escapeHtml(formatMoney(x.c / 100))}</b></div>${isCons ? `<span class="d2ch">${cOpen ? '&#8964;' : '&rsaquo;'}</span>` : ''}</div>`;
        if (!cOpen) return main;
        // Заказы сводного счёта со служебной информацией: оплата, отправка счёта, накладная и её отправка
        const gold2 = z => `<span class="d2gold">${escapeHtml(z)}</span>`;
        const subs = (typeof orders !== 'undefined' ? orders : []).filter(o => (d.memberIds || []).indexOf(o.id) >= 0)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.id - b.id)).map(o => {
            const ps = getOrderPaymentStatus(o);
            const pay = ps.status === 'paid' ? escapeHtml(t('docs2_st_paid')) : (ps.status === 'partial' ? gold2(t('docs_partial')) : escapeHtml(t('docs2_st_unpaid')));
            const inv = o.invoice_sent_at ? escapeHtml(t('docs2_svc_inv_sent')) : gold2(t('docs2_svc_inv_not'));
            const dn = o.dn_no ? escapeHtml(t('docs2_svc_dn').replace('{n}', _formatDocNumber('delivery_note', o.dn_no)) + ' \u00b7 ')
                + (o.delivery_note_sent_at ? escapeHtml(t('docs2_svc_sent')) : gold2(t('docs2_svc_not_sent'))) : escapeHtml(t('docs2_svc_nodn'));
            return `<div class="d2o d2sub" onclick="docs2AllOpen(${o.id})"><div class="l">
                <div class="a">${escapeHtml(t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)))}</div>
                <div class="b">${escapeHtml(formatDateDMY(o.date))} \u00b7 ${pay}</div>
                <div class="c">${inv} \u00b7 ${dn}</div></div>
                <div class="r"><b>${escapeHtml(formatMoney(orderGrandTotal(o)))}</b></div></div>`;
        }).join('');
        return main + subs;
    };
    const byDate = (a, b) => String(b.d.date || '').localeCompare(String(a.d.date || '')) || String(b.d.rawNumber).localeCompare(String(a.d.rawNumber));
    const groupHtml = gl.map(g => {
        const open = _d2A.open.has(g.key);
        const body = open ? g.items.slice().sort(byDate).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2AllToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${escapeHtml(t('docs2_docs_line').replace('{n}', g.items.length))}</small></div>
            <span class="sm">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    // Активные фильтры словами — чтобы было видно, за какой период и по чему показан список
    const fl = [];
    fl.push(q ? t('docs2_search_all') : (_d2A.period ? _docsMonthLabel(_d2A.period) : t('docs2_period_none')));
    if (_d2A.cust) fl.push(custMap.get(_d2A.cust) || '');
    if (_d2A.type) fl.push(_d2A.type === 'dn' ? t('docs_type_dn') : t('docs_type_inv'));
    if (_d2A.st) fl.push(_d2A.st === 'paid' ? t('docs_tile_paid') : (_d2A.st === 'unpaid' ? t('docs2_unpaid_t') : t('docs2_unsent_t')));
    const hadFocus = keepFocus && document.activeElement && document.activeElement.id === 'docs2AllQ';
    box.innerHTML = `<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(t('docs2_all') + ' \u00b7 ' + t('docs2_docs_line').replace('{n}', base.length))}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b><em class="d2flt">${escapeHtml(fl.join(' \u00b7 '))}</em></div></div>
        <input id="docs2AllQ" type="search" class="d2search" placeholder="${escapeHtml(t('docs_search_placeholder'))}" value="${escapeHtml(_d2A.q)}" oninput="docs2AllSearch(this.value)">
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2A.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2AdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2A.period && !q ? ' active' : ''}" onclick="toggleFilterDropdown('docs2AdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button>
            <button type="button" class="view-toggle-btn${_d2A.type ? ' active' : ''}" onclick="toggleFilterDropdown('docs2AdType')">${_D2_ALL_ICONS.type}</button>
            <button type="button" class="view-toggle-btn${_d2A.st ? ' active' : ''}" onclick="toggleFilterDropdown('docs2AdSt')">${_D2_ALL_ICONS.st}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2AllToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_all_empty'))}</p>`}`;
    if (hadFocus) { const i = document.getElementById('docs2AllQ'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} } }
}


// Документы одного клиента (из карточки клиента и из окна отправки): сразу «Все документы» с фильтром по клиенту, за всё время.
async function openDocs2Customer(custId) {
    if (!docs2Allowed() || !custId) return;
    showLoading();
    try {
        await _docsLoad();
    } catch (e) {
        console.error('Документы 2: ошибка загрузки', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    _d2A = { q: '', cust: String(custId), period: '', type: '', st: '', open: new Set(), cons: new Set() };
    openAppPage('docs2AllPage');
    docs2RenderAll(true);
}
