// Reads credit card statement PDFs in the browser (nothing is uploaded anywhere)
// and turns them into expenses. Supports Scotiabank credit card statements.
(() => {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON = MONTHS.join('|');
  const pad = n => String(n).padStart(2, '0');

  // ---------- PDF to lines ----------
  // Rebuilds each printed line from the PDF's text positions. Words far apart
  // (separate columns: date, merchant, city, amount) are joined with " | ".
  async function pdfToLines(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('The PDF reader did not load. Check your connection and reload the app.');
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      const items = content.items
        .filter(it => it.str.trim())
        .map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width }));
      const rows = [];
      for (const it of items) {
        const row = rows.find(r => Math.abs(r.y - it.y) < 2);
        if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        let line = '';
        let prevEnd = null;
        for (const it of row.items) {
          if (prevEnd !== null) line += it.x - prevEnd > 5 ? ' | ' : ' ';
          line += it.s;
          prevEnd = it.x + it.w;
        }
        lines.push(line);
      }
    }
    return lines;
  }

  // ---------- Parsing ----------
  const money = s => Number(s.replace(/[$,]/g, ''));
  const AMOUNT = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;

  function parseStatement(lines) {
    const text = lines.join(' ').replace(/ \| /g, ' ').replace(/\s+/g, ' ');
    const period = text.match(new RegExp(`(${MON}) (\\d{1,2}), (\\d{4}) - (${MON}) (\\d{1,2}), (\\d{4})`));
    if (!period) throw new Error("This doesn't look like a Scotiabank credit card statement (no statement period found).");
    const start = { m: MONTHS.indexOf(period[1]) + 1, d: +period[2], y: +period[3] };
    const end = { m: MONTHS.indexOf(period[4]) + 1, d: +period[5], y: +period[6] };

    // Transactions carry no year; take it from the statement period.
    // A December purchase on a January statement belongs to the previous year.
    const iso = (mon, day) => {
      const m = MONTHS.indexOf(mon) + 1;
      const y = m > end.m ? end.y - 1 : end.y;
      return `${y}-${pad(m)}-${pad(+day)}`;
    };

    // A transaction line: "001 | Aug 10 | Aug 11 | DOORDASHSHAWARMAROY | DOWNTOWN TOROON | 18.97",
    // with a trailing "-" on payments and refunds. Lines without a reference number that follow
    // (wrapped text, foreign currency details) are ignored once the amount has been read.
    const start_re = new RegExp(`^(\\d{3}) \\| (${MON}) (\\d{1,2}) \\| (${MON}) (\\d{1,2}) \\| (.*)$`);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(start_re);
      if (!m) continue;
      let fields = m[6].split(' | ');
      // Amount missing (text wrapped onto the next line): pull in continuation lines.
      for (let j = i + 1; !fields.some(f => AMOUNT.test(f.replace(/ -$/, ''))) && j < lines.length && j < i + 3; j++) {
        if (start_re.test(lines[j])) break;
        fields = fields.concat(lines[j].split(' | '));
      }
      let credit = false;
      if (fields[fields.length - 1] === '-') { credit = true; fields.pop(); }
      let last = fields.pop() || '';
      if (/ -$/.test(last)) { credit = true; last = last.slice(0, -2); }
      if (!AMOUNT.test(last)) continue;
      rows.push({
        ref: m[1],
        date: iso(m[2], m[3]),
        posted: iso(m[4], m[5]),
        merchant: fields[0] || '',
        details: fields.join(' '),
        amount: money(last),
        credit,
      });
    }
    if (!rows.length) throw new Error('No transactions were found in this statement.');

    const summary = key => {
      const s = text.match(new RegExp(`${key} [+-] \\$([\\d,]+\\.\\d{2})`));
      return s ? money(s[1]) : null;
    };
    const isPayment = r => /^PAYMENT\b/i.test(r.details);
    const purchases = rows.filter(r => !r.credit && !isPayment(r));
    const credits = rows.filter(r => r.credit || isPayment(r));
    const round = n => Math.round(n * 100) / 100;

    return {
      start: `${start.y}-${pad(start.m)}-${pad(start.d)}`,
      end: `${end.y}-${pad(end.m)}-${pad(end.d)}`,
      rows,
      // Totals are checked against the statement's own summary so nothing is silently missed.
      checks: {
        purchases: { found: round(purchases.reduce((t, r) => t + r.amount, 0)), expected: summary('Purchases/charges') },
        credits: { found: round(credits.reduce((t, r) => t + r.amount, 0)), expected: summary('Payments/credits') },
      },
    };
  }

  // ---------- Categories ----------
  // Merchant name as a stable key: "TIM HORTONS #2876" -> "TIM HORTONS".
  function merchantKey(merchant) {
    return merchant.replace(/^(DD\/)?(TST-|SQ \*|SP |PAYPAL \*)/i, '')
      .split(/#|\*|\/|\d{3,}/)[0].replace(/[\s-]+$/, '').trim().toUpperCase();
  }

  const DOORDASH = { SHAWARMAROY: 'Shawarma Roy', FIVEGUYSBUR: 'Five Guys', DOMINOSPIZZ: "Domino's",
    LITTLEBANGL: 'Little Bangladesh', MARYBROWNSC: "Mary Brown's", DAIRYQUEEN: 'Dairy Queen',
    OSMOWSSHAWA: "Osmow's", BURGERKING: 'Burger King', KABABIA: 'Kababia', CHICKNBROS: 'Chick N Bros',
    NOFRILLS: 'No Frills', DASHMART: 'DashMart' };

  const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

  // [pattern, category, friendly note]
  const RULES = [
    [/DOORDASH ?(NOFRILLS|DASHMART)/i, 'Groceries'],
    [/NO ?FRILLS|\bNF\b|LOBLAW|METRO |FARM BOY|SOBEYS|WALMART|FOOD BASICS|FRESHCO|COSTCO|T&T|CIRCLE K|MACS CONV|7-ELEVEN/i, 'Groceries'],
    [/DOORDASH|UBER ?EATS|SKIP ?THE ?DISHES/i, 'Eating out'],
    [/TIM HORTONS|MCDONALD|STARBUCKS|SHACK|SHAWARMA|PIZZ|BURGER|POPEYES|WENDY|SUBWAY|A&W|KFC|OSMOW|SUSHI|THAI|WINSTOP|WINGSTOP|BOOSTER JUICE|COFFEE|CAFE|EUREST|GRILL|RESTAURANT|\bRES\b|BAR\b|PASTA|ACAI|FLAVOUR BEAST|RUDY|GANGNAM|CHA BAR|Shelbys/i, 'Eating out'],
    [/PRESTO|UBER|LYFT|HOPP|COMMUNAUTO|MOBILITE|PARKING|IMPARK|GREEN P|DRIVETEST|PETRO|ESSO|SHELL |GO TRANSIT|TTC|OC TRANSPO/i, 'Transport'],
    [/MEGABUS|VIA RAIL|FLAIR|WESTJET|AIR CANADA|PORTER|AIRBNB|HOTEL|EXPEDIA|FLIXBUS/i, 'Travel'],
    [/NETFLIX|SPOTIFY|DISNEY|APPLE\.COM|GOOGLE \*|YOUTUBE|CRAVE|PRIME VIDEO|ICLOUD|OPENAI|CHATGPT|PATREON/i, 'Subscriptions'],
    [/INS\b|INSURANCE|ROGERS|BELL |FIDO|KOODO|FREEDOM MOBILE|TELUS|VIRGIN|HYDRO|ENBRIDGE|UTILIT/i, 'Bills & utilities'],
    [/SHOPPERS DRUG|PHARMA|JEAN COUTU|REXALL|DENTAL|CLINIC|OPTOM/i, 'Health'],
    [/FADES|BARBER|SALON|HAIR|SPA\b/i, 'Personal care'],
    [/CINEPLEX|FAMOUS PLAYER|SPLITSVILLE|STEAM|PLAYSTATION|XBOX|TICKETMASTER|BOWL/i, 'Entertainment'],
    [/BOOKSTORE|COURSERA|UDEMY|TUITION|QUEEN'?S U/i, 'Education'],
    [/AMZN|AMAZON|STAPLES|DOLLAR ?TREE|UNIQLO|OCTOBERS VERY OWN|FYREDWRLD|TAOBAO|SUPERBUY|H&M|ZARA|WINNERS|BEST BUY|IKEA|CANADIAN TIRE|SHEIN|TEMU|NIKE|ADIDAS/i, 'Shopping'],
  ];

  function friendlyName(row) {
    const details = row.merchant || row.details;
    const dd = details.match(/^(?:DD\/)?DOORDASH ?(\S+)/i);
    if (dd) return `${DOORDASH[dd[1].toUpperCase()] || titleCase(dd[1])} (DoorDash)`;
    if (/^AMZN|^AMAZON/i.test(details)) return 'Amazon';
    if (/^PRESTO/i.test(details)) return 'Presto transit';
    if (/^UBER/i.test(details)) return 'Uber';
    if (/^LYFT/i.test(details)) return 'Lyft';
    if (/^EUREST/i.test(details)) return 'Work cafeteria (Eurest)';
    return titleCase(merchantKey(details)).replace(/'S\b/g, "'s") || details;
  }

  /** Picks a category: your own past choices for this merchant first, then built-in rules, then "Other". */
  function categorize(row, categories, learned) {
    const details = row.details;
    const byName = name => categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    const mine = learned && learned[merchantKey(row.merchant || row.details)];
    if (mine && categories.some(c => c.id === mine)) return mine;
    for (const [re, name] of RULES) {
      if (re.test(details)) {
        const c = byName(name);
        if (c) return c.id;
      }
    }
    return (byName('Other') || categories[categories.length - 1]).id;
  }

  // Identifies a statement line so the same purchase is never added twice.
  // Identical purchases on the same day get a counter (#2, #3...).
  function keyRows(rows) {
    const seen = new Map();
    return rows.map(r => {
      const base = `${r.date}|${r.posted}|${r.amount.toFixed(2)}|${r.details.replace(/\s+/g, ' ').toUpperCase()}${r.credit ? '|CR' : ''}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { ...r, key: n > 1 ? `${base}#${n}` : base };
    });
  }

  window.SpendlyStatement = { pdfToLines, parseStatement, categorize, friendlyName, merchantKey, keyRows };
})();
