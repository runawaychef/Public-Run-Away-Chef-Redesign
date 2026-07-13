// ==================== i18n (русский / английский) ====================
// Подход: словарь I18N.ru / I18N.en с плоскими ключами + функция t(key).
// Для статичной разметки (не генерируемой в JS построчно) используем
// атрибуты data-i18n="ключ" на элементах — applyI18n() проходит по ним и
// подставляет textContent на текущем языке. Для placeholder-ов —
// data-i18n-placeholder="ключ". Для текста, который собирается в JS
// (шаблонные строки в orders.js/products.js и т.д.), будем постепенно
// заменять зашитые русские строки на вызовы t('ключ') отдельным заходом —
// это первый этап (общая рамка приложения: нижняя навигация, окно
// настроек, приветственное окно "Написать нам").
//
// Если для ключа нет перевода на текущем языке — откатываемся на русский,
// а если нет и там — возвращаем сам ключ (чтобы не падать с ошибкой и не
// показывать undefined, а сразу было заметно в интерфейсе, что перевод
// не найден и его нужно добавить).

const I18N = {
    ru: {
        // Нижняя навигация
        nav_orders: 'Заказы',
        nav_products: 'Ассортимент',
        nav_ingredients: 'Склад',
        nav_customers: 'Клиенты',

        // Окно настроек — общее
        settings_title: 'Настройки',
        settings_current_employee_label: 'Текущий сотрудник:',
        settings_language: 'Язык интерфейса',
        settings_tariff: 'Тариф',
        settings_plan_free: 'Бесплатный',
        settings_plan_paid: 'Платный',
        settings_orders_label: 'Заказы',
        settings_of: 'из',

        company_title: 'Информация о компании',
        company_autosave: 'Изменения сохраняются автоматически',
        company_name_label: 'Название пекарни',
        company_name_placeholder: 'Например, Пекарня Анны',
        company_country_label: 'Страна',
        company_country_not_specified: 'Не указана',
        company_country_hint: 'При выборе страны валюта и ставка НДС ниже подставятся автоматически — их можно изменить вручную',
        company_currency_label: 'Валюта расчёта',
        company_vat_label: 'Ставка НДС, %',
        company_entity_type_label: 'Тип лица',
        company_entity_individual: 'Физ. лицо',
        company_entity_company: 'Юр. лицо',
        company_phone_label: 'Телефон',
        company_email_label: 'Email',
        company_address_label: 'Адрес',
        company_legal_name_label: 'Юридическое название',
        company_legal_name_placeholder: 'Например, MB Runaway Chef',
        company_reg_number_label: 'Рег. номер',
        company_vat_code_label: 'Код НДС / PVM',
        company_director_label: 'Директор / представитель',
        company_personal_code_label: 'Личный код',
        company_bank_details_label: 'Банковские реквизиты',
        company_bank_name_label: 'Банк',
        company_bank_account_label: 'IBAN / счёт',
        company_bank_swift_label: 'SWIFT / BIC',
        settings_limits_not_apply: 'Лимиты не действуют.',
        settings_company_info: 'Информация о компании',
        settings_manage_data: 'Управление данными',
        settings_download_backup: 'Скачать резервную копию',
        settings_activity_log: 'Журнал действий',
        settings_refresh_data: 'Обновить данные',
        settings_orders_trash: 'Корзина удалённых заказов',
        settings_delete_demo: 'Удалить демо-данные и начать заново',
        settings_team: 'Команда и доступ',
        settings_employees_manage: 'Сотрудники и права',
        settings_switch_employee: 'Сменить сотрудника',
        settings_sign_out: 'Выйти из аккаунта',
        settings_about: 'О приложении',
        settings_privacy: 'Политика конфиденциальности',
        settings_terms: 'Условия использования',
        settings_contact: 'Написать нам',
        settings_faq: 'Частые вопросы',
        settings_version_prefix: 'Simple Bake · версия',
        settings_close: 'Закрыть',

        // Окно "Написать нам"
        contact_title: 'Написать нам',
        contact_subject: 'Simple Bake — вопрос',
        contact_desc: 'Опишите вопрос или проблему — при отправке откроется ваше почтовое приложение с уже готовым письмом на simplebake.support@gmail.com.',
        contact_placeholder: 'Ваше сообщение...',
        contact_send: 'Отправить',
        contact_cancel: 'Отмена',

        // Общие переиспользуемые элементы (кнопки, тосты, поиск, подсказки иконок)
        common_back: 'Назад',
        common_cancel: 'Отмена',
        common_ok: 'OK',
        common_delete: 'Удалить',
        common_delete_confirm_default: 'Вы уверены, что хотите удалить этот элемент?',
        common_show_more: 'Показать ещё',
        toast_saved: 'Сохранено',
        toast_data_updated: 'Данные обновлены',
        search_by_title: 'Поиск по названию...',
        search_by_person_name: 'Поиск по имени...',
        icon_delete_title: 'Удалить',
        icon_copy_title: 'Копировать',

        // Экран "Журнал действий"
        history_title: 'Журнал действий',
        history_all_employees: 'Все сотрудники',
        history_all_actions: 'Все действия',
        history_action_orders: 'Заказы',
        history_action_items: 'Позиции заказа',
        history_action_customers: 'Клиенты',
        history_action_products: 'Изделия',
        history_action_auth: 'Вход/выход',
        history_hint: 'Записи о заказах можно открыть нажатием (кроме удалённых)',
        history_col_date: 'Дата',
        history_col_time: 'Время',
        history_col_employee: 'Сотрудник',
        history_col_action: 'Действие',

        // Корзина удалённых заказов
        trash_desc: 'Удалённые заказы хранятся 30 дней. Нажмите на заказ для восстановления или окончательного удаления.',
        trash_loading: 'Загружаю корзину...',
        trash_col_order_date: 'Дата заказа',
        trash_col_customer: 'Клиент',
        trash_col_deleted: 'Удалён',
        trash_unknown_customer: '(неизвестно)',
        trash_empty: 'Корзина пуста',
        trash_restore_order: 'Восстановить заказ',
        trash_delete_forever: 'Удалить навсегда',
        trash_order_word: 'Заказ',
        trash_delete_confirm_prefix: 'Удалить заказ ',
        trash_delete_confirm_suffix: ' навсегда? Это действие нельзя отменить.',
        order_number_symbol: '№',

        // Удаление демо-данных
        demo_deleting: 'Удаляю демо-данные...',
        demo_activity_deleted: 'Демо-данные удалены',
        demo_deleted_success: 'Демо-данные удалены. Можно начинать вводить свои данные.',
        demo_deleted_error: 'Ошибка удаления демо-данных. Проверьте подключение и попробуйте ещё раз.',
        demo_not_found: 'Демо-данных не найдено — похоже, они уже удалены или не создавались.',
        demo_delete_confirm: 'Удалить весь демо-набор (демо-клиенты, изделия, полуфабрикат, ингредиенты и демо-заказ)? Ваши собственные данные это не затронет.',

        // Общие (дополнительно)
        common_save: 'Сохранить',
        common_saving: 'Сохранение...',
        common_deleting: 'Удаление...',
        common_cancelling: 'Отмена...',

        // Сотрудники и права
        employees_create: '+ Создать сотрудника',
        employees_name_label: 'Имя сотрудника',
        employees_name_placeholder: 'Например, Анна',
        employees_email_label: 'Email для личного входа (необязательно)',
        employees_email_placeholder: 'Оставьте пустым для входа по имени на общем устройстве',
        employees_email_hint: 'Если указать email — сотрудник сможет установить приложение на свой телефон и войти под собой. Он должен зарегистрироваться в приложении именно на этот email.',
        employees_permissions_label: 'Полномочия:',
        employees_permissions_locked: 'Права этого сотрудника недоступны для изменения.',
        employees_perm_costs: 'Видеть себестоимость и маржу',
        employees_perm_delete: 'Удаление заказов и клиентов',
        employees_perm_inventory: 'Управление складом и ассортиментом',
        employees_perm_reports: 'Просмотр отчётов и статистики',
        employees_perm_team: 'Команда и доступ',
        employees_perm_team_hint: 'Видеть список сотрудников, приглашать новых (с настройкой их прав) и удалять. Права уже существующих сотрудников менять нельзя — это может только владелец.',
        employees_no_access: 'Раздел «Сотрудники и права» вам недоступен.',
        employees_role_owner: 'Владелец',
        employees_role_staff: 'Сотрудник',
        employees_role_personal_login: 'Личный вход',
        employees_role_shared_device: 'Общее устройство',
        employees_invite_pending: 'Ждём регистрации',
        employees_invite_share: 'Поделиться',
        employees_invite_cancel: 'Отменить',
        employees_edit_title: 'Редактирование сотрудника',
        employees_new_title: 'Новый сотрудник',
        employees_name_required: 'Введите имя сотрудника.',
        employees_invite_created_prefix: 'Приглашение создано. Сообщите сотруднику, что нужно зарегистрироваться в приложении на email:',
        employees_save_error: 'Ошибка сохранения сотрудника.',
        employees_delete_warning_with_login: 'Удалить этого сотрудника? Он полностью потеряет доступ к пекарне (личный вход тоже будет отозван). Записи в журнале действий сохранятся.',
        employees_delete_warning_simple: 'Удалить этого сотрудника? Записи в журнале действий сохранятся.',
        employees_delete_membership_error: 'Карточка сотрудника удалена, но не удалось отозвать доступ к организации. Проверьте вручную в Supabase (таблица memberships).',
        employees_delete_error: 'Ошибка удаления сотрудника.',
        employees_our_bakery_fallback: 'нашу пекарню',
        employees_invite_share_text: 'Здравствуйте, {name}! Приглашаю вас в приложение «{org}» для учёта заказов.\n\n1. Откройте: {url}\n2. Зарегистрируйтесь именно на этот email: {email}\n\nПосле регистрации вы автоматически получите доступ.',
        employees_cancel_invite_confirm: 'Отменить это приглашение?',
        employees_cancel_invite_error: 'Ошибка отмены приглашения.',
        employees_switch_confirm: 'Сменить сотрудника?',
    },
    en: {
        // Bottom navigation
        nav_orders: 'Orders',
        nav_products: 'Menu',
        nav_ingredients: 'Inventory',
        nav_customers: 'Customers',

        // Settings — general
        settings_title: 'Settings',
        settings_current_employee_label: 'Current staff member:',
        settings_language: 'Language',
        settings_tariff: 'Plan',
        settings_plan_free: 'Free',
        settings_plan_paid: 'Paid',
        settings_orders_label: 'Orders',
        settings_of: 'of',

        company_title: 'Business info',
        company_autosave: 'Changes are saved automatically',
        company_name_label: 'Bakery name',
        company_name_placeholder: 'e.g. Anna\'s Bakery',
        company_country_label: 'Country',
        company_country_not_specified: 'Not set',
        company_country_hint: 'Selecting a country will fill in the currency and VAT rate below automatically — both stay editable',
        company_currency_label: 'Currency',
        company_vat_label: 'VAT rate, %',
        company_entity_type_label: 'Legal entity type',
        company_entity_individual: 'Individual',
        company_entity_company: 'Company',
        company_phone_label: 'Phone',
        company_email_label: 'Email',
        company_address_label: 'Address',
        company_legal_name_label: 'Legal name',
        company_legal_name_placeholder: 'e.g. MB Runaway Chef',
        company_reg_number_label: 'Registration number',
        company_vat_code_label: 'VAT code',
        company_director_label: 'Director / representative',
        company_personal_code_label: 'Personal code',
        company_bank_details_label: 'Bank details',
        company_bank_name_label: 'Bank',
        company_bank_account_label: 'IBAN / account',
        company_bank_swift_label: 'SWIFT / BIC',
        settings_limits_not_apply: 'No limits apply.',
        settings_company_info: 'Business info',
        settings_manage_data: 'Data management',
        settings_download_backup: 'Download backup',
        settings_activity_log: 'Activity log',
        settings_refresh_data: 'Refresh data',
        settings_orders_trash: 'Deleted orders',
        settings_delete_demo: 'Delete demo data and start over',
        settings_team: 'Team & access',
        settings_employees_manage: 'Staff & permissions',
        settings_switch_employee: 'Switch staff member',
        settings_sign_out: 'Sign out',
        settings_about: 'About',
        settings_privacy: 'Privacy Policy',
        settings_terms: 'Terms of Use',
        settings_contact: 'Contact us',
        settings_faq: 'FAQ',
        settings_version_prefix: 'Simple Bake · version',
        settings_close: 'Close',

        // "Contact us" window
        contact_title: 'Contact us',
        contact_subject: 'Simple Bake — question',
        contact_desc: 'Describe your question or issue — sending will open your mail app with a ready message to simplebake.support@gmail.com.',
        contact_placeholder: 'Your message...',
        contact_send: 'Send',
        contact_cancel: 'Cancel',

        // Common reusable elements (buttons, toasts, search, icon tooltips)
        common_back: 'Back',
        common_cancel: 'Cancel',
        common_ok: 'OK',
        common_delete: 'Delete',
        common_delete_confirm_default: 'Are you sure you want to delete this item?',
        common_show_more: 'Show more',
        toast_saved: 'Saved',
        toast_data_updated: 'Data updated',
        search_by_title: 'Search by name...',
        search_by_person_name: 'Search by name...',
        icon_delete_title: 'Delete',
        icon_copy_title: 'Copy',

        // "Activity log" screen
        history_title: 'Activity log',
        history_all_employees: 'All staff',
        history_all_actions: 'All actions',
        history_action_orders: 'Orders',
        history_action_items: 'Order items',
        history_action_customers: 'Customers',
        history_action_products: 'Menu items',
        history_action_auth: 'Sign in/out',
        history_hint: 'Order entries can be opened by tapping (except deleted ones)',
        history_col_date: 'Date',
        history_col_time: 'Time',
        history_col_employee: 'Staff',
        history_col_action: 'Action',

        // Deleted orders trash
        trash_desc: 'Deleted orders are kept for 30 days. Tap an order to restore or permanently delete it.',
        trash_loading: 'Loading trash...',
        trash_col_order_date: 'Order date',
        trash_col_customer: 'Customer',
        trash_col_deleted: 'Deleted',
        trash_unknown_customer: '(unknown)',
        trash_empty: 'Trash is empty',
        trash_restore_order: 'Restore order',
        trash_delete_forever: 'Delete forever',
        trash_order_word: 'Order',
        trash_delete_confirm_prefix: 'Permanently delete order ',
        trash_delete_confirm_suffix: '? This action cannot be undone.',
        order_number_symbol: '#',

        // Deleting demo data
        demo_deleting: 'Deleting demo data...',
        demo_activity_deleted: 'Demo data deleted',
        demo_deleted_success: 'Demo data deleted. You can start entering your own data now.',
        demo_deleted_error: 'Failed to delete demo data. Check your connection and try again.',
        demo_not_found: 'No demo data found — it looks like it was already deleted or never created.',
        demo_delete_confirm: 'Delete the whole demo set (demo customers, menu items, semi-finished goods, ingredients, and the demo order)? Your own data will not be affected.',

        // Common (additional)
        common_save: 'Save',
        common_saving: 'Saving...',
        common_deleting: 'Deleting...',
        common_cancelling: 'Cancelling...',

        // Employees & permissions
        employees_create: '+ Add employee',
        employees_name_label: 'Employee name',
        employees_name_placeholder: 'e.g. Anna',
        employees_email_label: 'Email for personal sign-in (optional)',
        employees_email_placeholder: 'Leave blank to sign in by name on a shared device',
        employees_email_hint: 'If you provide an email, the employee will be able to install the app on their own phone and sign in as themselves. They must register in the app using this exact email.',
        employees_permissions_label: 'Permissions:',
        employees_permissions_locked: "This employee's permissions cannot be changed.",
        employees_perm_costs: 'View cost price and margin',
        employees_perm_delete: 'Delete orders and customers',
        employees_perm_inventory: 'Manage inventory and menu',
        employees_perm_reports: 'View reports and statistics',
        employees_perm_team: 'Team & access',
        employees_perm_team_hint: 'Can see the staff list, invite new staff (setting their permissions), and remove them. Cannot change the permissions of already-existing staff — only the owner can.',
        employees_no_access: 'The "Staff & permissions" section is not available to you.',
        employees_role_owner: 'Owner',
        employees_role_staff: 'Staff',
        employees_role_personal_login: 'Personal login',
        employees_role_shared_device: 'Shared device',
        employees_invite_pending: 'Awaiting registration',
        employees_invite_share: 'Share',
        employees_invite_cancel: 'Cancel',
        employees_edit_title: 'Edit employee',
        employees_new_title: 'New employee',
        employees_name_required: 'Enter the employee name.',
        employees_invite_created_prefix: 'Invitation created. Let the employee know they need to register in the app using this email:',
        employees_save_error: 'Failed to save employee.',
        employees_delete_warning_with_login: 'Delete this employee? They will completely lose access to the bakery (personal login will also be revoked). Activity log entries will be kept.',
        employees_delete_warning_simple: 'Delete this employee? Activity log entries will be kept.',
        employees_delete_membership_error: 'The employee record was deleted, but access to the organization could not be revoked. Please check manually in Supabase (memberships table).',
        employees_delete_error: 'Failed to delete employee.',
        employees_our_bakery_fallback: 'our bakery',
        employees_invite_share_text: 'Hello, {name}! I\'m inviting you to the "{org}" app to manage orders.\n\n1. Open: {url}\n2. Register using this exact email: {email}\n\nYou will get access automatically after registering.',
        employees_cancel_invite_confirm: 'Cancel this invitation?',
        employees_cancel_invite_error: 'Failed to cancel the invitation.',
        employees_switch_confirm: 'Switch employee?',
    }
};

let currentLang = localStorage.getItem('appLang')
    || (navigator.language && navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en');

function t(key) {
    const dict = I18N[currentLang] || I18N.ru;
    if (dict[key] !== undefined) return dict[key];
    if (I18N.ru[key] !== undefined) return I18N.ru[key];
    return key;
}

function setLang(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    currentLang = lang;
    localStorage.setItem('appLang', lang);
    applyI18n();
    updateLangSwitcherUI();
    // Текст тарифа (Тариф/Лимиты) собирается в JS и зависит от языка —
    // перерисовываем, если функция уже подключена (inventory.js).
    if (typeof renderPlanInfo === 'function') renderPlanInfo();
    // Страна/валюта в окне "Информация о компании" — та же логика (company.js).
    if (typeof refreshCompanyLangDependentUI === 'function') refreshCompanyLangDependentUI();
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.documentElement.lang = currentLang;
}

function updateLangSwitcherUI() {
    const ruBtn = document.getElementById('langBtnRu');
    const enBtn = document.getElementById('langBtnEn');
    if (!ruBtn || !enBtn) return;
    ruBtn.classList.toggle('active', currentLang === 'ru');
    enBtn.classList.toggle('active', currentLang === 'en');
}

document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    updateLangSwitcherUI();
});
