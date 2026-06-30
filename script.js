/* =========================================================================
   FIREBASE SETUP — read this before deploying
   =========================================================================
   See the full step-by-step guide given alongside this file. In short:
   1. Create a Firebase project at https://console.firebase.google.com
   2. Enable Authentication → Email/Password sign-in method
   3. Create a Firestore Database and publish the security rule from the guide
   4. Register a Web app under Project settings → General → "Your apps"
   5. Copy the config object Firebase gives you and paste it below,
      replacing every "PASTE_YOUR_..." placeholder.
   6. Push this whole folder to GitHub and enable GitHub Pages.

   Your data lives entirely in YOUR Firebase project — nothing is stored
   on Claude's side. Only someone who signs in with your email+password
   can read or write it, enforced by the Firestore rule in the guide.
   ========================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyBNagk_jfL3BsY6rRSc-ebuEsVbidlwuHI",
  authDomain: "freelance-ledger-a48f2.firebaseapp.com",
  projectId: "freelance-ledger-a48f2",
  storageBucket: "freelance-ledger-a48f2.firebasestorage.app",
  messagingSenderId: "907902034350",
  appId: "1:907902034350:web:eb3ee8fb8300186773e83f"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, addDoc, onSnapshot, query, where, orderBy, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const configIsPlaceholder = firebaseConfig.apiKey.includes("PASTE_YOUR");
let app, auth, db;
if(!configIsPlaceholder){
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}else{
  document.getElementById('setupBanner').style.display = 'block';
}

let entries = [];
let categories = [];
let marketplaces = [];
let editingId = null;
let currentUid = null;
let isOwner = false;
let unsubApprovedComments = null;
let unsubPendingComments = null;

// Your Firebase Auth UID — makes this ledger PUBLIC TO VIEW but editable only by you.
// First time: open the app, click "Owner sign in" (top right) and sign in once with
// your one account. A toast will show your UID — paste it here, replacing the
// placeholder, AND into the Firestore rule from the setup guide. Until you do this,
// the app falls back to private/sign-in-required mode automatically.
const OWNER_UID = "0vsGifU3itenxHFi5P6aTVrHS9I1";
const ownerConfigured = OWNER_UID && !OWNER_UID.startsWith("PASTE_YOUR");

const EARLIEST_YEAR = 2022; // your freelancing start — change this any time
const DEFAULT_CATEGORIES = ["Web Development","Graphic Design","Content Writing","Video Editing","Data Entry"];
const DEFAULT_MARKETPLACES = ["Upwork","Fiverr","Freelancer","Direct Client","Other"];
const USD_TO_BDT = 122; // fixed conversion rate used everywhere a combined BDT figure is shown

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}
function fmtAmount(amount, currency){
  const sym = currency === 'USD' ? '$' : '৳';
  return sym + Number(amount).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------- theme ---------------- */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const label = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  const a = document.getElementById('themeBtnApp'); if(a) a.textContent = label;
  const l = document.getElementById('themeBtnLock'); if(l) l.textContent = label;
  localStorage.setItem('fl-theme', theme);
}
function initTheme(){
  const saved = localStorage.getItem('fl-theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
document.getElementById('themeBtnLock').addEventListener('click', toggleTheme);
document.getElementById('themeBtnApp').addEventListener('click', toggleTheme);
initTheme();

/* ---------------- firestore data ---------------- */
async function loadData(){
  if(!db) return;
  const targetUid = ownerConfigured ? OWNER_UID : currentUid;
  if(!targetUid) return;
  try{
    const ref = doc(db, 'users', targetUid);
    const snap = await getDoc(ref);
    if(snap.exists()){
      const data = snap.data();
      entries = data.entries || [];
      categories = data.categories || DEFAULT_CATEGORIES.slice();
      marketplaces = data.marketplaces || DEFAULT_MARKETPLACES.slice();
    }else if(isOwner){
      entries = [];
      categories = DEFAULT_CATEGORIES.slice();
      marketplaces = DEFAULT_MARKETPLACES.slice();
      await persistAll();
    }else{
      entries = []; categories = []; marketplaces = [];
    }
  }catch(err){
    console.error(err);
    toast('Could not load data from Firebase');
    entries = []; categories = DEFAULT_CATEGORIES.slice(); marketplaces = DEFAULT_MARKETPLACES.slice();
  }
}
async function persistAll(){
  if(!db || !currentUid || !isOwner) return;
  try{
    await setDoc(doc(db, 'users', currentUid), { entries, categories, marketplaces });
  }catch(err){
    console.error(err);
    toast('Save failed — check your connection');
  }
}

/* ---------------- lock screen (owner sign-in, optional overlay) ---------------- */
// Sign-in only — account creation removed on purpose so no one else can
// self-register. Create your one account once, manually, in the Firebase
// console: Authentication tab → Users → Add user. After that, just sign
// in here with that email/password.
const lockErr = document.getElementById('lockErr');
const emailInput = document.getElementById('emailInput');
const passInput = document.getElementById('passInput');
const lockSubmit = document.getElementById('lockSubmit');
const lockScreen = document.getElementById('lockScreen');

function openLockScreen(){ lockScreen.style.display = 'flex'; }
function closeLockScreen(){ lockScreen.style.display = 'none'; }

async function handleLockSubmit(){
  lockErr.textContent = '';
  if(configIsPlaceholder){
    lockErr.textContent = "Firebase isn't configured yet — see the banner above.";
    return;
  }
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if(!email || !pass){ lockErr.textContent = 'Enter both email and password.'; return; }
  try{ await signInWithEmailAndPassword(auth, email, pass); }
  catch(err){ lockErr.textContent = friendlyAuthError(err.code); }
}
function friendlyAuthError(code){
  const map = {
    'auth/invalid-email':'That email looks invalid.',
    'auth/user-not-found':'No account with that email.',
    'auth/wrong-password':'Wrong password.',
    'auth/invalid-credential':'Email or password is incorrect.',
    'auth/too-many-requests':'Too many attempts — wait a bit and try again.',
  };
  return map[code] || ('Something went wrong (' + code + ').');
}

lockSubmit.addEventListener('click', handleLockSubmit);
[emailInput, passInput].forEach(el => el.addEventListener('keydown', e => { if(e.key === 'Enter') handleLockSubmit(); }));
document.getElementById('lockCancelBtn').addEventListener('click', closeLockScreen);
document.getElementById('ownerSignInBtn').addEventListener('click', openLockScreen);

document.getElementById('lockNowBtn').addEventListener('click', async () => {
  if(auth) await signOut(auth);
});

if(auth){
  onAuthStateChanged(auth, async (user) => {
    if(user){
      if(ownerConfigured && user.uid !== OWNER_UID){
        // Safety net: only the configured owner UID may hold edit rights here.
        lockErr.textContent = "This account isn't the configured owner.";
        await signOut(auth);
        return;
      }
      currentUid = user.uid;
      isOwner = true;
      document.getElementById('app').style.display = 'block';
      closeLockScreen();
      passInput.value = '';
      if(!ownerConfigured){
        toast('Signed in — your UID: ' + user.uid);
        console.log('Your Firebase UID (paste into OWNER_UID in script.js + the Firestore rule):', user.uid);
      }
      applyAccessMode();
      await loadData();
      setupPeriodSelectors();
      renderCategoryOptions();
      renderMarketplaceOptions();
      renderAll();
      subscribeComments();
    }else{
      currentUid = null;
      isOwner = false;
      passInput.value = '';
      applyAccessMode();
      if(!ownerConfigured){
        // No public owner configured yet — fall back to old private/sign-in-required mode.
        document.getElementById('app').style.display = 'none';
        openLockScreen();
      }else{
        renderAll();
        subscribeComments();
      }
    }
  });
}else if(ownerConfigured === false && configIsPlaceholder){
  // Firebase not configured at all yet — show the lock screen with the setup banner.
  openLockScreen();
}

function applyAccessMode(){
  document.body.classList.toggle('owner-mode', isOwner);
  const signInBtn = document.getElementById('ownerSignInBtn');
  const lockBtn = document.getElementById('lockNowBtn');
  if(signInBtn) signInBtn.style.display = isOwner ? 'none' : '';
  if(lockBtn) lockBtn.style.display = isOwner ? '' : 'none';
}

async function enterApp(){
  document.getElementById('app').style.display = 'block';
  closeLockScreen();
  await loadData();
  setupPeriodSelectors();
  renderCategoryOptions();
  renderMarketplaceOptions();
  renderAll();
  subscribeComments();
}

// Public visitors (no sign-in) land here directly when an owner UID is configured.
if(ownerConfigured){
  applyAccessMode();
  enterApp();
}

/* ---------------- period selectors ---------------- */
const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function setupPeriodSelectors(){
  const prevYear = yearSelect.value;
  const prevMonth = monthSelect.value;
  monthSelect.innerHTML = monthNames.map((m,i)=>`<option value="${i}">${m}</option>`).join('');

  const now = new Date();
  const years = new Set();
  for(let y = EARLIEST_YEAR; y <= now.getFullYear(); y++) years.add(y);
  entries.forEach(e => years.add(new Date(e.date).getFullYear()));
  const sortedYears = Array.from(years).sort((a,b)=>b-a);
  yearSelect.innerHTML = sortedYears.map(y=>`<option value="${y}">${y}</option>`).join('');

  // keep current selection if one already existed, otherwise default to "now"
  monthSelect.value = prevMonth !== '' && prevMonth != null ? prevMonth : now.getMonth();
  yearSelect.value = prevYear || now.getFullYear();
}
monthSelect.addEventListener('change', renderAll);
yearSelect.addEventListener('change', renderAll);

/* ---------------- category / marketplace selects ---------------- */
function renderCategoryOptions(){
  const f_category = document.getElementById('f_category');
  const filterCategory = document.getElementById('filterCategory');
  f_category.innerHTML = categories.map(c=>`<option value="${c}">${c}</option>`).join('');
  filterCategory.innerHTML = '<option value="">All categories</option>' + categories.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function renderMarketplaceOptions(){
  const f_marketplace = document.getElementById('f_marketplace');
  const filterMarketplace = document.getElementById('filterMarketplace');
  f_marketplace.innerHTML = marketplaces.map(m=>`<option value="${m}">${m}</option>`).join('');
  filterMarketplace.innerHTML = '<option value="">All marketplaces</option>' + marketplaces.map(m=>`<option value="${m}">${m}</option>`).join('');
}

document.getElementById('addCatBtn').addEventListener('click', async () => {
  const inp = document.getElementById('newCatInput');
  const val = inp.value.trim();
  if(!val) return;
  if(!categories.includes(val)){ categories.push(val); await persistAll(); renderCategoryOptions(); }
  document.getElementById('f_category').value = val;
  inp.value = '';
});
document.getElementById('addMktBtn').addEventListener('click', async () => {
  const inp = document.getElementById('newMktInput');
  const val = inp.value.trim();
  if(!val) return;
  if(!marketplaces.includes(val)){ marketplaces.push(val); await persistAll(); renderMarketplaceOptions(); }
  document.getElementById('f_marketplace').value = val;
  inp.value = '';
});

/* ---------------- form toggle ---------------- */
const entryForm = document.getElementById('entryForm');
document.getElementById('toggleFormBtn').addEventListener('click', () => {
  editingId = null;
  resetForm();
  entryForm.style.display = entryForm.style.display === 'none' || !entryForm.style.display ? 'block' : 'none';
});
document.getElementById('cancelEntryBtn').addEventListener('click', () => {
  entryForm.style.display = 'none';
  editingId = null;
  resetForm();
});

function resetForm(){
  document.getElementById('f_date').value = new Date().toISOString().slice(0,10);
  document.getElementById('f_amount').value = '';
  document.getElementById('f_currency').value = 'USD';
  document.getElementById('f_note').value = '';
  if(categories.length) document.getElementById('f_category').value = categories[0];
  if(marketplaces.length) document.getElementById('f_marketplace').value = marketplaces[0];
  document.getElementById('saveEntryBtn').textContent = 'Save entry';
}

document.getElementById('saveEntryBtn').addEventListener('click', async () => {
  const date = document.getElementById('f_date').value;
  const amount = parseFloat(document.getElementById('f_amount').value);
  const currency = document.getElementById('f_currency').value;
  const category = document.getElementById('f_category').value;
  const marketplace = document.getElementById('f_marketplace').value;
  const note = document.getElementById('f_note').value.trim();

  if(!date){ toast('Pick a date'); return; }
  if(isNaN(amount) || amount <= 0){ toast('Enter a valid amount'); return; }
  if(!category){ toast('Pick or add a category'); return; }
  if(!marketplace){ toast('Pick or add a marketplace'); return; }

  let newId;
  if(editingId){
    const idx = entries.findIndex(e => e.id === editingId);
    if(idx > -1) entries[idx] = {...entries[idx], date, amount, currency, category, marketplace, note};
    newId = editingId;
    editingId = null;
  }else{
    newId = uid();
    entries.push({id:newId, date, amount, currency, category, marketplace, note});
  }
  await persistAll();
  entryForm.style.display = 'none';
  resetForm();
  setupPeriodSelectors();
  monthSelect.value = new Date(date).getMonth();
  yearSelect.value = new Date(date).getFullYear();
  renderAll();
  toast('Saved');
  const row = document.querySelector(`tr[data-id="${newId}"]`);
  if(row){
    row.classList.add('justSaved');
    row.scrollIntoView({behavior:'smooth', block:'center'});
  }
});

/* ---------------- filters ---------------- */
document.getElementById('filterCategory').addEventListener('change', renderTable);
document.getElementById('filterMarketplace').addEventListener('change', renderTable);
document.getElementById('showAllTime').addEventListener('change', renderTable);

/* ---------------- rendering ---------------- */
function periodEntries(){
  const m = parseInt(monthSelect.value);
  const y = parseInt(yearSelect.value);
  return entries.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === m && d.getFullYear() === y;
  });
}
function yearEntries(){
  const y = parseInt(yearSelect.value);
  return entries.filter(e => new Date(e.date).getFullYear() === y);
}
function sumByCurrency(list){
  const sums = {};
  list.forEach(e => { sums[e.currency] = (sums[e.currency]||0) + e.amount; });
  return sums;
}
function bdtEquivalent(sums){
  let total = 0;
  if(sums.BDT) total += sums.BDT;
  if(sums.USD) total += sums.USD * USD_TO_BDT;
  return total;
}
function fmtBdt(n){
  return '৳' + Number(n).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
}
// Combined display: one BDT-equivalent headline figure (no more "$ + ৳" stacking),
// with the real original amounts shown small underneath when both currencies are present.
function sumsToString(sums){
  const keys = Object.keys(sums);
  if(keys.length === 0) return '<span class="amtMain">'+fmtBdt(0)+'</span>';
  const total = bdtEquivalent(sums);
  const parts = [];
  if(sums.USD) parts.push(fmtAmount(sums.USD,'USD'));
  if(sums.BDT) parts.push(fmtAmount(sums.BDT,'BDT'));
  const sub = parts.length > 1 ? `<span class="amtSub">${parts.join(' + ')} · @${USD_TO_BDT}/USD</span>` : '';
  return `<span class="amtMain">${fmtBdt(total)}</span>${sub}`;
}
function lifetimeSums(){ return sumByCurrency(entries); }
function renderAll(){
  const pe = periodEntries();
  const ye = yearEntries();
  document.getElementById('monthLabel').textContent = monthNames[monthSelect.value] + ' ' + yearSelect.value;
  document.getElementById('monthTotal').innerHTML = sumsToString(sumByCurrency(pe));
  document.getElementById('yearTotal').innerHTML = sumsToString(sumByCurrency(ye));
  document.getElementById('entryCount').textContent = pe.length;
  document.getElementById('lifetimeTotal').innerHTML = sumsToString(lifetimeSums());
  const lc = document.getElementById('lifetimeCount'); if(lc) lc.textContent = entries.length + (entries.length === 1 ? ' entry' : ' entries') + ' total';
  const ol = document.getElementById('overviewYearLabel'); if(ol) ol.textContent = yearSelect.value;
  renderBreakdowns(pe);
  renderYearOverview(ye);
  renderTable();
}
function renderYearOverview(yearList){
  const container = document.getElementById('yearOverview');
  if(!container) return;
  const y = parseInt(yearSelect.value);
  if(yearList.length === 0){
    container.innerHTML = '<div class="emptyNote">No entries in ' + y + ' yet.</div>';
    return;
  }
  const perMonth = Array.from({length:12}, () => ({}));
  yearList.forEach(e => {
    const m = new Date(e.date).getMonth();
    perMonth[m][e.currency] = (perMonth[m][e.currency]||0) + e.amount;
  });
  const totals = perMonth.map(s => bdtEquivalent(s));
  const max = Math.max(...totals, 1);
  container.innerHTML = monthNames.map((name,i) => {
    const pct = Math.round((totals[i]/max)*100);
    const isCurrent = i === parseInt(monthSelect.value);
    return `<div class="monthBar ${isCurrent ? 'active' : ''}" data-month="${i}">
      <div class="monthBarTrack"><div class="monthBarFill" style="height:${Math.max(pct,totals[i]>0?4:0)}%"></div></div>
      <div class="monthBarLabel">${name}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.monthBar').forEach(el => {
    el.addEventListener('click', () => {
      monthSelect.value = el.dataset.month;
      renderAll();
    });
  });
}
function renderBreakdowns(periodList){
  renderBarGroup('categoryBars', periodList, 'category', 'rust');
  renderBarGroup('marketplaceBars', periodList, 'marketplace', '');
}
function renderBarGroup(containerId, list, field, fillClass){
  const container = document.getElementById(containerId);
  if(list.length === 0){
    container.innerHTML = '<div class="emptyNote">No entries this period yet.</div>';
    return;
  }
  const counts = {};
  const sums = {};
  list.forEach(e => {
    const key = e[field];
    counts[key] = (counts[key]||0) + 1;
    sums[key] = sums[key] || {};
    sums[key][e.currency] = (sums[key][e.currency]||0) + e.amount;
  });
  const maxCount = Math.max(...Object.values(counts));
  const sortedKeys = Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
  container.innerHTML = sortedKeys.map(key => {
    const pct = Math.round((counts[key]/maxCount)*100);
    const amtStr = fmtBdt(bdtEquivalent(sums[key]));
    return `<div class="barRow">
      <div class="barLabel"><span class="name">${escapeHtml(key)} <span style="color:var(--ink-soft);font-weight:400;">(${counts[key]})</span></span><span class="amt">${amtStr}</span></div>
      <div class="barTrack"><div class="barFill ${fillClass}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}
function renderTable(){
  const fc = document.getElementById('filterCategory').value;
  const fm = document.getElementById('filterMarketplace').value;
  const allTime = document.getElementById('showAllTime').checked;
  const title = document.getElementById('entriesTitle');
  if(title) title.textContent = allTime ? 'Entries — full history (all-time)' : 'Entries — this period';
  let list = (allTime ? entries : periodEntries()).filter(e => (!fc || e.category===fc) && (!fm || e.marketplace===fm));
  list = list.slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
  const body = document.getElementById('entriesBody');
  if(list.length === 0){
    body.innerHTML = `<tr><td colspan="6" class="emptyNote" style="padding:18px 8px;">No entries match — add one above, or change the filters.</td></tr>`;
    return;
  }
  body.innerHTML = list.map(e => `
    <tr data-id="${e.id}">
      <td class="mono">${e.date}</td>
      <td><span class="tag tag-cat">${escapeHtml(e.category)}</span></td>
      <td><span class="tag tag-mkt">${escapeHtml(e.marketplace)}</span></td>
      <td>${escapeHtml(e.note || '—')}</td>
      <td class="amountCell">${fmtAmount(e.amount, e.currency)}</td>
      <td>
        <div class="rowActions owner-only">
          <button class="iconBtn editBtn" title="Edit">✎</button>
          <button class="iconBtn del delBtn" title="Delete">✕</button>
        </div>
      </td>
    </tr>
  `).join('');
  body.querySelectorAll('.editBtn').forEach(btn => {
    btn.addEventListener('click', (ev) => startEdit(ev.target.closest('tr').dataset.id));
  });
  body.querySelectorAll('.delBtn').forEach(btn => {
    btn.addEventListener('click', (ev) => deleteEntry(ev.target.closest('tr').dataset.id));
  });
}
function startEdit(id){
  const e = entries.find(x => x.id === id);
  if(!e) return;
  editingId = id;
  document.getElementById('f_date').value = e.date;
  document.getElementById('f_amount').value = e.amount;
  document.getElementById('f_currency').value = e.currency;
  document.getElementById('f_category').value = e.category;
  document.getElementById('f_marketplace').value = e.marketplace;
  document.getElementById('f_note').value = e.note || '';
  document.getElementById('saveEntryBtn').textContent = 'Update entry';
  entryForm.style.display = 'block';
  entryForm.scrollIntoView({behavior:'smooth', block:'start'});
}
async function deleteEntry(id){
  if(!confirm('Delete this entry?')) return;
  entries = entries.filter(e => e.id !== id);
  await persistAll();
  renderAll();
  toast('Deleted');
}

/* ---------------- export ---------------- */
document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [["Date","Category","Marketplace","Note","Amount","Currency"]];
  entries.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(e => {
    rows.push([e.date, e.category, e.marketplace, e.note||'', e.amount, e.currency]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'freelance-ledger.csv';
  a.click();
  URL.revokeObjectURL(url);
});

/* ---------------- import (bulk-add old data, e.g. 2022 onward) ---------------- */
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if(!file) return;
  const text = await file.text();
  const { added, errors } = parseAndImportCsv(text);
  if(added > 0){
    await persistAll();
    setupPeriodSelectors();
    renderCategoryOptions();
    renderMarketplaceOptions();
    renderAll();
  }
  toast(errors > 0 ? `Imported ${added} rows, skipped ${errors}` : `Imported ${added} rows`);
  importFile.value = '';
});

// Expects the same columns Export CSV produces: Date,Category,Marketplace,Note,Amount,Currency
// Date can be any year — this is exactly how you backfill 2022/2023/2024 history.
function parseAndImportCsv(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if(lines.length < 2) return { added: 0, errors: 0 };
  let added = 0, errors = 0;
  for(let i = 1; i < lines.length; i++){
    const cols = splitCsvLine(lines[i]);
    if(cols.length < 6){ errors++; continue; }
    const [date, category, marketplace, note, amountStr, currency] = cols;
    const amount = parseFloat(amountStr);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if(!validDate || isNaN(amount) || amount <= 0 || !category || !marketplace){ errors++; continue; }
    const cur = (currency || 'USD').trim().toUpperCase() === 'BDT' ? 'BDT' : 'USD';
    entries.push({ id: uid(), date, category: category.trim(), marketplace: marketplace.trim(), note: (note||'').trim(), amount, currency: cur });
    if(!categories.includes(category.trim())) categories.push(category.trim());
    if(!marketplaces.includes(marketplace.trim())) marketplaces.push(marketplace.trim());
    added++;
  }
  return { added, errors };
}
function splitCsvLine(line){
  const out = [];
  let cur = '', inQuotes = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQuotes){
      if(ch === '"'){
        if(line[i+1] === '"'){ cur += '"'; i++; }
        else inQuotes = false;
      }else cur += ch;
    }else{
      if(ch === '"') inQuotes = true;
      else if(ch === ','){ out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

resetForm();

/* ---------------- guestbook / comments ---------------- */
// Anyone can leave a name + a short note. It only appears publicly after
// you (the owner) approve it from the "Pending" panel, which only shows
// when you're signed in.
function commentsCol(){
  const ownerId = ownerConfigured ? OWNER_UID : currentUid;
  if(!db || !ownerId) return null;
  return collection(db, 'users', ownerId, 'comments');
}
function subscribeComments(){
  const col = commentsCol();
  const approvedList = document.getElementById('approvedComments');
  const pendingWrap = document.getElementById('pendingCommentsWrap');
  if(!col || !approvedList) return;
  if(unsubApprovedComments) unsubApprovedComments();
  if(unsubPendingComments) unsubPendingComments();

  const approvedQ = query(col, where('approved','==', true), orderBy('createdAt','desc'));
  unsubApprovedComments = onSnapshot(approvedQ, snap => {
    if(snap.empty){
      approvedList.innerHTML = '<div class="emptyNote">No notes yet — be the first to say hi!</div>';
      return;
    }
    approvedList.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `<div class="commentCard"><div class="commentName">${escapeHtml(c.name)}</div><div class="commentText">${escapeHtml(c.comment)}</div></div>`;
    }).join('');
  }, err => console.error(err));

  if(pendingWrap){
    if(isOwner){
      const pendingQ = query(col, where('approved','==', false), orderBy('createdAt','desc'));
      unsubPendingComments = onSnapshot(pendingQ, snap => {
        if(snap.empty){
          pendingWrap.innerHTML = '<div class="emptyNote">No notes waiting for approval.</div>';
          return;
        }
        pendingWrap.innerHTML = snap.docs.map(d => {
          const c = d.data();
          return `<div class="commentCard pending" data-id="${d.id}">
            <div class="commentName">${escapeHtml(c.name)}</div>
            <div class="commentText">${escapeHtml(c.comment)}</div>
            <div class="commentActions">
              <button class="smallBtn approveBtn" data-id="${d.id}">Approve</button>
              <button class="smallBtn rejectBtn" data-id="${d.id}">Reject</button>
            </div>
          </div>`;
        }).join('');
        pendingWrap.querySelectorAll('.approveBtn').forEach(btn => btn.addEventListener('click', () => approveComment(btn.dataset.id)));
        pendingWrap.querySelectorAll('.rejectBtn').forEach(btn => btn.addEventListener('click', () => rejectComment(btn.dataset.id)));
      }, err => console.error(err));
    }else{
      pendingWrap.innerHTML = '';
    }
  }
}
async function approveComment(id){
  const col = commentsCol(); if(!col) return;
  try{ await updateDoc(doc(col, id), { approved: true }); }
  catch(err){ console.error(err); toast('Could not approve — check Firestore rules'); }
}
async function rejectComment(id){
  const col = commentsCol(); if(!col) return;
  try{ await deleteDoc(doc(col, id)); }
  catch(err){ console.error(err); toast('Could not delete — check Firestore rules'); }
}
const commentForm = document.getElementById('commentForm');
if(commentForm){
  commentForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nameInput = document.getElementById('c_name');
    const textInput = document.getElementById('c_text');
    const name = nameInput.value.trim().slice(0,40);
    const text = textInput.value.trim().slice(0,300);
    if(!name || !text){ toast('Add your name and a note'); return; }
    const col = commentsCol();
    if(!col){ toast('Not connected yet'); return; }
    try{
      await addDoc(col, { name, comment: text, approved: false, createdAt: Date.now() });
      nameInput.value = ''; textInput.value = '';
      toast('Thanks! Waiting for approval.');
    }catch(err){
      console.error(err);
      toast('Could not submit — check Firestore rules');
    }
  });
}
