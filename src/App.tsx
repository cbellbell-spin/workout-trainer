import React, { useEffect, useMemo, useState } from "react";

/**
 * Workout Tracker Web App
 * - Mobile first, works on desktop
 * - Tailwind CSS for styling
 * - Adapter pattern so you can swap data sources
 *
 * Adapters:
 *  - MockAdapter (in-memory demo)
 *  - GoogleSheetsAdapter (Apps Script REST bridge)
 */

// =========================
// Config
// =========================
type AdapterName = "mock" | "sheets";
type TabName = "daily" | "cardio" | "settings";

const API_BASE_URL =
  "https://script.google.com/macros/s/AKfycbyZhTwMUAD7MoebK9rPBdpptVBKRRg4upx54Wr41toCZ4UaTCIw2m9mJi5F3LJ2tIOL5A/exec";
const PROVISION_URL =
  "https://script.google.com/macros/s/AKfycbzSErIEb44zD1h9EXK9rFVW55cVz8zC_qenxKd7byRdksFfXqdzYqd-Anv3hI_pS0LWfg/exec";

const SHEET_ID_KEY = "wt_sheet_id";

// =========================
// HTTP helpers used by Sheets adapter
// =========================
async function getJSON(action: string, params: Record<string, string>) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);
  const sid = localStorage.getItem(SHEET_ID_KEY) || "";
  if (sid) url.searchParams.set("sheetId", sid);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { cache: "no-store" });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON. First 120: ${text.slice(0, 120)}`);
  }
}

async function postJSON<T extends Record<string, any>>(
  action: string,
  payload: any
): Promise<{ ok: boolean } & T> {
  const sid = localStorage.getItem(SHEET_ID_KEY) || "";
  const r = await fetch(API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sheetId: sid, payload }),
  });
  return r.json();
}

// =========================
/** Types */
// =========================
export type Exercise = {
  id: string;
  name: string;
  equipment: string;
  default_reps?: string;
  type: "strength" | "mobility" | "core" | "plyo" | "cardio";
  thumbnail_url?: string;
  yt_query?: string;
  description?: string;
};

export type PlanRow = {
  day_id: string;
  day_name: string;
  block_order: number;
  block_name: string;
  set_number: number;
  exercise_id: string;
  prescribed_reps?: string;
  tempo?: string;
  notes?: string;
};

export type StrengthLog = {
  date_iso: string;
  day_id: string;
  block_name: string;
  set_number: number;
  exercise_id: string;
  reps_done?: string;
  load?: string;
  notes?: string;
};

export type CardioPlanRow = {
  day_id?: string;
  date_iso?: string;
  activity: string;
  target_duration_min?: number;
  target_hr_zone?: string;
  target_rpe?: number;
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
// Adapter interface
// =========================
interface DataAdapter {
  listDays(): Promise<{ id: string; name: string }[]>;
  getPlanForDay(
    day_id: string
  ): Promise<{ plan: PlanRow[]; exercises: Record<string, Exercise> }>;
  saveStrengthLog(log: StrengthLog): Promise<{ ok: boolean }>;
  listCardio(
    dateRange?: { start_iso: string; end_iso: string }
  ): Promise<{ plan: CardioPlanRow[]; logs: CardioLog[] }>;
  saveCardioLog(log: CardioLog): Promise<{ ok: boolean }>;
  addExercise(ex: Exercise): Promise<{ ok: boolean; exercise_id: string }>;
  addPlanRow(row: PlanRow): Promise<{ ok: boolean }>;
}

// =========================
// Mock adapter (single source of truth)
// =========================
const MOCK_DB = (() => {
  const exercises: Record<string, Exercise> = {
    ex_glute_bridge: {
      id: "ex_glute_bridge",
      name: "Weighted Glute Bridge",
      equipment: "mat; dumbbells",
      default_reps: "8 to 10",
      type: "strength",
      thumbnail_url:
        "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?q=80&w=600&auto=format&fit=crop",
      yt_query: "weighted glute bridge form",
      description:
        "Supine, knees bent, drive through heels, squeeze glutes at top",
    },
    ex_banded_deadbug: {
      id: "ex_banded_deadbug",
      name: "Banded Dead Bug (overhead weight)",
      equipment: "mat; mini-band; dumbbell",
      default_reps: "6 each side",
      type: "core",
      thumbnail_url:
        "https://images.unsplash.com/photo-1554298062-9e6f67f99674?q=80&w=600&auto=format&fit=crop",
      yt_query: "banded dead bug exercise",
      description:
        "Brace, press band apart slightly, lower opposite arm and leg",
    },
  };

  const plan: PlanRow[] = [];
  for (let set = 1; set <= 3; set++) {
    plan.push({
      day_id: "Day 1",
      day_name: "Glutes + Core",
      block_order: 1,
      block_name: "Glute Strength Block",
      set_number: set,
      exercise_id: "ex_glute_bridge",
      prescribed_reps: "8 to 10",
    });
  }
  for (let set = 1; set <= 3; set++) {
    plan.push({
      day_id: "Day 1",
      day_name: "Glutes + Core",
      block_order: 2,
      block_name: "Core Block",
      set_number: set,
      exercise_id: "ex_banded_deadbug",
      prescribed_reps: "6 each side",
    });
  }

  const days = [
    { id: "Day 1", name: "Glutes + Core" },
    { id: "Day 2", name: "Upper Push" },
    { id: "Day 3", name: "Upper Pull" },
    { id: "Day 4", name: "Lower Body" },
  ];

  const strengthLogs: StrengthLog[] = [];
  const cardioPlan: CardioPlanRow[] = [
    {
      day_id: "Day 2",
      activity: "Zone 2 Ride",
      target_duration_min: 60,
      target_hr_zone: "Z2",
      notes: "Keep cadence smooth",
    },
  ];
  const cardioLogs: CardioLog[] = [];

  return { exercises, plan, days, strengthLogs, cardioPlan, cardioLogs };
})();

class MockAdapter implements DataAdapter {
  async listDays() {
    return MOCK_DB.days;
  }
  async getPlanForDay(day_id: string) {
    const plan = MOCK_DB.plan.filter(
      (p) => String(p.day_id) === String(day_id)
    );
    return { plan, exercises: MOCK_DB.exercises };
  }
  async listCardio() {
    return { plan: MOCK_DB.cardioPlan, logs: MOCK_DB.cardioLogs };
  }
  async saveStrengthLog(log: StrengthLog) {
    MOCK_DB.strengthLogs.push(log);
    return { ok: true };
  }
  async saveCardioLog(log: CardioLog) {
    MOCK_DB.cardioLogs.push(log);
    return { ok: true };
  }
  async addExercise(ex: Exercise) {
    MOCK_DB.exercises[ex.id] = ex;
    return { ok: true, exercise_id: ex.id };
  }
  async addPlanRow(row: PlanRow) {
    MOCK_DB.plan.push(row);
    return { ok: true };
  }
}

// =========================
/** Google Sheets adapter using Apps Script */
// =========================
class GoogleSheetsAdapter implements DataAdapter {
  async listDays() {
    const j = await getJSON("listDays", {});
    return (j.days as Array<{ day_id: string; day_name: string }>).map((d) => ({
      id: String(d.day_id),
      name: d.day_name,
    }));
  }

  async getPlanForDay(day_id: string) {
    const j = await getJSON("getPlanForDay", { day: day_id });
    return {
      plan: (j.plan || []) as PlanRow[],
      exercises: (j.exercises || {}) as Record<string, Exercise>,
    };
  }

  async listCardio(dateRange?: { start_iso: string; end_iso: string }) {
    const params: Record<string, string> = {};
    if (dateRange) {
      params.start_iso = dateRange.start_iso;
      params.end_iso = dateRange.end_iso;
    }
    const j = await getJSON("listCardio", params);
    return {
      plan: (j.plan || j.cardio || []) as CardioPlanRow[],
      logs: (j.logs || []) as CardioLog[],
    };
  }

  async saveStrengthLog(log: StrengthLog) {
    return await postJSON("saveStrengthLog", log);
  }
  async saveCardioLog(log: CardioLog) {
    return await postJSON("saveCardioLog", log);
  }
  async addExercise(ex: Exercise) {
    return await postJSON<{ exercise_id: string }>("addExercise", ex);
  }
  async addPlanRow(row: PlanRow) {
    return await postJSON("addPlanRow", row);
  }
}

// =========================
// UI bits
// =========================
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
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
  onSave: (d: { reps_done?: string; load?: string; notes?: string }) => void;
}) {
  const [reps, setReps] = useState("");
  const [load, setLoad] = useState("");
  const [notes, setNotes] = useState("");
  const ytQuery = exercise.yt_query || exercise.name + " exercise";
  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    ytQuery
  )}`;

  return (
    <div className="rounded-2xl border p-3 shadow-sm bg-white">
      <div className="flex gap-3">
        {exercise.thumbnail_url ? (
          <img
            src={exercise.thumbnail_url}
            alt={exercise.name}
            className="w-24 h-24 object-cover rounded-xl flex-shrink-0"
          />
        ) : (
          <div className="w-24 h-24 rounded-xl bg-gray-200 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate">
              <div className="text-base font-semibold">
                {exercise.name}{" "}
                <span className="text-xs font-normal text-gray-500">
                  Set {setNumber}
                </span>
              </div>
              <div className="text-sm text-gray-600">
                Equipment: {exercise.equipment || "bodyweight"}
              </div>
              <div className="text-sm text-gray-600">
                Prescribed:{" "}
                {prescribedReps || exercise.default_reps || "as assigned"}
              </div>
            </div>
            <a
              href={ytUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              YouTube lookup
            </a>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 max-[520px]:grid-cols-1">
            <input
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              placeholder="Reps or time"
              className="px-3 py-2 rounded-xl border w-full"
            />
            <input
              value={load}
              onChange={(e) => setLoad(e.target.value)}
              placeholder="Weight, band, hold"
              className="px-3 py-2 rounded-xl border w-full"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="px-3 py-2 rounded-xl border w-full"
            />
          </div>

          <div className="mt-3">
            <button
              onClick={() => onSave({ reps_done: reps, load, notes })}
              className="px-4 py-2 rounded-xl bg-black text-white shadow"
            >
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
  onSave: (
    exercise_id: string,
    set_number: number,
    data: { reps_done?: string; load?: string; notes?: string }
  ) => void;
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
  return <Section title={name}>{rows}</Section>;
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
    const group: Record<
      string,
      {
        order: number;
        sets: number;
        exercises: Set<string>;
        prescribed: Record<string, string | undefined>;
      }
    > = {};
    for (const row of plan) {
      const key = row.block_name;
      if (!group[key])
        group[key] = {
          order: row.block_order,
          sets: 0,
          exercises: new Set(),
          prescribed: {},
        };
      group[key].sets = Math.max(group[key].sets, row.set_number);
      group[key].exercises.add(row.exercise_id);
      if (row.prescribed_reps)
        group[key].prescribed[row.exercise_id] = row.prescribed_reps;
    }
    return Object.entries(group)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({
        name,
        setCount: v.sets,
        exercises: [...v.exercises].map((id) => exMap[id]).filter(Boolean),
        prescribed: v.prescribed,
      }));
  }, [plan, exMap]);

  function onSave(
    exercise_id: string,
    set_number: number,
    data: { reps_done?: string; load?: string; notes?: string }
  ) {
    const dayRow = plan.find((p) => p.exercise_id === exercise_id);
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
    setTimeout(() => setStatus(""), 1500);
  }

  // Simple AI add alternative exercise flow
  const [aiQuery, setAiQuery] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);

  async function addAlternativeExercise() {
    if (!selectedDay || !aiQuery.trim()) return;
    setAiBusy(true);
    try {
      const r = await fetch("/api/ai-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery }),
      });
      const ex: Exercise = await r.json();

      // 1) Save exercise
      const addRes = await adapter.addExercise(ex);
      // 2) Add to plan
      await adapter.addPlanRow({
        day_id: selectedDay,
        day_name: days.find((d) => d.id === selectedDay)?.name || selectedDay,
        block_order: 99,
        block_name: "Ad hoc alternatives",
        set_number: 1,
        exercise_id: addRes.exercise_id,
        prescribed_reps: ex.default_reps,
      });
      // 3) Reload
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
        <select
          value={selectedDay}
          onChange={(e) => setSelectedDay(e.target.value)}
          className="px-3 py-2 rounded-xl border"
        >
          <option value="">Select a day</option>
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} - {d.name}
            </option>
          ))}
        </select>
        {status && <div className="text-sm text-green-600">{status}</div>}
        <div className="ml-auto max-[520px]:ml-0 flex items-center gap-2">
          <input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder="Find an alternative exercise"
            className="px-3 py-2 rounded-xl border w-72 max-[520px]:w-full"
          />
          <button
            onClick={addAlternativeExercise}
            disabled={aiBusy}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow disabled:opacity-60"
          >
            {aiBusy ? "Adding..." : "Add via AI"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-4 rounded-xl border bg-white">Loading day...</div>
      )}

      {!loading &&
        blocks.map((b) => (
          <Block
            key={b.name}
            name={b.name}
            setCount={b.setCount}
            exercises={b.exercises}
            prescribedByExercise={b.prescribed}
            onSave={onSave}
          />
        ))}

      {!loading && !blocks.length && (
        <div className="p-4 rounded-xl border bg-white">
          No plan rows for this day yet.
        </div>
      )}
    </div>
  );
}

function CardioView({ adapter }: { adapter: DataAdapter }) {
  const [rows, setRows] = useState<CardioPlanRow[]>([]);
  const [logs, setLogs] = useState<CardioLog[]>([]);
  const [newLog, setNewLog] = useState<CardioLog>({
    date_iso: new Date().toISOString().slice(0, 10),
    activity: "Ride",
  });
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    adapter.listCardio().then(({ plan, logs }) => {
      setRows(plan);
      setLogs(logs);
    });
  }, [adapter]);

  async function save() {
    const res = await adapter.saveCardioLog(newLog);
    if (res.ok) {
      setStatus("Saved");
      const { plan, logs } = await adapter.listCardio();
      setRows(plan);
      setLogs(logs);
      setTimeout(() => setStatus(""), 1500);
    }
  }

  return (
    <div className="grid gap-6">
      <Section title="New cardio log">
        <div className="grid grid-cols-6 gap-2 max-[920px]:grid-cols-2">
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.date_iso}
            onChange={(e) => setNewLog({ ...newLog, date_iso: e.target.value })}
            type="date"
          />
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.activity}
            onChange={(e) => setNewLog({ ...newLog, activity: e.target.value })}
            placeholder="Activity"
          />
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.duration_min ?? ""}
            onChange={(e) =>
              setNewLog({
                ...newLog,
                duration_min: Number(e.target.value) || undefined,
              })
            }
            placeholder="Duration min"
          />
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.distance_km ?? ""}
            onChange={(e) =>
              setNewLog({
                ...newLog,
                distance_km: Number(e.target.value) || undefined,
              })
            }
            placeholder="Distance km"
          />
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.avg_hr ?? ""}
            onChange={(e) =>
              setNewLog({
                ...newLog,
                avg_hr: Number(e.target.value) || undefined,
              })
            }
            placeholder="Avg HR"
          />
          <input
            className="px-3 py-2 rounded-xl border"
            value={newLog.rpe ?? ""}
            onChange={(e) =>
              setNewLog({
                ...newLog,
                rpe: Number(e.target.value) || undefined,
              })
            }
            placeholder="RPE"
          />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={save}
            className="px-4 py-2 rounded-xl bg-black text-white shadow"
          >
            Save cardio log
          </button>
          {status && <div className="text-sm text-green-600">{status}</div>}
        </div>
      </Section>

      <Section title="Cardio plan (upcoming)">
        <div className="grid gap-2">
          {rows.length === 0 && (
            <div className="p-3 rounded-xl border">No plan rows yet.</div>
          )}
          {rows.map((r, i) => (
            <div key={i} className="p-3 rounded-xl border bg-white text-sm">
              <div className="font-medium">
                {r.date_iso || r.day_id || "Unscheduled"} — {r.activity}
              </div>
              <div className="text-gray-600">
                Target:{" "}
                {r.target_duration_min ? `${r.target_duration_min} min` : "n/a"}{" "}
                {r.target_hr_zone ? `| HR ${r.target_hr_zone}` : ""}{" "}
                {r.target_rpe ? `| RPE ${r.target_rpe}` : ""}
              </div>
              {r.notes && <div className="text-gray-600">{r.notes}</div>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cardio logs (recent)">
        <div className="grid gap-2">
          {logs.length === 0 && (
            <div className="p-3 rounded-xl border">No logs yet.</div>
          )}
          {logs
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={i} className="p-3 rounded-xl border bg-white text-sm">
                <div className="font-medium">
                  {l.date_iso} — {l.activity}
                </div>
                <div className="text-gray-600">
                  {l.duration_min ? `${l.duration_min} min` : ""}{" "}
                  {l.distance_km ? `| ${l.distance_km} km` : ""}{" "}
                  {typeof l.avg_hr === "number" ? `| ${l.avg_hr} bpm` : ""}{" "}
                  {typeof l.rpe === "number" ? `| RPE ${l.rpe}` : ""}{" "}
                  {typeof l.tss === "number" ? `| TSS ${l.tss}` : ""}
                </div>
                {l.notes && <div className="text-gray-600">{l.notes}</div>}
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

function Tabs({
  value,
  onChange,
}: {
  value: TabName;
  onChange: React.Dispatch<React.SetStateAction<TabName>>;
}) {
  const items: { label: string; value: TabName }[] = [
    { label: "Daily Workout", value: "daily" },
    { label: "Cardio", value: "cardio" },
    { label: "Settings", value: "settings" },
  ];
  return (
    <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl w-full max-w-full">
      {items.map((t) => (
        <button
          key={t.value}
          className={`px-4 py-2 rounded-2xl ${
            value === t.value ? "bg-white shadow" : "opacity-70"
          }`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SettingsView({
  adapterName,
  setAdapterName,
  setSid,
}: {
  adapterName: AdapterName;
  setAdapterName: React.Dispatch<React.SetStateAction<AdapterName>>;
  setSid: React.Dispatch<React.SetStateAction<string>>;
}) {
  const [sheetIdInput, setSheetIdInput] = useState<string>(
    localStorage.getItem(SHEET_ID_KEY) || ""
  );

  function useTypedSheet() {
    const id = sheetIdInput.trim();
    if (!id) {
      alert("Paste a Google Sheet ID first");
      return;
    }
    localStorage.setItem(SHEET_ID_KEY, id);
    setSid(id);
    setAdapterName("sheets");
  }

  async function createBackend() {
    const w = window.open(
      `${PROVISION_URL}?action=provisionPopup`,
      "_blank",
      "popup,width=520,height=640"
    );
    if (!w) {
      alert("Popup blocked");
      return;
    }
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as any;
      if (d && d.type === "wt/provisioned" && d.sheetId) {
        localStorage.setItem(SHEET_ID_KEY, d.sheetId);
        setSid(d.sheetId);
        setSheetIdInput(d.sheetId);
        setAdapterName("sheets");
        try {
          w.close();
        } catch {}
      }
    };
    window.addEventListener("message", onMsg, { once: true });
  }

  return (
    <div className="space-y-4">
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

      <button className="px-3 py-2 rounded-xl border" onClick={createBackend}>
        Create backend in my Google Drive
      </button>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Existing Sheet ID</label>
        <div className="flex items-center gap-2">
          <input
            placeholder="Paste existing Google Sheet ID"
            className="px-3 py-2 rounded-xl border w-full"
            value={sheetIdInput}
            onChange={(e) => setSheetIdInput(e.target.value)}
            onBlur={() => localStorage.setItem(SHEET_ID_KEY, sheetIdInput.trim())}
          />
          <button className="px-3 py-2 rounded-xl border" onClick={useTypedSheet}>
            Use this Sheet
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================
// App
// =========================
export default function App() {
  const [sid, setSid] = useState<string>(
    () => localStorage.getItem(SHEET_ID_KEY) || ""
  );
  const [tab, setTab] = useState<TabName>("daily");
  const [adapterName, setAdapterName] = useState<AdapterName>(
    sid ? "sheets" : "mock"
  );

  const adapter = useMemo<DataAdapter>(() => {
    return adapterName === "sheets"
      ? new GoogleSheetsAdapter()
      : new MockAdapter();
  }, [adapterName, sid]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workout Tracker</h1>
            <p className="text-sm text-gray-600">
              Strength and cardio in one place
            </p>
          </div>
          <Tabs value={tab} onChange={setTab} />
        </header>

        {tab === "daily" && <DayWorkoutView adapter={adapter} />}
        {tab === "cardio" && <CardioView adapter={adapter} />}
        {tab === "settings" && (
          <SettingsView
            adapterName={adapterName}
            setAdapterName={setAdapterName}
            setSid={setSid}
          />
        )}

        <footer className="mt-10 text-xs text-gray-500">
          <p>
            Pro tip: every exercise row is a separate set. Use the AI button to
            inject alternates fast.
          </p>
        </footer>
      </div>
    </div>
  );
}

/*
Google Sheets schema (each has a header row)

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
*/
