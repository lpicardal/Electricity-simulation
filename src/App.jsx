import { useState, useEffect, useRef, useCallback } from "react";

const APPLIANCES = {
  light: { label: "Light Bulb", kw: 0.009, defaultQty: 3 },
  fan: { label: "Ceiling Fan", kw: 0.075, defaultQty: 2 },
  tv: { label: "Television", kw: 0.30, defaultQty: 1 },
  laptop: { label: "Laptop", kw: 0.040, defaultQty: 1 },
  phone: { label: "Phone Charger", kw: 0.08, defaultQty: 2 },
  ref: { label: "Refrigerator", kw: 0.500, defaultQty: 1 },
  ricecooker: { label: "Rice Cooker", kw: 0.60, defaultQty: 1 },
  microwave: { label: "Microwave", kw: 0.80, defaultQty: 1 },
  washer: { label: "Washing Machine", kw: 0.5, defaultQty: 1 },
  aircon: { label: "Air Conditioner", kw: 1.0, defaultQty: 1 },
  iron: { label: "Electric Iron", kw: 1.0, defaultQty: 1 },
  router: { label: "WiFi Router", kw: 0.002, defaultQty: 1 },
};

const ALWAYS_ON = ["ref", "router"];

function formatTime(hour) {
  const h = hour % 24;
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
}

function formatDayTime(hour) {
  const day = Math.floor(hour / 24) + 1;
  return `Day ${day} ${formatTime(hour)}`;
}

// Typical duration ranges per appliance (hours)
const DURATION_RANGES = {
  light: [0.5, 4.0],
  fan: [1.0, 6.0],
  tv: [0.5, 3.0],
  laptop: [1.0, 4.0],
  phone: [0.5, 2.0],
  ricecooker: [0.3, 0.8],
  microwave: [0.1, 0.3],
  washer: [0.5, 1.5],
  aircon: [1.0, 4.0],
  iron: [0.3, 1.0],
};

// How many usage events per appliance per user per day
const USAGE_COUNT = {
  light: [1, 3],
  fan: [1, 3],
  tv: [1, 2],
  laptop: [1, 2],
  phone: [1, 3],
  ricecooker: [1, 2],
  microwave: [1, 2],
  washer: [0, 1],
  aircon: [0, 2],
  iron: [0, 1],
};

// Time-of-day usage windows per appliance (preferred hour ranges)
const TIME_WINDOWS = {
  light: [[5, 7], [17, 23]],
  fan: [[10, 16], [19, 23]],
  tv: [[17, 23]],
  laptop: [[8, 12], [14, 22]],
  phone: [[6, 8], [20, 24]],
  ricecooker: [[5, 7], [11, 13], [17, 19]],
  microwave: [[6, 8], [11, 13], [17, 20]],
  washer: [[7, 10]],
  aircon: [[12, 16], [21, 24]],
  iron: [[6, 8], [17, 19]],
};

// Energy-saving tips shown once the simulation has finished
const ENERGY_TIPS = [
  "Unplug chargers and appliances when not in use to eliminate phantom loads.",
  "Use energy-efficient lighting such as LED bulbs and turn them off when you leave a room.",
  "Run large appliances like washers and dryers during off-peak hours.",
  "Set your air conditioner a few degrees higher and keep doors/windows closed.",
  "Regularly maintain appliances to ensure they operate efficiently."
];

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randBetween(min, max + 1));
}

// Pick a random start hour from the appliance's preferred time windows
function pickTimeFromWindows(type) {
  const windows = TIME_WINDOWS[type];
  if (!windows || windows.length === 0) return randBetween(5, 23);
  const win = windows[Math.floor(Math.random() * windows.length)];
  return randBetween(win[0], win[1]);
}

function generateEvents(numUsers, numDays = 1, customUsageCount = {}, customDurationRanges = {}, applianceQty = {}) {
  const events = [];
  for (let day = 0; day < numDays; day++) {
    const dayOffset = day * 24;

    // Always-on appliances — generate one event per unit in the household
    ALWAYS_ON.forEach(type => {
      const qty = applianceQty[type] || APPLIANCES[type].defaultQty || 1;
      for (let q = 0; q < qty; q++) {
        events.push({ id: `d${day}-always-${type}-${q}`, user: 0, hour: dayOffset, type, dur: 24, kw: APPLIANCES[type].kw });
      }
    });

    // Shared appliances — only one "user" generates events (household-level, not per-person)
    const HOUSEHOLD_SHARED = ["tv", "ricecooker", "light", "washer", "microwave", "iron"];

    // For non-always-on appliances, generate a shared pool of events
    // capped by the household quantity of that appliance
    Object.keys(APPLIANCES).forEach(type => {
      if (ALWAYS_ON.includes(type)) return;

      const qty = applianceQty[type] || APPLIANCES[type].defaultQty || 1;
      const countRange = customUsageCount[type] || USAGE_COUNT[type] || [1, 2];
      const durRange = customDurationRanges[type] || DURATION_RANGES[type] || [0.5, 2.0];

      // Shared appliances are used as if by 1 user; others by all users
      const numEffectiveUsers = HOUSEHOLD_SHARED.includes(type) ? 1 : numUsers;

      // Each user wants to use the appliance some number of times
      const userRequests = [];
      for (let u = 0; u < numEffectiveUsers; u++) {
        const numUses = randInt(countRange[0], countRange[1]);
        for (let i = 0; i < numUses; i++) {
          userRequests.push({ user: u + 1 });
        }
      }

      // Shuffle user requests so assignment to appliance units is fair
      for (let i = userRequests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [userRequests[i], userRequests[j]] = [userRequests[j], userRequests[i]];
      }

      // Assign requests to appliance units; each unit handles events sequentially
      // Track end times per unit to prevent overlapping usage on the same unit
      const unitEndTimes = Array(qty).fill(0);

      userRequests.forEach((req, idx) => {
        const dur = randBetween(durRange[0], durRange[1]);
        let startHour = pickTimeFromWindows(type);

        // Find the appliance unit that is free earliest
        let bestUnit = 0;
        for (let u = 1; u < qty; u++) {
          if (unitEndTimes[u] < unitEndTimes[bestUnit]) bestUnit = u;
        }

        // If the unit is still busy, push start time after it finishes
        if (unitEndTimes[bestUnit] > startHour) {
          startHour = unitEndTimes[bestUnit] + 0.05; // small gap
        }

        // Skip if the event would go past midnight (24h) for this day
        if (startHour >= 24) return;

        unitEndTimes[bestUnit] = startHour + dur;

        events.push({
          id: `d${day}-u${req.user}-${type}-q${bestUnit}-${idx}-${startHour.toFixed(2)}`,
          user: req.user,
          hour: dayOffset + startHour,
          type,
          dur,
          kw: APPLIANCES[type].kw,
          unit: bestUnit,
        });
      });
    });
  }
  return events.sort((a, b) => a.hour - b.hour);
}



const S = {
  // Layout
  container: {
    flex: 1,
    backgroundColor: '#201f1fd5',
    padding: 16,
  },
  page: {
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    minHeight: "100vh",
    fontFamily: "arial",
    fontSize: 12,
    color: "#222",
    background: "#181717ff",
  },

  // Sidebar - Black theme
  sidebar: {
    background: "#1a1a1a",
    borderRight: "1px solid #333",
    padding: 20,
    overflowY: "auto",
    color: "black",
  },

  // Main content area
  main: {
    padding: 20,
    overflowY: "auto",
    background: "#f5f5f5",
  },

  // Cards/Panels
  panel: {
    background: "#ffffff",
    border: "1px solid #e0e0e0",
    borderRadius: "8px",
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
  },

  // Dark panel for sidebar items
  panelDark: {
    background: "#2a2a2a",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: 16,
    marginBottom: 16,
  },

  // Typography
  h1: {
    fontSize: 12,
    fontWeight: 600,
    color: "#f4a623",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 16,
    borderBottom: "2px solid #f4a623",
    paddingBottom: 8,
  },

  // Input fields 
  input: {
    padding: "10px 12px",
    fontSize: 11,
    border: "2px solid #e0e0e0",
    borderRadius: "6px",
    background: "white",
    width: "100%",
    fontFamily: "arial",
    color: "#212121",
    transition: "border-color 0.2s",
    outline: "none",
    height: 30,
  },

  inputFocus: {
    borderColor: "#f4a623",
  },

  inputDark: {
    padding: "10px 12px",
    fontSize: 11,
    border: "2px solid #404040",
    borderRadius: "6px",
    background: "#333",
    width: "100%",
    fontFamily: "arial",
    color: "#fff",
    transition: "border-color 0.2s",
    outline: "none",
  },

  inputLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#666",
    marginBottom: 4,
    display: "block",
  },

  inputLabelLight: {
    fontSize: 12,
    fontWeight: 500,
    color: "#ccc",
    marginBottom: 4,
    display: "block",
  },

  // Input row for side-by-side inputs
  inputRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    marginBottom: "12px",
  },

  // Circuit Breaker Pills
  breakerContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    margin: "12px 0",
  },

  breakerPill: (active = false) => ({
    padding: "8px 16px",
    fontSize: 13,
    borderRadius: "24px",
    border: active ? "2px solid #f4a623" : "2px solid #e0e0e0",
    background: active ? "#f4a623" : "white",
    color: active ? "white" : "#333",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    transition: "all 0.2s",
  }),

  // Appliances Grid
  appliancesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
    margin: "12px 0",
  },

  applianceItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    background: "white",
    borderRadius: "6px",
    fontSize: 12,

  },

  applianceItemDark: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    background: "white",
    borderRadius: "6px",
    fontSize: 12,
  },

  applianceName: {
    color: "white",
  },

  applianceNameLight: {
    color: "white",
  },

  appliancePower: {
    color: "#f4a623",
    fontWeight: 600,
    fontFamily: "monospace",
  },

  applianceStatus: {
    fontSize: 11,
    color: "#27ae60",
    background: "#e8f5e9",
    padding: "2px 6px",
    borderRadius: "4px",
    marginLeft: "8px",
  },

  // Simulation Dashboard
  simulationDashboard: {
    background: "linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)",
    borderRadius: "12px",
    padding: "24px",
    border: "1px solid #e0e0e0",
    textAlign: "center",
  },

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
    margin: "20px 0",
  },

  metricItem: {
    textAlign: "center",
  },

  metricValue: {
    fontSize: 28,
    fontWeight: 700,
    color: "#212121",
    lineHeight: 1.2,
  },

  metricValueWarning: {
    fontSize: 28,
    fontWeight: 700,
    color: "#f4a623",
    lineHeight: 1.2,
  },

  metricValueCritical: {
    fontSize: 28,
    fontWeight: 700,
    color: "#c0392b",
    lineHeight: 1.2,
  },

  metricLabel: {
    fontSize: 11,
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  // Progress bar
  progressBar: {
    height: "8px",
    background: "#e0e0e0",
    borderRadius: "4px",
    margin: "16px 0",
    overflow: "hidden",
  },

  progressFill: (percentage) => ({
    height: "100%",
    width: `${percentage}%`,
    background: percentage > 80 ? "#c0392b" : "#f4a623",
    transition: "width 0.3s",
  }),

  // Statistics Dashboard
  statsDashboard: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "10px",
    margin: "12px 0",
  },

  statBlock: {
    background: "#f8f9fa",
    padding: "12px",
    borderRadius: "8px",
    textAlign: "center",
  },

  statBlockHighlight: {
    background: "#fff3e0",
    borderLeft: "4px solid #f4a623",
    padding: "12px",
    borderRadius: "8px",
    textAlign: "center",
  },

  statNumber: {
    fontSize: 20,
    fontWeight: 700,
    color: "#212121",
  },

  statLabel: {
    fontSize: 11,
    color: "#757575",
    textTransform: "uppercase",
    marginTop: "4px",
    fontFamily: "arial",
  },

  // Buttons
  btn: {
    padding: "10px 20px",
    fontSize: 13,
    borderRadius: "6px",
    border: "none",
    background: "#f4a623",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    fontFamily: "arial",
  },

  btnHover: {
    background: "#e09112",
    transform: "translateY(-1px)",
    boxShadow: "0 4px 8px rgba(244, 166, 35, 0.3)",
  },

  btnSecondary: {
    padding: "8px 16px",
    fontSize: 13,
    borderRadius: "6px",
    border: "2px solid #e0e0e0",
    background: "white",
    color: "#333",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
    fontFamily: "arial",
  },

  btnPrimary: {
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    background: "#f4a623",
    color: "#fff",
    fontFamily: "arial",
    width: "100%",
    borderRadius: "6px",
    transition: "background 0.2s",
  },

  btnPreset: (active) => ({
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: active ? "2px solid #f4a623" : "2px solid #ddd",
    borderRadius: "4px",
    background: active ? "#fff3e0" : "#fff",
    fontWeight: active ? 600 : 400,
    color: active ? "#f4a623" : "#666",
    fontFamily: "arial",
    boxSizing: "border-box",
    width: "100%",
  }),


  // Tables
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },

  th: {
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: "2px solid #f4a623",
    background: "#f8f9fa",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#555",
  },

  td: {
    padding: "8px 12px",
    borderBottom: "1px solid #eee",
    color: "#444",
  },

  trHover: {
    background: "#f5f5f5",
  },

  // Status badges
  badge: {
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: 11,
    fontWeight: 500,
    display: "inline-block",
  },

  badgeSuccess: {
    background: "#e8f5e9",
    color: "#27ae60",
  },

  badgeWarning: {
    background: "#fff3e0",
    color: "#f4a623",
  },

  badgeError: {
    background: "#ffebee",
    color: "#c0392b",
  },

  // Links
  link: {
    color: "#f4a623",
    textDecoration: "none",
    fontWeight: 500,
    cursor: "pointer",
  },

  linkHover: {
    textDecoration: "underline",
  },

  clearAll: {
    fontSize: 12,
    color: "#f4a623",
    fontWeight: 500,
    textAlign: "right",
    cursor: "pointer",
    marginBottom: 8,
    display: "block",
  },

  // Error states
  error: {
    color: "#c0392b",
    fontSize: 11,
    marginTop: 4,
    fontWeight: 500,
  },

  // Utility classes
  textCenter: {
    textAlign: "center",
  },

  textRight: {
    textAlign: "right",
  },

  mt1: { marginTop: 4 },
  mt2: { marginTop: 8 },
  mt3: { marginTop: 12 },
  mt4: { marginTop: 16 },

  mb1: { marginBottom: 4 },
  mb2: { marginBottom: 8 },
  mb3: { marginBottom: 12 },
  mb4: { marginBottom: 16 },

  flex: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  flexBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // Divider
  divider: {
    height: "1px",
    background: "#e0e0e0",
    margin: "16px 0",
  },

  dividerDark: {
    height: "1px",
    background: "#333",
    margin: "16px 0",
  },
};

// ─── MAIN APP ───────────────
export default function App() {
  const [users, setUsers] = useState("");
  const [circuit, setCircuit] = useState("");
  const [days, setDays] = useState("1");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [errors, setErrors] = useState({});

  // ── Per-appliance household quantity ──
  const initApplianceQty = () => {
    const o = {};
    Object.keys(APPLIANCES).forEach(id => {
      o[id] = APPLIANCES[id].defaultQty || 1;
    });
    return o;
  };
  const [applianceQty, setApplianceQty] = useState(initApplianceQty);
  const updateQty = (id, val) => {
    setApplianceQty(prev => ({ ...prev, [id]: Math.max(0, parseInt(val) || 0) }));
  };

  // ── Per-appliance usage settings ──
  const initUsageCount = () => {
    const o = {};
    Object.keys(APPLIANCES).forEach(id => {
      if (!ALWAYS_ON.includes(id)) o[id] = [...(USAGE_COUNT[id] || [1, 2])];
    });
    return o;
  };
  const initDurationRanges = () => {
    const o = {};
    Object.keys(APPLIANCES).forEach(id => {
      if (!ALWAYS_ON.includes(id)) o[id] = [...(DURATION_RANGES[id] || [0.5, 2.0])];
    });
    return o;
  };
  const [customUsageCount, setCustomUsageCount] = useState(initUsageCount);
  const [customDurationRanges, setCustomDurationRanges] = useState(initDurationRanges);

  const updateUsageCount = (id, idx, val) => {
    setCustomUsageCount(prev => {
      const next = { ...prev };
      next[id] = [...(prev[id] || [1, 2])];
      next[id][idx] = Math.max(0, parseInt(val) || 0);
      return next;
    });
  };
  const updateDurationRange = (id, idx, val) => {
    setCustomDurationRanges(prev => {
      const next = { ...prev };
      next[id] = [...(prev[id] || [0.5, 2.0])];
      next[id][idx] = Math.max(0, parseFloat(val) || 0);
      return next;
    });
  };

  // ── Simulation state ──
  const [simActive, setSimActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(400);
  const [loadKw, setLoadKw] = useState(0);
  const [activeMap, setActiveMap] = useState({});
  const [log, setLog] = useState([]);
  const activeRef = useRef({});
  const timerRef = useRef(null);
  const eventsRef = useRef([]);
  const idxRef = useRef(-1);
  const consumedKwhRef = useRef(0);

  // ── Circuit breaker state ──
  const [tripped, setTripped] = useState(false);
  const [tripCount, setTripCount] = useState(0);

  const cooldownRef = useRef(null);

  // ── Load history for real-time graph ──
  const [loadHistory, setLoadHistory] = useState([]);

  // ── Setup helpers ──
  const toggle = (id) => {
    setSelectedAppliances(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };
  const selectAll = () => setSelectedAppliances(Object.keys(APPLIANCES));
  const clearAll = () => setSelectedAppliances([]);

  const totalKw = selectedAppliances.reduce((s, id) => {
    const qty = applianceQty[id] || APPLIANCES[id]?.defaultQty || 1;
    return s + (APPLIANCES[id]?.kw || 0) * qty;
  }, 0);

  const circuitLimit = parseFloat(circuit) || 0;


  const validate = () => {
    const e = {};
    const n = parseInt(users);
    const c = parseFloat(circuit);
    const d = parseInt(days);
    if (!users || isNaN(n) || n < 1 || n > 20) e.users = "Enter 1–20.";
    if (!circuit || isNaN(c) || c <= 0) e.circuit = "Enter a valid limit.";
    if (!days || isNaN(d) || d < 1 || d > 30) e.days = "Enter 1–30.";
    if (selectedAppliances.length === 0) e.appliances = "Select at least one.";
    return e;
  };

  // ── Simulation helpers ──
  const recalc = useCallback((active) => {
    const total = Object.entries(active)
      .filter(([, on]) => on)
      .reduce((s, [id]) => {
        const type = id.split("||")[0];
        return s + (APPLIANCES[type]?.kw || 0);
      }, 0);
    const r = parseFloat(total.toFixed(3));
    setLoadKw(r);
    return r;
  }, []);


  const step = useCallback(() => {
    const evts = eventsRef.current;
    const next = idxRef.current + 1;
    if (next >= evts.length) { setRunning(false); return; }

    idxRef.current = next;
    setCurrentIdx(next);

    const ev = evts[next];
    const key = `${ev.type}||${ev.id}`;
    const isAlwaysOn = ALWAYS_ON.includes(ev.type);

    // For always-on appliances on multi-day sims, remove only entries
    // originating from earlier days so that the baseline load stays
    // constant. Previously we deleted every key for the type, which meant
    // only the *last* unit would remain active when there were multiple
    // units or when several always-on events for the same day were
    // processed. That caused the total load to bounce around as each new
    // event replaced the previous one.
    if (isAlwaysOn) {
      const parts = ev.id.split('-');
      // ev.id format is `d<day>-always-<type>-<unit>`
      const currentDay = parseInt(parts[0].substring(1), 10);
      Object.keys(activeRef.current).forEach(k => {
        const oldId = k.split('||')[1] || '';
        const oldDayPart = oldId.split('-')[0] || '';
        const oldDay = parseInt(oldDayPart.substring(1), 10);
        if (!isNaN(oldDay) && oldDay < currentDay) {
          delete activeRef.current[k];
        }
      });
    }

    activeRef.current[key] = true;
    const newLoad = recalc({ ...activeRef.current });

    // Always-on appliances stay active for the entire simulation (no timeout)
    // Other appliances turn off after their visual duration
    if (!isAlwaysOn) {
      const offMs = Math.min(ev.dur * 50 * (speed / 6), 6000);
      setTimeout(() => {
        delete activeRef.current[key];
        recalc({ ...activeRef.current });
        setActiveMap(a => { const n = { ...a }; delete n[key]; return n; });
      }, offMs);
    }

    setActiveMap({ ...activeRef.current });
    const isOver = newLoad > circuitLimit;

    // ── Circuit breaker trip logic ──
    if (isOver) {
      // TRIP! Clear all active appliances
      activeRef.current = {};
      setActiveMap({});
      recalc({});
      setTripped(true);
      setTripCount(c => c + 1);
      setRunning(false); // Pause simulation

      // Log the trip event
      setLog(l => [{
        time: formatDayTime(ev.hour),
        label: `BREAKER TRIPPED (${APPLIANCES[ev.type].label})`,
        user: ev.user,
        load: newLoad,
        overload: true,
        trip: true,
      }, ...l].slice(0, 80));

      // Record trip in load history
      setLoadHistory(h => [...h, { hour: ev.hour, load: newLoad, consumed: consumedKwhRef.current, tripped: true }]);

      // Auto-reset after cooldown (2 seconds)
      cooldownRef.current = setTimeout(() => {
        setTripped(false);
      }, 2000);
      return;
    }

    // Accumulate energy: Energy (kWh) = Power (kW) × Duration (hours)
    // Only counted if breaker did NOT trip (appliance ran its full duration)
    consumedKwhRef.current += ev.kw * ev.dur;

    // Record in load history for real-time graph
    setLoadHistory(h => [...h, { hour: ev.hour, load: newLoad, consumed: consumedKwhRef.current, tripped: false }]);

    setLog(l => [{
      time: formatDayTime(ev.hour),
      label: APPLIANCES[ev.type].label,
      user: ev.user,
      load: newLoad,
      overload: false,
    }, ...l].slice(0, 80));
  }, [speed, circuitLimit, recalc]);

  useEffect(() => {
    if (running) timerRef.current = setInterval(step, speed);
    else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [running, step, speed]);

  // ── Actions ──
  const handleStart = () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setErrors({});
    const numUsers = parseInt(users);
    const numDays = parseInt(days) || 1;
    // ensure always-on types are never filtered out even if the user
    // somehow de-selects them (checkboxes are disabled but this is
    // defensive)
    const allEvents = generateEvents(numUsers, numDays, customUsageCount, customDurationRanges, applianceQty)
      .filter(ev => ALWAYS_ON.includes(ev.type) || selectedAppliances.includes(ev.type));
    eventsRef.current = allEvents;
    setEvents(allEvents);
    setCurrentIdx(-1);
    idxRef.current = -1;
    setLoadKw(0);
    setActiveMap({});
    activeRef.current = {};
    setLog([]);
    setLoadHistory([]);
    setRunning(false);
    setTripped(false);
    setTripCount(0);
    clearTimeout(cooldownRef.current);
    setSimActive(true);
    setTripCount(0);
    consumedKwhRef.current = 0;
  };

  const handleReset = () => {
    setRunning(false);
    clearInterval(timerRef.current);
    setSimActive(false);
    setCurrentIdx(-1);
    idxRef.current = -1;
    setLoadKw(0);
    setActiveMap({});
    activeRef.current = {};
    setLog([]);
    setLoadHistory([]);
    setEvents([]);
    setTripped(false);
    setTripCount(0);
    clearTimeout(cooldownRef.current);
    setTripCount(0);
    consumedKwhRef.current = 0;
  };

  // ── Derived ──
  const evts = eventsRef.current;
  const isOver = loadKw > circuitLimit;
  const progress = evts.length > 0 ? (Math.max(currentIdx, 0) / evts.length) * 100 : 0;
  const overloadCount = log.filter(e => e.overload).length;
  const currentHour = currentIdx >= 0 && currentIdx < evts.length ? evts[currentIdx]?.hour : null;
  const isDone = currentIdx >= evts.length - 1 && currentIdx >= 0 && evts.length > 0;
  const numDaysVal = parseInt(days) || 1;
  const currentDay = currentHour !== null ? Math.floor(currentHour / 24) + 1 : 1;

  // Total energy cost if rate is 10.30php/kwh
  const RATE_PER_KWH = 10.30;
  const totalKwh = parseFloat(consumedKwhRef.current.toFixed(2)); // round to match display
  const totalCost = totalKwh * RATE_PER_KWH;

  const presets = [
    { label: "15A / 3.3kW", val: "3.3" },
    { label: "20A / 4.4kW", val: "4.4" },
    { label: "25A / 5.5kW", val: "5.5" },
    { label: "30A / 6.6kW", val: "6.6" },
  ];

  return (
    <div style={S.page}>

      {/* ═══════════ LEFT SIDEBAR — SETUP ═══════════ */}
      <div style={S.sidebar}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px", color: "#f4a623" }}> ELECTRICAL LOAD AND OVERLOAD SIMULATION</h2>
        <p style={{
          color: "#f4a623", fontSize: 16, margin: "0 0 14px"
        }}>Configure parameters below.</p>

        {/* People */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.h1}>Number of People</div>
          <input type="number" min={1} max={20} value={users}
            onChange={e => { setUsers(e.target.value); setErrors(ev => ({ ...ev, users: "" })); }}
            placeholder="e.g. 4" style={S.input}
            disabled={simActive}
          />
          {errors.users && <div style={S.error}>{errors.users}</div>}
        </div>

        {/* Days */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.h1}>Number of Days</div>
          <input type="number" min={1} max={30} value={days}
            onChange={e => { setDays(e.target.value); setErrors(ev => ({ ...ev, days: "" })); }}
            placeholder="e.g. 1" style={S.input}
            disabled={simActive}
          />
          {errors.days && <div style={S.error}>{errors.days}</div>}
        </div>

        {/* Circuit Limit */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.h1}>Circuit Breaker Limit</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
            {presets.map(p => (
              <button key={p.val}
                onClick={() => { setCircuit(p.val); setErrors(ev => ({ ...ev, circuit: "" })); }}
                style={S.btnPreset(circuit === p.val)}
                disabled={simActive}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "white" }}>Custom:</span>
            <input type="number" step="0.1" min="0.1" value={circuit}
              onChange={e => { setCircuit(e.target.value); setErrors(ev => ({ ...ev, circuit: "" })); }}
              placeholder="kW" style={{ ...S.input, width: 300, fontFamily: "arial" }}
              disabled={simActive}
            />
          </div>
          {errors.circuit && <div style={S.error}>{errors.circuit}</div>}
        </div>

        {/* Appliances */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.h1}>Appliances</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button onClick={selectAll} style={{ ...S.btn, fontSize: 11, padding: "3px 8px" }} disabled={simActive}>All</button>
            <button onClick={clearAll} style={{ ...S.btn, fontSize: 11, padding: "3px 8px" }} disabled={simActive}>Clear</button>
            <span style={{ fontSize: 12, color: "white", alignSelf: "center" }}>
              {selectedAppliances.length} selected
            </span>
          </div>

          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {Object.entries(APPLIANCES).map(([id, ap]) => {
              const isAlways = ALWAYS_ON.includes(id);
              const checked = selectedAppliances.includes(id) || isAlways;
              return (
              <div key={id}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 4px", cursor: simActive ? "default" : isAlways ? "not-allowed" : "pointer",
                  background: checked ? "#f0f8ff" : "white",
                  borderBottom: "1px solid #f0f0f0", fontSize: 12,
                }}>
                <input type="checkbox" readOnly checked={checked}
                  onClick={() => !simActive && !isAlways && toggle(id)}
                  style={{ cursor: isAlways ? "not-allowed" : "pointer" }} disabled={simActive || isAlways} />
                <span
                  onClick={() => !simActive && !isAlways && toggle(id)}
                  style={{ flex: 1, fontWeight: checked ? 600 : 400, cursor: simActive || isAlways ? "default" : "pointer" }}>{ap.label}{isAlways ? " (always on)" : ""}</span>
                <span style={{ color: "#888", fontSize: 10, minWidth: 45, textAlign: "right" }}>{ap.kw}kW</span>
                <span style={{ fontSize: 10, color: "#999", marginLeft: 2 }}>×</span>
                <input type="number" min={0} max={20}
                  value={applianceQty[id] || 1}
                  onChange={e => updateQty(id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 36, padding: "2px 3px", fontSize: 11, border: "1px solid #ccc", borderRadius: 3, textAlign: "center", background: "white" }}
                  disabled={simActive}
                />
              </div>
            )})}
          </div>
          {errors.appliances && <div style={S.error}>{errors.appliances}</div>}
        </div>

        {/* Usage Settings per appliance */}
        {selectedAppliances.filter(id => !ALWAYS_ON.includes(id)).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={S.h1}>Usage Settings (per user per day)</div>

            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {selectedAppliances.filter(id => !ALWAYS_ON.includes(id)).map(id => {
                const ap = APPLIANCES[id];
                const uc = customUsageCount[id] || [1, 2];
                const dr = customDurationRanges[id] || [0.5, 2.0];
                return (
                  <div key={id} style={{ padding: "6px 4px", borderBottom: "1px solid white" }}>
                    <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4, color: "white" }}>{ap.label}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: "white", width: 55 }}>Uses/day:</span>
                      <input type="number" min={0} max={20} value={uc[0]}
                        onChange={e => updateUsageCount(id, 0, e.target.value)}
                        style={{ width: 40, padding: "2px 4px", fontSize: 11, border: "1px solid white", textAlign: "center", background: "white" }}
                        disabled={simActive} />
                      <span style={{ fontSize: 10, color: "white" }}>to</span>
                      <input type="number" min={0} max={20} value={uc[1]}
                        onChange={e => updateUsageCount(id, 1, e.target.value)}
                        style={{ width: 40, padding: "2px 4px", fontSize: 11, border: "1px solid white", textAlign: "center", background: "white" }}
                        disabled={simActive} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: "white", width: 55 }}>Hours:</span>
                      <input type="number" min={0} max={24} step={0.1} value={dr[0]}
                        onChange={e => updateDurationRange(id, 0, e.target.value)}
                        style={{ width: 50, padding: "2px 4px", fontSize: 11, border: "1px solid white", textAlign: "center", background: "white" }}
                        disabled={simActive} />
                      <span style={{ fontSize: 10, color: "white" }}>to</span>
                      <input type="number" min={0} max={24} step={0.1} value={dr[1]}
                        onChange={e => updateDurationRange(id, 1, e.target.value)}
                        style={{ width: 50, padding: "2px 4px", fontSize: 11, border: "1px solid white", textAlign: "center", background: "white" }}
                        disabled={simActive} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Total */}
        {selectedAppliances.length > 0 && (
          <div style={{ fontSize: 11, color: "black", marginBottom: 10, padding: "6px 8px", background: "#f8f8f8", border: "1px solid #e0e0e0" }}>
            Total rated: {totalKw.toFixed(3)} kW
            {circuit && totalKw > parseFloat(circuit) && (
              <span style={{ color: "orange", marginLeft: 6 }}>Exceeds limit</span>
            )}
          </div>
        )}

        {/* Buttons */}
        {!simActive ? (
          <button onClick={handleStart} style={S.btnPrimary}>Start Simulation</button>
        ) : (
          <button onClick={handleReset} style={{ ...S.btnPrimary, background: "#888", borderColor: "#888" }}>Reset</button>
        )}
      </div>

      {/* ═══════════ RIGHT SIDE — SIMULATION ═══════════ */}
      <div style={S.main}>
        {!simActive ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 14 }}>
            Configure parameters on the left, then click Start Simulation.
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>
                Simulation — {users} occupant(s), {circuit} kW limit, {days} day(s)
              </h2>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: tripped ? "#ff6600" : isOver ? "red" : running ? "#2a2" : isDone ? "#333" : "#888",
              }}>
                {tripped ? "⚡ TRIPPED" : isOver ? "OVERLOAD" : running ? "RUNNING" : isDone ? "DONE" : "READY"}
              </span>
            </div>

            <div style={{
              ...S.panel, display: "flex", gap: 28,
              background: tripped ? "#fff3e0" : isOver ? "#fff0f0" : "#f8fff8",
              borderColor: tripped ? "#ff6600" : isOver ? "#e88" : "#d0d0d0",
            }}>
              <div>
                <div style={{ fontSize: 10, color: "#666" }}>LOAD</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: isOver ? "red" : "#2a2" }}>{loadKw.toFixed(2)} kW</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#666" }}>LIMIT</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{circuit} kW</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#666" }}>TIME</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{currentHour !== null ? `Day ${currentDay} ${formatTime(currentHour)}` : "--:--"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#666" }}>BREAKER TRIPS</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: tripCount > 0 ? "#ff6600" : "#333" }}>{tripCount}</div>
              </div>
            </div>

            {/* Tripped Warning Banner */}
            {tripped && (
              <div style={{
                ...S.panel,
                background: "linear-gradient(135deg, #ff6600, #ff4400)",
                borderColor: "#ff4400",
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                textAlign: "center",
                padding: "20px 16px",
                animation: "pulse 1s infinite",
              }}>
                ⚡ CIRCUIT BREAKER TRIPPED! ⚡
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 6 }}>
                  All appliances have been shut off. Load was {log[0]?.load?.toFixed(2)} kW (limit: {circuit} kW).
                </div>
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, opacity: 0.8 }}>
                  Breaker resetting... Press Start to continue the simulation.
                </div>
              </div>
            )}

            {/* Progress */}
            <div style={S.panel}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 3 }}>
                Progress — Event {Math.max(currentIdx, 0)} of {evts.length}
              </div>
              <div style={{ background: "#e0e0e0", height: 8 }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "#555", transition: "width 0.3s" }} />
              </div>
            </div>

            {/* Real-Time Load Graph */}
            <div style={S.panel}>
              <div style={S.h1}>Real-Time Power Load</div>
              {loadHistory.length > 1 ? (() => {
                const W = 700, H = 220, PAD_L = 50, PAD_R = 20, PAD_T = 16, PAD_B = 36;
                const chartW = W - PAD_L - PAD_R;
                const chartH = H - PAD_T - PAD_B;

                const minHour = loadHistory[0].hour;
                const maxHour = loadHistory[loadHistory.length - 1].hour;
                const hourSpan = Math.max(maxHour - minHour, 0.1);

                const maxLoad = Math.max(circuitLimit * 1.3, ...loadHistory.map(d => d.load), 0.5);

                const toX = (hour) => PAD_L + ((hour - minHour) / hourSpan) * chartW;
                const toY = (load) => PAD_T + chartH - (load / maxLoad) * chartH;

                // Build load polyline
                const points = loadHistory.map(d => `${toX(d.hour)},${toY(d.load)}`).join(' ');

                // Build area fill (load area under curve)
                const areaPoints = `${toX(minHour)},${toY(0)} ${points} ${toX(loadHistory[loadHistory.length - 1].hour)},${toY(0)}`;

                // Grid lines (Y-axis)
                const yTicks = [];
                const yStep = maxLoad > 5 ? Math.ceil(maxLoad / 5) : maxLoad > 2 ? 1 : 0.5;
                for (let v = 0; v <= maxLoad; v += yStep) {
                  yTicks.push(v);
                }

                // X-axis ticks
                const xTicks = [];
                const numXTicks = Math.min(8, Math.max(2, Math.floor(hourSpan)));
                for (let i = 0; i <= numXTicks; i++) {
                  xTicks.push(minHour + (hourSpan * i / numXTicks));
                }

                // Trip points
                const trips = loadHistory.filter(d => d.tripped);

                return (
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, background: '#fafafa', borderRadius: 6, border: '1px solid #e0e0e0' }}>
                    {/* Grid lines */}
                    {yTicks.map((v, i) => (
                      <g key={`y${i}`}>
                        <line x1={PAD_L} x2={W - PAD_R} y1={toY(v)} y2={toY(v)} stroke="#e8e8e8" strokeWidth={1} />
                        <text x={PAD_L - 6} y={toY(v) + 3} textAnchor="end" fontSize={9} fill="#999">{v.toFixed(1)}</text>
                      </g>
                    ))}
                    {xTicks.map((v, i) => (
                      <g key={`x${i}`}>
                        <line x1={toX(v)} x2={toX(v)} y1={PAD_T} y2={H - PAD_B} stroke="#f0f0f0" strokeWidth={1} />
                        <text x={toX(v)} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} fill="#999">{formatDayTime(v)}</text>
                      </g>
                    ))}

                    {/* Circuit limit line */}
                    <line x1={PAD_L} x2={W - PAD_R} y1={toY(circuitLimit)} y2={toY(circuitLimit)}
                      stroke="#f4a623" strokeWidth={1.5} strokeDasharray="6 3" />
                    <text x={W - PAD_R + 2} y={toY(circuitLimit) + 3} fontSize={8} fill="#f4a623" fontWeight={600}>
                      {circuitLimit}kW
                    </text>

                    {/* Load area */}
                    <polygon points={areaPoints} fill="url(#loadGrad)" opacity={0.35} />

                    {/* Gradient definition */}
                    <defs>
                      <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#27ae60" />
                        <stop offset="100%" stopColor="#27ae60" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>

                    {/* Load line */}
                    <polyline points={points} fill="none" stroke="#27ae60" strokeWidth={2} strokeLinejoin="round" />

                    {/* Overload segments highlighted in red */}
                    {loadHistory.map((d, i) => {
                      if (i === 0 || d.load <= circuitLimit) return null;
                      const prev = loadHistory[i - 1];
                      return (
                        <line key={`ol${i}`}
                          x1={toX(prev.hour)} y1={toY(prev.load)}
                          x2={toX(d.hour)} y2={toY(d.load)}
                          stroke="#c0392b" strokeWidth={2.5} />
                      );
                    })}

                    {/* Trip markers */}
                    {trips.map((d, i) => (
                      <g key={`trip${i}`}>
                        <circle cx={toX(d.hour)} cy={toY(d.load)} r={5} fill="#ff6600" stroke="white" strokeWidth={1.5} />
                        <text x={toX(d.hour)} y={toY(d.load) - 8} textAnchor="middle" fontSize={8} fill="#ff6600" fontWeight={700}>⚡</text>
                      </g>
                    ))}

                    {/* Axes */}
                    <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="#ccc" strokeWidth={1} />
                    <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#ccc" strokeWidth={1} />

                    {/* Y-axis label */}
                    <text x={12} y={H / 2} textAnchor="middle" fontSize={10} fill="#888" transform={`rotate(-90, 12, ${H / 2})`}>kW</text>
                  </svg>
                );
              })() : (
                <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, padding: '30px 0' }}>
                  Graph will appear once the simulation starts running.
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{ ...S.panel, display: "flex", gap: 12, alignItems: "center" }}>
              <button onClick={() => setRunning(r => !r)} style={{ ...S.btnPrimary, width: "auto", padding: "6px 24px" }}>
                {running ? "Pause" : "Start"}
              </button>
              <label style={{ fontSize: 12, color: "white" }}>
                Speed:&nbsp;
                <input type="range" min={100} max={1000} step={50} value={speed}
                  onChange={e => setSpeed(+e.target.value)} style={{ verticalAlign: "middle" }} />
                &nbsp;{speed}ms
              </label>
            </div>

            {/* Two-column: Appliances + Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={S.panel}>
                <div style={S.h1}>Active Appliances</div>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Status</th>
                      <th style={S.th}>Appliance</th>
                      <th style={S.th}>Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAppliances.map(id => {
                      const ap = APPLIANCES[id];
                      const active = Object.keys(activeMap).some(k => k.startsWith(id + "||") && activeMap[k]);
                      return (
                        <tr key={id} style={{ background: active ? "#fffde0" : "#fff" }}>
                          <td style={S.td}>{active ? "ON" : "—"}</td>
                          <td style={{ ...S.td, fontWeight: active ? 600 : 400 }}>{ap.label}</td>
                          <td style={S.td}>{ap.kw} kW</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={S.panel}>
                <div style={S.h1}>Statistics</div>
                <table style={S.table}>
                  <tbody>
                    <tr><td style={S.td}>Breaker Trips</td><td style={{ ...S.td, fontWeight: 600, color: tripCount > 0 ? "#ff6600" : "#333" }}>{tripCount}</td></tr>
                    <tr><td style={S.td}>Events Processed</td><td style={{ ...S.td, fontWeight: 600 }}>{Math.max(currentIdx, 0)} / {evts.length}</td></tr>
                    <tr><td style={S.td}>Occupants</td><td style={{ ...S.td, fontWeight: 600 }}>{users}</td></tr>
                    <tr><td style={S.td}>Days</td><td style={{ ...S.td, fontWeight: 600 }}>{days}</td></tr>
                    <tr><td style={S.td}>Total Load</td><td style={{ ...S.td, fontWeight: 600 }}>{loadKw.toFixed(2)} kW</td></tr>
                    <tr><td style={S.td}>Total Consumed</td><td style={{ ...S.td, fontWeight: 600 }}>{totalKwh.toFixed(2)} kWh</td></tr>
                    <tr><td style={S.td}>Rate</td><td style={{ ...S.td, fontWeight: 600 }}>₱{RATE_PER_KWH.toFixed(2)}/kWh</td></tr>
                    <tr><td style={S.td}>Total Cost</td><td style={{ ...S.td, fontWeight: 600 }}>₱{totalCost.toFixed(2)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Event Log */}
            <div style={S.panel}>
              <div style={S.h1}>Event Log</div>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                <table style={S.table}>
                  <thead>
                    <tr style={{ position: "sticky", top: 0, background: "#f5f5f5" }}>
                      <th style={S.th}>Time</th>
                      <th style={S.th}>Appliance</th>
                      <th style={S.th}>User</th>
                      <th style={S.th}>Load</th>
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((e, i) => (
                      <tr key={i} style={{ background: e.overload ? "#fff0f0" : i === 0 ? "#fffff0" : "#fff" }}>
                        <td style={S.td}>{e.time}</td>
                        <td style={S.td}>{e.label}</td>
                        <td style={S.td}>{e.user === 0 ? "Always-on" : `User ${e.user}`}</td>
                        <td style={{ ...S.td, fontWeight: 600, color: e.overload ? "red" : "#333" }}>{e.load.toFixed(2)} kW</td>
                        <td style={{ ...S.td, color: e.trip ? "#ff6600" : e.overload ? "red" : "#2a2", fontWeight: e.trip ? 700 : 400 }}>{e.trip ? "⚡ TRIP" : e.overload ? "OVERLOAD" : "OK"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Energy saving tips shown after simulation completes */}
            {isDone && (
              <div style={S.panel}>
                <div style={S.h1}>Energy Saving Tips</div>
                <ul style={{ fontSize: 12, margin: 0, paddingLeft: 20 }}>
                  {ENERGY_TIPS.map((tip, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
