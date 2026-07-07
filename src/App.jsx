import { useAuth } from "./AuthContext"
import React, { useState, useEffect, useMemo } from "react";
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import * as XLSX from "xlsx";

// ---------- Seed data ----------
// NOTE: This used to contain real, hardcoded personal net-worth figures.
// That data is bundled into the client-side JS and shipped to every visitor
// of the site (logged in or not) -- a serious data exposure on a public
// Vercel deployment. It has been removed. New accounts now start empty;
// each user's real data lives only in their own Supabase row (RLS-protected)
// and is loaded at runtime via window.storage, never compiled into source.
const SEED_DATES = [];
const SEED_CATEGORIES = [];
const SEED_VALUES = {};
const ASSET_CLASS_MAP = {};
const COST_BASIS = {};

const DEFAULT_INCOME_CATEGORIES = ["Salary", "Bonus", "Dividends", "Interest", "Rental Income", "Other Income"];
const DEFAULT_EXPENSE_CATEGORIES = ["Rent", "Groceries", "Utilities", "Travel", "Dining", "Shopping", "Healthcare", "Insurance", "Investment Fees", "Other Expense"];
// Keep these as constants for any place that needs the original defaults (e.g. fresh rule state)
const INCOME_CATEGORIES = DEFAULT_INCOME_CATEGORIES;
const EXPENSE_CATEGORIES = DEFAULT_EXPENSE_CATEGORIES;
// Categories that are genuine consumption — all expense categories qualify
const CONSUMPTION_CATEGORIES = new Set(EXPENSE_CATEGORIES);

const COLORS = ["#c97c5d","#7c9885","#5b7c99","#d4a574","#9b6a6c","#6b8e9e","#b08968","#7a9b76","#a47551","#5e7a8c","#c4a35a"];
const ACCENT = "#c97c5d";
const BG = "#fbf8f4";
const PANEL = "#ffffff";
const INK = "#2b2620";
const MUTED = "#8a8178";
const BORDER = "#e8e2d8";

const CURRENCIES = {
  INR: { symbol: "₹", label: "INR — Indian Rupee" },
  USD: { symbol: "$", label: "USD — US Dollar" },
  AED: { symbol: "AED ", label: "AED — UAE Dirham" },
};
// Default FX rates expressed as "1 unit of currency = X INR". Editable in-app.
const DEFAULT_FX_TO_INR = { INR: 1, USD: 95.3, AED: 25.9 };

// ---------- Historical FX rates ----------
// Monthly USD/INR averages from ECB/RBI data.
// AED is pegged to USD at exactly 3.6725, so AED/INR = USD/INR / 3.6725.
// These are real historical monthly averages accurate to ±0.3 INR/USD.
const HIST_USD_INR = {
  "2024-01": 83.1, "2024-02": 83.0, "2024-03": 83.3, "2024-04": 83.6,
  "2024-05": 83.5, "2024-06": 83.5, "2024-07": 83.7, "2024-08": 83.9,
  "2024-09": 83.8, "2024-10": 84.1, "2024-11": 84.5, "2024-12": 85.0,
  "2025-01": 86.5, "2025-02": 86.9, "2025-03": 86.7, "2025-04": 85.5,
  "2025-05": 84.5, "2025-06": 84.4, "2025-07": 83.8, "2025-08": 83.9,
  "2025-09": 83.7, "2025-10": 83.9, "2025-11": 84.4, "2025-12": 85.0,
  "2026-01": 86.4, "2026-02": 87.1, "2026-03": 86.5, "2026-04": 84.8,
  "2026-05": 84.7, "2026-06": 85.2,
};
const AED_PER_USD = 3.6725; // fixed peg, never changes

function historicalRate(date, currency) {
  // Returns INR per 1 unit of currency for the given date
  if (!date || currency === "INR") return 1;
  const month = String(date).slice(0, 7); // "YYYY-MM"
  const usdInr = HIST_USD_INR[month] || DEFAULT_FX_TO_INR.USD;
  if (currency === "USD") return usdInr;
  if (currency === "AED") return usdInr / AED_PER_USD;
  return DEFAULT_FX_TO_INR[currency] || 1; // fallback for unknown currencies
}

// These are kept as no-ops for backward compat but do nothing now
const fxCache = new Map();
async function fetchRatesBatch(pairs) { return {}; }
async function fetchHistoricalRate(date, currency) { return historicalRate(date, currency); }

function fmtMoney(n, currency, symbol) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return symbol + Math.round(n).toLocaleString("en-IN");
}
function fmtCompactCur(n, symbol) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 10000000) return symbol + (n / 10000000).toFixed(2) + "Cr";
  if (abs >= 100000) return symbol + (n / 100000).toFixed(2) + "L";
  if (abs >= 1000) return symbol + (n / 1000).toFixed(1) + "K";
  return symbol + Math.round(n).toLocaleString("en-IN");
}

function fmtINR(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function fmtCompact(n) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  if (Math.abs(n) >= 10000000) return "₹" + (n / 10000000).toFixed(2) + "Cr";
  if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(2) + "L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function parseFlexDate(s) {
  // Handles "13 May 2025", "2026-06-01", etc.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}


// cashflows: array of {date: Date, amount: number} (negative = outflow/investment, positive = inflow/return)
function xirr(cashflows, guess = 0.1) {
  if (cashflows.length < 2) return null;
  const t0 = cashflows[0].date.getTime();
  const years = cashflows.map(cf => (cf.date.getTime() - t0) / (365 * 24 * 3600 * 1000));
  const npv = (rate) => cashflows.reduce((sum, cf, i) => sum + cf.amount / Math.pow(1 + rate, years[i]), 0);
  const dnpv = (rate) => cashflows.reduce((sum, cf, i) => sum - years[i] * cf.amount / Math.pow(1 + rate, years[i] + 1), 0);
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) break;
    const newRate = rate - f / df;
    if (!isFinite(newRate)) break;
    if (Math.abs(newRate - rate) < 1e-7) { rate = newRate; break; }
    rate = newRate;
    if (rate < -0.99) rate = -0.99;
  }
  return rate;
}

const STORAGE_KEY = "networth-snapshots";
const CATKEY = "networth-categories";

export default function App() {
  const { user, signOut } = useAuth()
  // Only pre-load seed data for the owner account.
  const isOwner = !user || user?.email === import.meta.env.VITE_OWNER_EMAIL;

  const [categories, setCategories] = useState(isOwner ? SEED_CATEGORIES : []);
  const [snapshots, setSnapshots] = useState(() =>
    isOwner
      ? SEED_DATES.map((date, i) => ({
          id: "seed-" + i,
          date,
          values: Object.fromEntries(SEED_CATEGORIES.map(c => [c, SEED_VALUES[c][i]])),
          fxRates: { ...DEFAULT_FX_TO_INR },
        }))
      : []
  );
  const [costBasis, setCostBasis] = useState(isOwner ? COST_BASIS : {});
  const [classMap, setClassMap] = useState(isOwner ? ASSET_CLASS_MAP : {});
  const [transactions, setTransactions] = useState([]); // {id, date, type: 'income'|'expense', category, description, amount}
  const [displayCurrency, setDisplayCurrency] = useState("INR");
  const [fxRates, setFxRates] = useState(DEFAULT_FX_TO_INR); // 1 unit of currency = X INR
  const [showFxEditor, setShowFxEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfParseError, setPdfParseError] = useState(null);
  const [pdfDetectedCurrency, setPdfDetectedCurrency] = useState(null);
  const [showRules, setShowRules] = useState(false);
  // Rules: [{id, keyword, type: 'income'|'expense'|'any', category, caseSensitive}]
  const [categoryRules, setCategoryRules] = useState([
    { id: "r1", keyword: "salary", type: "income", category: "Salary", caseSensitive: false },
    { id: "r2", keyword: "careem", type: "expense", category: "Travel", caseSensitive: false },
    { id: "r3", keyword: "deliveroo", type: "expense", category: "Dining", caseSensitive: false },
    { id: "r4", keyword: "dewa", type: "expense", category: "Utilities", caseSensitive: false },
    { id: "r5", keyword: "electricity", type: "expense", category: "Utilities", caseSensitive: false },
    { id: "r6", keyword: "emirates", type: "expense", category: "Travel", caseSensitive: false },
    { id: "r7", keyword: "noon food", type: "expense", category: "Dining", caseSensitive: false },
    { id: "r8", keyword: "taxi", type: "expense", category: "Travel", caseSensitive: false },
    // Credit card refunds/cashbacks should reduce expenses, not inflate income
    { id: "r9", keyword: "cashback", type: "income", category: "Other Expense", caseSensitive: false },
    { id: "r10", keyword: "refund", type: "income", category: "Other Expense", caseSensitive: false },
    { id: "r11", keyword: "reversal", type: "income", category: "Other Expense", caseSensitive: false },
  ]);
  const [newRule, setNewRule] = useState({ keyword: "", type: "expense", category: DEFAULT_EXPENSE_CATEGORIES[0], caseSensitive: false });

  // User-editable income/expense categories
  const [incomeCategories, setIncomeCategories] = useState(DEFAULT_INCOME_CATEGORIES);
  const [expenseCategories, setExpenseCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [newTxCatName, setNewTxCatName] = useState("");
  const [newTxCatType, setNewTxCatType] = useState("expense");
  const [renamingTxCat, setRenamingTxCat] = useState(null); // {name, type, draft}
  // Budget: monthly amount per expense category, in display currency
  const [budgets, setBudgets] = useState({}); // { [category]: amount }
  const [budgetMonth, setBudgetMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [importPreview, setImportPreview] = useState(null); // {rows: [...], mapping}
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState("saved"); // saved | saving
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState("overview");
  const [editingSnap, setEditingSnap] = useState(null); // snapshot id being edited
  const [showNwImport, setShowNwImport] = useState(false);
  const [nwImportPreview, setNwImportPreview] = useState(null); // [{date, values, fxRates, _selected, _id}]
  const [nwImportWarnings, setNwImportWarnings] = useState([]);
  const [showAddSnap, setShowAddSnap] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatClass, setNewCatClass] = useState("Equity");
  const [toast, setToast] = useState(null);
  const [txForm, setTxForm] = useState({ date: new Date().toISOString().slice(0,10), type: "income", category: "Salary", description: "", amount: "", currency: "INR" });
  const [editingTx, setEditingTx] = useState(null);
  const [cashFlowFilter, setCashFlowFilter] = useState("all"); // all | income | expense
  const [monthFilter, setMonthFilter] = useState("all"); // all | YYYY-MM
  const [catMonthFilter, setCatMonthFilter] = useState("all"); // for the expense/income by category charts
  const [txSearch, setTxSearch] = useState("");
  const [txCatFilter, setTxCatFilter] = useState("all"); // all | <category name>
  const [txView, setTxView] = useState("list"); // list | byCategory

  // load from storage
  useEffect(() => {
    (async () => {
      try {
        if (!window.storage || typeof window.storage.get !== "function") {
          // Should never happen now that Root guarantees window.storage
          // is configured before App ever mounts -- but if it somehow
          // does, fail loudly into the retry screen rather than
          // silently proceeding with blank state.
          console.warn("window.storage not ready when App mounted");
          setLoadError(true);
          return;
        }

        const res = await window.storage.get("data", false);

        if (res.status === "error") {
          // Real failure (network/auth/RLS) -- NOT the same as "no data yet".
          // Do not set `loaded` true: that would arm the autosave effect
          // below and it would overwrite the real cloud data with blanks.
          setLoadError(true);
          return;
        }

        if (res.status === "ok" && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.snapshots) setSnapshots(parsed.snapshots);
          if (parsed.categories) setCategories(parsed.categories);
          if (parsed.costBasis) setCostBasis(parsed.costBasis);
          if (parsed.classMap) setClassMap(parsed.classMap);
          if (parsed.transactions) setTransactions(parsed.transactions);
          if (parsed.displayCurrency) setDisplayCurrency(parsed.displayCurrency);
          if (parsed.fxRates) setFxRates(parsed.fxRates);
          if (parsed.categoryRules) setCategoryRules(parsed.categoryRules);
          if (parsed.incomeCategories) setIncomeCategories(parsed.incomeCategories);
          if (parsed.expenseCategories) setExpenseCategories(parsed.expenseCategories);
          if (parsed.budgets) setBudgets(parsed.budgets);
        }
        // status === "empty" means a genuinely new account -- safe to
        // continue with blank state and allow autosave to create the first row.
        setLoaded(true);
      } catch (e) {
        // Corrupt data, a thrown error from window.storage, or anything
        // else unexpected -- never fall through to blank state silently.
        console.error("Failed to load stored data:", e);
        setLoadError(true);
      }
    })();
  }, []);

  // persist
  useEffect(() => {
    if (!loaded || loadError) return;
    if (saveStatus === "unavailable") return; // storage API not present in this view
    const save = async () => {
      setSaveStatus("saving");
      try {
        const res = await window.storage.set("data", JSON.stringify({ snapshots, categories, costBasis, classMap, transactions, displayCurrency, fxRates, categoryRules, incomeCategories, expenseCategories, budgets }), false);
        if (res === null) {
          setSaveStatus("error");
        } else {
          setSaveStatus("saved");
        }
      } catch (e) {
        console.error("save failed", e);
        setSaveStatus("error");
      }
    };
    save();
  }, [snapshots, categories, costBasis, classMap, transactions, displayCurrency, fxRates, categoryRules, incomeCategories, expenseCategories, budgets, loaded]);

  // ---- Manual backup (export/import JSON) ----
  function exportBackup() {
    const data = { snapshots, categories, costBasis, classMap, transactions, displayCurrency, fxRates, categoryRules, incomeCategories, expenseCategories, budgets, exportedAt: new Date().toISOString() };
    const json = JSON.stringify(data, null, 2);
    const filename = `networth-backup-${new Date().toISOString().slice(0,10)}.json`;
    try {
      // Try Blob/createObjectURL first (works in deployed app)
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: data URI (works in Claude artifact sandbox)
      const a = document.createElement("a");
      a.href = "data:application/json;charset=utf-8," + encodeURIComponent(json);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    showToast("Backup downloaded");
  }

  function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.snapshots) setSnapshots(parsed.snapshots);
        if (parsed.categories) setCategories(parsed.categories);
        if (parsed.costBasis) setCostBasis(parsed.costBasis);
        if (parsed.classMap) setClassMap(parsed.classMap);
        if (parsed.transactions) setTransactions(parsed.transactions);
        if (parsed.displayCurrency) setDisplayCurrency(parsed.displayCurrency);
        if (parsed.fxRates) setFxRates(parsed.fxRates);
        if (parsed.categoryRules) setCategoryRules(parsed.categoryRules);
        if (parsed.incomeCategories) setIncomeCategories(parsed.incomeCategories);
        if (parsed.expenseCategories) setExpenseCategories(parsed.expenseCategories);
        showToast("Backup restored");
      } catch (err) {
        showToast("Couldn't read that file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ---- Excel (.xlsx) export/import — compatible with the Net_Worth_Tracker.xlsx template ----
  function exportExcel() {
    const wbx = XLSX.utils.book_new();

    // Settings
    const settingsRows = [["Rate", "Value (INR per unit)"], ["USD/INR", fxRates.USD || DEFAULT_FX_TO_INR.USD], ["AED/INR", fxRates.AED || DEFAULT_FX_TO_INR.AED]];
    XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet(settingsRows), "Settings");

    // Categories
    const catRows = [["Category", "Asset Class", "Cost Basis (INR)"]];
    categories.forEach(c => catRows.push([c, classMap[c] || "Other", Number(costBasis[c]) || 0]));
    XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet(catRows), "Categories");

    // NetWorth
    const nwHeader = ["Date", ...categories, "USD/INR", "AED/INR", "Total (INR)"];
    const nwRows = [nwHeader];
    sortedSnapshots.forEach(s => {
      const total = categories.reduce((sum, c) => sum + (Number(s.values[c]) || 0), 0);
      nwRows.push([s.date, ...categories.map(c => Number(s.values[c]) || 0), s.fxRates?.USD ?? DEFAULT_FX_TO_INR.USD, s.fxRates?.AED ?? DEFAULT_FX_TO_INR.AED, total]);
    });
    XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet(nwRows), "NetWorth");

    // Transactions
    const txHeader = ["Date", "Type", "Category", "Description", "Amount", "Currency", "Amount (INR)"];
    const txRows = [txHeader];
    sortedTx.slice().reverse().forEach(t => {
      txRows.push([t.date, t.type === "income" ? "Income" : "Expense", t.category, t.description || "", Number(t.origAmount ?? t.amount) || 0, t.currency || "INR", Number(t.amount) || 0]);
    });
    XLSX.utils.book_append_sheet(wbx, XLSX.utils.aoa_to_sheet(txRows), "Transactions");

    XLSX.writeFile(wbx, `networth-data-${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast("Excel file downloaded");
  }

  function importExcel(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wbx = XLSX.read(data, { type: "array", cellDates: true });

        const sheetRows = (name) => {
          const ws = wbx.Sheets[name];
          if (!ws) return null;
          return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        };
        const toIso = (v) => {
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          const d = parseFlexDate(String(v));
          return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
        };
        const findRow = (rows, firstCell) => rows ? rows.findIndex(r => r[0] === firstCell) : -1;

        let newFxRates = { ...fxRates };
        const settingsRows = sheetRows("Settings");
        if (settingsRows) {
          settingsRows.forEach(r => {
            if (r[0] === "USD/INR" && r[1] !== "") newFxRates.USD = Number(r[1]);
            if (r[0] === "AED/INR" && r[1] !== "") newFxRates.AED = Number(r[1]);
          });
        }

        let newCategories = categories, newClassMap = { ...classMap }, newCostBasis = { ...costBasis };
        const catRows = sheetRows("Categories");
        const catHeaderIdx = findRow(catRows, "Category");
        if (catHeaderIdx >= 0) {
          newCategories = [];
          for (let i = catHeaderIdx + 1; i < catRows.length; i++) {
            const r = catRows[i];
            if (!r[0] || r[0] === "Total") break;
            newCategories.push(r[0]);
            newClassMap[r[0]] = r[1] || "Other";
            newCostBasis[r[0]] = Number(r[2]) || 0;
          }
        }

        let newSnapshots = snapshots;
        const nwRows = sheetRows("NetWorth");
        const nwHeaderIdx = findRow(nwRows, "Date");
        if (nwHeaderIdx >= 0) {
          const header = nwRows[nwHeaderIdx];
          const usdCol = header.indexOf("USD/INR");
          const aedCol = header.indexOf("AED/INR");
          const catCols = newCategories.map(c => header.indexOf(c)).map(idx => idx >= 0 ? idx : null);
          newSnapshots = [];
          for (let i = nwHeaderIdx + 1; i < nwRows.length; i++) {
            const r = nwRows[i];
            if (!r[0]) break;
            const values = {};
            newCategories.forEach((c, ci) => { const col = catCols[ci]; values[c] = col != null ? (Number(r[col]) || 0) : 0; });
            newSnapshots.push({
              id: "xlsx-" + i,
              date: toIso(r[0]),
              values,
              fxRates: { USD: Number(r[usdCol]) || newFxRates.USD, AED: Number(r[aedCol]) || newFxRates.AED },
            });
          }
        }

        let newTransactions = transactions;
        const txRows = sheetRows("Transactions");
        const txHeaderIdx = findRow(txRows, "Date");
        if (txHeaderIdx >= 0 && txRows[txHeaderIdx][1] === "Type") {
          newTransactions = [];
          for (let i = txHeaderIdx + 1; i < txRows.length; i++) {
            const r = txRows[i];
            if (!r[0]) break;
            const currency = CURRENCIES[r[5]] ? r[5] : "INR";
            const origAmount = Number(r[4]) || 0;
            const inrAmount = r[6] !== "" && r[6] != null ? Number(r[6]) : origAmount * (newFxRates[currency] || 1);
            newTransactions.push({
              id: "xlsx-tx-" + i,
              date: toIso(r[0]),
              type: String(r[1]).toLowerCase() === "income" ? "income" : "expense",
              category: r[2],
              description: r[3],
              amount: inrAmount,
              origAmount,
              currency,
              fxRatesAtEntry: { ...newFxRates },
            });
          }
        }

        setFxRates(newFxRates);
        setCategories(newCategories);
        setClassMap(newClassMap);
        setCostBasis(newCostBasis);
        if (nwHeaderIdx >= 0) setSnapshots(newSnapshots);
        if (txHeaderIdx >= 0) setTransactions(newTransactions);
        showToast("Excel data imported");
      } catch (err) {
        console.error(err);
        showToast("Couldn't read that Excel file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Fallback: find the closest snapshot rate for a given date
  function snapshotRateFor(date, currency) {
    if (currency === "INR") return 1;
    if (!sortedSnapshots.length) return fxRates[currency] || DEFAULT_FX_TO_INR[currency] || 1;
    // Find the snapshot whose date is closest to (but not after) the transaction date
    const target = new Date(date).getTime();
    let best = sortedSnapshots[0];
    for (const s of sortedSnapshots) {
      if (new Date(s.date).getTime() <= target) best = s;
    }
    return best?.fxRates?.[currency] || fxRates[currency] || DEFAULT_FX_TO_INR[currency] || 1;
  }

  function buildTxRecord({ date, type, category, description, origAmount, currency, fxRatesAtEntry: entryRates }) {
    const fxRateAtDate = historicalRate(date, currency);
    const inrAmount = (origAmount || 0) * fxRateAtDate;
    return { date, type, category, description, origAmount, currency, fxRateAtDate, fxRateSource: "historical", amount: inrAmount, fxRatesAtEntry: entryRates || { ...fxRates } };
  }

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [snapshots]);

  const latest = sortedSnapshots[sortedSnapshots.length - 1];
  const previous = sortedSnapshots[sortedSnapshots.length - 2];

  // ---- Currency conversion ----
  // All stored values are in INR. Convert to display currency: value_in_display = value_inr / fxRates[displayCurrency]
  const cur = CURRENCIES[displayCurrency];
  const fx = fxRates[displayCurrency] || 1;
  const conv = (inrValue) => (Number(inrValue) || 0) / fx;
  const fmtC = (n) => fmtMoney(conv(n), displayCurrency, cur.symbol);
  const fmtCC = (n) => fmtCompactCur(conv(n), cur.symbol);

  // Convert using a specific record's FX rates (e.g. a snapshot's rates as of its date),
  // falling back to the current global rates if the record has none set.
  const convAt = (inrValue, recordFx) => {
    if (displayCurrency === "INR") return Number(inrValue) || 0;
    const rate = (recordFx && recordFx[displayCurrency]) || fxRates[displayCurrency] || 1;
    return (Number(inrValue) || 0) / rate;
  };
  const fmtCAt = (n, recordFx) => fmtMoney(convAt(n, recordFx), displayCurrency, cur.symbol);
  const fmtCCAt = (n, recordFx) => fmtCompactCur(convAt(n, recordFx), cur.symbol);
  // Pass-through formatters for values already converted (e.g. chart data pre-converted per-row)
  const fmtDisp = (n) => fmtMoney(Number(n) || 0, displayCurrency, cur.symbol);
  const fmtDispCompact = (n) => fmtCompactCur(Number(n) || 0, cur.symbol);

  // txInr(t): transaction amount in INR using the best available rate
  const txInr = (t) => {
    if ((t.currency || "INR") === "INR") return Number(t.origAmount ?? t.amount) || 0;
    const rate = t.fxRateAtDate || t.fxRatesAtEntry?.[t.currency] || fxRates[t.currency] || DEFAULT_FX_TO_INR[t.currency] || 1;
    return (Number(t.origAmount ?? t.amount) || 0) * rate;
  };

  // txDisplay(t): transaction amount in the current display currency
  const txDisplay = (t) => {
    if (displayCurrency === "INR") return txInr(t);
    if (t.currency === displayCurrency) return Number(t.origAmount ?? t.amount) || 0;
    return txInr(t) / (fxRates[displayCurrency] || DEFAULT_FX_TO_INR[displayCurrency] || 1);
  };

  const fmtTx = (t) => fmtMoney(txDisplay(t), displayCurrency, cur.symbol);

  // totals: each row converted using THAT snapshot's own FX rates (rate as of that date)
  // Also includes a "savingsBaseline" = starting NW + cumulative net savings up to that date
  const totals = useMemo(() => {
    // Build monthly net savings in INR using historical rates per transaction
    // Note: we treat credits on expense categories as negative expenses (refunds),
    // not as income, to avoid credit card refunds/cashbacks inflating savings.
    const monthlySavingsInr = {};
    transactions.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!monthlySavingsInr[m]) monthlySavingsInr[m] = 0;
      const amtInr = txInr(t);
      // Only true income categories contribute positively to savings
      // Credit card credits (refunds, cashbacks, payments received) are NOT income
      if (t.type === "income") monthlySavingsInr[m] += amtInr;
      else monthlySavingsInr[m] -= amtInr;
    });
    const sortedMonths = Object.keys(monthlySavingsInr).sort();

    const startingNwInr = sortedSnapshots.length > 0
      ? categories.reduce((s, c) => s + (Number(sortedSnapshots[0].values[c]) || 0), 0)
      : 0;

    return sortedSnapshots.map(s => {
      const row = { date: s.date };
      categories.forEach(c => { row[c] = convAt(s.values[c], s.fxRates); });
      const totalInr = categories.reduce((sum, c) => sum + (Number(s.values[c]) || 0), 0);
      row.total = convAt(totalInr, s.fxRates);

      // Cumulative savings up to (and including) this snapshot's month — in INR
      const snapMonth = s.date.slice(0, 7);
      const cumulSavingsInr = sortedMonths
        .filter(m => m <= snapMonth)
        .reduce((sum, m) => sum + monthlySavingsInr[m], 0);
      const baselineInr = startingNwInr + cumulSavingsInr;
      // Convert baseline using the SAME snapshot rate as the net worth — keeps them comparable
      row.savingsBaseline = convAt(baselineInr, s.fxRates);

      return row;
    });
  }, [sortedSnapshots, categories, displayCurrency, fxRates, transactions]);

  const latestTotalInr = latest ? categories.reduce((sum, c) => sum + (Number(latest.values[c]) || 0), 0) : 0;
  const prevTotalInr = previous ? categories.reduce((sum, c) => sum + (Number(previous.values[c]) || 0), 0) : 0;
  const latestTotal = convAt(latestTotalInr, latest?.fxRates); // in display currency, at latest's rate
  const prevTotalDisp = convAt(prevTotalInr, previous?.fxRates); // in display currency, at previous's rate
  const change = latestTotal - prevTotalDisp;
  const changePct = prevTotalDisp ? (change / prevTotalDisp) * 100 : 0;

  const totalCostBasisInr = categories.reduce((sum, c) => sum + (Number(costBasis[c]) || 0), 0);
  const totalCostBasis = convAt(totalCostBasisInr, latest?.fxRates);
  const totalProfit = latestTotal - totalCostBasis;

  const assetClassBreakdown = useMemo(() => {
    if (!latest) return [];
    const map = {};
    categories.forEach(c => {
      const cls = classMap[c] || "Other";
      map[cls] = (map[cls] || 0) + convAt(latest.values[c], latest.fxRates);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [latest, categories, classMap, displayCurrency, fxRates]);

  const categoryBreakdown = useMemo(() => {
    if (!latest) return [];
    return categories.map(c => ({ name: c, value: convAt(latest.values[c], latest.fxRates) }))
      .filter(d => d.value !== 0)
      .sort((a, b) => b.value - a.value);
  }, [latest, categories, displayCurrency, fxRates]);

  const assetClassOptions = ["Equity", "FD", "PF", "Bank A/C", "Private Equity", "Other"];

  // ---- XIRR-based return ----
  // ---- XIRR (savings-based, correct framework) ----
  // Structure:
  //   T0 outflow  : net worth at earliest snapshot (your starting "investment")
  //   Monthly flows: net savings per month = income − consumption expenses
  //                  Positive savings → outflow (you're deploying more capital)
  //                  Negative savings → inflow (you dissaved / drew down)
  //   Terminal inflow: net worth at latest snapshot
  //
  // "Investments" is intentionally excluded as an expense — it's just
  // reallocation of savings, already captured in the net worth snapshots.
  const xirrResult = useMemo(() => {
    if (sortedSnapshots.length < 2) return null;

    const flows = [];

    // T0: starting net worth as outflow
    const firstDate = parseFlexDate(sortedSnapshots[0].date);
    const firstTotal = categories.reduce((s, c) => s + (Number(sortedSnapshots[0].values[c]) || 0), 0);
    flows.push({ date: firstDate, amount: -firstTotal });

    // Aggregate monthly net savings from transactions (INR, all amounts stored in INR)
    const monthlyMap = {}; // "YYYY-MM" -> net savings in INR
    transactions.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!monthlyMap[m]) monthlyMap[m] = 0;
      const rate = t.currency === "INR" ? 1 : (t.fxRateAtDate || t.fxRatesAtEntry?.[t.currency] || fxRates[t.currency] || 1);
      const amtInr = (Number(t.origAmount ?? t.amount) || 0) * (t.currency === "INR" ? 1 : rate);
      if (t.type === "income") monthlyMap[m] += amtInr;
      else monthlyMap[m] -= amtInr;
    });

    // Each month's net savings becomes a dated flow
    // Use the last day of the month as the date (conservative — end of month)
    Object.entries(monthlyMap).forEach(([ym, netSavings]) => {
      const [y, m] = ym.split("-").map(Number);
      const lastDay = new Date(y, m, 0); // day 0 of next month = last day of this month
      // Positive savings = capital deployed = outflow (negative in XIRR convention)
      // Negative savings = dissaving = inflow (positive in XIRR convention)
      flows.push({ date: lastDay, amount: -netSavings });
    });

    // Terminal: current net worth as inflow
    const lastDate = parseFlexDate(sortedSnapshots[sortedSnapshots.length - 1].date);
    flows.push({ date: lastDate, amount: latestTotalInr });

    // Sort by date and discard any flows before T0 (can't precede start)
    flows.sort((a, b) => a.date - b.date);

    // Sanity check: need at least one outflow and one inflow
    const hasOutflow = flows.some(f => f.amount < 0);
    const hasInflow = flows.some(f => f.amount > 0);
    if (!hasOutflow || !hasInflow) return null;

    const rate = xirr(flows);
    return isFinite(rate) && rate > -1 ? rate : null;
  }, [sortedSnapshots, categories, transactions, latestTotalInr]);

  // Monthly net savings (for display — in display currency)
  const monthlySavings = useMemo(() => {
    const map = {};
    transactions.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!map[m]) map[m] = { month: m, income: 0, expense: 0, savings: 0 };
      const val = txDisplay(t);
      if (t.type === "income") map[m].income += val;
      else map[m].expense += val;
    });
    Object.values(map).forEach(r => { r.savings = r.income - r.expense; });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions, displayCurrency, fxRates]);

  const cumulativeSavings = useMemo(() =>
    monthlySavings.reduce((sum, m) => sum + m.savings, 0),
  [monthlySavings]);

  const startingNwDisp = convAt(
    categories.reduce((s, c) => s + (Number(sortedSnapshots[0]?.values[c]) || 0), 0),
    sortedSnapshots[0]?.fxRates
  );
  const wealthCreated = latestTotal - startingNwDisp - cumulativeSavings;



  // ---- Cash flow derived data ----
  const sortedTx = useMemo(() => {
    return [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions]);

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map(t => t.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const availableCategories = useMemo(() => {
    const set = new Set(sortedTx.map(t => t.category).filter(Boolean));
    return Array.from(set).sort();
  }, [sortedTx]);

  const filteredTx = useMemo(() => {
    const searchLower = txSearch.toLowerCase();
    return sortedTx.filter(t => {
      if (cashFlowFilter !== "all" && t.type !== cashFlowFilter) return false;
      if (monthFilter !== "all" && t.date.slice(0, 7) !== monthFilter) return false;
      if (txCatFilter !== "all" && t.category !== txCatFilter) return false;
      if (searchLower && !(t.description || "").toLowerCase().includes(searchLower)) return false;
      return true;
    });
  }, [sortedTx, cashFlowFilter, monthFilter, txCatFilter, txSearch]);

  // ---- Budget derived data ----
  const budgetActuals = useMemo(() => {
    // Actual spend per expense category for the selected budget month
    const map = {};
    transactions
      .filter(t => t.type === "expense" && t.date.slice(0, 7) === budgetMonth)
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + txDisplay(t);
      });
    return map;
  }, [transactions, budgetMonth, displayCurrency, fxRates]);

  const budgetTotalBudgeted = expenseCategories.reduce((s, c) => s + (Number(budgets[c]) || 0), 0);
  const budgetTotalActual = expenseCategories.reduce((s, c) => s + (budgetActuals[c] || 0), 0);

  function setBudgetAmount(category, value) {
    setBudgets(prev => ({ ...prev, [category]: value === "" ? 0 : Number(value) }));
  }

  // monthlyFlows = monthlySavings (alias for chart usage)
  const monthlyFlows = monthlySavings;

  // Group filtered transactions by category for the "By Category" view
  const txByCategory = useMemo(() => {
    const map = {};
    filteredTx.forEach(t => {
      if (!map[t.category]) map[t.category] = { category: t.category, type: t.type, total: 0, txs: [] };
      map[t.category].total += txDisplay(t);
      map[t.category].txs.push(t);
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredTx, displayCurrency, fxRates]);

  const totalIncome = useMemo(() => transactions.filter(t => t.type === "income").reduce((s, t) => s + txDisplay(t), 0), [transactions, displayCurrency, fxRates]);
  const totalExpense = useMemo(() => transactions.filter(t => t.type === "expense").reduce((s, t) => s + txDisplay(t), 0), [transactions, displayCurrency, fxRates]);
  const netCashFlow = totalIncome - totalExpense; // = total savings

  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const thisMonthFlow = monthlyFlows.find(m => m.month === thisMonthKey) || { income: 0, expense: 0, savings: 0 };

  const expenseByCategory = useMemo(() => {
    const map = {};
    transactions
      .filter(t => t.type === "expense" && (catMonthFilter === "all" || t.date.slice(0, 7) === catMonthFilter))
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + txDisplay(t);
      });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions, displayCurrency, fxRates, catMonthFilter]);

  const incomeByCategory = useMemo(() => {
    const map = {};
    transactions
      .filter(t => t.type === "income" && (catMonthFilter === "all" || t.date.slice(0, 7) === catMonthFilter))
      .forEach(t => {
        map[t.category] = (map[t.category] || 0) + txDisplay(t);
      });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [transactions, displayCurrency, fxRates, catMonthFilter]);

  function addOrUpdateTx() {
    if (!txForm.amount || isNaN(Number(txForm.amount))) {
      showToast("Enter a valid amount");
      return;
    }
    const origAmount = Number(txForm.amount);
    const currency = txForm.currency || "INR";
    const autoCategory = applyRulesToDescription(txForm.description, txForm.type) || txForm.category;
    const record = buildTxRecord({
      date: txForm.date, type: txForm.type, category: autoCategory,
      description: txForm.description, origAmount, currency,
      fxRatesAtEntry: { ...fxRates },
    });
    if (editingTx) {
      setTransactions(prev => prev.map(t => t.id === editingTx ? { ...t, ...record } : t));
      setEditingTx(null);
      showToast("Transaction updated");
    } else {
      setTransactions(prev => [...prev, { id: "tx-" + Date.now(), ...record }]);
      showToast("Transaction added");
    }
    setTxForm({ date: txForm.date, type: txForm.type, category: txForm.type === "income" ? incomeCategories[0] : expenseCategories[0], description: "", amount: "", currency: txForm.currency });
  }

  function startEditTx(t) {
    setEditingTx(t.id);
    setTxForm({ date: t.date, type: t.type, category: t.category, description: t.description || "", amount: String(t.origAmount ?? t.amount), currency: t.currency || "INR" });
  }

  function cancelEditTx() {
    setEditingTx(null);
    setTxForm({ date: new Date().toISOString().slice(0,10), type: "income", category: "Salary", description: "", amount: "", currency: "INR" });
  }

  function deleteTx(id) {
    setTransactions(prev => prev.filter(t => t.id !== id));
    if (editingTx === id) cancelEditTx();
    showToast("Transaction removed");
  }

  function refreshHistoricalRates() {
    const needsUpdate = transactions.filter(t =>
      (t.currency || "INR") !== "INR" && t.fxRateSource !== "historical"
    );
    if (needsUpdate.length === 0) { showToast("All rates already up to date"); return; }
    const updatedMap = {};
    needsUpdate.forEach(t => {
      updatedMap[t.id] = historicalRate(t.date, t.currency);
    });
    setTransactions(prev => prev.map(t => {
      const newRate = updatedMap[t.id];
      if (!newRate) return t;
      return {
        ...t,
        fxRateAtDate: newRate,
        fxRateSource: "historical",
        amount: (Number(t.origAmount ?? t.amount) || 0) * newRate,
      };
    }));
    showToast(`Updated ${needsUpdate.length} transactions with historical rates`);
  }

  // ---- Categorisation rules ----
  function applyRulesToDescription(desc, txType) {
    for (const rule of categoryRules) {
      if (rule.type !== "any" && rule.type !== txType) continue;
      const haystack = rule.caseSensitive ? desc : desc.toLowerCase();
      const needle = rule.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
      if (haystack.includes(needle)) return rule.category;
    }
    return null;
  }

  function applyRulesToAll() {
    let changed = 0;
    setTransactions(prev => prev.map(t => {
      const matched = applyRulesToDescription(t.description || "", t.type);
      if (matched && matched !== t.category) { changed++; return { ...t, category: matched }; }
      return t;
    }));
    showToast(`Rules applied — categories updated`);
  }

  function addRule() {
    if (!newRule.keyword.trim()) { showToast("Enter a keyword"); return; }
    setCategoryRules(prev => [...prev, { ...newRule, id: "r-" + Date.now(), keyword: newRule.keyword.trim() }]);
    setNewRule({ keyword: "", type: "expense", category: expenseCategories[0], caseSensitive: false });
    showToast("Rule added");
  }

  function deleteRule(id) {
    setCategoryRules(prev => prev.filter(r => r.id !== id));
  }

  function updateRule(id, field, value) {
    setCategoryRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // ---- Transaction category management ----
  function addTxCategory() {
    const name = newTxCatName.trim();
    if (!name) return;
    if (newTxCatType === "income") {
      if (incomeCategories.includes(name)) { showToast("Already exists"); return; }
      setIncomeCategories(prev => [...prev, name]);
    } else {
      if (expenseCategories.includes(name)) { showToast("Already exists"); return; }
      setExpenseCategories(prev => [...prev, name]);
    }
    setNewTxCatName("");
    showToast(`"${name}" added`);
  }

  function removeTxCategory(name, type) {
    if (type === "income") {
      setIncomeCategories(prev => prev.filter(c => c !== name));
    } else {
      setExpenseCategories(prev => prev.filter(c => c !== name));
    }
    showToast(`"${name}" removed`);
  }

  function renameTxCategory(oldName, newName, type) {
    if (!newName.trim() || newName === oldName) return;
    if (type === "income") {
      setIncomeCategories(prev => prev.map(c => c === oldName ? newName : c));
    } else {
      setExpenseCategories(prev => prev.map(c => c === oldName ? newName : c));
    }
    // Update any transactions using the old name
    setTransactions(prev => prev.map(t => t.category === oldName ? { ...t, category: newName } : t));
    // Update any rules using the old name
    setCategoryRules(prev => prev.map(r => r.category === oldName ? { ...r, category: newName } : r));
    showToast(`Renamed to "${newName}"`);
  }

  // ---- CSV import ----
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const splitLine = (line) => {
      // basic CSV split handling quoted commas
      const out = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQ = !inQ;
        else if (ch === "," && !inQ) { out.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const headers = splitLine(lines[0]).map(h => h.toLowerCase());
    const rows = lines.slice(1).filter(l => l.trim()).map(l => splitLine(l));

    const dateIdx = headers.findIndex(h => h.includes("date"));
    const descIdx = headers.findIndex(h => h.includes("desc") || h.includes("narration") || h.includes("particular") || h.includes("merchant"));
    const debitIdx = headers.findIndex(h => h.includes("debit") || h.includes("withdrawal"));
    const creditIdx = headers.findIndex(h => h.includes("credit") || h.includes("deposit"));
    const amountIdx = headers.findIndex(h => h === "amount" || h.includes("amount"));
    const currencyIdx = headers.findIndex(h => h.includes("currency") || h === "ccy");

    const parsed = rows.map((r, i) => {
      let amount = 0, type = "expense";
      if (debitIdx >= 0 || creditIdx >= 0) {
        const debit = parseFloat((r[debitIdx] || "0").replace(/[^0-9.\-]/g, "")) || 0;
        const credit = parseFloat((r[creditIdx] || "0").replace(/[^0-9.\-]/g, "")) || 0;
        if (credit > 0) { amount = credit; type = "income"; }
        else { amount = debit; type = "expense"; }
      } else if (amountIdx >= 0) {
        const raw = parseFloat((r[amountIdx] || "0").replace(/[^0-9.\-]/g, "")) || 0;
        amount = Math.abs(raw);
        type = raw >= 0 ? "income" : "expense";
      }
      const dateRaw = dateIdx >= 0 ? r[dateIdx] : "";
      const d = parseFlexDate(dateRaw);
      const date = isNaN(d.getTime()) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
      const description = descIdx >= 0 ? r[descIdx] : r.join(" ");
      const currencyRaw = currencyIdx >= 0 ? (r[currencyIdx] || "").toUpperCase() : "INR";
      const currency = CURRENCIES[currencyRaw] ? currencyRaw : "INR";
      return {
        id: "imp-" + Date.now() + "-" + i,
        date,
        type,
        amount,
        currency,
        description,
        category: categorise(description, type),
        _selected: amount > 0,
      };
    }).filter(r => r.amount > 0);

    return parsed;
  }

  function categorise(desc, txType) {
    // User-defined rules take priority; fall back to built-in heuristics
    return applyRulesToDescription(desc, txType) || guessCategory(desc, txType);
  }

  function guessCategory(desc, type) {
    const d = (desc || "").toLowerCase();
    if (type === "income") {
      // Credit card refunds, cashbacks, airline credits etc. are NOT real income —
      // they are offsets to expenses. Reclassify so they reduce expenses, not inflate savings.
      if (d.includes("cashback") || d.includes("cash back") || d.includes("refund") ||
          d.includes("reversal") || d.includes("reversed") || d.includes("cancelled") ||
          /^\d+(\.\d+)?%\s/.test(d)) return "Other Expense"; // "10% Cashback..." etc.
      if (d.includes("salary") || d.includes("payroll")) return "Salary";
      if (d.includes("dividend")) return "Dividends";
      if (d.includes("interest") && !d.includes("restaurant")) return "Interest";
      if (d.includes("rent received")) return "Rental Income";
      return "Other Income";
    }
    if (d.includes("swiggy") || d.includes("zomato") || d.includes("deliveroo") || d.includes("restaurant") || d.includes("cafe") || d.includes("noon food") || d.includes("itsu") || d.includes("hutong") || d.includes("city social") || d.includes("opa") || d.includes("island poke") || d.includes("jamavar") || d.includes("ivy asia") || d.includes("pilpel") || d.includes("hidden gem") || d.includes("gift house") || d.includes("pearl hoi an") || d.includes("thien thai")) return "Dining";
    if (d.includes("amazon") || d.includes("flipkart") || d.includes("myntra") || d.includes("tesco") || d.includes("noon.com")) {
      if (d.includes("grocery")) return "Groceries";
      return d.includes("tesco") ? "Groceries" : "Shopping";
    }
    if (d.includes("uber") || d.includes("ola") || d.includes("irctc") || d.includes("careem") || d.includes("grab") || d.includes("taxi") || d.includes("limousine") || d.includes("tfl ") || d.includes("zed mobility")) return "Travel";
    if (d.includes("flight") || d.includes("airline") || d.includes("emirates") || d.includes("air india") || d.includes("oman air") || d.includes("air arabia") || d.includes("indigo") || d.includes("hotel") || d.includes("westin") || d.includes("hoxton") || d.includes("rotana") || d.includes("wyndham")) return "Travel";
    if (d.includes("electricity") || d.includes("water bill") || d.includes("gas") || d.includes("broadband") || d.includes("recharge") || d.includes("dewa")) return "Utilities";
    if (d.includes("rent")) return "Rent";
    if (d.includes("hospital") || d.includes("pharmacy") || d.includes("medical") || d.includes("parma medics")) return "Healthcare";
    if (d.includes("insurance") || d.includes("premium")) return "Insurance";
    if (d.includes("mutual fund") || d.includes("sip") || d.includes("zerodha") || d.includes("groww")) return "Investments";
    if (d.includes("grocery") || d.includes("bigbasket") || d.includes("dmart") || d.includes("supermarket")) return "Groceries";
    if (d.includes("mutual fund") || d.includes("sip") || d.includes("zerodha") || d.includes("groww")) return "Investment Fees"; // only fees, not the investment itself
    if (d.includes("annual fee") || d.includes("vat on") || d.includes("visa") || d.includes("vfs") || d.includes("ukvi") || d.includes("copy centre") || d.includes("barbers") || d.includes("noon minutes")) return "Other Expense";
    return "Other Expense";
  }

  // ---- Duplicate detection ----
  // Strips punctuation, currency noise, and long reference/auth-code numbers so
  // that cosmetic differences (extra whitespace, a transaction ref appended by
  // the bank) don't defeat matching.
  function normalizeDesc(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Jaccard similarity over word tokens — cheap, dependency-free, and good
  // enough to tell "UBER *TRIP HELP.UBER.COM" apart from "UBER EATS".
  function descSimilarity(a, b) {
    const na = normalizeDesc(a), nb = normalizeDesc(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const setA = new Set(na.split(" ").filter(Boolean));
    const setB = new Set(nb.split(" ").filter(Boolean));
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    setA.forEach(w => { if (setB.has(w)) inter++; });
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : inter / union;
  }

  function daysBetween(d1, d2) {
    const t1 = new Date(d1).getTime(), t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return Infinity;
    return Math.abs(t1 - t2) / 86400000;
  }

  // Looks for the best-matching candidate for `row` among `candidates`
  // ({date, amount, currency, description}). Same amount (currency-aware,
  // small tolerance for rounding) is required either way; date and
  // description similarity determine confidence:
  //   "exact"    — same day, and descriptions clearly refer to the same thing
  //   "possible" — within a few days (statements often show the post date on
  //                one export and the transaction date on another) with at
  //                least some descriptive overlap
  function findDuplicateMatch(row, candidates) {
    const rowAmount = Number(row.amount);
    if (!rowAmount) return null;
    const rowCcy = row.currency || "INR";
    let best = null;
    for (const c of candidates) {
      const cAmount = Number(c.amount);
      if (!cAmount) continue;
      if ((c.currency || "INR") !== rowCcy) continue;
      const tolerance = Math.max(0.01, Math.abs(rowAmount) * 0.001);
      if (Math.abs(cAmount - rowAmount) > tolerance) continue;
      const dayGap = daysBetween(c.date, row.date);
      if (dayGap > 3) continue;
      const sim = descSimilarity(c.description, row.description);
      if (dayGap === 0 && sim >= 0.4) {
        return { confidence: "exact", dayGap, sim, ref: c };
      }
      if (dayGap <= 3 && sim >= 0.25) {
        if (!best || sim > best.sim) best = { confidence: "possible", dayGap, sim, ref: c };
      }
    }
    return best;
  }

  // Flags each freshly-parsed row as a likely duplicate of either (a) a
  // transaction already saved in the tracker, or (b) an earlier row in this
  // same import batch — which is exactly what happens when a user uploads
  // two statements whose date ranges overlap, or a statement that contains
  // a repeated line. Exact matches are auto-unchecked; possible matches are
  // left selectable but visibly flagged so the user makes the call.
  function annotateDuplicates(rows) {
    const existingCandidates = transactions.map(t => ({
      date: t.date,
      amount: Number(t.origAmount ?? t.amount),
      currency: t.currency || "INR",
      description: t.description || "",
    }));

    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let match = findDuplicateMatch(row, existingCandidates);
      let source = "existing";
      if (!match) {
        // Only look back at rows already processed in this batch, so the
        // first occurrence of a transaction stays clean and only the
        // repeat(s) get flagged.
        const batchCandidates = out.slice(0, i).map(r => ({
          date: r.date, amount: Number(r.amount), currency: r.currency, description: r.description,
        }));
        match = findDuplicateMatch(row, batchCandidates);
        source = "batch";
      }
      if (match) {
        out.push({
          ...row,
          _dupStatus: match.confidence, // "exact" | "possible"
          _dupSource: source, // "existing" | "batch"
          _dupInfo: match,
          _selected: match.confidence === "exact" ? false : row._selected,
        });
      } else {
        out.push(row);
      }
    }
    return out;
  }

  function dupTooltip(r) {
    if (!r._dupInfo) return "";
    const { ref, dayGap } = r._dupInfo;
    const where = r._dupSource === "existing" ? "an existing transaction" : "another row in this import";
    const dateNote = dayGap > 0 ? ` (${Math.round(dayGap)} day${dayGap >= 1.5 ? "s" : ""} apart)` : "";
    return `Looks like a duplicate of ${where}: ${ref.date}${dateNote}, ${ref.description || "no description"}, ${Number(ref.amount).toLocaleString()} ${ref.currency || ""}`;
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setImportText(text);
      const parsed = parseCSV(text);
      if (!parsed || parsed.length === 0) {
        showToast("Couldn't parse this CSV — check format");
        setImportPreview(null);
      } else {
        setImportPreview(annotateDuplicates(parsed));
      }
    };
    reader.readAsText(file);
  }

  async function handlePdfImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPdfParsing(true);
    setPdfParseError(null);
    setImportPreview(null);

    try {
      // Load pdf.js from CDN (runs entirely in browser, no server involved)
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Extract all text items with their positions across all pages
      const allItems = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1.0 });
        const content = await page.getTextContent();
        content.items.forEach(item => {
          if (!item.str.trim()) return;
          // Transform [a,b,c,d,e,f] → x=e, y=viewport.height-f (flip y so top=0)
          const tx = item.transform;
          allItems.push({
            text: item.str.trim(),
            x: Math.round(tx[4]),
            y: Math.round(viewport.height - tx[5]),
            w: Math.round(item.width),
            page: p,
          });
        });
      }

      if (allItems.length === 0) {
        throw new Error("No text found — this may be a scanned (image) PDF. Please export as CSV instead.");
      }

      const result = parsePdfItems(allItems);
      if (!result || result.rows.length === 0) {
        throw new Error("Couldn't identify transaction rows. The layout may be unusual — try exporting as CSV from your bank's portal.");
      }

      setPdfDetectedCurrency(result.detectedCurrency);
      setImportPreview(annotateDuplicates(result.rows));
      setShowImport(true);
    } catch (err) {
      setPdfParseError(err.message || "Failed to parse PDF");
    } finally {
      setPdfParsing(false);
    }
  }

  function parsePdfItems(items) {
    // ── Step 0: Detect statement currency from header text ──
    const allText = items.map(it => it.text).join(" ");

    // Explicit currency codes/symbols in the text
    const detectedCurrency = (() => {
      // Look for "Amount in AED", "Currency: INR", "Transactions in USD" etc.
      const explicit = allText.match(/(?:amount\s+in|currency[:\s]+|in\s+currency[:\s]+)\s*(AED|INR|USD)/i);
      if (explicit) return explicit[1].toUpperCase();

      // Look for prominent standalone currency codes (appear multiple times = likely the statement currency)
      const counts = { AED: 0, INR: 0, USD: 0 };
      const tokens = allText.split(/\s+/);
      tokens.forEach(t => {
        const up = t.toUpperCase().replace(/[^A-Z]/g, "");
        if (counts[up] !== undefined) counts[up]++;
      });
      // AED symbol is "AED" — Indian statements often say "INR" or "Rs."
      if (/\bRs\.?\b/.test(allText) || /\bINR\b/.test(allText)) counts.INR += 5;
      if (/\bAED\b/.test(allText)) counts.AED += 3;
      if (/\bUSD\b|\$/.test(allText)) counts.USD += 2;
      // Bank name heuristics for common UAE/Indian banks
      if (/ADCB|Emirates\s+NBD|ENBD|Mashreq|FAB|DIB|RAK\s*Bank|HSBC.*UAE|CBD/i.test(allText)) counts.AED += 5;
      if (/HDFC|ICICI|SBI|Axis\s+Bank|Kotak|IndusInd|Yes\s+Bank|IDFC/i.test(allText)) counts.INR += 5;
      if (/Citibank|JPMorgan|Bank\s+of\s+America|Chase/i.test(allText)) counts.USD += 3;

      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return best[1] > 0 ? best[0] : "AED"; // fallback to AED
    })();

    // Check if statement has a per-row currency column
    const hasCurrencyCol = /\b(AED|INR|USD)\b/.test(allText) &&
      items.some(it => ["AED","INR","USD"].includes(it.text.toUpperCase()));


    const lines = [];
    const sorted = [...items].sort((a, b) => a.page !== b.page ? a.page - b.page : a.y !== b.y ? a.y - b.y : a.x - b.x);

    sorted.forEach(item => {
      const existing = lines.find(l => l.page === item.page && Math.abs(l.y - item.y) <= 4);
      if (existing) {
        existing.items.push(item);
        existing.y = Math.round((existing.y * existing.items.length + item.y) / (existing.items.length + 1));
      } else {
        lines.push({ y: item.y, page: item.page, items: [item] });
      }
    });

    // Sort items within each line by x
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));

    // ── Step 2: Detect column structure ──
    // Collect all x positions of first-tokens and amount-like tokens
    const DATE_RE = /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$|^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$|^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i;
    const AMOUNT_RE = /^[\d,]+\.?\d*$/;
    const CRDR_RE = /^(CR|DR|Credit|Debit|C|D)$/i;
    const SKIP_RE = /^(page|statement|account|balance|total|opening|closing|carried|brought|date|description|narration|particulars|debit|credit|amount|currency|ref|reference|type|transaction)$/i;

    // Find lines that look like transaction rows (start with a date)
    const txLines = lines.filter(l => {
      const first = l.items[0]?.text;
      return first && DATE_RE.test(first);
    });

    if (txLines.length < 2) {
      // Try relaxed: lines where any token is a date
      const relaxed = lines.filter(l => l.items.some(it => DATE_RE.test(it.text)));
      if (relaxed.length < 2) return null;
      txLines.push(...relaxed);
    }

    // ── Step 3: Identify column roles from a sample of tx lines ──
    // For each tx line, bucket tokens by x-zone
    // We'll use the rightmost numeric columns as amounts, leftmost as date, middle as description

    // Gather all x-positions from tx lines
    const allXPositions = txLines.flatMap(l => l.items.map(it => it.x));
    const minX = Math.min(...allXPositions);
    const maxX = Math.max(...allXPositions);
    const pageWidth = maxX - minX;

    // Zone boundaries (relative)
    const leftZone = minX + pageWidth * 0.25;   // date zone
    const rightZone = minX + pageWidth * 0.65;  // amount zone starts here

    // Detect if there's a CR/DR column
    const hasCrDr = txLines.some(l => l.items.some(it => CRDR_RE.test(it.text)));

    // ── Step 4: Parse each tx line into {date, description, amount, type} ──
    const rows = [];
    txLines.forEach((line, li) => {
      const its = line.items;
      if (its.length < 2) return;

      const dateItem = its.find(it => DATE_RE.test(it.text));
      if (!dateItem) return;

      // Description: all items between date and amount zone
      const descItems = its.filter(it =>
        it.x > dateItem.x + dateItem.w &&
        it.x < rightZone &&
        !DATE_RE.test(it.text) &&
        !CRDR_RE.test(it.text) &&
        !AMOUNT_RE.test(it.text)
      );
      const description = descItems.map(it => it.text).join(" ").trim();

      // Amount items: rightmost numeric tokens
      const amountItems = its.filter(it => it.x >= rightZone && AMOUNT_RE.test(it.text.replace(/,/g, "")));
      if (amountItems.length === 0) return;

      // CR/DR indicator
      const crdrItem = its.find(it => CRDR_RE.test(it.text));

      let amount = 0, type = "expense";

      if (hasCrDr && crdrItem) {
        amount = parseFloat(amountItems[amountItems.length - 1].text.replace(/,/g, "")) || 0;
        type = /^(CR|Credit|C)$/i.test(crdrItem.text) ? "income" : "expense";
      } else if (amountItems.length >= 2) {
        // Two amount columns: debit and credit (one may be empty — represented by 0 or absent)
        // Heuristic: if last two numeric values, first=debit, second=credit
        const vals = amountItems.map(it => parseFloat(it.text.replace(/,/g, "")) || 0);
        // Many banks: debit col then credit col; non-zero one determines type
        const debit = vals[vals.length - 2] || 0;
        const credit = vals[vals.length - 1] || 0;
        if (credit > 0 && credit !== debit) {
          amount = credit; type = "income";
        } else if (debit > 0) {
          amount = debit; type = "expense";
        } else {
          amount = vals[vals.length - 1]; type = "expense";
        }
      } else {
        // Single signed or unsigned amount
        const raw = amountItems[amountItems.length - 1].text.replace(/,/g, "");
        const val = parseFloat(raw) || 0;
        // If negative → expense; positive → check description for "credit"
        if (val < 0) { amount = Math.abs(val); type = "expense"; }
        else { amount = val; type = "expense"; } // default expense; user can fix in preview
      }

      if (amount <= 0 || !description) return;

      const dateStr = toIsoDate(dateItem.text);
      if (!dateStr) return;

      // Per-row currency: some banks print "AED", "INR", or "USD" next to each amount
      const rowCurrencyItem = its.find(it => ["AED","INR","USD"].includes(it.text.toUpperCase()));
      const rowCurrency = rowCurrencyItem
        ? rowCurrencyItem.text.toUpperCase()
        : detectedCurrency;

      rows.push({
        id: "pdf-" + li + "-" + Math.random().toString(36).slice(2, 6),
        date: dateStr,
        type,
        amount,
        currency: rowCurrency,
        description,
        category: categorise(description, type),
        _selected: true,
      });
    });

    return rows.length > 0 ? { rows, detectedCurrency } : null;
  }

  function toIsoDate(str) {
    // Handle dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, "13 Jun 2026" etc.
    if (!str) return null;
    const s = str.trim();
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
    const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      const year = y.length === 2 ? "20" + y : y;
      return `${year}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
    }
    // "13 Jun 2026" or "13 June 2026"
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const dmy2 = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
    if (dmy2) {
      const [, d, mon, y] = dmy2;
      const m = months[mon.slice(0,3).toLowerCase()];
      if (m) return `${y}-${String(m).padStart(2,"0")}-${d.padStart(2,"0")}`;
    }
    return null;
  }

  function toggleImportRow(id) {
    setImportPreview(prev => prev.map(r => r.id === id ? { ..._r(r), _selected: !r._selected } : r));
  }
  function _r(r) { return r; }

  function updateImportRow(id, field, value) {
    setImportPreview(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // Re-run categorisation automatically when description or type changes
      if (field === "description" || field === "type") {
        const autoCat = categorise(
          field === "description" ? value : r.description,
          field === "type" ? value : r.type
        );
        if (autoCat) updated.category = autoCat;
      }
      return updated;
    }));
  }

  function confirmImport() {
    const selected = importPreview.filter(r => r._selected);
    const toAdd = selected.map(r => {
      const origAmount = Number(r.amount);
      const currency = r.currency || "INR";
      const fxRateAtDate = historicalRate(r.date, currency);
      return {
        id: "tx-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        date: r.date, type: r.type, category: r.category, description: r.description,
        origAmount, currency, fxRateAtDate, fxRateSource: "historical",
        amount: origAmount * fxRateAtDate,
        fxRatesAtEntry: { ...fxRates },
      };
    });
    setTransactions(prev => [...prev, ...toAdd]);
    setImportPreview(null);
    setImportText("");
    setPdfDetectedCurrency(null);
    setShowImport(false);
    showToast(`Imported ${toAdd.length} transactions`);
  }


  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  function updateSnapshotValue(id, cat, val) {
    setSnapshots(prev => prev.map(s => s.id === id ? { ...s, values: { ...s.values, [cat]: val === "" ? "" : Number(val) } } : s));
  }

  function updateSnapshotFx(id, code, val) {
    setSnapshots(prev => prev.map(s => s.id === id ? { ...s, fxRates: { ...(s.fxRates || DEFAULT_FX_TO_INR), [code]: val === "" ? "" : Number(val) } } : s));
  }

  function updateSnapshotDate(id, date) {
    setSnapshots(prev => prev.map(s => s.id === id ? { ...s, date } : s));
  }

  function deleteSnapshot(id) {
    setSnapshots(prev => prev.filter(s => s.id !== id));
    showToast("Entry removed");
  }

  function addSnapshot() {
    const newId = "s-" + Date.now();
    const baseValues = latest ? { ...latest.values } : Object.fromEntries(categories.map(c => [c, 0]));
    const baseFx = latest?.fxRates ? { ...latest.fxRates } : { ...fxRates };
    const today = new Date().toISOString().slice(0, 10);
    setSnapshots(prev => [...prev, { id: newId, date: today, values: baseValues, fxRates: baseFx }]);
    setEditingSnap(newId);
    showToast("New entry added — edit values below");
  }

  function handleNwExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wbx = XLSX.read(data, { type: "array", cellDates: true });
        const warnings = [];

        // Try NetWorth sheet first, then the first sheet
        const sheetName = wbx.SheetNames.includes("NetWorth") ? "NetWorth"
          : wbx.SheetNames.find(n => /net.?worth|history|portfolio|wealth|balance/i.test(n))
          || wbx.SheetNames[0];
        const ws = wbx.Sheets[sheetName];
        if (!ws) { showToast("No sheet found"); return; }

        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        if (rows.length < 2) { showToast("Sheet appears empty"); return; }

        // Find the header row — the one that contains "Date"
        let headerIdx = rows.findIndex(r => r.some(cell => /^date$/i.test(String(cell).trim())));
        if (headerIdx < 0) headerIdx = 0;
        const header = rows[headerIdx].map(h => String(h).trim());
        const dateCol = header.findIndex(h => /^date$/i.test(h));

        const toIso = (v) => {
          if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
          const d = parseFlexDate(String(v));
          return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        };

        // Map header columns to known categories (fuzzy — case-insensitive, ignoring spaces/dashes)
        const normalise = s => String(s).toLowerCase().replace(/[\s\-_]/g, "");
        const catColMap = {}; // category -> col index
        const unmappedCols = [];
        const usdCol = header.findIndex(h => /usd.?inr|usd.?rate/i.test(h));
        const aedCol = header.findIndex(h => /aed.?inr|aed.?rate/i.test(h));
        const totalCol = header.findIndex(h => /^total/i.test(h));

        header.forEach((h, i) => {
          if (i === dateCol || i === usdCol || i === aedCol || i === totalCol) return;
          if (!h) return;
          const match = categories.find(c => normalise(c) === normalise(h));
          if (match) {
            catColMap[match] = i;
          } else {
            // partial match
            const partial = categories.find(c => normalise(h).includes(normalise(c)) || normalise(c).includes(normalise(h)));
            if (partial && !catColMap[partial]) {
              catColMap[partial] = i;
              warnings.push(`Column "${h}" matched to category "${partial}"`);
            } else if (!partial && h) {
              unmappedCols.push(h);
            }
          }
        });

        if (unmappedCols.length) warnings.push(`Unrecognised columns (ignored): ${unmappedCols.join(", ")}`);
        const mappedCats = Object.keys(catColMap);
        if (mappedCats.length === 0) warnings.push("No category columns matched — check your sheet headers match category names.");

        const preview = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const dateRaw = dateCol >= 0 ? r[dateCol] : r[0];
          const date = toIso(dateRaw);
          if (!date) continue;
          if (r.every(v => v === "" || v == null || v === 0)) continue; // skip blank rows

          const values = Object.fromEntries(categories.map(c => [c, 0]));
          mappedCats.forEach(c => {
            const v = Number(r[catColMap[c]]);
            if (!isNaN(v)) values[c] = v;
          });

          const usdRate = usdCol >= 0 && r[usdCol] ? Number(r[usdCol]) : (fxRates.USD || DEFAULT_FX_TO_INR.USD);
          const aedRate = aedCol >= 0 && r[aedCol] ? Number(r[aedCol]) : (fxRates.AED || DEFAULT_FX_TO_INR.AED);

          // Check if a snapshot for this date already exists
          const existing = snapshots.find(s => s.date === date);

          preview.push({
            _id: "nwimp-" + i,
            _selected: true,
            _existing: !!existing,
            _existingId: existing?.id,
            date,
            values,
            fxRates: { INR: 1, USD: usdRate, AED: aedRate },
          });
        }

        if (preview.length === 0) { showToast("No valid rows found"); return; }
        setNwImportPreview(preview);
        setNwImportWarnings(warnings);
        setShowNwImport(true);
      } catch (err) {
        console.error(err);
        showToast("Couldn't parse that file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function confirmNwImport() {
    const selected = nwImportPreview.filter(r => r._selected);
    let added = 0, updated = 0;
    setSnapshots(prev => {
      let next = [...prev];
      selected.forEach(r => {
        const snap = { id: r._existingId || ("nwimp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)), date: r.date, values: r.values, fxRates: r.fxRates };
        if (r._existing && r._existingId) {
          next = next.map(s => s.id === r._existingId ? snap : s);
          updated++;
        } else {
          next.push(snap);
          added++;
        }
      });
      return next;
    });
    setNwImportPreview(null);
    setNwImportWarnings([]);
    setShowNwImport(false);
    showToast(`Imported: ${added} new, ${updated} updated`);
  }

  function addCategory() {
    if (!newCatName.trim()) return;
    if (categories.includes(newCatName.trim())) {
      showToast("Category already exists");
      return;
    }
    const name = newCatName.trim();
    setCategories(prev => [...prev, name]);
    setClassMap(prev => ({ ...prev, [name]: newCatClass }));
    setCostBasis(prev => ({ ...prev, [name]: 0 }));
    setSnapshots(prev => prev.map(s => ({ ...s, values: { ...s.values, [name]: 0 } })));
    setNewCatName("");
    setShowAddCat(false);
    showToast("Category added");
  }

  function removeCategory(cat) {
    if (!window.confirm) {} // no-op
    setCategories(prev => prev.filter(c => c !== cat));
    setSnapshots(prev => prev.map(s => {
      const v = { ...s.values };
      delete v[cat];
      return { ...s, values: v };
    }));
    showToast(`${cat} removed`);
  }

  function updateCostBasis(cat, val) {
    setCostBasis(prev => ({ ...prev, [cat]: val === "" ? 0 : Number(val) }));
  }

  function updateClassMap(cat, cls) {
    setClassMap(prev => ({ ...prev, [cat]: cls }));
  }

  if (loadError) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", color: INK, gap: 16, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Couldn't load your data</div>
        <div style={{ color: MUTED, maxWidth: 420 }}>
          We weren't able to reach your saved data just now. To protect your existing records, nothing will be saved until this succeeds — please check your connection and try again.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Source Serif 4', Georgia, serif", color: MUTED }}>
        Loading your ledger…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Inter', system-ui, sans-serif", color: INK }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .num-input {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          border: 1px solid ${BORDER};
          border-radius: 6px;
          padding: 6px 8px;
          width: 100%;
          background: ${BG};
          color: ${INK};
        }
        .num-input:focus { outline: 2px solid ${ACCENT}33; border-color: ${ACCENT}; }
        .tab-btn {
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 13px;
          letter-spacing: 0.02em;
          padding: 10px 18px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: ${MUTED};
          cursor: pointer;
          transition: all 0.15s;
        }
        .tab-btn.active {
          background: ${INK};
          color: ${BG};
        }
        .tab-btn:hover:not(.active) {
          background: ${BORDER};
          color: ${INK};
        }
        .panel {
          background: ${PANEL};
          border: 1px solid ${BORDER};
          border-radius: 14px;
          padding: 20px;
        }
        .btn-primary {
          background: ${ACCENT};
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .btn-primary:hover { opacity: 0.88; }
        .btn-ghost {
          background: transparent;
          border: 1px solid ${BORDER};
          color: ${INK};
          border-radius: 8px;
          padding: 9px 14px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .btn-ghost:hover { background: ${BG}; }
        .btn-icon {
          background: transparent;
          border: none;
          color: ${MUTED};
          cursor: pointer;
          font-size: 14px;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .btn-icon:hover { background: #f3eee6; color: ${INK}; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 10px; text-align: right; font-size: 13px; border-bottom: 1px solid ${BORDER}; }
        th:first-child, td:first-child { text-align: left; }
        th { font-weight: 600; color: ${MUTED}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
        tbody tr:hover { background: #faf6f0; }
        .scroll-x { overflow-x: auto; }
        @media (max-width: 720px) {
          .grid-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .grid-charts { grid-template-columns: 1fr !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <header style={{ padding: "28px 24px 20px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", color: MUTED, fontWeight: 600, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 10 }}>
              Personal Ledger
              <span style={{ fontWeight: 500, color: saveStatus === "error" ? "#b5685a" : (saveStatus === "unavailable" ? "#c97c5d" : "#a39a8e"), letterSpacing: "0.05em", textTransform: "none", fontSize: 10 }}>
                {saveStatus === "saving" ? "saving…" : saveStatus === "error" ? "save failed — use backup below" : saveStatus === "unavailable" ? "auto-save unavailable — use backup below" : "● all changes saved"}
              </span>
            </div>
            <h1 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 32, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Net Worth</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {user && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 12, color: MUTED }}>{user.email}</span>
                <button onClick={signOut} style={{ fontSize: 11, color: MUTED, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>Sign out</button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <select className="num-input" style={{ width: 100, fontSize: 12 }} value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
                {Object.entries(CURRENCIES).map(([code, c]) => <option key={code} value={code}>{code}</option>)}
              </select>
              <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => setShowFxEditor(v => !v)}>FX rates</button>
            </div>
            {latest && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{fmtDispCompact(latestTotal)}</div>
                <div style={{ fontSize: 13, color: change >= 0 ? "#5f8d6b" : "#b5685a", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  {change >= 0 ? "▲" : "▼"} {fmtDispCompact(Math.abs(change))} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}%) <span style={{color: MUTED, fontWeight: 400}}>since {previous?.date}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        {showFxEditor && (
          <div className="panel" style={{ marginTop: 14, padding: 16 }}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
              These are today's exchange rates, used as defaults for new entries and as a fallback for older entries that don't have their own rate set. All values are stored in INR. Each net worth entry (History tab) has its own USD/AED rates editable for that date — so past balances convert using the rate from that date, not today's rate.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
              {Object.entries(CURRENCIES).filter(([code]) => code !== "INR").map(([code, c]) => (
                <div key={code}>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>1 {code} = ? INR</label>
                  <input className="num-input" type="number" value={fxRates[code] ?? ""} onChange={e => setFxRates(prev => ({ ...prev, [code]: e.target.value === "" ? "" : Number(e.target.value) }))} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="panel" style={{ marginTop: 14, padding: 16, borderColor: saveStatus === "unavailable" || saveStatus === "error" ? ACCENT : BORDER }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: MUTED, maxWidth: 480 }}>
              {saveStatus === "unavailable"
                ? "Auto-save isn't available in this view, so changes won't persist between sessions automatically. Download a backup after making changes, and restore it when you reopen this app."
                : saveStatus === "error"
                ? "Auto-save just failed. Download a backup now as a precaution, then try again."
                : "Your changes auto-save. You can also download a manual backup anytime, or restore from a previous one."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={exportBackup}>Download backup (.json)</button>
              <label className="btn-ghost" style={{ cursor: "pointer" }}>
                Restore backup (.json)
                <input type="file" accept=".json,application/json" onChange={importBackup} style={{ display: "none" }} />
              </label>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 12, color: MUTED, maxWidth: 480 }}>
              Or work in Excel: export your data to a spreadsheet (NetWorth, Categories, Transactions, Settings sheets) to edit in bulk or build your own dashboards, then import it back here.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={exportExcel}>Export to Excel (.xlsx)</button>
              <label className="btn-ghost" style={{ cursor: "pointer" }}>
                Import from Excel (.xlsx)
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importExcel} style={{ display: "none" }} />
              </label>
            </div>
          </div>
        </div>
      </header>


      {/* Tabs */}
      <nav style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          ["overview", "Overview"],
          ["history", "History"],
          ["cashflow", "Cash Flow"],
          ["budget", "Budget"],
          ["data", "Edit Data"],
          ["categories", "Categories"],
        ].map(([key, label]) => (
          <button key={key} className={"tab-btn" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 60px" }}>

        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Stat row */}
            <div className="grid-stats" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              <StatCard label="Current Net Worth" value={fmtDispCompact(latestTotal)} />
              <StatCard label="Cumulative Savings" value={fmtDispCompact(cumulativeSavings)} positive={cumulativeSavings >= 0} sub="income − expenses" />
              <StatCard label="Wealth Created" value={fmtDispCompact(wealthCreated)} positive={wealthCreated >= 0} sub="returns above savings" />
              <StatCard label="Savings Rate" value={totalIncome > 0 ? ((netCashFlow / totalIncome) * 100).toFixed(1) + "%" : "—"} positive={netCashFlow >= 0} sub="of total income" />
              <StatCard label="XIRR" value={xirrResult !== null ? (xirrResult * 100).toFixed(1) + "%" : "—"} positive={xirrResult === null || xirrResult >= 0} sub="annualised, savings-based" />
            </div>

            {/* Net worth over time */}
            <div className="panel">
              <PanelTitle>Net worth over time</PanelTitle>
              <div style={{ fontSize: 12, color: MUTED, marginTop: -10, marginBottom: 10 }}>
                The gap between <span style={{ color: ACCENT, fontWeight: 600 }}>Net Worth</span> and <span style={{ color: "#7c9885", fontWeight: 600 }}>Savings Baseline</span> (starting wealth + cumulative net income minus expenses) is wealth created through returns. Credit card refunds and cashbacks reduce expenses rather than counting as income, so they don't inflate savings.
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={totals} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c9885" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#7c9885" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={BORDER} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: MUTED }} interval={Math.floor(totals.length / 6)} />
                  <YAxis tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} width={60} />
                  <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="savingsBaseline" stroke="#7c9885" strokeWidth={2} fill="url(#savingsGrad)" name="Savings Baseline" strokeDasharray="5 3" />
                  <Area type="monotone" dataKey="total" stroke={ACCENT} strokeWidth={2.5} fill="url(#totalGrad)" name="Net Worth" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Two-up: Asset class pie + category bar */}
            <div className="grid-charts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="panel">
                <PanelTitle>Allocation by asset class</PanelTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={assetClassBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                      {assetClassBreakdown.map((entry, i) => (
                        <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="panel">
                <PanelTitle>Holdings breakdown</PanelTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke={BORDER} horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: INK }} width={130} />
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {categoryBreakdown.map((entry, i) => (
                        <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Asset class trends */}
            <div className="panel">
              <PanelTitle>Asset class trends over time</PanelTitle>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={totals.map(row => {
                  const out = { date: row.date };
                  assetClassOptions.forEach(cls => {
                    out[cls] = categories.reduce((sum, c) => (classMap[c] === cls ? sum + (Number(row[c]) || 0) : sum), 0);
                  });
                  return out;
                })} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={BORDER} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: MUTED }} interval={Math.floor(totals.length / 6)} />
                  <YAxis tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} width={60} />
                  <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {assetClassOptions.map((cls, i) => (
                    <Line key={cls} type="monotone" dataKey={cls} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Upload panel */}
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <PanelTitle noMargin>Import from Excel</PanelTitle>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: MUTED }}>
                    Upload any .xlsx file — your own Net_Worth_Tracker.xlsx, your original spreadsheet, or any sheet with a <strong>Date</strong> column and holding names as headers. Column names are matched to your categories automatically.
                  </p>
                </div>
                <label className="btn-primary" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                  Upload .xlsx
                  <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleNwExcelUpload} style={{ display: "none" }} />
                </label>
              </div>

              {nwImportWarnings.length > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#fdf6ec", borderRadius: 8, border: "1px solid #e9d8b8" }}>
                  {nwImportWarnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#8a6a2a" }}>⚠ {w}</div>
                  ))}
                </div>
              )}

              {nwImportPreview && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>
                    Found <strong>{nwImportPreview.length}</strong> entries.
                    {nwImportPreview.filter(r => r._existing).length > 0 && (
                      <span style={{ color: "#c97c5d" }}> {nwImportPreview.filter(r => r._existing).length} will overwrite an existing date.</span>
                    )}
                    {" "}Uncheck any rows to skip.
                  </div>
                  <div className="scroll-x">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Import</th>
                          <th style={{ textAlign: "left" }}>Date</th>
                          {categories.map(c => <th key={c}>{c}</th>)}
                          <th>USD/INR</th>
                          <th>AED/INR</th>
                          <th>Total (INR)</th>
                          <th style={{ textAlign: "left" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nwImportPreview.map((r, ri) => {
                          const total = categories.reduce((sum, c) => sum + (Number(r.values[c]) || 0), 0);
                          return (
                            <tr key={r._id} style={{ opacity: r._selected ? 1 : 0.4 }}>
                              <td style={{ textAlign: "left" }}>
                                <input type="checkbox" checked={r._selected}
                                  onChange={() => setNwImportPreview(prev => prev.map((x, i) => i === ri ? { ...x, _selected: !x._selected } : x))} />
                              </td>
                              <td style={{ textAlign: "left", fontWeight: 600 }}>{r.date}</td>
                              {categories.map(c => (
                                <td key={c}>
                                  <input className="num-input" type="number" style={{ width: 90 }}
                                    value={r.values[c] ?? ""}
                                    onChange={e => setNwImportPreview(prev => prev.map((x, i) => i === ri ? { ...x, values: { ...x.values, [c]: Number(e.target.value) } } : x))} />
                                </td>
                              ))}
                              <td>
                                <input className="num-input" type="number" step="0.01" style={{ width: 72 }}
                                  value={r.fxRates?.USD ?? DEFAULT_FX_TO_INR.USD}
                                  onChange={e => setNwImportPreview(prev => prev.map((x, i) => i === ri ? { ...x, fxRates: { ...x.fxRates, USD: Number(e.target.value) } } : x))} />
                              </td>
                              <td>
                                <input className="num-input" type="number" step="0.01" style={{ width: 72 }}
                                  value={r.fxRates?.AED ?? DEFAULT_FX_TO_INR.AED}
                                  onChange={e => setNwImportPreview(prev => prev.map((x, i) => i === ri ? { ...x, fxRates: { ...x.fxRates, AED: Number(e.target.value) } } : x))} />
                              </td>
                              <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmtDispCompact(total)}</td>
                              <td style={{ textAlign: "left" }}>
                                {r._existing
                                  ? <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: "#c97c5d22", color: "#c97c5d", fontWeight: 600 }}>overwrite</span>
                                  : <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 10, background: "#7c988522", color: "#5f8d6b", fontWeight: 600 }}>new</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                    <button className="btn-primary" onClick={confirmNwImport}>
                      Import selected ({nwImportPreview.filter(r => r._selected).length})
                    </button>
                    <button className="btn-ghost" onClick={() => { setNwImportPreview(null); setNwImportWarnings([]); setShowNwImport(false); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Existing entries table */}
            <div className="panel scroll-x">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <PanelTitle noMargin>All entries ({sortedSnapshots.length})</PanelTitle>
                <button className="btn-ghost" onClick={addSnapshot}>+ Add entry manually</button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    {categories.map(c => <th key={c}>{c}</th>)}
                    <th>Total</th>
                    <th>USD/INR</th>
                    <th>AED/INR</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSnapshots.map(s => {
                    const total = categories.reduce((sum, c) => sum + (Number(s.values[c]) || 0), 0);
                    const isEditing = editingSnap === s.id;
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>
                          {isEditing ? (
                            <input className="num-input" style={{ width: 120 }} value={s.date} onChange={e => updateSnapshotDate(s.id, e.target.value)} />
                          ) : s.date}
                        </td>
                        {categories.map(c => (
                          <td key={c}>
                            {isEditing ? (
                              <input className="num-input" type="number" value={s.values[c] ?? ""} onChange={e => updateSnapshotValue(s.id, c, e.target.value)} />
                            ) : fmtCCAt(s.values[c], s.fxRates)}
                          </td>
                        ))}
                        <td style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{fmtCCAt(total, s.fxRates)}</td>
                        <td>
                          {isEditing ? (
                            <input className="num-input" type="number" step="0.01" style={{ width: 80 }} value={s.fxRates?.USD ?? DEFAULT_FX_TO_INR.USD} onChange={e => updateSnapshotFx(s.id, "USD", e.target.value)} />
                          ) : (s.fxRates?.USD ?? DEFAULT_FX_TO_INR.USD)}
                        </td>
                        <td>
                          {isEditing ? (
                            <input className="num-input" type="number" step="0.01" style={{ width: 80 }} value={s.fxRates?.AED ?? DEFAULT_FX_TO_INR.AED} onChange={e => updateSnapshotFx(s.id, "AED", e.target.value)} />
                          ) : (s.fxRates?.AED ?? DEFAULT_FX_TO_INR.AED)}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <button className="btn-icon" onClick={() => setEditingSnap(null)}>Done</button>
                          ) : (
                            <button className="btn-icon" onClick={() => setEditingSnap(s.id)}>Edit</button>
                          )}
                          <button className="btn-icon" onClick={() => deleteSnapshot(s.id)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "cashflow" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Historical rates banner */}
            {(() => {
              const missing = transactions.filter(t => (t.currency || "INR") !== "INR" && t.fxRateSource !== "historical").length;
              return missing > 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#fdf6ec", border: "1px solid #e9d8b8", borderRadius: 10, fontSize: 13, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <span style={{ color: "#8a6a2a" }}>
                      ⚠ <strong>{missing}</strong> foreign-currency transactions are using estimated rates.
                    </span>
                    <div style={{ fontSize: 11, color: "#a88a50", marginTop: 3 }}>
                      Rates are looked up via web search (Claude) — only date and currency codes are sent, no transaction data.
                    </div>
                  </div>
                  <button className="btn-ghost" onClick={refreshHistoricalRates} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    Fetch historical rates
                  </button>
                </div>
              ) : transactions.some(t => t.fxRateSource === "historical") ? (
                <div style={{ fontSize: 12, color: MUTED, padding: "6px 0" }}>
                  ✓ All foreign-currency transactions are using confirmed historical rates from Frankfurter (ECB data).
                </div>
              ) : null;
            })()}

            {/* Summary stats */}
            <div className="grid-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              <StatCard label="Total Income" value={fmtDispCompact(totalIncome)} positive={true} />
              <StatCard label="Total Expenses" value={fmtDispCompact(totalExpense)} positive={false} />
              <StatCard label="Net Savings" value={fmtDispCompact(netCashFlow)} positive={netCashFlow >= 0} sub="income − expenses" />
              <StatCard label="Savings Rate" value={totalIncome > 0 ? ((netCashFlow / totalIncome) * 100).toFixed(1) + "%" : "—"} positive={netCashFlow >= 0} sub={`this month: ${fmtDispCompact(thisMonthFlow.savings || thisMonthFlow.net || 0)}`} />
            </div>

            {/* Add transaction form */}
            <div className="panel">
              <PanelTitle>Add transaction</PanelTitle>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Date</label>
                  <input className="num-input" type="date" style={{ width: 150 }} value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Type</label>
                  <select className="num-input" style={{ width: 120 }} value={txForm.type} onChange={e => {
                    const type = e.target.value;
                    setTxForm(f => ({ ...f, type, category: type === "income" ? incomeCategories[0] : expenseCategories[0] }));
                  }}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Category</label>
                  <select className="num-input" style={{ width: 160 }} value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))}>
                    {(txForm.type === "income" ? incomeCategories : expenseCategories).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Description</label>
                  <input className="num-input" value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional note" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Amount</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="num-input" type="number" style={{ width: 110 }} value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                    <select className="num-input" style={{ width: 80 }} value={txForm.currency} onChange={e => setTxForm(f => ({ ...f, currency: e.target.value }))}>
                      {Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn-primary" onClick={addOrUpdateTx} >
                  Add
                </button>
                <button className="btn-ghost" onClick={() => setShowImport(v => !v)}>Import from CSV</button>
              </div>
            </div>

            {showImport && (
              <div className="panel">
                <PanelTitle>Import bank / card statement</PanelTitle>
                <p style={{ fontSize: 13, color: MUTED, marginTop: -8, marginBottom: 16 }}>
                  Upload a <strong>PDF</strong> or <strong>CSV</strong> statement. PDF parsing runs entirely in your browser — nothing is sent to any server.
                  Review and edit the parsed rows before importing.
                </p>

                <div
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = ACCENT; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = BORDER; }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = BORDER;
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    if (file.name.toLowerCase().endsWith(".pdf")) {
                      handlePdfImport({ target: { files: [file], value: "" } });
                    } else {
                      handleImportFile({ target: { files: [file] } });
                    }
                  }}
                  style={{ border: `2px dashed ${BORDER}`, borderRadius: 12, padding: "28px 20px", textAlign: "center", marginBottom: 16, transition: "border-color 0.15s", background: "#faf8f5" }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>Drag & drop your statement here</div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>PDF or CSV — both processed locally, nothing sent to any server</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <label className="btn-primary" style={{ cursor: "pointer" }}>
                      Upload PDF
                      <input type="file" accept=".pdf,application/pdf" onChange={handlePdfImport} style={{ display: "none" }} />
                    </label>
                    <label className="btn-ghost" style={{ cursor: "pointer" }}>
                      Upload CSV
                      <input type="file" accept=".csv,text/csv" onChange={handleImportFile} style={{ display: "none" }} />
                    </label>
                  </div>
                </div>

                {pdfParsing && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f0f4ff", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
                    <div style={{ width: 16, height: 16, border: "2px solid #5b7c99", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Extracting text from PDF in your browser…
                  </div>
                )}
                {pdfParseError && (
                  <div style={{ padding: "12px 16px", background: "#fdf0ef", border: "1px solid #e8c4c0", borderRadius: 8, marginBottom: 14, fontSize: 13, color: "#8b3a35" }}>
                    <strong>Couldn't parse this PDF:</strong> {pdfParseError}
                  </div>
                )}

                {importPreview && (
                  <div style={{ marginTop: 10 }}>
                    {pdfDetectedCurrency && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f0f6f1", border: "1px solid #c4dac9", borderRadius: 8, marginBottom: 12, fontSize: 13, flexWrap: "wrap" }}>
                        <span>🔍 Detected statement currency: <strong>{pdfDetectedCurrency}</strong></span>
                        <span style={{ color: MUTED }}>— applied per row. If this is wrong, override all rows here:</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          {Object.keys(CURRENCIES).map(code => (
                            <button
                              key={code}
                              onClick={() => setImportPreview(prev => prev.map(r => ({ ...r, currency: code })))}
                              style={{
                                padding: "3px 10px", borderRadius: 6, border: `1px solid ${code === pdfDetectedCurrency ? "#5f8d6b" : BORDER}`,
                                background: code === pdfDetectedCurrency ? "#7c988522" : "transparent",
                                color: code === pdfDetectedCurrency ? "#5f8d6b" : INK,
                                fontWeight: 600, fontSize: 12, cursor: "pointer"
                              }}
                            >{code}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>
                      Found <strong>{importPreview.length}</strong> transactions. Uncheck any to skip, and adjust type/category/currency as needed.
                    </div>
                    {(() => {
                      const exactCount = importPreview.filter(r => r._dupStatus === "exact").length;
                      const possibleCount = importPreview.filter(r => r._dupStatus === "possible").length;
                      if (exactCount === 0 && possibleCount === 0) return null;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#fdf6ec", border: "1px solid #e6d3ac", borderRadius: 8, marginBottom: 12, fontSize: 13, flexWrap: "wrap" }}>
                          <span>
                            ⚠️ {exactCount > 0 && <>Found <strong>{exactCount}</strong> likely duplicate{exactCount === 1 ? "" : "s"} of transactions already in your tracker (or repeated in this file) — unchecked automatically. </>}
                            {possibleCount > 0 && <>Flagged <strong>{possibleCount}</strong> possible duplicate{possibleCount === 1 ? "" : "s"} (close date/amount match) for you to review. </>}
                            This often happens when statement date ranges overlap.
                          </span>
                          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 12, padding: "4px 10px" }}
                              onClick={() => setImportPreview(prev => prev.map(r => r._dupStatus ? { ...r, _selected: false } : r))}
                            >Uncheck all flagged</button>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 12, padding: "4px 10px" }}
                              onClick={() => setImportPreview(prev => prev.map(r => r._dupStatus ? { ...r, _selected: true } : r))}
                            >Import anyway</button>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="scroll-x">
                      <table>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left" }}>Import</th>
                            <th style={{ textAlign: "left" }}>Date</th>
                            <th style={{ textAlign: "left" }}>Description</th>
                            <th style={{ textAlign: "left" }}>Type</th>
                            <th style={{ textAlign: "left" }}>Category</th>
                            <th>Amount</th>
                            <th style={{ textAlign: "left" }}>Currency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.map(r => (
                            <tr key={r.id} style={{ opacity: r._selected ? 1 : 0.45, background: r._dupStatus === "exact" ? "#fdf0ef" : r._dupStatus === "possible" ? "#fdf6ec" : "transparent" }}>
                              <td style={{ textAlign: "left" }}>
                                <input type="checkbox" checked={r._selected} onChange={() => toggleImportRow(r.id)} />
                              </td>
                              <td style={{ textAlign: "left" }}>
                                <input className="num-input" type="date" style={{ width: 130 }} value={r.date} onChange={e => updateImportRow(r.id, "date", e.target.value)} />
                              </td>
                              <td style={{ textAlign: "left", maxWidth: 220 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <input className="num-input" value={r.description} onChange={e => updateImportRow(r.id, "description", e.target.value)} />
                                  {r._dupStatus && (
                                    <span
                                      title={dupTooltip(r)}
                                      style={{
                                        flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 5, cursor: "help",
                                        color: r._dupStatus === "exact" ? "#8b3a35" : "#8a6d23",
                                        background: r._dupStatus === "exact" ? "#f5d9d6" : "#f2e2ba",
                                      }}
                                    >{r._dupStatus === "exact" ? "Duplicate" : "Possible dup"}</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: "left" }}>
                                <select className="num-input" style={{ width: 100 }} value={r.type} onChange={e => updateImportRow(r.id, "type", e.target.value)}>
                                  <option value="income">Income</option>
                                  <option value="expense">Expense</option>
                                </select>
                              </td>
                              <td style={{ textAlign: "left" }}>
                                <select className="num-input" style={{ width: 140 }} value={r.category} onChange={e => updateImportRow(r.id, "category", e.target.value)}>
                                  {(r.type === "income" ? incomeCategories : expenseCategories).map(c => <option key={c}>{c}</option>)}
                                </select>
                              </td>
                              <td>
                                <input className="num-input" type="number" style={{ width: 100, textAlign: "right" }} value={r.amount} onChange={e => updateImportRow(r.id, "amount", e.target.value)} />
                              </td>
                              <td style={{ textAlign: "left" }}>
                                <select className="num-input" style={{ width: 80 }} value={r.currency} onChange={e => updateImportRow(r.id, "currency", e.target.value)}>
                                  {Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="btn-primary" onClick={confirmImport}>Import selected ({importPreview.filter(r => r._selected).length})</button>
                      <button className="btn-ghost" onClick={() => { setImportPreview(null); setImportText(""); setPdfParseError(null); setPdfDetectedCurrency(null); }}>Cancel</button>
                      <span style={{ fontSize: 12, color: MUTED }}>✓ Processed locally — no data left your device.</span>
                    </div>
                  </div>
                )}
              </div>
            )}


            {/* Monthly income vs expense chart */}
            <div className="panel">
              <PanelTitle>Income vs expenses by month</PanelTitle>
              {monthlyFlows.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13, padding: "20px 0" }}>No transactions yet. Add your first one above.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyFlows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} width={60} />
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" fill="#7c9885" name="Income" radius={[4,4,0,0]} />
                    <Bar dataKey="expense" fill="#b5685a" name="Expenses" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Net cash flow trend + category pies */}
            {monthlyFlows.length > 0 && (
              <div className="grid-charts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div className="panel">
                  <PanelTitle>Net cash flow trend</PanelTitle>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={monthlyFlows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={BORDER} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                      <YAxis tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} width={60} />
                      <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="savings" stroke={ACCENT} strokeWidth={2.5} dot={{ r: 3 }} name="Net Savings" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                    <PanelTitle noMargin>Expenses by category</PanelTitle>
                    <select className="num-input" style={{ width: 150 }} value={catMonthFilter} onChange={e => setCatMonthFilter(e.target.value)}>
                      <option value="all">All time</option>
                      {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {expenseByCategory.length === 0 ? (
                    <div style={{ color: MUTED, fontSize: 13, padding: "20px 0" }}>No expenses{catMonthFilter !== "all" ? ` in ${catMonthFilter}` : ""} recorded yet.</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie data={expenseByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                            {expenseByCategory.map((entry, i) => (
                              <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 10, paddingTop: 10 }}>
                        {expenseByCategory.map((e, i) => (
                          <div key={e.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0, display: "inline-block" }} />
                              {e.name}
                            </span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#b5685a" }}>{fmtDispCompact(e.value)}</span>
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 2px", marginTop: 4, borderTop: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 700 }}>
                          <span>Total</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#b5685a" }}>{fmtDispCompact(expenseByCategory.reduce((s, e) => s + e.value, 0))}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Income by category */}
            {incomeByCategory.length > 0 && (
              <div className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <PanelTitle noMargin>Income by category</PanelTitle>
                  <select className="num-input" style={{ width: 150 }} value={catMonthFilter} onChange={e => setCatMonthFilter(e.target.value)}>
                    <option value="all">All time</option>
                    {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(180, incomeByCategory.length * 36)}>
                  <BarChart data={incomeByCategory} layout="vertical" margin={{ top: 5, right: 80, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke={BORDER} horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: INK }} width={120} />
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" fill="#7c9885" radius={[0, 4, 4, 0]} label={{ position: "right", formatter: fmtDispCompact, fontSize: 11, fill: MUTED }} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 2px", marginTop: 4, borderTop: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 700 }}>
                  <span>Total</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5f8d6b" }}>{fmtDispCompact(incomeByCategory.reduce((s, e) => s + e.value, 0))}</span>
                </div>
              </div>
            )}

            {/* Categorisation rules */}
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <PanelTitle noMargin>Categorisation rules</PanelTitle>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: MUTED }}>
                    Rules match on description keywords and auto-assign a category. Applied in order — first match wins.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn-ghost" onClick={() => setShowRules(v => !v)}>{showRules ? "Hide rules" : "Manage rules"}</button>
                  <button className="btn-primary" onClick={applyRulesToAll}>Apply to all</button>
                </div>
              </div>

              {showRules && (
                <div style={{ marginTop: 16 }}>
                  {/* Add new rule */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                    <div>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Keyword</label>
                      <input className="num-input" style={{ width: 160 }} value={newRule.keyword} onChange={e => setNewRule(r => ({ ...r, keyword: e.target.value }))} placeholder="e.g. netflix" onKeyDown={e => e.key === "Enter" && addRule()} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Applies to</label>
                      <select className="num-input" style={{ width: 110 }} value={newRule.type} onChange={e => setNewRule(r => ({ ...r, type: e.target.value, category: e.target.value === "income" ? incomeCategories[0] : expenseCategories[0] }))}>
                        <option value="expense">Expenses</option>
                        <option value="income">Income</option>
                        <option value="any">Any</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Category</label>
                      <select className="num-input" style={{ width: 160 }} value={newRule.category} onChange={e => setNewRule(r => ({ ...r, category: e.target.value }))}>
                        {(newRule.type === "income" ? incomeCategories : [...incomeCategories, ...expenseCategories]).map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 2 }}>
                      <input type="checkbox" id="case-sensitive" checked={newRule.caseSensitive} onChange={e => setNewRule(r => ({ ...r, caseSensitive: e.target.checked }))} />
                      <label htmlFor="case-sensitive" style={{ fontSize: 12, color: MUTED }}>Case sensitive</label>
                    </div>
                    <button className="btn-primary" onClick={addRule}>Add rule</button>
                  </div>

                  {/* Existing rules */}
                  {categoryRules.length === 0 ? (
                    <div style={{ color: MUTED, fontSize: 13 }}>No rules yet.</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Keyword</th>
                          <th style={{ textAlign: "left" }}>Applies to</th>
                          <th style={{ textAlign: "left" }}>Category</th>
                          <th style={{ textAlign: "left" }}>Case</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryRules.map((rule, idx) => (
                          <tr key={rule.id}>
                            <td style={{ textAlign: "left" }}>
                              <input className="num-input" style={{ width: 150 }} value={rule.keyword} onChange={e => updateRule(rule.id, "keyword", e.target.value)} />
                            </td>
                            <td style={{ textAlign: "left" }}>
                              <select className="num-input" style={{ width: 110 }} value={rule.type} onChange={e => updateRule(rule.id, "type", e.target.value)}>
                                <option value="expense">Expenses</option>
                                <option value="income">Income</option>
                                <option value="any">Any</option>
                              </select>
                            </td>
                            <td style={{ textAlign: "left" }}>
                              <select className="num-input" style={{ width: 160 }} value={rule.category} onChange={e => updateRule(rule.id, "category", e.target.value)}>
                                {[...incomeCategories, ...expenseCategories].map(c => <option key={c}>{c}</option>)}
                              </select>
                            </td>
                            <td style={{ textAlign: "left" }}>
                              <input type="checkbox" checked={rule.caseSensitive} onChange={e => updateRule(rule.id, "caseSensitive", e.target.checked)} />
                            </td>
                            <td>
                              <button className="btn-icon" onClick={() => {
                                const rules = [...categoryRules];
                                if (idx > 0) { [rules[idx-1], rules[idx]] = [rules[idx], rules[idx-1]]; setCategoryRules(rules); }
                              }}>↑</button>
                              <button className="btn-icon" onClick={() => {
                                const rules = [...categoryRules];
                                if (idx < rules.length - 1) { [rules[idx], rules[idx+1]] = [rules[idx+1], rules[idx]]; setCategoryRules(rules); }
                              }}>↓</button>
                              <button className="btn-icon" onClick={() => deleteRule(rule.id)}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Transaction list with inline editing */}
            <div className="panel">
              {/* Filter bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <PanelTitle noMargin>
                  Transactions ({filteredTx.length}{transactions.length !== filteredTx.length ? ` of ${transactions.length}` : ""})
                </PanelTitle>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", marginRight: 4 }}>
                    {[["list","List"],["byCategory","By Category"]].map(([v, label]) => (
                      <button key={v} onClick={() => setTxView(v)} style={{
                        padding: "7px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                        background: txView === v ? INK : "transparent",
                        color: txView === v ? "#fff" : MUTED,
                        transition: "all 0.15s"
                      }}>{label}</button>
                    ))}
                  </div>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13, pointerEvents: "none" }}>🔍</span>
                    <input
                      className="num-input"
                      style={{ width: 180, paddingLeft: 28 }}
                      placeholder="Search description…"
                      value={txSearch}
                      onChange={e => setTxSearch(e.target.value)}
                    />
                  </div>
                  <select className="num-input" style={{ width: 120 }} value={cashFlowFilter} onChange={e => setCashFlowFilter(e.target.value)}>
                    <option value="all">All types</option>
                    <option value="income">Income</option>
                    <option value="expense">Expenses</option>
                  </select>
                  <select className="num-input" style={{ width: 150 }} value={txCatFilter} onChange={e => setTxCatFilter(e.target.value)}>
                    <option value="all">All categories</option>
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="num-input" style={{ width: 130 }} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                    <option value="all">All months</option>
                    {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {(txSearch || cashFlowFilter !== "all" || txCatFilter !== "all" || monthFilter !== "all") && (
                    <button className="btn-icon" style={{ fontSize: 12 }} onClick={() => { setTxSearch(""); setCashFlowFilter("all"); setTxCatFilter("all"); setMonthFilter("all"); }}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Active filter chips */}
              {(txSearch || cashFlowFilter !== "all" || txCatFilter !== "all" || monthFilter !== "all") && (
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {txSearch && <FilterChip label={`"${txSearch}"`} onRemove={() => setTxSearch("")} />}
                  {cashFlowFilter !== "all" && <FilterChip label={cashFlowFilter === "income" ? "Income" : "Expenses"} onRemove={() => setCashFlowFilter("all")} />}
                  {txCatFilter !== "all" && <FilterChip label={txCatFilter} onRemove={() => setTxCatFilter("all")} />}
                  {monthFilter !== "all" && <FilterChip label={monthFilter} onRemove={() => setMonthFilter("all")} />}
                </div>
              )}

              {filteredTx.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 13, padding: "20px 0" }}>No transactions match these filters.</div>
              ) : txView === "byCategory" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {txByCategory.map(group => (
                    <details key={group.category} style={{ borderRadius: 10, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
                      <summary style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "12px 16px", cursor: "pointer", background: "#faf8f5", listStyle: "none", userSelect: "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                            background: group.type === "income" ? "#7c988522" : "#b5685a22",
                            color: group.type === "income" ? "#5f8d6b" : "#b5685a"
                          }}>{group.category}</span>
                          <span style={{ fontSize: 13, color: MUTED }}>{group.txs.length} transaction{group.txs.length !== 1 ? "s" : ""}</span>
                        </div>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, color: group.type === "income" ? "#5f8d6b" : "#b5685a" }}>
                          {group.type === "income" ? "+" : "−"}{fmtDispCompact(group.total)}
                        </span>
                      </summary>
                      <div className="scroll-x">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left" }}>Date</th>
                              <th style={{ textAlign: "left" }}>Description</th>
                              <th>Amount</th>
                              <th style={{ textAlign: "left" }}>Currency</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.txs.map(t => {
                              const isEditing = editingTx === t.id;
                              return (
                                <tr key={t.id} style={{ background: isEditing ? "#faf6f0" : "transparent" }}>
                                  <td style={{ textAlign: "left" }}>
                                    {isEditing ? <input className="num-input" type="date" style={{ width: 130 }} value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
                                      : <span style={{ fontSize: 13 }}>{t.date}</span>}
                                  </td>
                                  <td style={{ textAlign: "left" }}>
                                    {isEditing ? <input className="num-input" style={{ width: 200 }} value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} />
                                      : <span style={{ fontSize: 13, color: MUTED }}>{t.description || "—"}</span>}
                                  </td>
                                  <td>
                                    {isEditing ? <input className="num-input" type="number" style={{ width: 100 }} value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} />
                                      : <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 13, color: t.type === "income" ? "#5f8d6b" : "#b5685a" }}>{t.type === "income" ? "+" : "−"}{fmtTx(t)}</span>}
                                  </td>
                                  <td style={{ textAlign: "left" }}>
                                    {isEditing ? <select className="num-input" style={{ width: 80 }} value={txForm.currency} onChange={e => setTxForm(f => ({ ...f, currency: e.target.value }))}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</select>
                                      : <span style={{ fontSize: 13, color: MUTED }}>{t.currency || "INR"}</span>}
                                  </td>
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    {isEditing ? (
                                      <><button className="btn-icon" style={{ color: "#5f8d6b", fontWeight: 600 }} onClick={addOrUpdateTx}>Save</button><button className="btn-icon" onClick={cancelEditTx}>Cancel</button></>
                                    ) : (
                                      <><button className="btn-icon" onClick={() => startEditTx(t)}>Edit</button><button className="btn-icon" onClick={() => deleteTx(t.id)}>✕</button></>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: "#f3ede6", borderRadius: 10, fontWeight: 700, fontSize: 14 }}>
                    <span>Total ({filteredTx.length} transactions)</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      <span style={{ color: "#5f8d6b" }}>{fmtDispCompact(txByCategory.filter(g => g.type === "income").reduce((s, g) => s + g.total, 0))}</span>
                      {" income · "}
                      <span style={{ color: "#b5685a" }}>{fmtDispCompact(txByCategory.filter(g => g.type === "expense").reduce((s, g) => s + g.total, 0))}</span>
                      {" expenses"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="scroll-x">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Date</th>
                        <th style={{ textAlign: "left" }}>Type</th>
                        <th style={{ textAlign: "left" }}>Category</th>
                        <th style={{ textAlign: "left" }}>Description</th>
                        <th>Amount</th>
                        <th style={{ textAlign: "left" }}>Currency</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTx.map(t => {
                        const isEditing = editingTx === t.id;
                        return (
                          <tr key={t.id} style={{ background: isEditing ? "#faf6f0" : "transparent" }}>
                            <td style={{ textAlign: "left" }}>
                              {isEditing ? <input className="num-input" type="date" style={{ width: 130 }} value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
                                : <span style={{ fontSize: 13 }}>{t.date}</span>}
                            </td>
                            <td style={{ textAlign: "left" }}>
                              {isEditing
                                ? <select className="num-input" style={{ width: 105 }} value={txForm.type} onChange={e => setTxForm(f => ({ ...f, type: e.target.value, category: e.target.value === "income" ? incomeCategories[0] : expenseCategories[0] }))}><option value="income">Income</option><option value="expense">Expense</option></select>
                                : <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: t.type === "income" ? "#7c988522" : "#b5685a22", color: t.type === "income" ? "#5f8d6b" : "#b5685a" }}>{t.type === "income" ? "Income" : "Expense"}</span>}
                            </td>
                            <td style={{ textAlign: "left" }}>
                              {isEditing
                                ? <select className="num-input" style={{ width: 150 }} value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))}>{(txForm.type === "income" ? incomeCategories : expenseCategories).map(c => <option key={c}>{c}</option>)}</select>
                                : <button style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: INK }} onClick={() => setTxCatFilter(t.category)} title={`Filter by ${t.category}`}>{t.category}</button>}
                            </td>
                            <td style={{ textAlign: "left" }}>
                              {isEditing ? <input className="num-input" style={{ width: 200 }} value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" />
                                : <span style={{ fontSize: 13, color: MUTED }}>{t.description || "—"}</span>}
                            </td>
                            <td>
                              {isEditing ? <input className="num-input" type="number" style={{ width: 100, textAlign: "right" }} value={txForm.amount} onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))} />
                                : <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 13, color: t.type === "income" ? "#5f8d6b" : "#b5685a" }}>
                                    {t.type === "income" ? "+" : "−"}{fmtTx(t)}
                                    {t.currency && t.currency !== "INR" && (
                                      <div style={{ fontSize: 11, color: MUTED, fontWeight: 400 }}>
                                        {CURRENCIES[t.currency]?.symbol}{Math.round(t.origAmount ?? t.amount).toLocaleString("en-IN")} {t.currency}
                                        {t.fxRateSource === "historical"
                                          ? <span title="Confirmed historical rate from Frankfurter (ECB)"> · {t.fxRateAtDate?.toFixed(2)} ✓</span>
                                          : <span style={{ color: "#c97c5d" }} title="Estimated rate — click 'Fetch historical rates' to update"> · {t.fxRateAtDate?.toFixed(2)} est.</span>}
                                      </div>
                                    )}
                                  </span>}
                            </td>
                            <td style={{ textAlign: "left" }}>
                              {isEditing ? <select className="num-input" style={{ width: 80 }} value={txForm.currency} onChange={e => setTxForm(f => ({ ...f, currency: e.target.value }))}>{Object.keys(CURRENCIES).map(c => <option key={c}>{c}</option>)}</select>
                                : <span style={{ fontSize: 13, color: MUTED }}>{t.currency || "INR"}</span>}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {isEditing ? (
                                <><button className="btn-icon" style={{ color: "#5f8d6b", fontWeight: 600 }} onClick={addOrUpdateTx}>Save</button><button className="btn-icon" onClick={cancelEditTx}>Cancel</button></>
                              ) : (
                                <><button className="btn-icon" onClick={() => startEditTx(t)}>Edit</button><button className="btn-icon" onClick={() => deleteTx(t.id)}>✕</button></>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "budget" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Month selector + summary */}
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                <div>
                  <PanelTitle noMargin>Budget vs actual</PanelTitle>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: MUTED }}>
                    Set monthly budgets per expense category. Amounts are in {displayCurrency}.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: MUTED }}>Month</label>
                  <input className="num-input" type="month" style={{ width: 150 }} value={budgetMonth} onChange={e => setBudgetMonth(e.target.value)} />
                </div>
              </div>

              {/* Summary stat row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
                {[
                  { label: "Budgeted", value: fmtDispCompact(budgetTotalBudgeted), color: INK },
                  { label: "Actual spend", value: fmtDispCompact(budgetTotalActual), color: budgetTotalActual > budgetTotalBudgeted ? "#b5685a" : INK },
                  { label: "Remaining", value: fmtDispCompact(budgetTotalBudgeted - budgetTotalActual), color: budgetTotalBudgeted - budgetTotalActual >= 0 ? "#5f8d6b" : "#b5685a" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "#faf8f5", borderRadius: 10, padding: "12px 16px", border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 600, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Per-category table */}
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Category</th>
                    <th>Monthly budget ({displayCurrency})</th>
                    <th>Actual ({budgetMonth})</th>
                    <th>Remaining</th>
                    <th style={{ textAlign: "left", minWidth: 160 }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseCategories.map(cat => {
                    const budget = Number(budgets[cat]) || 0;
                    const actual = budgetActuals[cat] || 0;
                    const remaining = budget - actual;
                    const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
                    const over = budget > 0 && actual > budget;
                    const overPct = budget > 0 ? ((actual / budget) * 100).toFixed(0) : null;
                    return (
                      <tr key={cat}>
                        <td style={{ fontWeight: 600 }}>{cat}</td>
                        <td>
                          <input
                            className="num-input"
                            type="number"
                            style={{ width: 110, textAlign: "right" }}
                            value={budgets[cat] ?? ""}
                            placeholder="—"
                            onChange={e => setBudgetAmount(cat, e.target.value)}
                          />
                        </td>
                        <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: over ? "#b5685a" : INK }}>
                          {actual > 0 ? fmtDispCompact(actual) : <span style={{ color: MUTED }}>—</span>}
                        </td>
                        <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: remaining >= 0 ? (budget > 0 ? "#5f8d6b" : MUTED) : "#b5685a" }}>
                          {budget > 0 ? fmtDispCompact(remaining) : <span style={{ color: MUTED }}>—</span>}
                        </td>
                        <td>
                          {budget > 0 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, height: 8, background: BORDER, borderRadius: 4, overflow: "hidden" }}>
                                <div style={{
                                  width: `${pct}%`, height: "100%", borderRadius: 4,
                                  background: over ? "#b5685a" : pct > 80 ? "#c97c5d" : "#7c9885",
                                  transition: "width 0.3s"
                                }} />
                              </div>
                              <span style={{ fontSize: 12, color: over ? "#b5685a" : MUTED, fontWeight: 600, minWidth: 36, textAlign: "right" }}>
                                {over ? `+${(actual - budget > 0 ? ((actual - budget) / budget * 100).toFixed(0) : 0)}%` : `${pct.toFixed(0)}%`}
                              </span>
                            </div>
                          ) : <span style={{ fontSize: 12, color: MUTED }}>no budget set</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bar chart: budget vs actual */}
            {expenseCategories.some(c => budgets[c] > 0 || budgetActuals[c] > 0) && (
              <div className="panel">
                <PanelTitle>Budget vs actual — {budgetMonth}</PanelTitle>
                <ResponsiveContainer width="100%" height={Math.max(200, expenseCategories.filter(c => budgets[c] > 0 || budgetActuals[c] > 0).length * 44)}>
                  <BarChart
                    data={expenseCategories
                      .filter(c => budgets[c] > 0 || budgetActuals[c] > 0)
                      .map(c => ({
                        name: c,
                        Budget: Number(budgets[c]) || 0,
                        Actual: budgetActuals[c] || 0,
                      }))}
                    layout="vertical"
                    margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid stroke={BORDER} horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: INK }} width={130} />
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Budget" fill="#c8d8c8" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Actual" fill={ACCENT} radius={[0, 4, 4, 0]}
                      label={{ position: "right", formatter: (v) => v > 0 ? fmtDispCompact(v) : "", fontSize: 11, fill: MUTED }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Multi-month trend: actual vs budget over time */}
            {availableMonths.length > 1 && (
              <div className="panel">
                <PanelTitle>Monthly spend trend vs budget</PanelTitle>
                <p style={{ fontSize: 13, color: MUTED, marginTop: -10, marginBottom: 14 }}>
                  Dashed line = total monthly budget. Bars = actual spend per month.
                </p>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart
                    data={availableMonths.slice().reverse().map(m => ({
                      month: m,
                      Actual: transactions
                        .filter(t => t.type === "expense" && t.date.slice(0, 7) === m)
                        .reduce((s, t) => s + txDisplay(t), 0),
                      Budget: budgetTotalBudgeted,
                    }))}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke={BORDER} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
                    <YAxis tickFormatter={fmtDispCompact} tick={{ fontSize: 11, fill: MUTED }} width={60} />
                    <Tooltip formatter={(v) => fmtDisp(v)} contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Actual" fill={ACCENT} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="Budget" stroke="#7c9885" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        )}

        {tab === "data" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="panel">
              <PanelTitle>Latest snapshot — edit values directly</PanelTitle>
              <p style={{ fontSize: 13, color: MUTED, marginTop: -8, marginBottom: 16 }}>
                Editing {latest?.date}. All raw entries are stored in ₹ (INR) regardless of your display currency above. To add a new dated entry instead, go to History → Add entry.
              </p>
              {latest && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {categories.map(c => (
                    <div key={c}>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>{c}</label>
                      <input className="num-input" type="number" value={latest.values[c] ?? ""} onChange={e => updateSnapshotValue(latest.id, c, e.target.value)} />
                    </div>
                  ))}
                </div>
              )}
              {latest && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                    Exchange rates for this date ({latest.date}) — used to convert this entry's INR values into USD/AED.
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>1 USD = ? INR</label>
                      <input className="num-input" type="number" step="0.01" style={{ width: 120 }} value={latest.fxRates?.USD ?? DEFAULT_FX_TO_INR.USD} onChange={e => updateSnapshotFx(latest.id, "USD", e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>1 AED = ? INR</label>
                      <input className="num-input" type="number" step="0.01" style={{ width: 120 }} value={latest.fxRates?.AED ?? DEFAULT_FX_TO_INR.AED} onChange={e => updateSnapshotFx(latest.id, "AED", e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="panel">
              <PanelTitle>Cost basis (for P&L calculation)</PanelTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                {categories.map(c => (
                  <div key={c}>
                    <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>{c}</label>
                    <input className="num-input" type="number" value={costBasis[c] ?? ""} onChange={e => updateCostBasis(c, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "categories" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ---- Asset categories ---- */}
            <div className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <PanelTitle noMargin>Asset categories</PanelTitle>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: MUTED }}>Holdings tracked in your net worth snapshots.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowAddCat(v => !v)}>+ Add holding</button>
              </div>

              {showAddCat && (
                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end", padding: "14px", background: "#faf6f0", borderRadius: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Name</label>
                    <input className="num-input" style={{ width: 220 }} value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Gold ETF" onKeyDown={e => e.key === "Enter" && addCategory()} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Asset class</label>
                    <select className="num-input" style={{ width: 160 }} value={newCatClass} onChange={e => setNewCatClass(e.target.value)}>
                      {assetClassOptions.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={addCategory}>Add</button>
                  <button className="btn-ghost" onClick={() => setShowAddCat(false)}>Cancel</button>
                </div>
              )}

              <table>
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Asset class</th>
                    <th>Current value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c}>
                      <td style={{ fontWeight: 600 }}>{c}</td>
                      <td>
                        <select className="num-input" value={classMap[c] || "Other"} onChange={e => updateClassMap(c, e.target.value)}>
                          {assetClassOptions.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </td>
                      <td>{fmtCCAt(latest?.values[c], latest?.fxRates)}</td>
                      <td><button className="btn-icon" onClick={() => removeCategory(c)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---- Income categories ---- */}
            <TxCategoryPanel
              title="Income categories"
              subtitle="Categories available when logging income transactions."
              type="income"
              cats={incomeCategories}
              renamingTxCat={renamingTxCat}
              setRenamingTxCat={setRenamingTxCat}
              newTxCatName={newTxCatName}
              setNewTxCatName={setNewTxCatName}
              newTxCatType={newTxCatType}
              setNewTxCatType={setNewTxCatType}
              addTxCategory={addTxCategory}
              removeTxCategory={removeTxCategory}
              renameTxCategory={renameTxCategory}
              usageCount={name => transactions.filter(t => t.category === name).length}
              MUTED={MUTED} BORDER={BORDER}
            />

            {/* ---- Expense categories ---- */}
            <TxCategoryPanel
              title="Expense categories"
              subtitle="Categories available when logging expense transactions. All are treated as genuine consumption in the savings calculation."
              type="expense"
              cats={expenseCategories}
              renamingTxCat={renamingTxCat}
              setRenamingTxCat={setRenamingTxCat}
              newTxCatName={newTxCatName}
              setNewTxCatName={setNewTxCatName}
              newTxCatType={newTxCatType}
              setNewTxCatType={setNewTxCatType}
              addTxCategory={addTxCategory}
              removeTxCategory={removeTxCategory}
              renameTxCategory={renameTxCategory}
              usageCount={name => transactions.filter(t => t.category === name).length}
              MUTED={MUTED} BORDER={BORDER}
            />

          </div>
        )}
      </main>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: INK, color: BG, padding: "10px 20px", borderRadius: 8,
          fontSize: 13, fontWeight: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.15)"
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: "#f0e8e0", color: "#6b5a4e", border: "1px solid #e0d4c8"
    }}>
      {label}
      <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "#9a8880", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
    </span>
  );
}

function StatCard({ label, value, positive, sub }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 600, color: positive === undefined ? INK : (positive ? "#5f8d6b" : "#b5685a") }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function PanelTitle({ children, noMargin }) {
  return (
    <h2 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 18, fontWeight: 600, margin: noMargin ? 0 : "0 0 14px" }}>{children}</h2>
  );
}

function TxCategoryPanel({ title, subtitle, type, cats, renamingTxCat, setRenamingTxCat, newTxCatName, setNewTxCatName, newTxCatType, setNewTxCatType, addTxCategory, removeTxCategory, renameTxCategory, usageCount, MUTED, BORDER }) {
  const [showAdd, setShowAdd] = useState(false);
  const accentColor = type === "income" ? "#5f8d6b" : "#b5685a";
  const bgColor = type === "income" ? "#7c988514" : "#b5685a14";

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <PanelTitle noMargin>{title}</PanelTitle>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: MUTED }}>{subtitle}</p>
        </div>
        <button
          style={{ background: accentColor, color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 12 }}
          onClick={() => { setShowAdd(v => !v); setNewTxCatType(type); setNewTxCatName(""); }}
        >+ Add</button>
      </div>

      {showAdd && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", padding: "14px", background: "#faf6f0", borderRadius: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>Category name</label>
            <input
              className="num-input" style={{ width: 240 }} value={newTxCatName}
              onChange={e => setNewTxCatName(e.target.value)}
              placeholder={type === "income" ? "e.g. Freelance" : "e.g. Pet Care"}
              onKeyDown={e => { if (e.key === "Enter") { setNewTxCatType(type); addTxCategory(); setShowAdd(false); } }}
            />
          </div>
          <button
            style={{ background: accentColor, color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            onClick={() => { setNewTxCatType(type); addTxCategory(); setShowAdd(false); }}
          >Add</button>
          <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Category</th>
            <th>Transactions using this</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cats.map(name => {
            const count = usageCount(name);
            const isRenaming = renamingTxCat?.name === name && renamingTxCat?.type === type;
            return (
              <tr key={name}>
                <td style={{ textAlign: "left" }}>
                  {isRenaming ? (
                    <input
                      className="num-input" style={{ width: 200 }}
                      value={renamingTxCat.draft}
                      onChange={e => setRenamingTxCat(r => ({ ...r, draft: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === "Enter") { renameTxCategory(name, renamingTxCat.draft, type); setRenamingTxCat(null); }
                        if (e.key === "Escape") setRenamingTxCat(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 8, height: 8, borderRadius: "50%", background: accentColor, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{name}</span>
                    </span>
                  )}
                </td>
                <td>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: bgColor, color: accentColor, fontWeight: 600 }}>
                    {count} {count === 1 ? "transaction" : "transactions"}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {isRenaming ? (
                    <>
                      <button className="btn-icon" style={{ color: "#5f8d6b", fontWeight: 600 }} onClick={() => { renameTxCategory(name, renamingTxCat.draft, type); setRenamingTxCat(null); }}>Save</button>
                      <button className="btn-icon" onClick={() => setRenamingTxCat(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-icon" onClick={() => setRenamingTxCat({ name, type, draft: name })}>Rename</button>
                      <button className="btn-icon" onClick={() => removeTxCategory(name, type)} title={count > 0 ? `${count} transactions use this category` : ""}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
