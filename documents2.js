// ==================== НОВЫЙ РАЗДЕЛ «ДОКУМЕНТЫ» — шаг 1: главный экран (31.10.2026) ====================
// ТЕСТ: пока виден только в id1 (currentOrgProtected). Старый documents.js не меняется и работает у всех.
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

// Кому показывать новый раздел. Сейчас — только защищённой организации id1.
// Когда откроем всем: убрать условие currentOrgProtected (одна строка).
function docs2Allowed() {
    if (typeof currentOrgProtected === 'undefined' || !currentOrgProtected) return false;
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
    exp:   '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 15v4h14v-4"/>'
};
function _d2Icon(key) {
    return `<svg class="dashboard-card__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_D2_ICONS[key]}</svg>`;
}

// Плитка-квадрат: число/сумма, строка пояснения, подвал «слева — справа»
function _d2Tile(o) {
    return `<div class="dashboard-card dc2${o.cls ? ' ' + o.cls : ''}" role="button" tabindex="0" onclick="${o.click || 'docs2Soon()'}">
        <div class="dashboard-card__hd ${o.color}">${_d2Icon(o.icon)}<span class="dashboard-card__label">${escapeHtml(o.label)}</span></div>
        <div class="dc-val"><span class="dashboard-card__value">${o.value}</span></div>
        <div class="dc-mid"><div class="sth-wrow"><span>${escapeHtml(o.mid || '')}</span></div></div>
        <div class="dc-foot"><span>${escapeHtml(o.footL || '')}</span><em>${escapeHtml(o.footR || '')}</em></div>
    </div>`;
}

function docs2RenderHome() {
    const box = document.getElementById('docs2Home');
    if (!box) return;
    const today = getLocalDateStr(0);
    const ym = _d2Months().cur;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];

    // ---- Документы: статусы не пересекаются (просрочено / ждут в срок / оплачены) ----
    const over = { n: 0, c: 0, maxDays: 0 };
    const wait = { n: 0, c: 0, nextDue: null };
        let unsent = 0, dnMonth = 0, lastDn = '', total = 0;
    docs.forEach(d => {
        if (d.cancelled) return;
        total++;
        if (d.kind === 'dn') {
            if (String(d.date).slice(0, 7) === ym) dnMonth++;
            if (String(d.rawNumber || '') > lastDn) lastDn = String(d.rawNumber || '');
            return;
        }
        const st = _docsInvStatus(d, today);
        if (!st) return;
        if (st.paid) return;
        if (st.wait) {
            if (st.over) {
                over.n++; over.c += d.sumC || 0;
                if (d.due) over.maxDays = Math.max(over.maxDays, _docsDayDiff(d.due, today));
            } else {
                wait.n++; wait.c += d.sumC || 0;
                if (d.due && (!wait.nextDue || d.due < wait.nextDue)) wait.nextDue = d.due;
            }
            if (st.unsent) unsent++;
        }
    });

    // ---- Заказы без счёта (главный документ — заказ) ----
    const todo = (typeof orders !== 'undefined' ? orders : []).filter(o => typeof orderNeedsInvoice === 'function' && orderNeedsInvoice(o));
    let todoSumC = 0;
    const byCust = new Map();
    todo.forEach(o => {
        todoSumC += Math.round(orderGrandTotal(o) * 100);
        const name = o.customer || t('orders_no_customer');
        byCust.set(name, (byCust.get(name) || 0) + 1);
    });
    const top = [...byCust.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const DOTS = ['#c9973a', '#5f7857', '#4f7a88'];
    const topRows = top.map(([name, n], i) => `<div class="sth-wrow"><i style="background:${DOTS[i]}"></i><span>${escapeHtml(name)}</span><b>${n}</b></div>`).join('');

    const shortDate = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] : ''; };
    const nDocs = n => t('docs2_docs_n').replace('{n}', n);

    const alertHtml = unsent
        ? `<div class="docs2-alert" role="button" tabindex="0" onclick="docs2Soon()"><span>${escapeHtml(t('docs2_unsent').replace('{n}', unsent))}</span><b>&rsaquo;</b></div>` : '';

    const wide = `<div class="dashboard-card dc2 sth-wide" role="button" tabindex="0" onclick="docs2Soon()">
        <div class="dashboard-card__hd dash-c-day">${_d2Icon('plus')}<span class="dashboard-card__label">${escapeHtml(t('docs_tab_todo'))}</span></div>
        <div class="sth-wbody"><div class="sth-wr">
            <div class="dc-val"><span class="dashboard-card__value">${todo.length}</span><span class="dc-cap">${escapeHtml(todo.length ? t('docs2_todo_cap') : t('docs_todo_empty'))}</span></div>
            <div class="dc-mid">${topRows}</div>
        </div></div>
        <div class="dc-foot"><span>${escapeHtml(todo.length ? t('docs2_todo_sum') : '')}</span><em>${todo.length ? _d2Money(todoSumC) : ''}</em></div>
    </div>`;

    const tiles = [
        _d2Tile({ color: 'dash-c-tom', icon: 'clock', label: t('docs_tile_wait'), value: _d2Money(wait.c), mid: nDocs(wait.n),
                  footL: wait.nextDue ? t('docs2_next_due') : '', footR: shortDate(wait.nextDue) }),
        _d2Tile({ color: 'dash-c-pay', icon: 'alert', label: t('docs_tile_over'), value: _d2Money(over.c), mid: nDocs(over.n),
                  footL: over.n ? t('docs2_longest') : '', footR: over.n ? t('docs2_days_short').replace('{n}', over.maxDays) : '' }),
        _d2Tile({ color: 'dash-c-acc', icon: 'check', label: t('docs_tile_paid'), value: _d2Paid ? _d2Money(_d2Paid.c) : '&mdash;', mid: _d2Paid ? t('docs2_pays_n').replace('{n}', _d2Paid.n) : '',
                  footL: _d2Paid ? t('docs2_prev_month') : '', footR: _d2Paid ? formatMoney(_d2Paid.pc / 100) : '' }),
        _d2Tile({ color: 'dash-c-stock', icon: 'dn', label: t('docs_type_dn'), value: String(dnMonth), mid: t('docs2_this_month'),
                  footL: lastDn ? t('docs2_last') : '', footR: lastDn }),
        _d2Tile({ color: 'dash-c-rev', icon: 'all', label: t('docs2_all'), value: String(total), mid: t('docs2_all_sub'), footL: t('docs2_total') }),
        _d2Tile({ color: 'dash-c-stock', icon: 'exp', label: t('docs2_export'), value: '&mdash;', mid: t('docs2_export_sub'),
                  footL: t('docs2_soon'), cls: 'docs2-soon', click: 'docs2Soon()' })
    ].join('');

    box.innerHTML = `<div class="dashboard-grid stats-home-grid">${alertHtml}${wide}${tiles}
        <div class="sth-info"><i>i</i><ul><li>${escapeHtml(t('docs2_info'))}</li></ul></div></div>`;
}
