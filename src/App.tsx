import React, { useEffect, useMemo, useState } from "react";

/**
 * Workout Tracker Web App (single file starter)
 * Mobile first, works on desktop. Tailwind CSS assumed.
 * Uses an Adapter pattern so you can swap data sources:
 *  - MockAdapter (in-memory demo)
 *  - GoogleSheetsAdapter (Apps Script REST bridge)
 *
 * What you get
 * 1) Daily workout view with Day dropdown
 * 2) Blocks → Sets → Exercises layout
 * 3) Thumbnail, equipment, prescribed reps, inputs for load and notes
 * 4) One-click YouTube lookup per exercise
 * 5) Add Alternative Exercise via AI (server endpoint expected)
 * 6) Cardio view for plan and actual with a combined timeline
 *
 * To wire up Google Sheets quickly
 * 1) Make a Google Sheet with the schemas at the bottom of this file
 * 2) Create an Apps Script web app that exposes GET/POST for read/write
 * 3) Set APPS_SCRIPT_BASE_URL below
 * 4) Switch adapter in the App component
 */

// =========================
// Types
// =========================
type AdapterName = "mock" | "sheets";

const APPS_SCRIPT_BASE_URL = "https://script.google.com/macros/s/AKfycbw_cV-YyxjxWuWtNYC9sd4MKrVz2GyOc1vIa-73QeCVA4HwPmKaLyd_m9f4fTU9dY7_Og/execERE";
const SHEET_ID_KEY = "wt_sheet_id";

function sheetId(): string {
  return localStorage.getItem(SHEET_ID_KEY) || "";
}

async function getJSON(action: string, params: Record<string,string>) {
  const url = new URL(APPS_SCRIPT_BASE_URL);
  url.searchParams.set("action", action);
  if (!url.searchParams.has("sheetId")) url.searchParams.set("sheetId", sheetId());
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`${action} failed`);
  return r.json();
}

async function postJSON(action: string, payload: any) {
  const r = await fetch(APPS_SCRIPT_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sheetId: sheetId(), payload }),
  });
  if (!r.ok) throw new Error(`${action} failed`);
  return r.json();
}

// =========================
// EXPORTS
// =========================
export type Exercise = {
  id: string;
  name: string;
  equipment: string; // e.g., "mat; dumbbells; mini-band"
  default_reps?: string; // e.g., "8 to 10 each side" or "30 sec hold"
  type: "strength" | "mobility" | "core" | "plyo" | "cardio";
  thumbnail_url?: string;
  yt_query?: string;
  description?: string;
};

export type PlanRow = {
  day_id: string; // e.g., "Day 1"
  day_name: string; // e.g., "Upper Body Push"
  block_order: number; // 1, 2, 3...
  block_name: string; // e.g., "Glute Strength Block"
  set_number: number; // 1..N
  exercise_id: string;
  prescribed_reps?: string; // override default if present
  tempo?: string;
  notes?: string;
};

export type StrengthLog = {
  date_iso: string; // 2025-08-20
  day_id: string;
  block_name: string;
  set_number: number;
  exercise_id: string;
  reps_done?: string;
  load?: string; // weight, band color, cable setting, hold duration
  notes?: string;
};

export type CardioPlanRow = {
  day_id?: string; // optional if you periodize by day labels
  date_iso?: string; // optional if you target specific dates
  activity: string; // run, ride, row, hike, zone2, intervals
  target_duration_min?: number;
  target_hr_zone?: string; // Z2, Z3, etc
  target_rpe?: number; // 1..10
  notes?: string;
};

export type CardioLog = {
  date_iso: string;
  activity: string;
  duration_min?: number;
  distance_km?: number;
  avg_hr?: number;
  rpe?: number;
  tss?: number;
  notes?: string;
};

// =========================
// Adapters
// =========================

interface DataAdapter {
  listDays(): Promise<{ id: string; name: string }[]>;
  getPlanForDay(day_id: string): Promise<{ plan: PlanRow[]; exercises: Record<string, Exercise> }>;
  saveStrengthLog(log: StrengthLog): Promise<{ ok: boolean }>;
  listCardio(dateRange?: { start_iso: string; end_iso: string }): Promise<{ plan: CardioPlanRow[]; logs: CardioLog[] }>;
  saveCardioLog(log: CardioLog): Promise<{ ok: boolean }>;
  addExercise(ex: Exercise): Promise<{ ok: boolean; exercise_id: string }>;
  addPlanRow(row: PlanRow): Promise<{ ok: boolean }>;
}

// ===== Mock Adapter for local demo
const MOCK_DB = (() => {
  const exercises: Record<string, Exercise> = {
    ex_glute_bridge: {
      id: "ex_glute_bridge",
      name: "Weighted Glute Bridge",
      equipment: "mat; dumbbells",
      default_reps: "8 to 10",
      type: "strength",
      thumbnail_url: "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?q=80&w=600&auto=format&fit=crop",
      yt_query: "weighted glute bridge form",
      description: "Supine, knees bent, drive through heels, squeeze glutes at top"
    },
    ex_banded_deadbug: {
      id: "ex_banded_deadbug",
      name: "Banded Dead Bug (overhead weight)",
      equipment: "mat; mini-band; dumbbell",
      default_reps: "6 each side",
      type: "core",
      thumbnail_url: "https://images.unsplash.com/photo-1554298062-9e6f67f99674?q=80&w=600&auto=format&fit=crop",
      yt_query: "banded dead bug exercise",
      description: "Brace, press band apart slightly, lower opposite arm and leg"
    },
  };
  const plan: PlanRow[] = [];
  // Build a sample plan with 2 blocks, 3 sets each
  for (let set = 1; set <= 3; set++) {
    plan.push({ day_id: "Day 1", day_name: "Glutes + Core", block_order: 1, block_name: "Glute Strength Block", set_number: set, exercise_id: "ex_glute_bridge", prescribed_reps: "8 to 10" });
  }
  for (let set = 1; set <= 3; set++) {
    plan.push({ day_id: "Day 1", day_name: "Glutes + Core", block_order: 2, block_name: "Core Block", set_number: set, exercise_id: "ex_banded_deadbug", prescribed_reps: "6 each side" });
  }
  const days = [{ id: "Day 1", name: "Glutes + Core" }, { id: "Day 2", name: "Upper Push" }, { id: "Day 3", name: "Upper Pull" }, { id: "Day 4", name: "Lower Body" }];
  const strengthLogs: StrengthLog[] = [];
  const cardioPlan: CardioPlanRow[] = [
    { day_id: "Day 2", activity: "Zone 2 Ride", target_duration_min: 60, target_hr_zone: "Z2", notes: "Keep cadence smooth" },
  ];
  const cardioLogs: CardioLog[] = [];
  return { exercises, plan, days, strengthLogs, cardioPlan, cardioLogs };
})();

class MockAdapter implements DataAdapter {
  async listDays() {
    return MOCK_DB.days;
  }
  async getPlanForDay(day_id: string) {
    const plan = MOCK_DB.plan.filter(p => p.day_id === day_id).sort((a, b) => a.block_order - b.block_order || a.set_number - b.set_number);
    return { plan, exercises: MOCK_DB.exercises };
  }
  async saveStrengthLog(log: StrengthLog) {
    MOCK_DB.strengthLogs.push(log);
    return { ok: true };
  }
  async listCardio() {
    return { plan: MOCK_DB.cardioPlan, logs: MOCK_DB.cardioLogs };
  }
  async saveCardioLog(log: CardioLog) {
    MOCK_DB.cardioLogs.push(log);
    return { ok: true };
  }
  async addExercise(ex: Exercise) {
    const id = ex.id || `ex_${Math.random().toString(36).slice(2, 10)}`;
    MOCK_DB.exercises[id] = { ...ex, id };
    return { ok: true, exercise_id: id };
  }
  async addPlanRow(row: PlanRow) {
    MOCK_DB.plan.push(row);
    return { ok: true };
  }
}

// ===== Google Sheets Adapter via Apps Script REST
// You will create an Apps Script web app that accepts GET/POST for different actions
// Minimal example Apps Script is provided at the bottom of this file

class GoogleSheetsAdapter implements DataAdapter {
  async listDays(): Promise<{ id: string; name: string }[]> {
    const j = await getJSON("listDays", {});
    // j.days: [{ day_id, day_name }]
    return (j.days as Array<{ day_id: string; day_name: string }>).map(d => ({
      id: String(d.day_id),
      name: d.day_name,
    }));
  }

  async getPlanForDay(dayId: string): Promise<{
    plan: PlanRow[];
    exercises: Record<string, Exercise>;
  }> {
    const j = await getJSON("getPlanForDay", { day: String(dayId) });
    return {
      plan: j.plan as PlanRow[],
      exercises: j.exercises as Record<string, Exercise>,
    };
  }

  async saveStrengthLog(log: StrengthLog): Promise<{ ok: boolean }> {
    await postJSON("saveStrengthLog", log);
    return { ok: true };
  }

  async listCardio(): Promise<{ plan: CardioPlanRow[]; logs: CardioLog[] }> {
    const j = await getJSON("listCardio", {});
    // Apps Script returns { cardio, logs }
    const plan = (j.cardio ?? []) as CardioPlanRow[];
    const logs = (j.logs ?? []) as CardioLog[];
    return { plan, logs };
  }

  async saveCardioLog(log: CardioLog): Promise<{ ok: boolean }> {
    await postJSON("saveCardioLog", log);
    return { ok: true };
  }

  async addExercise(ex: Exercise): Promise<{ ok: boolean; exercise_id: string }> {
    await postJSON("addExercise", ex);
    return { ok: true, exercise_id: ex.id };
  }

  async addPlanRow(row: PlanRow): Promise<{ ok: boolean }> {
    await postJSON("addPlanRow", row);
    return { ok: true };
  }
}

// =========================
// UI Components
// =========================

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {right}
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

function ExerciseCard({
  exercise,
  setNumber,
  prescribedReps,
  onSave,
}: {
  exercise: Exercise;
  setNumber: number;
  prescribedReps?: string;
  onSave: (data: { reps_done?: string; load?: string; notes?: string }) => void;
}) {
  const [reps, setReps] = useState<string>("");
  const [load, setLoad] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const ytQuery = exercise.yt_query || exercise.name + " exercise";
  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery)}`;
  return (
    <div className="rounded-2xl border p-3 shadow-sm bg-white">
      <div className="flex gap-3">
        <img src={exercise.thumbnail_url} alt={exercise.name} className="w-24 h-24 object-cover rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate">
              <div className="text-base font-semibold">{exercise.name} <span className="text-xs font-normal text-gray-500">Set {setNumber}</span></div>
              <div className="text-sm text-gray-600">Equipment: {exercise.equipment || "bodyweight"}</div>
              <div className="text-sm text-gray-600">Prescribed: {prescribedReps || exercise.default_reps || "as assigned"}</div>
            </div>
            <a href={ytUrl} target="_blank" rel="noreferrer" className="text-sm underline">YouTube lookup</a>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 max-[520px]:grid-cols-1">
            <input value={reps} onChange={e => setReps(e.target.value)} placeholder="Reps or time"
                   className="px-3 py-2 rounded-xl border w-full" />
            <input value={load} onChange={e => setLoad(e.target.value)} placeholder="Weight, band, hold"
                   className="px-3 py-2 rounded-xl border w-full" />
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes"
                   className="px-3 py-2 rounded-xl border w-full" />
          </div>

          <div className="mt-3">
            <button onClick={() => onSave({ reps_done: reps, load, notes })}
                    className="px-4 py-2 rounded-xl bg-black text-white shadow">
              Save set
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({
  name,
  setCount,
  exercises,
  prescribedByExercise,
  onSave,
}: {
  name: string;
  setCount: number;
  exercises: Exercise[];
  prescribedByExercise: Record<string, string | undefined>;
  onSave: (exercise_id: string, set_number: number, data: { reps_done?: string; load?: string; notes?: string }) => void;
}) {
  const rows: React.ReactNode[] = [];
  for (let set = 1; set <= setCount; set++) {
    for (const ex of exercises) {
      rows.push(
        <ExerciseCard
          key={`${ex.id}_${set}`}
          exercise={ex}
          setNumber={set}
          prescribedReps={prescribedByExercise[ex.id]}
          onSave={(data) => onSave(ex.id, set, data)}
        />
      );
    }
  }
  return (
    <Section title={name}>{rows}</Section>
  );
}

function DayWorkoutView({ adapter }: { adapter: DataAdapter }) {
  const [days, setDays] = useState<{ id: string; name: string }[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [exMap, setExMap] = useState<Record<string, Exercise>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    adapter.listDays().then(setDays);
  }, [adapter]);

  useEffect(() => {
    if (!selectedDay) return;
    setLoading(true);
    adapter.getPlanForDay(selectedDay).then(({ plan, exercises }) => {
      setPlan(plan);
      setExMap(exercises);
      setLoading(false);
    });
  }, [adapter, selectedDay]);

  const blocks = useMemo(() => {
    const group: Record<string, { order: number; sets: number; exercises: Set<string>; prescribed: Record<string, string | undefined> }> = {};
    for (const row of plan) {
      const key = row.block_name;
      if (!group[key]) group[key] = { order: row.block_order, sets: 0, exercises: new Set(), prescribed: {} };
      group[key].sets = Math.max(group[key].sets, row.set_number);
      group[key].exercises.add(row.exercise_id);
      if (row.prescribed_reps) group[key].prescribed[row.exercise_id] = row.prescribed_reps;
    }
    return Object.entries(group)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ name, setCount: v.sets, exercises: [...v.exercises].map(id => exMap[id]).filter(Boolean), prescribed: v.prescribed }));
  }, [plan, exMap]);

  function onSave(exercise_id: string, set_number: number, data: { reps_done?: string; load?: string; notes?: string }) {
    const dayRow = plan.find(p => p.exercise_id === exercise_id);
    if (!dayRow) return;
    const log: StrengthLog = {
      date_iso: new Date().toISOString().slice(0, 10),
      day_id: dayRow.day_id,
      block_name: dayRow.block_name,
      set_number,
      exercise_id,
      ...data,
    };
    adapter.saveStrengthLog(log).then(() => setStatus("Saved"));
  }

  // Simple AI add alternative exercise flow
  const [aiQuery, setAiQuery] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);

  async function addAlternativeExercise() {
    if (!selectedDay || !aiQuery.trim()) return;
    setAiBusy(true);
    try {
      // Expect a server endpoint you host that calls OpenAI and returns a normalized Exercise
      const r = await fetch("/api/ai-exercise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: aiQuery }) });
      const ex: Exercise = await r.json();
      // 1) Save exercise
      const addRes = await adapter.addExercise(ex);
      // 2) Add it to the current day as an extra item in Block 99 (Ad hoc)
      await adapter.addPlanRow({
        day_id: selectedDay,
        day_name: days.find(d => d.id === selectedDay)?.name || selectedDay,
        block_order: 99,
        block_name: "Ad hoc alternatives",
        set_number: 1,
        exercise_id: addRes.exercise_id,
        prescribed_reps: ex.default_reps,
      });
      // 3) Reload the plan
      const updated = await adapter.getPlanForDay(selectedDay);
      setPlan(updated.plan);
      setExMap(updated.exercises);
      setAiQuery("");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 max-[520px]:flex-col max-[520px]:items-stretch">
        <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="px-3 py-2 rounded-xl border">
          <option value="">Select a day</option>
          {days.map(d => (
            <option key={d.id} value={d.id}>{d.id} — {d.name}</option>
          ))}
        </select>
        {status && <div className="text-sm text-green-600">{status}</div>}
        <div className="ml-auto max-[520px]:ml-0 flex items-center gap-2">
          <input value={aiQuery} onChange={e => setAiQuery(e.target.value)} placeholder="Find an alternative exercise"
                 className="px-3 py-2 rounded-xl border w-72 max-[520px]:w-full" />
          <button onClick={addAlternativeExercise} disabled={aiBusy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow disabled:opacity-60">
            {aiBusy ? "Adding..." : "Add via AI"}
          </button>
        </div>
      </div>

      {loading && <div className="p-4 rounded-xl border bg-white">Loading day...</div>}

      {!loading && blocks.map(b => (
        <Block key={b.name} name={b.name} setCount={b.setCount} exercises={b.exercises} prescribedByExercise={b.prescribed} onSave={onSave} />
      ))}

      {!loading && !blocks.length && (
        <div className="p-4 rounded-xl border bg-white">No plan rows for this day yet.</div>
      )}
    </div>
  );
}

function CardioView({ adapter }: { adapter: DataAdapter }) {
  const [rows, setRows] = useState<CardioPlanRow[]>([]);
  const [logs, setLogs] = useState<CardioLog[]>([]);
  const [newLog, setNewLog] = useState<CardioLog>({ date_iso: new Date().toISOString().slice(0, 10), activity: "Ride" });
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    adapter.listCardio().then(({ plan, logs }) => { setRows(plan); setLogs(logs); });
  }, [adapter]);

  async function save() {
    const res = await adapter.saveCardioLog(newLog);
    if (res.ok) {
      setStatus("Saved");
      const { plan, logs } = await adapter.listCardio();
      setRows(plan); setLogs(logs);
    }
  }

  return (
    <div className="grid gap-6">
      <Section title="New cardio log">
        <div className="grid grid-cols-6 gap-2 max-[920px]:grid-cols-2">
          <input className="px-3 py-2 rounded-xl border" value={newLog.date_iso} onChange={e => setNewLog({ ...newLog, date_iso: e.target.value })} type="date"/>
          <input className="px-3 py-2 rounded-xl border" value={newLog.activity} onChange={e => setNewLog({ ...newLog, activity: e.target.value })} placeholder="Activity"/>
          <input className="px-3 py-2 rounded-xl border" value={newLog.duration_min ?? ""} onChange={e => setNewLog({ ...newLog, duration_min: Number(e.target.value) || undefined })} placeholder="Duration min"/>
          <input className="px-3 py-2 rounded-xl border" value={newLog.distance_km ?? ""} onChange={e => setNewLog({ ...newLog, distance_km: Number(e.target.value) || undefined })} placeholder="Distance km"/>
          <input className="px-3 py-2 rounded-xl border" value={newLog.avg_hr ?? ""} onChange={e => setNewLog({ ...newLog, avg_hr: Number(e.target.value) || undefined })} placeholder="Avg HR"/>
          <input className="px-3 py-2 rounded-xl border" value={newLog.rpe ?? ""} onChange={e => setNewLog({ ...newLog, rpe: Number(e.target.value) || undefined })} placeholder="RPE"/>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={save} className="px-4 py-2 rounded-xl bg-black text-white shadow">Save cardio log</button>
          {status && <div className="text-sm text-green-600">{status}</div>}
        </div>
      </Section>

      <Section title="Cardio plan (upcoming)">
        <div className="grid gap-2">
          {rows.length === 0 && <div className="p-3 rounded-xl border">No plan rows yet.</div>}
          {rows.map((r, i) => (
            <div key={i} className="p-3 rounded-xl border bg-white text-sm">
              <div className="font-medium">{r.date_iso || r.day_id || "Unscheduled"} — {r.activity}</div>
              <div className="text-gray-600">Target: {r.target_duration_min ? `${r.target_duration_min} min` : "n/a"} {r.target_hr_zone ? `| HR ${r.target_hr_zone}` : ""} {r.target_rpe ? `| RPE ${r.target_rpe}` : ""}</div>
              {r.notes && <div className="text-gray-600">{r.notes}</div>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cardio logs (recent)">
        <div className="grid gap-2">
          {logs.length === 0 && <div className="p-3 rounded-xl border">No logs yet.</div>}
          {logs.slice().reverse().map((l, i) => (
            <div key={i} className="p-3 rounded-xl border bg-white text-sm">
              <div className="font-medium">{l.date_iso} — {l.activity}</div>
              <div className="text-gray-600">{l.duration_min ? `${l.duration_min} min` : ""} {l.distance_km ? `| ${l.distance_km} km` : ""} {typeof l.avg_hr === "number" ? `| ${l.avg_hr} bpm` : ""} {typeof l.rpe === "number" ? `| RPE ${l.rpe}` : ""} {typeof l.tss === "number" ? `| TSS ${l.tss}` : ""}</div>
              {l.notes && <div className="text-gray-600">{l.notes}</div>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Tabs({ value, onChange }: { value: string; onChange: React.Dispatch<React.SetStateAction<string>> }) { 

  return (
    <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl w-full max-w-full">
      {["Daily Workout", "Cardio", "Settings"].map(tab => (
        <button key={tab}
                className={`px-4 py-2 rounded-2xl ${value === tab ? "bg-white shadow" : "opacity-70"}`}
                onClick={() => onChange(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function SettingsView({
  adapterName,
  setAdapterName,
}: {
  adapterName: AdapterName;
  setAdapterName: React.Dispatch<React.SetStateAction<AdapterName>>;
}) {
  const [sheetIdInput, setSheetIdInput] = React.useState<string>(
    localStorage.getItem(SHEET_ID_KEY) || ""
  );

async function createBackend() {
  try {
    const popup = window.open(
      `${APPS_SCRIPT_BASE_URL}?action=provisionPopup`,
      "_blank",
      "popup,width=520,height=640"
    );
    if (!popup) {
      alert("Popup blocked. Allow popups for this site and try again.");
      return;
    }

    // One-shot listener for the Apps Script message
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as any;
      if (data && data.type === "wt/provisioned" && data.sheetId) {
        localStorage.setItem(SHEET_ID_KEY, data.sheetId);
        setAdapterName("sheets");
        try { popup.close(); } catch {}
        alert(`Backend created. You can open the Sheet at:\n${data.url}`);
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg, { once: true });
  } catch (e: any) {
    alert("Provision error: " + e.message);
  }
}

  function useTypedSheet() {
    const id = sheetIdInput.trim();
    if (!id) {
      alert("Paste a Google Sheet ID first");
      return;
    }
    localStorage.setItem(SHEET_ID_KEY, id);
    setAdapterName("sheets");
  }

  return (
    <div className="space-y-4">
      {/* Adapter selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Data source</label>
        <select
          value={adapterName}
          onChange={(e) => setAdapterName(e.target.value as AdapterName)}
          className="px-3 py-2 rounded-xl border"
        >
          <option value="mock">Mock (local demo)</option>
          <option value="sheets">Google Sheets via Apps Script</option>
        </select>
      </div>

      {/* One-click backend creation */}
      <button
        className="px-3 py-2 rounded-xl border"
        onClick={createBackend}
      >
        Create backend in my Google Drive
      </button>

      {/* Use an existing Sheet */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Existing Sheet ID</label>
        <div className="flex items-center gap-2">
          <input
            placeholder="Paste existing Google Sheet ID"
            className="px-3 py-2 rounded-xl border w-full"
            value={sheetIdInput}
            onChange={(e) => setSheetIdInput(e.target.value)}
            onBlur={() =>
              localStorage.setItem(SHEET_ID_KEY, sheetIdInput.trim())
            }
          />
          <button className="px-3 py-2 rounded-xl border" onClick={useTypedSheet}>
            Use this Sheet
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("Daily Workout");
  const [adapterName, setAdapterName] = useState<AdapterName>("mock");
  const adapter = useMemo<DataAdapter>(() => adapterName === "mock" ? new MockAdapter() : new GoogleSheetsAdapter(), [adapterName]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workout Tracker</h1>
            <p className="text-sm text-gray-600">Strength and cardio in one place</p>
          </div>
          <Tabs value={tab} onChange={setTab} />
        </header>

        {tab === "Daily Workout" && <DayWorkoutView adapter={adapter} />}
        {tab === "Cardio" && <CardioView adapter={adapter} />}
        {tab === "Settings" && <SettingsView adapterName={adapterName} setAdapterName={setAdapterName} />}

        <footer className="mt-10 text-xs text-gray-500">
          <p>Pro tip: every exercise row is a separate set. Use the AI button to inject alternates fast.</p>
        </footer>
      </div>
    </div>
  );
}

/* =========================
Google Sheets schema (one header row each)

Sheet: Exercises
id, name, equipment, default_reps, type, thumbnail_url, yt_query, description

Sheet: WorkoutPlan
day_id, day_name, block_order, block_name, set_number, exercise_id, prescribed_reps, tempo, notes

Sheet: StrengthLogs
date_iso, day_id, block_name, set_number, exercise_id, reps_done, load, notes

Sheet: CardioPlan
date_iso, day_id, activity, target_duration_min, target_hr_zone, target_rpe, notes

Sheet: CardioLogs
date_iso, activity, duration_min, distance_km, avg_hr, rpe, tss, notes
========================= */

/* =========================
Apps Script sample (Code.gs)

const SPREADSHEET_ID = 'PUT_YOURS_HERE';

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'listDays') return json(listDays());
  if (action === 'getPlanForDay') return json(getPlanForDay(e.parameter.day_id));
  if (action === 'listCardio') return json(listCardio());
  return json({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  const { action, payload } = JSON.parse(e.postData.contents);
  if (action === 'saveStrengthLog') return json(saveStrengthLog(payload));
  if (action === 'saveCardioLog') return json(saveCardioLog(payload));
  if (action === 'addExercise') return json(addExercise(payload));
  if (action === 'addPlanRow') return json(addPlanRow(payload));
  return json({ ok: false, error: 'Unknown action' });
}

function ss() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sh(name) { return ss().getSheetByName(name); }
function A(rows) { return rows.map(r => r.map(c => c === undefined ? '' : c)); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function listDays() {
  const ws = sh('WorkoutPlan');
  const vals = ws.getDataRange().getValues();
  const [hdr, ...rows] = vals;
  const day_id_i = hdr.indexOf('day_id');
  const day_name_i = hdr.indexOf('day_name');
  const map = {};
  rows.forEach(r => { if (r[day_id_i]) map[r[day_id_i]] = r[day_name_i] || r[day_id_i]; });
  return Object.entries(map).map(([id, name]) => ({ id, name }));
}

function getPlanForDay(day_id) {
  const exMap = {};
  const exs = sh('Exercises').getDataRange().getValues();
  const [eh, ...erows] = exs;
  const eIdx = idx(eh);
  erows.forEach(r => { exMap[r[eIdx.id]] = {
    id: r[eIdx.id], name: r[eIdx.name], equipment: r[eIdx.equipment], default_reps: r[eIdx.default_reps], type: r[eIdx.type], thumbnail_url: r[eIdx.thumbnail_url], yt_query: r[eIdx.yt_query], description: r[eIdx.description]
  }; });

  const ws = sh('WorkoutPlan');
  const vals = ws.getDataRange().getValues();
  const [hdr, ...rows] = vals;
  const i = idx(hdr);
  const plan = rows.filter(r => r[i.day_id] === day_id).map(r => ({
    day_id: r[i.day_id], day_name: r[i.day_name], block_order: Number(r[i.block_order]), block_name: r[i.block_name], set_number: Number(r[i.set_number]), exercise_id: r[i.exercise_id], prescribed_reps: r[i.prescribed_reps], tempo: r[i.tempo], notes: r[i.notes]
  }));
  return { plan, exercises: exMap };
}

function saveStrengthLog(p) {
  const ws = sh('StrengthLogs');
  ws.appendRow([p.date_iso, p.day_id, p.block_name, p.set_number, p.exercise_id, p.reps_done, p.load, p.notes]);
  return { ok: true };
}

function listCardio() {
  const plan = readRows('CardioPlan');
  const logs = readRows('CardioLogs');
  return { plan, logs };
}

function saveCardioLog(p) {
  sh('CardioLogs').appendRow([p.date_iso, p.activity, p.duration_min, p.distance_km, p.avg_hr, p.rpe, p.tss, p.notes]);
  return { ok: true };
}

function addExercise(ex) {
  const id = ex.id || 'ex_' + Math.random().toString(36).slice(2, 10);
  sh('Exercises').appendRow([id, ex.name, ex.equipment, ex.default_reps, ex.type, ex.thumbnail_url, ex.yt_query, ex.description]);
  return { ok: true, exercise_id: id };
}

function addPlanRow(row) {
  sh('WorkoutPlan').appendRow([row.day_id, row.day_name, row.block_order, row.block_name, row.set_number, row.exercise_id, row.prescribed_reps, row.tempo, row.notes]);
  return { ok: true };
}

function idx(h) { const m = {}; h.forEach((k, i) => m[k] = i); return m; }
function readRows(name) {
  const ws = sh(name); const vals = ws.getDataRange().getValues();
  const [hdr, ...rows] = vals; const i = idx(hdr);
  return rows.filter(r => r.join('').length).map(r => Object.fromEntries(Object.keys(i).map(k => [k, r[i[k]]] )))
}
========================= */
