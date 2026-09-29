(() => {
  'use strict';

  const STORAGE_KEY = 'spendly:v1';

  const DEFAULT_CATEGORIES = [
    { name: 'Eating out',       emoji: '🍽️', color: '#e8590c' },
    { name: 'Groceries',        emoji: '🛒', color: '#2f9e44' },
    { name: 'Subscriptions',    emoji: '🔁', color: '#7048e8' },
    { name: 'Shopping',         emoji: '🛍️', color: '#d6336c' },
    { name: 'Transport',        emoji: '🚗', color: '#1c7ed6' },
    { name: 'Bills & utilities',emoji: '💡', color: '#f08c00' },
    { name: 'Rent & housing',   emoji: '🏠', color: '#5c940d' },
    { name: 'Health',           emoji: '💊', color: '#0c8599' },
    { name: 'Entertainment',    emoji: '🎬', color: '#ae3ec9' },
    { name: 'Travel',           emoji: '✈️', color: '#1098ad' },
    { name: 'Personal care',    emoji: '💇', color: '#c2255c' },
    { name: 'Education',        emoji: '📚', color: '#3b5bdb' },
    { name: 'Gifts & donations',emoji: '🎁', color: '#e03131' },
    { name: 'Other',            emoji: '📦', color: '#868e96' },
  ];

  const PALETTE = ['#e8590c', '#2f9e44', '#7048e8', '#d6336c', '#1c7ed6', '#f08c00',
    '#5c940d', '#0c8599', '#ae3ec9', '#1098ad', '#c2255c', '#3b5bdb', '#e03131', '#868e96'];

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'PKR', 'AED', 'SAR', 'CAD', 'AUD', 'SGD',
    'JPY', 'CNY', 'CHF', 'SEK', 'NZD', 'ZAR', 'BDT', 'MYR', 'TRY', 'NGN', 'BRL', 'MXN'];

  // ---------- State ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function freshState() {
    return {
      currency: 'USD',
      categories: DEFAULT_CATEGORIES.map(c => ({ id: uid(), ...c, budget: null })),
      expenses: [],
      merchantCats: {},  // merchant -> category you picked, used when importing statements
      importedKeys: [],  // statement lines already handled (refunds, deleted imports)
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.categories) && Array.isArray(s.expenses)) return withDefaults(s);
      }
    } catch (e) { /* storage unavailable or corrupt; start fresh */ }
    return freshState();
  }

  function withDefaults(s) {
    return { merchantCats: {}, importedKeys: [], ...s };
  }

  let state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Your browser may be blocking storage.'); }
  }

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11
  let selectedCategory = state.categories[0]?.id;
  let lastDeleted = null;

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (y, m) => `${y}-${pad(m + 1)}`;

  function fmt(n) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(n);
    } catch (e) {
      return `${state.currency} ${n.toFixed(2)}`;
    }
  }

  function currencySymbol() {
    try {
      const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
      return parts.find(p => p.type === 'currency')?.value || state.currency;
    } catch (e) { return state.currency; }
  }

  const catById = id => state.categories.find(c => c.id === id)
    || { id, name: 'Deleted category', emoji: '❔', color: '#868e96', budget: null };

  const expensesInMonth = (y, m) => {
    const key = monthKey(y, m);
    return state.expenses.filter(e => e.date.startsWith(key));
  };

  const sum = list => list.reduce((t, e) => t + e.amount, 0);

  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { action.run(); el.classList.remove('show'); };
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2500);
  }

  // ---------- Rendering ----------
  function renderChips() {
    const wrap = $('#categoryChips');
    if (!state.categories.some(c => c.id === selectedCategory)) selectedCategory = state.categories[0]?.id;
    wrap.innerHTML = state.categories.map(c => `
      <button type="button" class="chip" role="radio" data-id="${c.id}"
        aria-checked="${c.id === selectedCategory}" style="--chip-color:${c.color}">
        <span aria-hidden="true">${esc(c.emoji)}</span>${esc(c.name)}
      </button>`).join('');
  }

  function renderFilter() {
    const sel = $('#filterCategory');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' +
      state.categories.map(c => `<option value="${c.id}">${esc(c.emoji)} ${esc(c.name)}</option>`).join('');
    sel.value = state.categories.some(c => c.id === cur) ? cur : '';
  }

  function renderMonthLabel() {
    const d = new Date(viewYear, viewMonth, 1);
    $('#monthLabel').textContent = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function renderSummary(monthExp) {
    const total = sum(monthExp);
    $('#totalSpent').textContent = fmt(total);

    const budgetTotal = state.categories.reduce((t, c) => t + (c.budget || 0), 0);
    const left = $('#budgetLeft');
    const barWrap = $('#overallBarWrap');
    if (budgetTotal > 0) {
      const remaining = budgetTotal - total;
      $('#budgetLabel').textContent = remaining >= 0 ? `Left of ${fmt(budgetTotal)}` : `Over ${fmt(budgetTotal)} budget`;
      left.textContent = fmt(Math.abs(remaining));
      left.className = 'stat-value' + (remaining < 0 ? ' over' : '');
      barWrap.hidden = false;
      const pct = Math.min(100, (total / budgetTotal) * 100);
      const bar = $('#overallBar');
      bar.style.width = pct + '%';
      bar.className = 'bar-fill' + (total > budgetTotal ? ' over' : pct >= 85 ? ' warn' : '');
    } else {
      $('#budgetLabel').textContent = 'Budget';
      left.textContent = 'Not set';
      left.className = 'stat-value';
      barWrap.hidden = true;
    }

    const prev = new Date(viewYear, viewMonth - 1, 1);
    const prevTotal = sum(expensesInMonth(prev.getFullYear(), prev.getMonth()));
    const vs = $('#vsLast');
    if (prevTotal > 0) {
      const diff = ((total - prevTotal) / prevTotal) * 100;
      vs.textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(0)}%`;
      vs.className = 'stat-value ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
      vs.title = `Last month: ${fmt(prevTotal)}`;
    } else {
      vs.textContent = '–';
      vs.className = 'stat-value';
      vs.title = 'No spending logged last month';
    }
  }

  function renderBreakdown(monthExp) {
    const totals = new Map();
    for (const e of monthExp) totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + e.amount);
    const total = sum(monthExp);

    // Show categories with spending first, then budgeted-but-unspent ones.
    const ids = new Set([...totals.keys()]);
    state.categories.forEach(c => { if (c.budget) ids.add(c.id); });
    const rows = [...ids].map(id => ({ cat: catById(id), spent: totals.get(id) || 0 }))
      .sort((a, b) => b.spent - a.spent);

    // Donut
    const svg = $('#donut');
    const r = 48, C = 2 * Math.PI * r;
    let offset = 0;
    let segs = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="16"/>`;
    if (total > 0) {
      for (const row of rows) {
        if (!row.spent) continue;
        const len = (row.spent / total) * C;
        segs += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${row.cat.color}" stroke-width="16"
          stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)">
          <title>${esc(row.cat.name)}: ${fmt(row.spent)}</title></circle>`;
        offset += len;
      }
    }
    svg.innerHTML = segs;
    $('#donutTotal').textContent = fmt(total);

    const list = $('#categoryBreakdown');
    if (!rows.length) {
      list.innerHTML = '<li class="empty">No spending this month yet.</li>';
      return;
    }
    list.innerHTML = rows.map(({ cat, spent }) => {
      const share = total ? Math.round((spent / total) * 100) : 0;
      let sub, bar;
      if (cat.budget) {
        const pct = (spent / cat.budget) * 100;
        const over = spent > cat.budget;
        const cls = over ? 'over' : pct >= 85 ? 'warn' : '';
        sub = `<span>${fmt(spent)} of ${fmt(cat.budget)}</span>` +
          (over ? `<span class="over">${fmt(spent - cat.budget)} over</span>` : `<span>${fmt(cat.budget - spent)} left</span>`);
        bar = `<div class="bar"><div class="bar-fill ${cls}" style="width:${Math.min(100, pct)}%;${cls ? '' : `background:${cat.color}`}"></div></div>`;
      } else {
        sub = `<span>${share}% of spending</span><span></span>`;
        bar = `<div class="bar"><div class="bar-fill" style="width:${share}%;background:${cat.color}"></div></div>`;
      }
      return `<li class="cat-row">
        <span class="cat-dot" style="background:${cat.color}"></span>
        <span class="cat-name">${esc(cat.emoji)} ${esc(cat.name)}</span>
        <span class="cat-amt">${fmt(spent)}</span>
        ${bar}
        <div class="cat-sub">${sub}</div>
      </li>`;
    }).join('');
  }

  function renderList(monthExp) {
    const filter = $('#filterCategory').value;
    const items = monthExp.filter(e => !filter || e.categoryId === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const el = $('#expenseList');
    if (!items.length) {
      el.innerHTML = `<p class="empty">${filter ? 'No expenses in this category this month.' : 'Nothing logged for this month. Add your first expense above.'}</p>`;
      return;
    }
    const groups = new Map();
    for (const e of items) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    const todayIso = isoDate(new Date());
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yestIso = isoDate(yest);
    el.innerHTML = [...groups].map(([date, list]) => {
      const [y, m, d] = date.split('-').map(Number);
      const label = date === todayIso ? 'Today' : date === yestIso ? 'Yesterday'
        : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div class="day-group">
        <div class="day-head"><span>${label}</span><span>${fmt(sum(list))}</span></div>
        ${list.map(e => {
          const c = catById(e.categoryId);
          return `<div class="expense" style="--c:${c.color}">
            <div class="exp-icon" aria-hidden="true">${esc(c.emoji)}</div>
            <div class="exp-main">
              <div class="exp-title">${esc(e.note || c.name)}</div>
              ${e.note ? `<div class="exp-cat">${esc(c.name)}</div>` : ''}
            </div>
            <div class="exp-amt">${fmt(e.amount)}</div>
            <div class="exp-actions">
              <button class="icon-btn" data-edit="${e.id}" aria-label="Edit">✎</button>
              <button class="icon-btn" data-del="${e.id}" aria-label="Delete">🗑</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  function render() {
    const monthExp = expensesInMonth(viewYear, viewMonth);
    $('#currencySym').textContent = currencySymbol();
    renderMonthLabel();
    renderChips();
    renderFilter();
    renderSummary(monthExp);
    renderBreakdown(monthExp);
    renderList(monthExp);
  }

  // ---------- Expense form ----------
  function resetForm() {
    $('#editId').value = '';
    $('#amount').value = '';
    $('#note').value = '';
    $('#date').value = defaultDate();
    $('#submitBtn').textContent = 'Add expense';
    $('#cancelEdit').hidden = true;
    $('#addTitle').textContent = 'Add expense';
  }

  // Default to today when viewing the current month, else the 1st of the viewed month.
  function defaultDate() {
    const now = new Date();
    if (now.getFullYear() === viewYear && now.getMonth() === viewMonth) return isoDate(now);
    return isoDate(new Date(viewYear, viewMonth, 1));
  }

  $('#categoryChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    selectedCategory = chip.dataset.id;
    renderChips();
  });

  $('#expenseForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = Math.round(parseFloat($('#amount').value) * 100) / 100;
    if (!(amount > 0)) { toast('Enter an amount above zero.'); return; }
    if (!selectedCategory) { toast('Pick a category.'); return; }
    const date = $('#date').value;
    const note = $('#note').value.trim();
    const editId = $('#editId').value;

    if (editId) {
      const exp = state.expenses.find(x => x.id === editId);
      if (exp) {
        // Remember the category you chose for this merchant for future statement imports.
        if (exp.merchant && exp.categoryId !== selectedCategory) state.merchantCats[exp.merchant] = selectedCategory;
        Object.assign(exp, { amount, categoryId: selectedCategory, date, note });
      }
      toast('Expense updated');
    } else {
      state.expenses.push({ id: uid(), amount, categoryId: selectedCategory, date, note, createdAt: Date.now() });
      toast(`Added ${fmt(amount)} to ${catById(selectedCategory).name}`);
    }
    save();

    // Jump to the month the expense belongs to so it's visible.
    const [y, m] = date.split('-').map(Number);
    viewYear = y; viewMonth = m - 1;
    resetForm();
    render();
    $('#amount').focus();
  });

  $('#cancelEdit').addEventListener('click', resetForm);

  $('#expenseList').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) {
      const exp = state.expenses.find(x => x.id === editBtn.dataset.edit);
      if (!exp) return;
      $('#editId').value = exp.id;
      $('#amount').value = exp.amount;
      $('#date').value = exp.date;
      $('#note').value = exp.note || '';
      selectedCategory = exp.categoryId;
      renderChips();
      $('#submitBtn').textContent = 'Save changes';
      $('#addTitle').textContent = 'Edit expense';
      $('#cancelEdit').hidden = false;
      $('.add-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#amount').focus();
    } else if (delBtn) {
      const idx = state.expenses.findIndex(x => x.id === delBtn.dataset.del);
      if (idx < 0) return;
      lastDeleted = state.expenses.splice(idx, 1)[0];
      // A deleted statement purchase stays deleted if that statement is imported again.
      if (lastDeleted.sourceKey) state.importedKeys.push(lastDeleted.sourceKey);
      save(); render();
      toast('Expense deleted', { label: 'Undo', run: () => {
        if (!lastDeleted) return;
        state.expenses.push(lastDeleted);
        state.importedKeys = state.importedKeys.filter(k => k !== lastDeleted.sourceKey);
        lastDeleted = null; save(); render();
      }});
    }
  });

  $('#filterCategory').addEventListener('change', () => renderList(expensesInMonth(viewYear, viewMonth)));

  // ---------- Month navigation ----------
  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    if (!$('#editId').value) $('#date').value = defaultDate();
    render();
  }
  $('#prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('#nextMonth').addEventListener('click', () => shiftMonth(1));
  $('#monthLabel').addEventListener('click', () => {
    const now = new Date();
    viewYear = now.getFullYear(); viewMonth = now.getMonth();
    if (!$('#editId').value) $('#date').value = defaultDate();
    render();
  });

  // ---------- Settings ----------
  const dialog = $('#settingsDialog');

  function renderSettings() {
    const cs = $('#currencySelect');
    const list = CURRENCIES.includes(state.currency) ? CURRENCIES : [state.currency, ...CURRENCIES];
    cs.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
    cs.value = state.currency;

    $('#categoryEditor').innerHTML = state.categories.map(c => `
      <div class="cat-edit" data-id="${c.id}">
        <input class="emoji-in" data-field="emoji" value="${esc(c.emoji)}" maxlength="4" aria-label="Icon">
        <input data-field="name" value="${esc(c.name)}" maxlength="30" aria-label="Name">
        <input data-field="budget" type="number" min="0" step="1" inputmode="decimal"
          value="${c.budget ?? ''}" placeholder="No budget" aria-label="Monthly budget for ${esc(c.name)}">
        <button type="button" class="icon-btn" data-remove="${c.id}" aria-label="Remove ${esc(c.name)}">&times;</button>
      </div>`).join('');
  }

  function openSettings(focusBudgets) {
    renderSettings();
    dialog.showModal();
    if (focusBudgets) dialog.querySelector('[data-field="budget"]')?.focus();
  }

  $('#settingsBtn').addEventListener('click', () => openSettings(false));
  $('#editBudgetsBtn').addEventListener('click', () => openSettings(true));
  dialog.addEventListener('close', render);

  $('#currencySelect').addEventListener('change', e => { state.currency = e.target.value; save(); });

  $('#categoryEditor').addEventListener('change', e => {
    const row = e.target.closest('.cat-edit');
    const field = e.target.dataset.field;
    if (!row || !field) return;
    const cat = state.categories.find(c => c.id === row.dataset.id);
    if (!cat) return;
    if (field === 'budget') {
      const v = parseFloat(e.target.value);
      cat.budget = v > 0 ? v : null;
    } else if (field === 'name') {
      const v = e.target.value.trim();
      if (v) cat.name = v; else e.target.value = cat.name;
    } else if (field === 'emoji') {
      cat.emoji = e.target.value.trim() || '🏷️';
    }
    save();
  });

  $('#categoryEditor').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const cat = state.categories.find(c => c.id === btn.dataset.remove);
    if (!cat) return;
    if (state.categories.length <= 1) { toast('Keep at least one category.'); return; }
    const used = state.expenses.filter(x => x.categoryId === cat.id).length;
    let target = null;
    if (used) {
      target = state.categories.find(c => c.id !== cat.id && c.name.toLowerCase() === 'other')
        || state.categories.find(c => c.id !== cat.id);
      if (!confirm(`"${cat.name}" has ${used} expense${used > 1 ? 's' : ''}. Remove it and move them to "${target.name}"?`)) return;
      state.expenses.forEach(x => { if (x.categoryId === cat.id) x.categoryId = target.id; });
    }
    state.categories = state.categories.filter(c => c.id !== cat.id);
    save(); renderSettings();
  });

  $('#addCatBtn').addEventListener('click', () => {
    const name = $('#newCatName').value.trim();
    if (!name) { $('#newCatName').focus(); return; }
    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast('That category already exists.'); return;
    }
    const used = new Set(state.categories.map(c => c.color));
    const color = PALETTE.find(p => !used.has(p)) || PALETTE[state.categories.length % PALETTE.length];
    state.categories.push({ id: uid(), name, emoji: $('#newCatEmoji').value.trim() || '🏷️', color, budget: null });
    $('#newCatName').value = ''; $('#newCatEmoji').value = '';
    save(); renderSettings();
  });

  // ---------- Import / export ----------
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#exportCsv').addEventListener('click', () => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Category', 'Amount', 'Currency', 'Note']];
    [...state.expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach(e =>
      rows.push([e.date, catById(e.categoryId).name, e.amount.toFixed(2), state.currency, e.note || '']));
    download(`expenses-${isoDate(new Date())}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
  });

  $('#exportJson').addEventListener('click', () => {
    download(`spendly-backup-${isoDate(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
  });

  $('#importJson').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.categories) || !Array.isArray(data.expenses)) throw new Error('bad file');
      if (!confirm(`Replace your current data with this backup (${data.expenses.length} expenses)?`)) return;
      state = withDefaults({ ...data, currency: data.currency || 'USD' });
      save(); renderSettings(); render();
      toast('Backup restored');
    } catch (err) {
      toast('That file is not a valid backup.');
    }
  });

  $('#clearAll').addEventListener('click', () => {
    if (!confirm('Delete all expenses and reset categories? This cannot be undone. Download a backup first if unsure.')) return;
    state = freshState();
    save(); renderSettings(); render();
    toast('All data deleted');
  });

  // ---------- Import statements ----------
  // The PDF reader is large, so it only loads the first time you import.
  let pdfLib = null;
  function loadPdfReader() {
    pdfLib = pdfLib || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = resolve;
      s.onerror = () => { pdfLib = null; reject(new Error('Could not load the PDF reader. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }

  const monthName = iso => {
    const [y, m] = iso.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  const niceDate = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const sameMerchant = (a, b) => !!a && !!b && a.slice(0, 4).toUpperCase() === b.slice(0, 4).toUpperCase();

  /**
   * Works out what a statement changes, without changing anything yet:
   * new purchases, ones already in Spendly, and refunds that cancel an earlier purchase.
   */
  function planImport(statement) {
    const S = window.SpendlyStatement;
    const rows = S.keyRows(statement.rows);
    const handled = new Set(state.importedKeys);
    const claimed = new Set();
    const plan = { added: [], known: [], linked: [], refunds: [], unmatchedRefunds: [] };

    for (const r of rows.filter(r => !r.credit && !/^PAYMENT\b/i.test(r.details))) {
      if (handled.has(r.key) || state.expenses.some(e => e.sourceKey === r.key)) { plan.known.push(r); continue; }
      // Entered by hand (or from an older backup) with the same date and amount: link it, don't duplicate it.
      const same = state.expenses.find(e => !e.sourceKey && !claimed.has(e.id) && e.date === r.date && Math.abs(e.amount - r.amount) < 0.005);
      if (same) { claimed.add(same.id); plan.linked.push({ row: r, expense: same }); continue; }
      plan.added.push({
        id: uid(), amount: r.amount, date: r.date,
        categoryId: S.categorize(r, state.categories, state.merchantCats),
        note: S.friendlyName(r), merchant: S.merchantKey(r.merchant || r.details),
        sourceKey: r.key, createdAt: Date.now(),
      });
    }

    for (const r of rows.filter(r => r.credit && !/^PAYMENT\b/i.test(r.details))) {
      if (handled.has(r.key)) continue;
      const pool = [...plan.added, ...state.expenses].filter(e => !plan.refunds.some(x => x.expense === e));
      const match = pool.find(e => Math.abs(e.amount - r.amount) < 0.005 && e.date <= r.date
        && (sameMerchant(e.merchant, r.merchant) || sameMerchant(e.note, r.merchant)));
      if (match) plan.refunds.push({ row: r, expense: match }); else plan.unmatchedRefunds.push(r);
    }
    return plan;
  }

  function applyImport(plan) {
    plan.linked.forEach(({ row, expense }) => {
      expense.sourceKey = row.key;
      expense.merchant = window.SpendlyStatement.merchantKey(row.merchant || row.details);
    });
    state.expenses.push(...plan.added);
    const refunded = new Set(plan.refunds.map(x => x.expense.id));
    state.expenses = state.expenses.filter(e => !refunded.has(e.id));
    plan.refunds.forEach(x => {
      state.importedKeys.push(x.row.key);
      if (x.expense.sourceKey) state.importedKeys.push(x.expense.sourceKey);
    });
    save();
  }

  function describePlan(statement, plan) {
    const lines = [`Statement ${niceDate(statement.start)} to ${niceDate(statement.end)}`, ''];
    const refunded = new Set(plan.refunds.map(x => x.expense));
    const added = plan.added.filter(e => !refunded.has(e));
    const byMonth = new Map();
    added.forEach(e => { const k = e.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + e.amount); });
    const total = added.reduce((t, e) => t + e.amount, 0);
    lines.push(`• ${added.length} new purchase${added.length === 1 ? '' : 's'} (${fmt(total)})`);
    [...byMonth].sort().forEach(([k, v]) => lines.push(`     ${monthName(k + '-01')}: +${fmt(v)}`));
    const already = plan.known.length + plan.linked.length;
    if (already) lines.push(`• ${already} already in Spendly, skipped`);
    if (plan.refunds.length) lines.push(`• ${plan.refunds.length} refund${plan.refunds.length === 1 ? '' : 's'}: the refunded purchase${plan.refunds.length === 1 ? ' is' : 's are'} removed`);
    if (plan.unmatchedRefunds.length) lines.push(`• ${plan.unmatchedRefunds.length} refund${plan.unmatchedRefunds.length === 1 ? '' : 's'} for purchases not in Spendly, ignored`);
    lines.push('• Card payments are not expenses, so they are skipped');
    const { purchases } = statement.checks;
    if (purchases.expected != null && Math.abs(purchases.found - purchases.expected) > 0.005) {
      lines.push('', `Heads up: the statement lists ${fmt(purchases.expected)} in purchases but ${fmt(purchases.found)} was read. Some lines may be missing.`);
    }
    return lines.join('\n');
  }

  $('#importStatement').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const btn = $('#importStatementBtn');
    btn.setAttribute('aria-busy', 'true');
    let lastDate = null;
    let addedCount = 0;
    try {
      await loadPdfReader();
      for (const file of files) {
        let statement;
        try {
          statement = window.SpendlyStatement.parseStatement(await window.SpendlyStatement.pdfToLines(file));
        } catch (err) {
          alert(`${file.name}: ${/password/i.test(err.message) ? 'this PDF is password protected.' : /Invalid PDF|Missing PDF/i.test(err.message) ? "this isn't a PDF. Download the statement PDF from your bank and pick that." : err.message || 'this file could not be read as a statement.'}`);
          continue;
        }
        const plan = planImport(statement);
        if (!plan.added.length && !plan.refunds.length) {
          alert(`${file.name}: everything on this statement is already in Spendly.`);
          continue;
        }
        if (!confirm(describePlan(statement, plan) + '\n\nImport it?')) continue;
        applyImport(plan);
        addedCount += plan.added.filter(x => !plan.refunds.some(r => r.expense === x)).length;
        const newest = plan.added.map(x => x.date).sort().pop();
        if (newest && (!lastDate || newest > lastDate)) lastDate = newest;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      btn.removeAttribute('aria-busy');
    }
    if (addedCount) {
      const [y, m] = lastDate.split('-').map(Number);
      viewYear = y; viewMonth = m - 1;
      if (!$('#editId').value) $('#date').value = defaultDate();
      render();
      toast(`Imported ${addedCount} purchase${addedCount === 1 ? '' : 's'}. Tap ✎ on any to change its category.`);
    } else {
      render();
    }
  });

  // ---------- Install (PWA) ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Keyboard shortcut: "n" focuses the amount field.
  document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !dialog.open) {
      e.preventDefault(); $('#amount').focus();
    }
  });

  // ---------- Init ----------
  resetForm();
  render();
})();
