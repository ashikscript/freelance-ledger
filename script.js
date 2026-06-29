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
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc
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

const EARLIEST_YEAR = 2022; // your freelancing start — change this any time
const DEFAULT_CATEGORIES = ["Web Development","Graphic Design","Content Writing","Video Editing","Data Entry"];
const DEFAULT_MARKETPLACES = ["Upwork","Fiverr","Freelancer","Direct Client","Other"];

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
  try{
    const ref = doc(db, 'users', currentUid);
    const snap = await getDoc(ref);
    if(snap.exists()){
      const data = snap.data();
      entries = data.entries || [];
      categories = data.categories || DEFAULT_CATEGORIES.slice();
      marketplaces = data.marketplaces || DEFAULT_MARKETPLACES.slice();
    }else{
      entries = [];
      categories = DEFAULT_CATEGORIES.slice();
      marketplaces = DEFAULT_MARKETPLACES.slice();
      await persistAll();
    }
  }catch(err){
    console.error(err);
    toast('Could not load data from Firebase');
    entries = []; categories = DEFAULT_CATEGORIES.slice(); marketplaces = DEFAULT_MARKETPLACES.slice();
  }
}
async function persistAll(){
  if(!db || !currentUid) return;
  try{
    await setDoc(doc(db, 'users', currentUid), { entries, categories, marketplaces });
  }catch(err){
    console.error(err);
    toast('Save failed — check your connection');
  }
}

/* ---------------- lock screen ---------------- */
const lockErr = document.getElementById('lockErr');
const emailInput = document.getElementById('emailInput');
const passInput = document.getElementById('passInput');
const passConfirm = document.getElementById('passConfirm');
const lockSubmit = document.getElementById('lockSubmit');
const lockSwitch = document.getElementById('lockSwitch');

let mode = 'signin';

function renderLockMode(){
  const lockSub = document.getElementById('lockSub');
  if(mode === 'signin'){
    lockSub.textContent = 'Sign in to open your ledger.';
    passConfirm.style.display = 'none';
    lockSubmit.textContent = 'Sign in';
    lockSwitch.innerHTML = 'First time here? <button id="switchModeBtn">Create your account</button>';
  }else{
    lockSub.textContent = 'Create an account to start your private ledger.';
    passConfirm.style.display = 'block';
    lockSubmit.textContent = 'Create account';
    lockSwitch.innerHTML = 'Already have an account? <button id="switchModeBtn">Sign in</button>';
  }
  document.getElementById('switchModeBtn').addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    lockErr.textContent = '';
    renderLockMode();
  });
}
renderLockMode();

async function handleLockSubmit(){
  lockErr.textContent = '';
  if(configIsPlaceholder){
    lockErr.textContent = "Firebase isn't configured yet — see the banner above.";
    return;
  }
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if(!email || !pass){ lockErr.textContent = 'Enter both email and password.'; return; }

  if(mode === 'signup'){
    const conf = passConfirm.value;
    if(pass.length < 6){ lockErr.textContent = 'Use at least 6 characters.'; return; }
    if(pass !== conf){ lockErr.textContent = "Passwords don't match."; return; }
    try{ await createUserWithEmailAndPassword(auth, email, pass); }
    catch(err){ lockErr.textContent = friendlyAuthError(err.code); }
  }else{
    try{ await signInWithEmailAndPassword(auth, email, pass); }
    catch(err){ lockErr.textContent = friendlyAuthError(err.code); }
  }
}
function friendlyAuthError(code){
  const map = {
    'auth/invalid-email':'That email looks invalid.',
    'auth/user-not-found':'No account with that email — try "Create your account".',
    'auth/wrong-password':'Wrong password.',
    'auth/invalid-credential':'Email or password is incorrect.',
    'auth/email-already-in-use':'That email already has an account — try signing in instead.',
    'auth/weak-password':'Password is too weak — use at least 6 characters.',
  };
  return map[code] || ('Something went wrong (' + code + ').');
}

lockSubmit.addEventListener('click', handleLockSubmit);
[emailInput, passInput, passConfirm].forEach(el => el.addEventListener('keydown', e => { if(e.key === 'Enter') handleLockSubmit(); }));

document.getElementById('lockNowBtn').addEventListener('click', async () => {
  if(auth) await signOut(auth);
});

if(auth){
  onAuthStateChanged(auth, async (user) => {
    if(user){
      currentUid = user.uid;
      await enterApp();
    }else{
      currentUid = null;
      document.getElementById('app').style.display = 'none';
      document.getElementById('lockScreen').style.display = 'flex';
      passInput.value = ''; passConfirm.value = '';
      mode = 'signin';
      renderLockMode();
    }
  });
}

async function enterApp(){
  document.getElementById('lockScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  await loadData();
  setupPeriodSelectors();
  renderCategoryOptions();
  renderMarketplaceOptions();
  renderAll();
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
  monthSelect.addEventListener('change', renderAll);
  yearSelect.addEventListener('change', renderAll);
}

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

  if(editingId){
    const idx = entries.findIndex(e => e.id === editingId);
    if(idx > -1) entries[idx] = {...entries[idx], date, amount, currency, category, marketplace, note};
    editingId = null;
  }else{
    entries.push({id:uid(), date, amount, currency, category, marketplace, note});
  }
  await persistAll();
  entryForm.style.display = 'none';
  resetForm();
  setupPeriodSelectors();
  monthSelect.value = new Date(date).getMonth();
  yearSelect.value = new Date(date).getFullYear();
  renderAll();
  toast('Saved');
});

/* ---------------- filters ---------------- */
document.getElementById('filterCategory').addEventListener('change', renderTable);
document.getElementById('filterMarketplace').addEventListener('change', renderTable);

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
function sumsToString(sums){
  const keys = Object.keys(sums);
  if(keys.length === 0) return '—';
  return keys.map(c => fmtAmount(sums[c], c)).join('  <small>+</small>  ');
}
function renderAll(){
  const pe = periodEntries();
  const ye = yearEntries();
  document.getElementById('monthLabel').textContent = monthNames[monthSelect.value] + ' ' + yearSelect.value;
  document.getElementById('monthTotal').innerHTML = sumsToString(sumByCurrency(pe));
  document.getElementById('yearTotal').innerHTML = sumsToString(sumByCurrency(ye));
  document.getElementById('entryCount').textContent = pe.length;
  renderBreakdowns(pe);
  renderTable();
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
    const amtStr = sumsToString(sums[key]);
    return `<div class="barRow">
      <div class="barLabel"><span class="name">${escapeHtml(key)} <span style="color:var(--ink-soft);font-weight:400;">(${counts[key]})</span></span><span class="amt">${amtStr}</span></div>
      <div class="barTrack"><div class="barFill ${fillClass}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}
function renderTable(){
  const fc = document.getElementById('filterCategory').value;
  const fm = document.getElementById('filterMarketplace').value;
  let list = periodEntries().filter(e => (!fc || e.category===fc) && (!fm || e.marketplace===fm));
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
        <div class="rowActions">
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
