// ==================== ИНФОРМАЦИЯ О КОМПАНИИ ====================
// Карточка реквизитов организации: физ./юр. лицо, контакты, банковские
// реквизиты, валюта расчёта. Открывается из Настроек (только владелец).
// Зависит от: db (supabaseClient.js), currentOrgId, currentOrgName,
// currentOrgCurrency, currentOrgVatRate (employees.js), showLoading/hideLoading/showInfo,
// updateChecked (helpers.js),
// showAutosaveToast, updateHeaderOrgName (employees.js), logActivity.

let _companyEntityType = 'company'; // текущее выбранное значение в открытой карточке

// Евро/доллар — по умолчанию, остальные — валюты русскоязычных стран
// (страны бывшего СССР; страны Прибалтики уже покрываются евро) + польский злотый.
const CURRENCY_OPTIONS = [
    { code: 'EUR', label: 'Евро (€)' },
    { code: 'USD', label: 'Доллар США ($)' },
    { code: 'PLN', label: 'Польский злотый (zł)' },
    { code: 'RUB', label: 'Российский рубль (₽)' },
    { code: 'BYN', label: 'Белорусский рубль (Br)' },
    { code: 'KZT', label: 'Казахстанский тенге (₸)' },
    { code: 'KGS', label: 'Киргизский сом (с)' },
    { code: 'UZS', label: 'Узбекский сум' },
    { code: 'TJS', label: 'Таджикский сомони' },
    { code: 'TMT', label: 'Туркменский манат (m)' },
    { code: 'AZN', label: 'Азербайджанский манат (₼)' },
    { code: 'AMD', label: 'Армянский драм (֏)' },
    { code: 'GEL', label: 'Грузинский лари (₾)' },
    { code: 'MDL', label: 'Молдавский лей (L)' },
    { code: 'UAH', label: 'Украинская гривна (₴)' },
];

function currencyLabel(code) {
    const found = CURRENCY_OPTIONS.find(c => c.code === code);
    return found ? found.label : code;
}

// ==================== СТРАНА (определяет валюту и ставку НДС по умолчанию) ====================
// Стартовый набор: несколько стран ЕС (первый рынок) + весь список русскоязычных
// стран бывшего СССР (обязательный охват). Ставки НДС актуальны на 2026 год и могут
// меняться — при выборе страны они лишь подставляются как отправная точка,
// после чего остаются полностью редактируемыми вручную (см. selectCountry()).
const COUNTRY_OPTIONS = [
    { code: 'LT', label: 'Литва', currency: 'EUR', vatRate: 0.21 },
    { code: 'LV', label: 'Латвия', currency: 'EUR', vatRate: 0.21 },
    { code: 'EE', label: 'Эстония', currency: 'EUR', vatRate: 0.24 },
    { code: 'DE', label: 'Германия', currency: 'EUR', vatRate: 0.19 },
    { code: 'PL', label: 'Польша', currency: 'PLN', vatRate: 0.23 },
    { code: 'RU', label: 'Россия', currency: 'RUB', vatRate: 0.22 },
    { code: 'BY', label: 'Беларусь', currency: 'BYN', vatRate: 0.20 },
    { code: 'KZ', label: 'Казахстан', currency: 'KZT', vatRate: 0.16 },
    { code: 'KG', label: 'Киргизия', currency: 'KGS', vatRate: 0.12 },
    { code: 'UZ', label: 'Узбекистан', currency: 'UZS', vatRate: 0.12 },
    { code: 'TJ', label: 'Таджикистан', currency: 'TJS', vatRate: 0.14 },
    { code: 'TM', label: 'Туркменистан', currency: 'TMT', vatRate: 0.15 },
    { code: 'AZ', label: 'Азербайджан', currency: 'AZN', vatRate: 0.18 },
    { code: 'AM', label: 'Армения', currency: 'AMD', vatRate: 0.20 },
    { code: 'GE', label: 'Грузия', currency: 'GEL', vatRate: 0.18 },
    { code: 'MD', label: 'Молдова', currency: 'MDL', vatRate: 0.20 },
    { code: 'UA', label: 'Украина', currency: 'UAH', vatRate: 0.20 },
];

function countryLabel(code) {
    const found = COUNTRY_OPTIONS.find(c => c.code === code);
    return found ? found.label : 'Не указана';
}

function renderCurrencyDropdown() {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    dropdown.innerHTML = CURRENCY_OPTIONS.map(c =>
        `<div onclick="selectCurrency('${c.code}')" class="table-text px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer">${c.label}</div>`
    ).join('');
}

function toggleCurrencyDropdown() {
    document.getElementById('cmpCurrencyDropdown').classList.toggle('hidden');
}

function selectCurrency(code) {
    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(code);
    document.getElementById('cmpCurrencyDropdown').classList.add('hidden');
    saveCompanyInfo('currency_code', code);
}

function renderCountryDropdown() {
    const dropdown = document.getElementById('cmpCountryDropdown');
    dropdown.innerHTML = COUNTRY_OPTIONS.map(c =>
        `<div onclick="selectCountry('${c.code}')" class="table-text px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer">${c.label}</div>`
    ).join('');
}

function toggleCountryDropdown() {
    document.getElementById('cmpCountryDropdown').classList.toggle('hidden');
}

// Выбор страны: сохраняет саму страну и одновременно подставляет валюту
// и ставку НДС по умолчанию для неё. Оба поля остаются редактируемыми
// вручную сразу после этого — подстановка лишь отправная точка.
async function selectCountry(code) {
    const found = COUNTRY_OPTIONS.find(c => c.code === code);
    document.getElementById('cmpCountryLabel').textContent = countryLabel(code);
    document.getElementById('cmpCountryDropdown').classList.add('hidden');

    if (!found) { await saveCompanyInfo('country', code); return; }

    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(found.currency);
    document.getElementById('cmpVatRate').value = (found.vatRate * 100).toString();

    showLoading('Сохранение...');
    try {
        await updateChecked(db.from('organizations')
            .update({ country: code, currency_code: found.currency, vat_rate: found.vatRate })
            .eq('id', currentOrgId));
        currentOrgCurrency = found.currency;
        currentOrgVatRate = found.vatRate;
        logActivity('system', `Изменена страна в информации о компании: ${found.label}`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сохранить страну. Проверьте подключение.');
    } finally {
        hideLoading();
    }
}

// Ставка НДС хранится в базе как доля (0.21), а вводится пользователем в процентах (21).
function saveVatRatePercent(percentStr) {
    const pct = parseFloat(String(percentStr).replace(',', '.'));
    if (isNaN(pct) || pct < 0 || pct > 100) {
        showInfo('Ставка НДС должна быть числом от 0 до 100.');
        return;
    }
    saveCompanyInfo('vat_rate', pct / 100);
}

// Закрытие выпадающего списка валют по клику снаружи (как у фильтра заказов)
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    const btn = document.getElementById('cmpCurrencyBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

// Закрытие выпадающего списка стран по клику снаружи — тот же паттерн
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('cmpCountryDropdown');
    const btn = document.getElementById('cmpCountryBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

async function openCompanyInfoModal() {
    showLoading();
    try {
        const { data, error } = await db.from('organizations')
            .select('name, currency_code, country, vat_rate, entity_type, phone, email, address, legal_name, reg_number, vat_code, director_name, personal_code, bank_name, bank_account, bank_swift')
            .eq('id', currentOrgId)
            .single();
        if (error) throw error;

        document.getElementById('cmpOrgName').value      = data.name || '';
        renderCountryDropdown();
        document.getElementById('cmpCountryLabel').textContent = countryLabel(data.country);
        renderCurrencyDropdown();
        document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(data.currency_code || 'EUR');
        document.getElementById('cmpVatRate').value = data.vat_rate != null ? (Number(data.vat_rate) * 100).toString() : '21';
        document.getElementById('cmpPhone').value        = data.phone || '';
        document.getElementById('cmpEmail').value        = data.email || '';
        document.getElementById('cmpAddress').value      = data.address || '';
        document.getElementById('cmpLegalName').value    = data.legal_name || '';
        document.getElementById('cmpRegNumber').value    = data.reg_number || '';
        document.getElementById('cmpVatCode').value      = data.vat_code || '';
        document.getElementById('cmpDirectorName').value = data.director_name || '';
        document.getElementById('cmpPersonalCode').value = data.personal_code || '';
        document.getElementById('cmpBankName').value     = data.bank_name || '';
        document.getElementById('cmpBankAccount').value  = data.bank_account || '';
        document.getElementById('cmpBankSwift').value    = data.bank_swift || '';

        setCompanyEntityType(data.entity_type || 'company', /*skipSave*/ true);
        document.getElementById('companyInfoModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo('Не удалось загрузить информацию о компании.');
    } finally {
        hideLoading();
    }
}

// Переключение Физ. лицо / Юр. лицо — показывает нужный блок полей
// и (если это не просто отрисовка при открытии) сохраняет выбор.
function setCompanyEntityType(type, skipSave) {
    _companyEntityType = type;
    const isCompany = type === 'company';

    document.getElementById('cmpCompanyFields').classList.toggle('hidden', !isCompany);
    document.getElementById('cmpIndividualFields').classList.toggle('hidden', isCompany);

    const companyBtn    = document.getElementById('cmpEntityCompanyBtn');
    const individualBtn = document.getElementById('cmpEntityIndividualBtn');
    companyBtn.className    = 'btn flex-1 text-xs py-1 rounded-xl border' + (isCompany ? ' bg-indigo-600 text-white border-indigo-600' : ' bg-white text-gray-700');
    individualBtn.className = 'btn flex-1 text-xs py-1 rounded-xl border' + (!isCompany ? ' bg-indigo-600 text-white border-indigo-600' : ' bg-white text-gray-700');

    if (!skipSave) saveCompanyInfo('entity_type', type);
}

// Универсальное сохранение одного поля карточки компании.
async function saveCompanyInfo(field, value) {
    try {
        await updateChecked(db.from('organizations').update({ [field]: value }).eq('id', currentOrgId));

        // Локально обновляем то, что используется в остальном приложении
        if (field === 'name') {
            currentOrgName = value;
            updateHeaderOrgName();
        }
        if (field === 'currency_code') {
            currentOrgCurrency = value;
        }
        if (field === 'vat_rate') {
            currentOrgVatRate = Number(value);
        }

        logActivity('system', `Изменено поле «${field}» в информации о компании`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сохранить изменение. Проверьте подключение.');
    }
}
