// Aica Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked pre-token board, a separate live-token view, filters, sortable columns and a
// per-protocol detail drawer. No network: every byte it shows is in data.js.
//
// The page runs the model itself: impliedOf() recomputes a row's implied value from the snapshot's
// figures and the comparables table data.js carries, and farmSteps() rebuilds the plan that
// board.json holds — the same derivation, in the same words, as lib/model.ts writes it.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;

  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  function multipleOf(row) {
    var entry = row.category ? DATA.multiples.by_category[row.category] : undefined;
    if (entry) return { multiple: entry.multiple, comps: entry.comps, median: entry.median };
    return { multiple: DATA.multiples.global_median, comps: 0, median: DATA.multiples.global_median };
  }

  // The value model in one function: TVL x category multiple x growth x maturity, the same
  // arithmetic lib/model.ts scores the board with, from the figures data.js carries.
  function impliedOf(row) {
    var m = multipleOf(row);
    var rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
    var growthMult = round4(1 + (growthPct / 100) * MODEL.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturityMult = round4(MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range);
    var implied = Math.max(1, Math.round(row.tvl_usd * m.multiple * growthMult * maturityMult));
    return { implied: implied, multiple: m.multiple, comps: m.comps, median: m.median, growthPct: growthPct, growthMult: growthMult, maturityMult: maturityMult };
  }

  function pct(x) { return (x > 0 ? '+' : '') + (Math.round(x * 10) / 10).toString() + '%'; }

  function capitalFor(tvl) {
    if (tvl >= 5000000000) return 500;
    if (tvl >= 1000000000) return 250;
    if (tvl >= 250000000) return 150;
    if (tvl >= 50000000) return 100;
    return 50;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 'about $15';
    if (chain === 'Bitcoin') return 'about $6';
    return 'about $2';
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  // The category's core action — the same words lib/model.ts writes into board.json.
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' through its own app, then borrow once against it, no more than 40% of what you supplied, so the wallet counts as both a supplier and a borrower.';
    if (c.indexOf('cdp') >= 0) return 'Open a vault on ' + name + ' on ' + chain + ': deposit $' + capital + ' of collateral and mint no more than a third of it as the protocol\'s stablecoin, keeping the vault well above its liquidation line.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of two-sided liquidity to ' + name + '\'s largest pool on ' + chain + ' — the stablecoin pair if it has one — and leave the LP position open.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' — the largest vault it curates — and keep the vault shares in the same wallet.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s main vault on ' + chain + ' and keep the receipt shares; do not chase its highest-APY vault first.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' on ' + chain + ' and hold the staking receipt in the same wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small position hedged the other way, so the account trades without betting on direction.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s basis vault on ' + chain + ', the position that holds its hedged trade, and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Subscribe $' + capital + ' to ' + name + '\'s tokenised asset on ' + chain + ' through its own app and hold the asset in the same wallet.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and take one position in its most liquid market, then let it settle rather than trading out early.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' against a position you actually hold, and keep the policy to its end date.';
    if (c.indexOf('launchpad') >= 0) return 'Register the wallet with ' + name + ' and commit $' + capital + ' to one launch it runs on ' + chain + ', following the allocation steps its own page sets out.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of a ' + name + ' index on ' + chain + ' and hold the basket token rather than its parts.';
    if (c.indexOf('stable') >= 0 || c.indexOf('reserve currency') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset ' + name + ' issues, on ' + chain + ', and hold it in the wallet.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in one app on the far side so the trip is not a round trip.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of funds onto ' + name + ' and make real transactions there: one swap and one contract call a week in its own apps.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' into ' + name + '\'s pool on ' + chain + ' and let the funds sit the pool\'s full waiting period before any withdrawal.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Fund $' + capital + ' on ' + name + ' and make one real payment or card purchase with it, so the account is a user and not a deposit.';
    if (c.indexOf('ai') >= 0) return 'Buy $' + capital + ' of credits or compute on ' + name + ' and run one real job with it, keeping the account active afterwards.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' through its own app and keep the position open.';
  }

  function secondFor(p, capital, chain) {
    var half = capital / 2;
    if (p.chains.length >= 2) {
      var other = p.chains[1];
      return {
        text: p.name + ' also runs on ' + other + ': repeat a smaller position there, bridging $' + half + ' across with the bridge its own app names, so your activity is not all on one chain.',
        cost: '$' + half + ' of capital and ' + gasFor(other) + ' of gas',
        time: '25 minutes'
      };
    }
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0) {
      return {
        text: 'After a week, add a second market on ' + chain + ': supply $' + half + ' in the other large market ' + p.name + ' runs, so the wallet shows depth in two markets, not a single touch.',
        cost: '$' + half + ' of capital and ' + gasFor(chain) + ' of gas',
        time: '15 minutes, a week after the first step'
      };
    }
    if (c.indexOf('dex') >= 0) {
      return {
        text: 'After a week, add $' + half + ' to a second pool on ' + chain + ' — a different pair from the first — so the wallet provides liquidity in more than one market ' + p.name + ' runs.',
        cost: '$' + half + ' of capital and ' + gasFor(chain) + ' of gas',
        time: '15 minutes, a week after the first step'
      };
    }
    return {
      text: 'After a week, add $' + half + ' to the same position on ' + chain + ': a second, separate deposit reads as a returning user, which most points programs count for more than one large deposit.',
      cost: '$' + half + ' of capital and ' + gasFor(chain) + ' of gas',
      time: '10 minutes, a week after the first step'
    };
  }

  function trendFor(p) {
    if (p.change_7d === null || p.change_7d === undefined) {
      return {
        text: 'The snapshot reports no 7-day TVL change for ' + p.name + ': before adding beyond the first position, check its TVL trend on DefiLlama and size as if the trend were unknown.',
        cost: 'nothing to check',
        time: '5 minutes before you add'
      };
    }
    if (p.change_7d <= -10) {
      return {
        text: p.name + '\'s TVL fell ' + pct(p.change_7d) + ' in the snapshot\'s 7 days: halve every amount in this plan until two weekly checks in a row show its TVL flat or rising again.',
        cost: 'nothing to check; the smaller size is the saving',
        time: '5 minutes a week while it falls'
      };
    }
    if (p.change_7d >= 25) {
      return {
        text: p.name + '\'s TVL rose ' + pct(p.change_7d) + ' in the snapshot\'s 7 days: do not chase the spike with more size — keep the planned capital and let the weekly cadence do the work.',
        cost: 'nothing extra; the discipline is the saving',
        time: '5 minutes a week'
      };
    }
    return {
      text: p.name + '\'s TVL moved ' + pct(p.change_7d) + ' in the snapshot\'s 7 days, inside the normal band: stay with the planned size and re-check the trend at each weekly visit.',
      cost: 'nothing to check',
      time: '5 minutes a week'
    };
  }

  // The farm plan, rebuilt from the row's own record — the same seven steps board.json carries.
  function farmSteps(p) {
    var chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
    var capital = capitalFor(p.tvl_usd);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    return [
      {
        text: 'Start with a fresh wallet for ' + p.name + ': fund it only with what this plan uses, keep its seed phrase on paper offline, and never farm from the wallet that holds your main funds.',
        cost: 'one funding transfer, ' + gasFor(chain) + ' of gas',
        time: '10 minutes'
      },
      {
        text: actionFor(p, capital, chain),
        cost: '$' + capital + ' of capital and ' + gasFor(chain) + ' of gas',
        time: '20 minutes to set up'
      },
      secondFor(p, capital, chain),
      {
        text: 'Come back once a week for ' + weeks + ' weeks: one qualifying action a visit — a deposit, a swap, a vote or a claim — keeps the wallet in the active set most points programs count.',
        cost: gasFor(chain) + ' of gas a week',
        time: '10 minutes a week for ' + weeks + ' weeks'
      },
      trendFor(p),
      {
        text: 'Hold the position for at least ' + hold + ' days, and once a month open ' + p.name + '\'s own points or rewards page — only from the link inside its app — to confirm the wallet is being counted.',
        cost: 'the capital stays in the position; never pay anyone to claim or to verify a wallet',
        time: hold + ' days in total'
      },
      {
        text: 'If ' + p.name + ' issues a token, check any allocation only on the protocol\'s own page, claim inside its deadline if it sets one, and keep the farm log — wallet, dates, amounts, transaction hashes — either way.',
        cost: 'claim gas only, ' + gasFor(chain),
        time: '30 minutes when a claim opens'
      }
    ];
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }

  // Exposed so the entry's own checks can prove the page and board.json agree, row for row.
  window.RADAR_CHECK = { impliedOf: impliedOf, farmSteps: farmSteps, stepText: stepText };

  /* ---------- rendering ---------- */

  var app = document.getElementById('board');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', wl: false, sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function setHash(h) { try { history.replaceState(null, '', h); } catch (e) { /* file:// in some browsers */ } }
  function currentHash() {
    if (state.tab === 'live') return '#/live';
    if (state.selected) return '#/p/' + state.selected;
    if (state.category !== 'all') return '#/f/' + encodeURIComponent(state.category);
    return '#/';
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; }
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      // dir -1 is descending (the board's own order), 1 ascending; ties keep rank order.
      return dir === -1 ? vb - va : va - vb;
    });
    return rows;
  }

  function sortHead(label, key) {
    var active = state.sort === key;
    var arrow = active ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
    return el('th', null, el('button', {
      type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      }
    }, label, el('span', { 'class': 'arrow', text: arrow })));
  }

  function boardTable(rows) {
    if (rows.length === 0) return el('div', { 'class': 'empty', text: 'No protocol matches this filter. Loosen the search, the category or the chain.' });
    var head = el('tr', null,
      sortHead('#', 'implied'), sortHead('Protocol', 'name'), sortHead('TVL', 'tvl'),
      sortHead('7d', 'change'), sortHead('Age', 'age'), el('th', { text: 'Multiple' }), sortHead('Implied value', 'implied'));
    var body = rows.map(function (r) {
      var m = impliedOf(r);
      var chg = r.change_7d === null ? el('span', { 'class': 'flat', text: 'n/a' })
        : el('span', { 'class': r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat', text: pct(r.change_7d) });
      return el('tr', {
        'class': state.selected === r.slug ? 'selected' : '',
        onclick: function () { state.selected = r.slug; setHash(currentHash()); render(); }
      },
        el('td', { 'class': 'rank', text: String(r.rank) }),
        el('td', null,
          el('span', { 'class': 'pname', text: r.name }),
          r.watchlist ? el('span', { 'class': 'badge wl', text: 'WATCHLIST' }) : el('span', { 'class': 'badge early', text: 'EARLY' }),
          el('span', { 'class': 'pcat', text: r.category || 'Uncategorised' }),
          el('span', { 'class': 'chains', text: r.chains.join(' · ') })),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', null, chg),
        el('td', { text: fmtAge(r.age_days) }),
        el('td', null, m.multiple.toFixed(2) + '×', el('span', { 'class': 'mult', text: m.comps > 0 ? m.comps + ' comps' : 'global' })),
        el('td', { 'class': 'implied', text: fmtUsd(r.implied_value_usd) }));
    });
    return el('table', null, el('thead', null, head), el('tbody', null, body));
  }

  function liveTable() {
    var head = el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }),
      el('th', { text: 'Market cap' }), el('th', { text: 'MCap / TVL' }), el('th', { text: '7d' }));
    var body = DATA.live.map(function (r) {
      var chg = r.change_7d === null ? el('span', { 'class': 'flat', text: 'n/a' })
        : el('span', { 'class': r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat', text: pct(r.change_7d) });
      return el('tr', null,
        el('td', null, el('span', { 'class': 'pname', text: r.name }),
          el('span', { 'class': 'pcat', text: (r.symbol || '') + (r.chains.length ? ' · ' + r.chains.join(' · ') : '') })),
        el('td', { text: r.category || 'Uncategorised' }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { text: fmtUsd(r.mcap_usd) }),
        el('td', { text: r.mcap_tvl.toFixed(2) + '×' }),
        el('td', null, chg));
    });
    return el('table', null, el('thead', null, head), el('tbody', null, body));
  }

  function detail(row) {
    var m = impliedOf(row);
    var steps = farmSteps(row).map(function (s) { return el('li', { text: stepText(s) }); });
    var cat = row.category || 'its category';
    var multNote = m.comps > 0
      ? 'the median market cap per TVL dollar of ' + m.comps + ' live ' + cat + ' protocols (median ' + m.median.toFixed(2) + '×), shrunk toward the global median ' + DATA.multiples.global_median.toFixed(2) + '×'
      : 'no live ' + cat + ' protocol carries a market cap, so the global median of ' + DATA.multiples.comps + ' live protocols prices it';
    return el('aside', { 'class': 'drawer', id: 'drawer' },
      el('button', { 'class': 'close', type: 'button', 'aria-label': 'Close detail', onclick: function () { state.selected = null; setHash(currentHash()); render(); } }, '×'),
      el('p', { 'class': 'kicker', text: 'Rank #' + row.rank + ' · ' + (row.watchlist ? 'on the house watchlist' : 'early — below the watchlist floor') }),
      el('h2', { text: row.name }),
      el('p', { 'class': 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.join(', ') || 'no chains recorded') }),
      el('h3', { text: 'The record' }),
      el('div', { 'class': 'facts' },
        el('div', null, el('span', { 'class': 'k', text: 'TVL' }), el('span', { 'class': 'v', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { 'class': 'k', text: 'TVL change, 7d' }), el('span', { 'class': 'v', text: row.change_7d === null ? 'not reported' : pct(row.change_7d) })),
        el('div', null, el('span', { 'class': 'k', text: 'Tracked since' }), el('span', { 'class': 'v', text: row.listed_at || 'not reported' })),
        el('div', null, el('span', { 'class': 'k', text: 'Age with no token' }), el('span', { 'class': 'v', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { 'class': 'k', text: 'Token' }), el('span', { 'class': 'v', text: 'records none' })),
        el('div', null, el('span', { 'class': 'k', text: 'Chains' }), el('span', { 'class': 'v', text: String(row.chains.length) }))),
      el('h3', { text: 'What a token would be worth' }),
      el('div', { 'class': 'modelbox' },
        el('div', { 'class': 'line' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { 'class': 'line' }, el('span', { text: '× category multiple' }), el('b', { text: m.multiple.toFixed(4) + '×' })),
        el('div', { 'class': 'line' }, el('span', { text: '× growth (' + pct(m.growthPct) + ' in 7d)' }), el('b', { text: m.growthMult.toFixed(4) + '×' })),
        el('div', { 'class': 'line' }, el('span', { text: '× maturity (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { text: m.maturityMult.toFixed(4) + '×' })),
        el('div', { 'class': 'line total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(m.implied) })),
        el('p', { 'class': 'note', text: 'The multiple is ' + multNote + '. This page recomputes the value from these figures; board.json carries the same ' + fmtUsd(row.implied_value_usd) + ' for ' + row.name + '.' })),
      el('h3', { text: 'How to farm it' }),
      el('ol', { 'class': 'plan' }, steps));
  }

  function render() {
    var rows = state.tab === 'board' ? visibleRows() : [];
    var drawer = null;
    if (state.selected) {
      var found = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) found = r; });
      if (found) drawer = detail(found); else state.selected = null;
    }
    var catOpts = [el('option', { value: 'all', text: 'All categories' })].concat(categories().map(function (c) {
      var o = el('option', { value: c, text: c }); if (state.category === c) o.setAttribute('selected', ''); return o;
    }));
    var chainOpts = [el('option', { value: 'all', text: 'All chains' })].concat(chains().map(function (c) {
      var o = el('option', { value: c, text: c }); if (state.chain === c) o.setAttribute('selected', ''); return o;
    }));
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; setHash(currentHash()); render(); } }, catOpts);
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; setHash(currentHash()); render(); } }, chainOpts);

    app.textContent = '';
    app.appendChild(el('header', { 'class': 'masthead' },
      el('p', { 'class': 'kicker', text: 'Token launch radar · model ' + DATA.model_version }),
      el('h1', null, 'Pre-token protocols, ', el('span', { 'class': 'thin', text: 'ranked by what their token would be worth' })),
      el('p', { 'class': 'lede', text: 'Every protocol in the snapshot that records no token yet, priced by the market\'s own yardstick: what live protocols in the same category are worth per dollar of TVL. Each row carries its farm plan — open one to see the value broken down and the steps, with their costs and times.' }),
      el('div', { 'class': 'stats' },
        el('div', { 'class': 'stat' }, el('span', { 'class': 'n', text: String(DATA.protocols_size) }), el('span', { 'class': 'l', text: 'protocols scanned' })),
        el('div', { 'class': 'stat hot' }, el('span', { 'class': 'n', text: String(DATA.board_size) }), el('span', { 'class': 'l', text: 'pre-token ranked' })),
        el('div', { 'class': 'stat' }, el('span', { 'class': 'n', text: String(DATA.watchlist_size) }), el('span', { 'class': 'l', text: 'watchlist covered' })),
        el('div', { 'class': 'stat' }, el('span', { 'class': 'n', text: String(DATA.multiples.comps) }), el('span', { 'class': 'l', text: 'live comps priced' })),
        el('div', { 'class': 'stat' }, el('span', { 'class': 'n', text: DATA.multiples.global_median.toFixed(2) + '×' }), el('span', { 'class': 'l', text: 'median mcap / TVL' })))));
    app.appendChild(el('div', { 'class': 'method' },
      el('b', { text: 'The model: ' }),
      el('span', { 'class': 'formula', text: 'implied = TVL × category multiple × growth × maturity' }),
      document.createTextNode(' — the multiple is the median market cap per TVL dollar of the category\'s live-token protocols, shrunk toward the global median by comp count; wild single ratios are winsorised and no category is priced above ' + MODEL.multiple_hi + '× TVL; growth reads the week\'s TVL change (clamped −50%…+100%, weight ' + MODEL.growth_weight + '); maturity grows with the days the protocol has run with no token. No name is priced by hand: the same function scores every row, and this page recomputes it.')));
    app.appendChild(el('div', { 'class': 'controls' },
      el('div', { 'class': 'tabs' },
        el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; setHash(currentHash()); render(); } }, 'Pre-token board'),
        el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; setHash(currentHash()); render(); } }, 'Live tokens')),
      state.tab === 'board' ? el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; render(); } }) : null,
      state.tab === 'board' ? catSel : null,
      state.tab === 'board' ? chainSel : null,
      state.tab === 'board' ? el('label', { 'class': 'check' }, el('input', { type: 'checkbox', onchange: function (e) { state.wl = e.target.checked; render(); } }), 'Watchlist only') : null,
      el('span', { 'class': 'count', text: state.tab === 'board' ? rows.length + ' of ' + DATA.board_size + ' rows' : DATA.live_size + ' live tokens' })));
    if (state.tab === 'board') {
      app.appendChild(boardTable(rows));
    } else {
      app.appendChild(el('p', { 'class': 'method', text: 'These protocols already have a token: the radar does not rank them. Their market caps are the comparables the pre-token board is priced from — the market\'s own values, kept apart from the model\'s.' }));
      app.appendChild(liveTable());
    }
    app.appendChild(el('footer', { 'class': 'foot' },
      el('b', { text: 'Data: ' }),
      document.createTextNode(DATA.source + ' · snapshot as of ' + DATA.as_of + ' · watchlist floor ' + fmtUsd(DATA.floor_usd) + '. '),
      el('b', { text: 'Reading it: ' }),
      document.createTextNode('an implied value is this radar\'s own claim about what a token would be worth if the protocol\'s record stayed as it is — not a prediction that one will be issued. A protocol "records no token" in this snapshot; that is DefiLlama\'s record, not proof none exists.')));
    if (drawer) app.appendChild(drawer);
    app.setAttribute('aria-busy', 'false');
  }

  /* ---------- hash routing: #/ board, #/live, #/p/<slug> detail, #/f/<category> filtered ---------- */
  function applyHash() {
    var h = window.location.hash || '#/';
    if (h.indexOf('#/p/') === 0) {
      state.tab = 'board';
      state.selected = decodeURIComponent(h.slice(4));
    } else if (h.indexOf('#/f/') === 0) {
      state.tab = 'board';
      state.category = decodeURIComponent(h.slice(4));
    } else if (h === '#/live') {
      state.tab = 'live';
    }
  }
  window.addEventListener('hashchange', function () { applyHash(); render(); });
  applyHash();
  render();
})();
