"use strict";

// The entire prototype runs locally. No server or external libraries are needed.
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEALS = ["Breakfast", "Lunch", "Dinner"];
const LABELS = { dashboard: "Overview", exams: "Exam planner", schedule: "Daily plan", meals: "Meal tracker", hydration: "Hydration", sleep: "Sleep tracker", focus: "Focus timer", progress: "Weekly progress", settings: "Settings" };
const STORAGE_KEY = "examease-p13-v3";
const $ = id => document.getElementById(id);
const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
let storageAvailable = true;

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { storageAvailable = false; return null; }
}

function emptyDay() {
  return { meals: { Breakfast: null, Lunch: null, Dinner: null }, water: null, sleep: null, legacySkipped: false, mood: null, focus: 0 };
}

function dateKey(date = new Date()) { return [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-"); }
function parseDate(key) { return new Date(key + "T12:00:00"); }
function addDays(key, count) { const d = parseDate(key); d.setDate(d.getDate()+count); return dateKey(d); }
function monday(key) { return addDays(key, -(parseDate(key).getDay()+6)%7); }
function shortDate(key) { return parseDate(key).toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
function dateFor(day) { return addDays(weekStart, DAYS.indexOf(day)); }
function selectedDate() { return dateFor(selectedDay); }
function selectDate(key) { weekStart = monday(key); selectedDay = DAYS[(parseDate(key).getDay()+6)%7]; }
function blankState() { return { records:{}, goal:8, demo:false, exams:[], plans:{}, profile:{name:"",year:"",type:"", commute:0, wake:"07:00",bed:"23:00", breakfast:"08:00", lunch:"13:00",dinner:"19:00",reminders:true} }; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function daysUntil(key) { return Math.round((Date.UTC(...key.split("-").map((v,i)=>Number(v)-(i===1?1:0)))-Date.UTC(...dateKey().split("-").map((v,i)=>Number(v)-(i===1?1:0))))/86400000); }

function getInitialState() {
  const base = blankState();
  const saved = readStorage(STORAGE_KEY);
  if (saved && saved.records && Number.isInteger(saved.goal) && saved.goal >= 1 && saved.goal <= 24) return {...base,...saved,profile:{...base.profile,...saved.profile},demo:false};
  const records = {};
  const previous = readStorage("examease-p13-v2");
  if (previous && previous.records && !previous.demo) {
    DAYS.forEach((day,i)=>{if(previous.records[day]) records[addDays(monday(dateKey()),i)]={...emptyDay(),...previous.records[day]};});
    return {...base, records, goal: previous.goal || 8};
  }
  // Import recognizable entries from the original CP7 prototype when available.
  const old = readStorage("examease-p13-v1");
  if (old) DAYS.forEach(day => {
    const entry = old[day];
    if (!entry) return;
    const record = emptyDay();
    if (MEALS.includes(entry.meal)) record.meals[entry.meal] = "eaten";
    // A skipped meal in the old version had no meal name; retain it separately.
    if (entry.meal === "Skipped meal") record.legacySkipped = true;
    if (Number.isInteger(entry.water) && entry.water >= 0) record.water = entry.water;
    if (entry.sleep && validTime(entry.sleep.bed) && validTime(entry.sleep.wake) && entry.sleep.bed !== entry.sleep.wake) record.sleep = sleepRecord(entry.sleep.bed, entry.sleep.wake);
    records[addDays(monday(dateKey()),DAYS.indexOf(day))] = record;
  });
  return {...base, records};
}

let state = getInitialState();
let personalState = null;
let weekStart = monday(dateKey());
let selectedDay = DAYS[(new Date().getDay()+6)%7];
let currentView = "dashboard";
let toastTimer;
let editExam = null, editTask = null;
let timer = {seconds:25*60, remaining:25*60, end:null, date:null, mode:"study"};

function getDay(day = selectedDay) {
  return {...emptyDay(), ...state.records[dateFor(day)]};
}

function writeDay(patch) {
  state.records[selectedDate()] = { ...getDay(), ...patch };
  persist();
}

function persist() {
  if (state.demo) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { storageAvailable = false; }
  updateStorageIndicator();
}

function updateStorageIndicator() {
  if (!storageAvailable) document.querySelector(".offline").innerHTML = '<span class="status-dot" style="background:#c98b34"></span> Session only';
}

function notify(message) {
  const toast = $("toast");
  toast.textContent = message + (storageAvailable ? "" : " (Storage unavailable; session only.)");
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function validTime(value) {
  return typeof value === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function sleepRecord(bed, wake) {
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return { bed, wake, duration: (minutes(wake) - minutes(bed) + 1440) % 1440 };
}

function durationText(minutes) {
  if (!Number.isFinite(minutes)) return "Not recorded";
  return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
}

function mealStats(record) {
  const statuses = MEALS.map(meal => record.meals[meal]);
  return { eaten: statuses.filter(s => s === "eaten").length, skipped: statuses.filter(s => s === "skipped").length, logged: statuses.filter(s => s === "eaten" || s === "skipped").length };
}

function routines(record) {
  return [mealStats(record).logged > 0 || record.legacySkipped, record.water !== null, record.sleep !== null];
}

function weekStats() {
  const records = DAYS.map(day => getDay(day));
  const meals = records.reduce((n, record) => n + mealStats(record).eaten, 0);
  const loggedMeals = records.reduce((n, record) => n + mealStats(record).logged, 0);
  const waters = records.filter(record => record.water !== null);
  const sleeps = records.filter(record => record.sleep !== null);
  return { meals, loggedMeals, waterDays: waters.length, sleepDays: sleeps.length,
    waterTotal: waters.reduce((n, record) => n + record.water, 0),
    sleepAvg: sleeps.length ? Math.round(sleeps.reduce((n, record) => n + record.sleep.duration, 0) / sleeps.length) : null,
    checkedDays: records.filter(record => routines(record).every(Boolean)).length };
}

function meter(value, color = "var(--accent)") {
  return '<div class="meter" aria-hidden="true"><span style="--value:' + Math.max(0, Math.min(100, value)) + '%;--meter:' + color + '"></span></div>';
}
function pill(done, text) { return '<span class="pill' + (done ? ' done' : '') + '">' + text + '</span>'; }
function pageHeading(title, subtitle, label = selectedDay + " · " + shortDate(selectedDate())) {
  return '<div class="page-heading"><div><span class="label">' + label + '</span><h1>' + title + '</h1><p>' + subtitle + '</p></div></div>';
}
function featureIcon(name, color) { return '<span class="feature-icon ' + color + '">' + icon(name) + '</span>'; }
function navButton(label, view, variant = "secondary") { return '<button class="button ' + variant + '" data-nav="' + view + '">' + label + '</button>'; }
function renderDays() {
  $("weekTitle").textContent = weekStart === monday(dateKey()) ? "This week" : "Selected week";
  $("weekRange").textContent = shortDate(weekStart) + " – " + shortDate(addDays(weekStart,6));
  $("dayPicker").innerHTML = DAYS.map(day => {
    const dots = routines(getDay(day)).map(done => '<i class="' + (done ? "logged" : "") + '"></i>').join("");
    return '<button class="day-btn' + (selectedDay === day ? ' active' : '') + '" data-day="' + day + '" aria-label="' + day + ' ' + shortDate(dateFor(day)) + '" aria-pressed="' + (selectedDay === day) + '"><strong>' + day.slice(0, 3) + '</strong><span class="date-num">'+parseDate(dateFor(day)).getDate()+'</span><span class="mini-dots" aria-hidden="true">' + dots + '</span></button>';
  }).join("");
}

function renderDashboard() {
  const record = getDay(), meals = mealStats(record), checked = routines(record).filter(Boolean).length;
  const mealComplete = meals.logged === 3;
  const waterValue = record.water === null ? "—" : record.water;
  const sleepValue = record.sleep === null ? "—" : durationText(record.sleep.duration);
  const waterPct = (record.water || 0) / state.goal * 100;
  const tasks = [["Review your meals", meals.logged > 0, meals.logged + "/3 logged", "meals"],
    ["Record water intake", record.water !== null, record.water === null ? "Not recorded" : record.water + " glasses", "hydration"],
    ["Log last night's sleep", record.sleep !== null, record.sleep === null ? "Not recorded" : sleepValue, "sleep"]];
  return pageHeading(state.profile.name ? "Hello, " + esc(state.profile.name) : "Your routine dashboard", "A little planning can make a busy exam week feel more manageable.") +
    '<article class="hero"><div><span class="eyebrow">YOUR DAILY CHECK-IN</span><h2>' + (checked === 3 ? "Check-in recorded!" : "Make room for yourself.") + '</h2><p>' + (checked === 3 ? "All three routine categories have an entry. You can come back and update any details." : "Take a moment to log what you ate, how much water you drank and when you slept. Start wherever you like.") + '</p></div><div class="ring" style="--pct:' + checked / 3 * 100 + '%"><div class="ring-inner"><b>' + checked + '/3</b><small>routines logged</small></div></div></article>' +
    dashboardPlan() + '<div class="section-head"><h2>Daily routines</h2><small>' + selectedDay + '</small></div><div class="cards">' +
    '<article class="card"><div class="card-top">' + featureIcon("meal", "meal") + pill(mealComplete, mealComplete ? "All logged" : "Meal log") + '</div><span class="card-title">Meals eaten</span><div class="stat">' + meals.eaten + '<small> / 3</small></div><p class="caption">' + meals.logged + ' of 3 meal statuses recorded</p>' + meter(meals.logged / 3 * 100, "var(--meal)") + navButton("Manage meals", "meals") + '</article>' +
    '<article class="card"><div class="card-top">' + featureIcon("water", "water") + pill(record.water !== null, record.water === null ? "Not recorded" : "Recorded") + '</div><span class="card-title">Water intake</span><div class="stat">' + waterValue + '<small> / ' + state.goal + '</small></div><p class="caption">Glasses · personal target</p>' + meter(waterPct, "var(--water)") + '<div class="quick-row"><button class="button primary" data-action="quick-water">+ 1 glass</button>' + navButton("Edit", "hydration") + '</div></article>' +
    '<article class="card"><div class="card-top">' + featureIcon("moon", "sleep") + pill(record.sleep !== null, record.sleep === null ? "Not recorded" : "Recorded") + '</div><span class="card-title">Sleep duration</span><div class="stat">' + sleepValue + '</div><p class="caption">' + (record.sleep ? record.sleep.bed + " – " + record.sleep.wake : "Log your bedtime and wake time") + '</p>' + meter(record.sleep ? 100 : 0, "var(--sleep)") + navButton("Log sleep", "sleep") + '</article></div>' +
    '<div class="two-col"><article class="card"><div class="card-top"><h3>Quick meal check-in</h3>' + pill(mealComplete, meals.logged + "/3 recorded") + '</div><div class="quick-meals">' + MEALS.map(meal=>'<button class="choice '+(record.meals[meal]==="eaten"?"selected eaten":"")+'" data-meal="'+meal+'" data-status="'+(record.meals[meal]==="eaten"?"unknown":"eaten")+'" aria-pressed="'+(record.meals[meal]==="eaten")+'">'+meal+'<small>'+({eaten:"Eaten",skipped:"Skipped"}[record.meals[meal]]||"Mark eaten")+'</small></button>').join("")+'</div><p class="subtext">Tap to mark eaten; use the meal tracker for skipped meals.</p>'+navButton("Manage meals","meals")+'</article>'+moodCard(record)+'</div>' +
    '<div class="two-col"><article class="card"><div class="card-top"><h3>Daily checklist</h3>' + pill(checked === 3, checked + "/3 recorded") + '</div><ul class="check-list">' + tasks.map(([label, done, detail, view]) => '<li><span class="check-circle' + (done ? " done" : "") + '">' + icon("check") + '</span><span>' + label + '<br><small>' + detail + '</small></span><button class="text-button" data-nav="' + view + '">Edit</button></li>').join("") + '</ul></article><article class="card tip">' + featureIcon("spark", "") + '<h3>Keep the week in view</h3><p>Every day is different. Review your entries and correct anything you missed, without comparing yourself to anyone else.</p>' + navButton("View weekly progress", "progress", "primary") + '</article></div>';
}

function renderMeals() {
  const r = getDay(), stats = mealStats(r);
  return pageHeading("Meal tracker", "Record each meal separately, even if you missed it.") +
    '<div class="tracker-layout"><article class="card"><h2>Your meals</h2><p class="subtext">Choose a status for each meal. Changes save automatically.</p>' +
    MEALS.map(meal => '<div class="meal-row"><div><strong>' + meal + '</strong><small>' + (r.meals[meal] === "eaten" ? "Eaten" : r.meals[meal] === "skipped" ? "Skipped" : "Not recorded") + '</small></div><div class="meal-status" role="group" aria-label="' + meal + ' status">' +
      [["eaten", "Eaten"], ["skipped", "Skipped"], ["unknown", "Not recorded"]].map(([value, label]) => {
        const active = (r.meals[meal] || "unknown") === value;
        return '<button class="choice ' + value + (active ? " selected" : "") + '" data-meal="' + meal + '" data-status="' + value + '" aria-pressed="' + active + '">' + label + '</button>';
      }).join("") + '</div></div>').join("") +
    (r.legacySkipped ? '<p class="subtext">Earlier prototype: one unspecified meal was marked skipped.</p><button class="button secondary" data-action="clear-legacy">Remove old entry</button>' : "") +
    '<div class="actions">' + navButton("Back to overview", "dashboard", "primary") + '</div></article><aside class="card">' + featureIcon("meal", "meal") + '<div class="stat">' + stats.eaten + ' / 3</div><p class="caption">Meals marked eaten</p>' + meter(stats.logged / 3 * 100, "var(--meal)") + '<ul class="check-list"><li>' + stats.logged + ' recorded</li><li>' + stats.skipped + ' skipped</li><li>' + (3 - stats.logged) + ' not recorded</li></ul><p class="subtext">Not recorded means you do not know or have not entered the information. It does not mean you skipped the meal.</p></aside></div>';
}

function glassDisplay(value) {
  const max = Math.min(state.goal, 24);
  return Array.from({ length: max }, (_, i) => '<span class="glass' + (i < value ? " filled" : "") + '"></span>').join("");
}

function renderHydration() {
  const r = getDay();
  return pageHeading("Hydration tracker", "Log your full glasses of water for the day.") +
    '<div class="tracker-layout"><article class="card"><div class="card-top"><h2>Water check-in</h2>' + featureIcon("water", "water") + '</div><div class="big-value" id="waterDisplay">' + (r.water === null ? "—" : r.water) + ' <small>/ ' + state.goal + ' glasses</small></div><p class="subtext">Your personal target can be changed whenever you like.</p><div class="glass-grid" id="glassGrid" aria-hidden="true">' + glassDisplay(r.water || 0) + '</div><div id="waterMeter">' + meter((r.water || 0) / state.goal * 100, "var(--water)") + '</div>' +
    '<form id="waterForm" novalidate><div class="water-controls"><button type="button" class="icon-button" data-action="water-minus" aria-label="Subtract one glass">' + icon("minus") + '</button><div class="field"><label for="waterInput">Glasses of water</label><input id="waterInput" type="number" min="0" step="1" placeholder="e.g. 5" value="' + (r.water ?? "") + '"></div><button type="button" class="icon-button" data-action="water-plus" aria-label="Add one glass">' + icon("plus") + '</button></div><p class="error" id="waterError" role="alert"></p><div class="actions"><button type="submit" class="button primary">Save entry</button><button type="button" class="button secondary" data-action="clear-water">Leave unrecorded</button></div></form></article>' +
    '<aside class="card"><h2>Personal target</h2><p class="subtext">Set any whole-number target that suits your own routine. This is a tracking preference, not medical advice.</p><form id="goalForm" novalidate><div class="field"><label for="goalInput">Daily target (glasses)</label><input id="goalInput" type="number" min="1" max="24" step="1" value="' + state.goal + '"></div><p class="error" id="goalError" role="alert"></p><button type="submit" class="button secondary">Save target</button></form></aside></div>';
}

function renderSleep() {
  const r = getDay(), sleep = r.sleep;
  return pageHeading("Sleep tracker", "Record the sleep that ended on " + selectedDay + ".") +
    '<div class="tracker-layout"><article class="card"><div class="card-top"><h2>Last night’s sleep</h2>' + featureIcon("moon", "sleep") + '</div><p class="subtext">Enter the time you went to bed and when you woke up. Overnight sleep is calculated automatically.</p><form id="sleepForm" novalidate><div class="field-grid"><div class="field"><label for="bedInput">Bedtime</label><input id="bedInput" type="time" value="' + (sleep ? sleep.bed : "") + '"></div><div class="field"><label for="wakeInput">Wake-up time</label><input id="wakeInput" type="time" value="' + (sleep ? sleep.wake : "") + '"></div></div><div class="sleep-preview">' + icon("moon") + '<strong id="sleepDuration">' + (sleep ? durationText(sleep.duration) : "—") + '</strong><span class="subtext">Calculated sleep duration</span></div><p class="error" id="sleepError" role="alert"></p><div class="actions"><button type="submit" class="button primary">Save entry</button><button type="button" class="button secondary" data-action="clear-sleep">Leave unrecorded</button></div></form></article><aside class="card tip">' + featureIcon("clock", "") + '<h3>One sleep record per day</h3><p>For example, if you slept from 11 pm to 7 am, enter 23:00 and 07:00. The entry is saved under the morning you woke up. This log records duration, not sleep quality.</p></aside></div>';
}

const MOODS = ["Stressed", "Low", "Okay", "Good", "Great"];
const MOOD_ICONS = ["😣","😟","😐","🙂","😄"];
const PRIORITIES = ["High","Medium","Low"];
const CATEGORIES = ["Study","Meal","Water break","Rest","Commute","Other"];
function optionList(values, selected) {
  return values.map(v=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v||"Not specified")+'</option>').join("");
}
function plansFor(key = selectedDate()) { return state.plans[key] || []; }
function sortedExams() { return [...state.exams].sort((a,b)=>a.date.localeCompare(b.date)||PRIORITIES.indexOf(a.priority)-PRIORITIES.indexOf(b.priority)); }
function upcomingExams() { return sortedExams().filter(e=>daysUntil(e.date)>=0); }
function examWhen(e) { const d=daysUntil(e.date); return d===0?"Today":d===1?"Tomorrow":d>1?d+" days left":"Past exam"; }
function moodCard(r) {
  return '<article class="card"><div class="card-top"><h3>How are you feeling?</h3>' + (r.mood!==null?pill(true,"Recorded"):"") + '</div><p class="subtext">A private, optional self-check-in.</p><div class="mood-row">'+MOODS.map((m,i)=>'<button class="mood-btn'+(r.mood===i?' selected':'')+'" data-mood="'+i+'" aria-pressed="'+(r.mood===i)+'"><span>'+MOOD_ICONS[i]+'</span><small>'+m+'</small></button>').join("")+'</div><button class="text-button" data-action="clear-mood">Leave unrecorded</button></article>';
}
function reminders() {
  if (!state.profile.reminders || selectedDate()!==dateKey()) return [];
  const clock = new Date(), now = String(clock.getHours()).padStart(2,"0")+":"+String(clock.getMinutes()).padStart(2,"0");
  const r=getDay(), p=state.profile, items=[];
  for (const meal of MEALS) if(!r.meals[meal] && now>=p[meal.toLowerCase()]) items.push("Check in on "+meal.toLowerCase()+".");
  if(now>="10:00" && r.water===null) items.push("Log your water intake when convenient.");
  if(now>=p.bed) items.push("Your planned wind-down time has arrived.");
  const due=plansFor().filter(t=>!t.done && t.time<=now);
  if(due.length) items.push(due.length+" planned "+(due.length===1?"activity is":"activities are")+" still open. Adjust the plan if needed.");
  return items;
}
function reminderMarkup(){
  const prompts=reminders();
  return prompts.length?'<article class="card reminder-card"><h3>Gentle reminders</h3><ul>'+prompts.map(p=>'<li>'+esc(p)+'</li>').join("")+'</ul><small>In-app reminders only · adjust in Settings</small></article>':"";
}
function dashboardPlan() {
  const next=upcomingExams()[0], tasks=plansFor(), done=tasks.filter(t=>t.done).length;
  return '<div class="two-col planning-overview"><article class="card"><div class="card-top">'+featureIcon("book","")+'<span class="pill">Next exam</span></div>'+(next?'<h2>'+esc(next.subject)+'</h2><p class="caption">'+shortDate(next.date)+' · '+examWhen(next)+' · '+esc(next.priority)+' priority</p>'+meter(next.progress)+'<p class="caption">'+next.progress+'% revision complete</p>':'<h2>No upcoming exams</h2><p class="subtext">Add exam dates and revision priorities.</p>')+navButton("Exam planner","exams")+'</article><article class="card"><div class="card-top">'+featureIcon("list","")+'<span class="pill">'+done+'/'+tasks.length+' done</span></div><h2>Daily plan</h2><p class="caption">'+(tasks.length?esc((tasks.find(t=>!t.done)||tasks[0]).title):"Make space for study, meals and rest.")+'</p>'+meter(tasks.length?done/tasks.length*100:0)+navButton("Open daily plan","schedule")+'</article></div>'+
  '<div id="reminderSlot">'+reminderMarkup()+'</div>'+
  (getDay().meals && Object.values(getDay().meals).includes("skipped")?'<div class="recovery-banner"><strong>A missed meal does not mean a failed day.</strong><span>Adjust your remaining plan to make room for your next meal or break.</span>'+navButton("Adjust my plan","schedule")+'</div>':'');
}
function renderExams() {
  const e=state.exams.find(x=>x.id===editExam);
  return pageHeading("Exam planner","Keep track of exam dates, revision priorities and progress.")+
    '<div class="planner-grid"><article class="card"><h2>'+ (e?"Edit exam":"Add an exam")+'</h2><form id="examForm" class="stack-form"><div class="field"><label for="examSubject">Subject</label><input id="examSubject" required maxlength="70" placeholder="e.g. Mathematics" value="'+esc(e?.subject)+'"></div><div class="field"><label for="examDate">Exam date</label><input type="date" id="examDate" required value="'+esc(e?.date||selectedDate())+'"></div><div class="field"><label for="examPriority">Priority</label><select id="examPriority">'+optionList(PRIORITIES,e?.priority||"Medium")+'</select></div><div class="field"><label for="examProgress">Revision complete (%)</label><input type="number" min="0" max="100" step="1" id="examProgress" required value="'+(e?.progress??0)+'"></div><button class="button primary" type="submit">'+(e?"Save changes":"Add exam")+'</button>'+(e?'<button type="button" data-action="cancel-exam" class="button secondary">Cancel edit</button>':'')+'</form></article><article class="card"><div class="card-top"><h2>Your exams</h2>'+pill(false,state.exams.length+" planned")+'</div>'+(!state.exams.length?'<div class="empty-state">No exams yet. Add your first subject and date.</div>':sortedExams().map(item=>'<div class="exam-entry"><div class="card-top"><div><strong>'+esc(item.subject)+'</strong><p class="caption">'+shortDate(item.date)+' '+parseDate(item.date).getFullYear()+' · '+esc(item.priority)+' priority</p></div><span class="pill">'+examWhen(item)+'</span></div>'+meter(item.progress)+'<div class="exam-meta"><small>'+item.progress+'% revised</small><div><button class="text-button" data-edit-exam="'+item.id+'">Edit</button><button class="text-button danger" data-delete-exam="'+item.id+'">Remove</button></div></div></div>').join(""))+'</article></div>';
}
function renderSchedule() {
  const tasks=[...plansFor()].sort((a,b)=>a.time.localeCompare(b.time));
  const t=tasks.find(x=>x.id===editTask);
  const remaining=tasks.filter(x=>!x.done && x.category==="Study").length;
  return pageHeading("Daily plan","Create a flexible plan around your exams, classes, meals and rest.")+
    '<div class="planner-grid"><article class="card"><h2>'+ (t?"Edit activity":"Add an activity")+'</h2><form id="taskForm" class="stack-form"><div class="field"><label for="taskTitle">Activity</label><input id="taskTitle" required maxlength="90" placeholder="e.g. Python revision" value="'+esc(t?.title)+'"></div><div class="field"><label for="taskTime">Start time</label><input id="taskTime" type="time" required value="'+esc(t?.time||"09:00")+'"></div><div class="field"><label for="taskCategory">Type</label><select id="taskCategory">'+optionList(CATEGORIES,t?.category||"Study")+'</select></div><div class="field"><label for="taskDuration">Duration (minutes)</label><input type="number" id="taskDuration" min="5" max="720" step="1" required value="'+(t?.duration||30)+'"></div><button type="submit" class="button primary">'+(t?"Save changes":"Add activity")+'</button>'+(t?'<button type="button" class="button secondary" data-action="cancel-task">Cancel edit</button>':'')+'</form><hr><button class="button secondary" data-action="suggest-plan">Add starter routine</button><p class="subtext">Adds editable meal, rest and commute blocks from Settings; your existing activities stay.</p></article><article class="card"><div class="card-top"><h2>'+selectedDay+"’s schedule"+'</h2>'+pill(false,tasks.filter(x=>x.done).length+"/"+tasks.length+" done")+'</div>'+(!tasks.length?'<div class="empty-state">No activities planned. Start with a routine or add activities yourself.</div>':tasks.map(x=>'<div class="task-entry'+(x.done?' task-done':'')+'"><button class="task-toggle" data-toggle-task="'+x.id+'" aria-label="'+(x.done?"Mark incomplete: ":"Complete: ")+esc(x.title)+'" aria-pressed="'+x.done+'">'+icon("check")+'</button><div class="task-details"><strong>'+esc(x.title)+'</strong><small>'+esc(x.time)+' · '+x.duration+' min · '+esc(x.category)+'</small></div><div class="task-buttons"><button class="text-button" data-edit-task="'+x.id+'">Edit</button><button class="text-button danger" data-delete-task="'+x.id+'">Remove</button></div></div>').join(""))+
    '<div class="recovery-box"><h3>Plans changed?</h3><p class="subtext">Move unfinished study activities to tomorrow without changing meals, breaks or completed tasks. You can edit times afterward.</p><button class="button secondary" data-action="move-tasks" '+(remaining?"":"disabled")+'>Move '+remaining+' unfinished study '+(remaining===1?"task":"tasks")+'</button></div></article></div>';
}
function renderSettings() {
  const p=state.profile;
  return pageHeading("Settings","Personalize your routines. All information stays in this browser.")+
  '<div class="tracker-layout"><article class="card"><h2>Student profile</h2><form id="profileForm" class="stack-form"><div class="field"><label for="profileName">First name (optional)</label><input id="profileName" maxlength="40" value="'+esc(p.name)+'" placeholder="Your name"></div><div class="field-grid"><div class="field"><label for="profileYear">Year of study</label><select id="profileYear">'+optionList(["","1st year","2nd year","3rd year","4th year","Other"],p.year)+'</select></div><div class="field"><label for="profileType">Living arrangement</label><select id="profileType">'+optionList(["","Hosteller","Day scholar","Other"],p.type)+'</select></div></div><div class="field"><label for="profileCommute">One-way commute (minutes)</label><input type="number" id="profileCommute" min="0" max="300" value="'+p.commute+'"></div><div class="field-grid">'+[["wake","Wake-up time"],["bed","Bedtime"],["breakfast","Breakfast"],["lunch","Lunch"],["dinner","Dinner"]].map(([key,label])=>'<div class="field"><label for="profile-'+key+'">'+label+'</label><input type="time" id="profile-'+key+'" required value="'+esc(p[key])+'"></div>').join("")+'</div><label class="check-label"><input type="checkbox" id="profileReminders" '+(p.reminders?"checked":"")+'> Show gentle in-app reminders</label><button class="button primary" type="submit">Save preferences</button></form></article><aside class="card"><h2>How your settings are used</h2><p class="subtext">The starter routine uses your preferred times. A commute block is included for day scholars. Reminders appear in the dashboard while the website is open; they are not background notifications.</p><hr><h3>Data & privacy</h3><p class="subtext">No accounts, server, or tracking. Your browser keeps the records. Export a weekly summary before clearing browser data.</p>'+navButton("Weekly progress","progress")+'</aside></div>';
}
function renderFocus() {
  const r=getDay();
  return pageHeading("Focus timer","Make time for revision and short breaks.")+
    '<div class="tracker-layout"><article class="card focus-card"><div class="focus-modes"><button class="choice '+(timer.mode==="study"?"selected":"")+'" data-timer-mode="study">Study</button><button class="choice '+(timer.mode==="break"?"selected":"")+'" data-timer-mode="break">Break</button></div><div class="timer-face" id="timerFace"><small>'+ (timer.mode==="study"?"FOCUS SESSION":"BREAK SESSION")+'</small><strong id="timerDisplay">'+timerText()+'</strong><span id="timerStatus">'+(timer.end?"Running":"Ready / paused")+'</span></div><div class="field"><label for="timerLength">Session length (minutes)</label><input type="number" id="timerLength" min="1" max="120" value="'+timer.seconds/60+'" '+(timer.end?"disabled":"")+'></div><div class="actions"><button class="button primary" data-action="timer-toggle">'+(timer.end?"Pause":"Start")+'</button><button class="button secondary" data-action="timer-reset">Reset</button></div><p class="subtext">Keep this tab open. Completed study timers are added to your daily record; breaks are not counted.</p></article><aside class="card"><h2>Study time logged</h2><div class="stat">'+(r.focus||0)+' <small>minutes</small></div><p class="subtext">Completed focus sessions on '+shortDate(selectedDate())+'.</p>'+navButton("Daily plan","schedule")+'</aside></div>';
}
function timerText() { return String(Math.floor(timer.remaining/60)).padStart(2,"0")+":"+String(timer.remaining%60).padStart(2,"0"); }
function updateTimer() {
  if(!timer.end) return;
  timer.remaining=Math.max(0,Math.ceil((timer.end-Date.now())/1000));
  if($("timerDisplay")) $("timerDisplay").textContent=timerText();
  if(timer.remaining===0){
    if(timer.mode==="study") {
      const record={...emptyDay(),...state.records[timer.date]};
      state.records[timer.date]={...record,focus:(record.focus||0)+timer.seconds/60}; persist();
    }
    timer.end=null; timer.remaining=timer.seconds;
    render(); notify(timer.mode==="study"?"Focus session complete. Take a break when ready.":"Break complete.");
  }
}

function chart(title, subtitle, field, max, color, formatter) {
  return '<article class="card chart-card"><h2>' + title + '</h2><p class="subtext">' + subtitle + '</p><div class="bar-chart" role="group" aria-label="' + title + '">' +
    DAYS.map(day => {
      const record = getDay(day);
      const value = field === "sleep" ? (record.sleep ? record.sleep.duration / 60 : null) : record.water;
      return '<div class="bar-col" aria-label="' + day + ': ' + (value === null ? "Not recorded" : formatter(value)) + '"><strong>' + (value === null ? "—" : formatter(value)) + '</strong><div class="bar-track"><span class="bar-fill" style="--height:' + (value === null ? 0 : Math.min(value / max * 100, 100)) + '%;--fill:' + color + '"></span></div><small>' + day.slice(0, 3) + '</small></div>';
    }).join("") + '</div></article>';
}

function renderProgress() {
  const w = weekStats();
  const maxWater = Math.max(state.goal, ...DAYS.map(d => getDay(d).water || 0));
  const maxSleep = Math.max(12, ...DAYS.map(d => getDay(d).sleep ? getDay(d).sleep.duration / 60 : 0));
  const focusTotal = DAYS.reduce((sum,d)=>sum+(getDay(d).focus||0),0);
  return pageHeading("Weekly progress", "Review your records, navigate between weeks and export a summary.", shortDate(weekStart)+" – "+shortDate(addDays(weekStart,6))) +
    '<div class="section-head"><span class="pill">'+focusTotal+' minutes of focus logged</span><button class="button secondary" data-action="export-week">Export CSV</button></div>'+
    '<div class="cards progress-cards"><article class="card">' + featureIcon("meal", "meal") + '<span class="card-title">Meals eaten</span><div class="stat">' + w.meals + '</div><p class="caption">' + w.loggedMeals + ' / 21 meal statuses recorded</p></article><article class="card">' + featureIcon("water", "water") + '<span class="card-title">Water recorded</span><div class="stat">' + w.waterTotal + ' glasses</div><p class="caption">' + w.waterDays + ' of 7 days logged</p></article><article class="card">' + featureIcon("moon", "sleep") + '<span class="card-title">Average logged sleep</span><div class="stat">' + (w.sleepAvg === null ? "—" : durationText(w.sleepAvg)) + '</div><p class="caption">' + w.sleepDays + ' of 7 days logged</p></article></div>' +
    '<div class="two-col">' + chart("Water throughout the week", "Glasses recorded per day", "water", maxWater, "var(--water)", n => String(n)) + chart("Sleep throughout the week", "Hours recorded per day", "sleep", maxSleep, "var(--sleep)", n => (Math.round(n * 10) / 10) + "h") + '</div>' +
    '<article class="card"><div class="card-top"><h2>Daily records</h2>' + pill(w.checkedDays === 7, w.checkedDays + "/7 days checked in") + '</div><p class="subtext">A dash means no entry was recorded. Recorded days are not a health score.</p><div class="week-list"><table class="week-table"><thead><tr><th>Day</th><th>Meals eaten / logged</th><th>Water</th><th>Sleep</th><th>Mood</th><th>Focus</th><th></th></tr></thead><tbody>' +
    DAYS.map(day => { const r = getDay(day), m = mealStats(r); return '<tr><td>' + day + '<br><small>'+shortDate(dateFor(day))+'</small></td><td>' + (m.logged ? m.eaten + " / " + m.logged : "—") + (r.legacySkipped ? " + old skipped entry" : "") + '</td><td>' + (r.water === null ? "—" : r.water + " glasses") + '</td><td>' + (r.sleep ? durationText(r.sleep.duration) : "—") + '</td><td>'+(r.mood===null?"—":MOOD_ICONS[r.mood]+" "+MOODS[r.mood])+'</td><td>'+(r.focus?r.focus+" min":"—")+'</td><td><button class="button secondary compact" data-edit-day="' + day + '">View / edit</button></td></tr>'; }).join("") +
    '</tbody></table></div></article>';
}

function render() {
  $("breadcrumb").textContent = LABELS[currentView];
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === currentView);
    if (button.dataset.nav === currentView) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $("demoBanner").hidden = !state.demo;
  $("demoBtn").hidden = !!state.demo;
  renderDays();
  const views = { dashboard: renderDashboard, exams: renderExams, schedule: renderSchedule, meals: renderMeals, hydration: renderHydration, sleep: renderSleep, focus:renderFocus, progress: renderProgress, settings:renderSettings };
  $("view").innerHTML = views[currentView]();
  updateStorageIndicator();
}

function go(view) {
  if (!LABELS[view]) return;
  editExam=null; editTask=null;
  currentView = view; render();
}

function updateWaterPreview() {
  const input = $("waterInput"), raw = input.value;
  const n = Number(raw);
  const valid = raw !== "" && Number.isInteger(n) && n >= 0;
  $("waterDisplay").innerHTML = (valid ? n : "—") + ' <small>/ ' + state.goal + ' glasses</small>';
  $("glassGrid").innerHTML = glassDisplay(valid ? n : 0);
  $("waterMeter").innerHTML = meter(valid ? n / state.goal * 100 : 0, "var(--water)");
  $("waterError").textContent = "";
}

function updateSleepPreview() {
  const bed = $("bedInput").value, wake = $("wakeInput").value;
  $("sleepDuration").textContent = validTime(bed) && validTime(wake) && bed !== wake ? durationText(sleepRecord(bed, wake).duration) : "—";
  $("sleepError").textContent = "";
}

// Confirm destructive actions through a keyboard-accessible dialog.
function ask(title, message, callback) {
  const dialog = $("confirmDialog");
  if (typeof dialog.showModal !== "function") {
    if (window.confirm(message)) callback();
    return;
  }
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = message;
  dialog.returnValue = "cancel";
  dialog.addEventListener("close", () => { if (dialog.returnValue === "confirm") callback(); }, { once: true });
  dialog.showModal();
}

function clearWeek() {
  state.records={}; state.plans={}; state.exams=[]; timer.end=null; timer.remaining=timer.seconds;
  selectDate(dateKey()); currentView = "dashboard"; persist(); render(); notify("All entries cleared.");
}

function sampleWeek() {
  // Fictional examples solely for demonstrating the prototype.
  personalState=state;
  state=blankState(); state.goal=personalState.goal; state.demo=true;
  selectDate(dateKey());
  const records = {};
  records.Monday = { ...emptyDay(), meals: { Breakfast: "eaten", Lunch: "eaten", Dinner: "eaten" }, water: 5, sleep: sleepRecord("23:00", "07:00") };
  records.Tuesday = { ...emptyDay(), meals: { Breakfast: "eaten", Lunch: "skipped", Dinner: null }, water: 7, sleep: sleepRecord("00:30", "06:30") };
  records.Wednesday = { ...emptyDay(), meals: { Breakfast: "eaten", Lunch: "eaten", Dinner: "eaten" }, water: 6, sleep: sleepRecord("22:45", "06:45") };
  records.Thursday = { ...emptyDay(), meals: { Breakfast: "skipped", Lunch: "eaten", Dinner: null }, water: 4, sleep: sleepRecord("01:00", "06:30") };
  for(const day of Object.keys(records)) state.records[dateFor(day)]={...records[day],mood:day==="Tuesday"?1:3,focus:day==="Tuesday"?25:50};
  if(!state.records[selectedDate()]) state.records[selectedDate()]={...emptyDay(),meals:{Breakfast:"eaten",Lunch:"skipped",Dinner:null},water:4,sleep:sleepRecord("23:30","06:30"),mood:2,focus:25};
  state.exams=[{id:uid(),subject:"Mathematics",date:addDays(dateKey(),2),priority:"High",progress:65},{id:uid(),subject:"Python",date:addDays(dateKey(),4),priority:"Medium",progress:40}];
  state.plans[selectedDate()]=[{id:uid(),title:"Revise matrices",time:"09:00",duration:45,category:"Study",done:true},{id:uid(),title:"Lunch break",time:"13:00",duration:30,category:"Meal",done:false},{id:uid(),title:"Practice Python",time:"16:00",duration:50,category:"Study",done:false}];
  timer.end=null;timer.remaining=timer.seconds;currentView = "dashboard"; render(); notify("Fictional sample week loaded.");
}

function starterRoutine() {
  const p=state.profile, tasks=[["Wake up and get ready",p.wake,20,"Other"],["Breakfast",p.breakfast,20,"Meal"],["Lunch",p.lunch,30,"Meal"],["Dinner",p.dinner,30,"Meal"],["Wind down",p.bed,20,"Rest"]];
  if(p.type==="Day scholar" && p.commute>0) {
    const start=Number(p.breakfast.slice(0,2))*60+Number(p.breakfast.slice(3))+25;
    const time=n=>String(Math.floor(Math.min(n,1439)/60)).padStart(2,"0")+":"+String(Math.min(n,1439)%60).padStart(2,"0");
    tasks.push(["Travel to campus",time(start),p.commute,"Commute"],["Travel home","17:00",p.commute,"Commute"]);
  }
  const existing=plansFor();
  const fresh=tasks.filter(([title])=>!existing.some(t=>t.title===title)).map(([title,time,duration,category])=>({id:uid(),title,time,duration,category,done:false}));
  state.plans[selectedDate()]=[...existing,...fresh];persist();render();notify(fresh.length+" activities added. Edit their times to suit your day.");
}
function exportWeek(){
  const rows=[["Date","Breakfast","Lunch","Dinner","Water glasses","Sleep minutes","Mood","Focus minutes","Demo data"]];
  DAYS.forEach(d=>{const r=getDay(d);rows.push([dateFor(d),...MEALS.map(m=>r.meals[m]||""),r.water??"",r.sleep?.duration??"",r.mood===null?"":MOODS[r.mood],r.focus||0,state.demo?"Yes":"No"]);});
  const csv=rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="examease-"+weekStart+(state.demo?"-demo":"")+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener("click", event => {
  const button = event.target.closest("button, [data-nav]");
  if (!button) return;
  if (button.dataset.nav) { event.preventDefault(); go(button.dataset.nav); return; }
  if (button.dataset.day) { selectedDay = button.dataset.day; editTask=null; render(); return; }
  if (button.dataset.editDay) { selectedDay = button.dataset.editDay; go("dashboard"); return; }
  if (button.dataset.meal) {
    const meal = button.dataset.meal, status = button.dataset.status;
    writeDay({ meals: { ...getDay().meals, [meal]: status === "unknown" ? null : status } });
    render();
    notify(meal + " updated for " + selectedDay + ".");
    document.querySelector('[data-meal="' + meal + '"][data-status="' + status + '"]')?.focus();
    return;
  }
  if(button.dataset.mood!==undefined){writeDay({mood:Number(button.dataset.mood)});render();notify("Mood recorded.");return;}
  if(button.dataset.editExam){editExam=button.dataset.editExam;render();$("examSubject")?.focus();return;}
  if(button.dataset.deleteExam){ const id=button.dataset.deleteExam;ask("Remove exam?","This removes the selected exam from the planner.",()=>{state.exams=state.exams.filter(e=>e.id!==id);editExam=null;persist();render();});return;}
  if(button.dataset.editTask){editTask=button.dataset.editTask;render();$("taskTitle")?.focus();return;}
  if(button.dataset.toggleTask){state.plans[selectedDate()]=plansFor().map(t=>t.id===button.dataset.toggleTask?{...t,done:!t.done}:t);persist();render();return;}
  if(button.dataset.deleteTask){const id=button.dataset.deleteTask;ask("Remove activity?","This removes the selected activity from your daily plan.",()=>{state.plans[selectedDate()]=plansFor().filter(t=>t.id!==id);editTask=null;persist();render();});return;}
  if(button.dataset.timerMode){if(timer.end){notify("Pause or reset the current session first.");return;}timer.mode=button.dataset.timerMode;timer.seconds=(timer.mode==="study"?25:5)*60;timer.remaining=timer.seconds;render();return;}
  switch (button.dataset.action) {
    case "prev-week": case "next-week": weekStart=addDays(weekStart,button.dataset.action==="prev-week"?-7:7);editTask=null;render();break;
    case "today": selectDate(dateKey());editTask=null;render();break;
    case "quick-water": writeDay({water:Math.min(1000,(getDay().water||0)+1)});render();notify("One glass added.");break;
    case "clear-mood": writeDay({mood:null});render();break;
    case "cancel-exam": editExam=null;render();break;
    case "cancel-task": editTask=null;render();break;
    case "suggest-plan": starterRoutine();break;
    case "move-tasks": {
      const key=selectedDate(), next=addDays(key,1);
      const moving=plansFor().filter(t=>t.category==="Study"&&!t.done);
      state.plans[key]=plansFor().filter(t=>!moving.includes(t));
      state.plans[next]=[...plansFor(next),...moving]; editTask=null;persist();render();notify(moving.length+" study activities moved to "+shortDate(next)+".");break;
    }
    case "export-week":exportWeek();break;
    case "timer-toggle":
      if(timer.end){updateTimer();if(timer.end)timer.end=null;}
      else {const n=Number($("timerLength").value);if(!Number.isInteger(n)||n<1||n>120){notify("Choose 1–120 minutes.");return;}if(timer.remaining===timer.seconds||n*60!==timer.seconds){timer.seconds=n*60;timer.remaining=timer.seconds;timer.date=selectedDate();}timer.end=Date.now()+timer.remaining*1000;}
      render();break;
    case "timer-reset":timer.end=null;timer.remaining=timer.seconds;render();break;
    case "water-minus": case "water-plus": {
      const input = $("waterInput"), n = Number(input.value);
      input.value = Math.max(0, (Number.isInteger(n) && n >= 0 ? n : 0) + (button.dataset.action === "water-plus" ? 1 : -1));
      updateWaterPreview(); break;
    }
    case "clear-water": writeDay({ water: null }); render(); notify("Water left unrecorded."); break;
    case "clear-sleep": writeDay({ sleep: null }); render(); notify("Sleep left unrecorded."); break;
    case "clear-legacy": writeDay({ legacySkipped: false }); render(); notify("Old meal entry removed."); break;
  }
});

document.addEventListener("input", event => {
  if (event.target.id === "waterInput") updateWaterPreview();
  if (event.target.id === "bedInput" || event.target.id === "wakeInput") updateSleepPreview();
});

document.addEventListener("submit", event => {
  const form = event.target;
  if(form.id==="examForm"){
    event.preventDefault();
    const subject=$("examSubject").value.trim(),date=$("examDate").value,priority=$("examPriority").value,progress=Number($("examProgress").value);
    if(!subject||!date||!PRIORITIES.includes(priority)||!Number.isInteger(progress)||progress<0||progress>100){notify("Check the exam details.");return;}
    const item={id:editExam||uid(),subject,date,priority,progress};
    state.exams=editExam?state.exams.map(e=>e.id===editExam?item:e):[...state.exams,item];
    editExam=null;persist();render();notify("Exam saved.");return;
  }
  if(form.id==="taskForm"){
    event.preventDefault();
    const title=$("taskTitle").value.trim(),time=$("taskTime").value,category=$("taskCategory").value,duration=Number($("taskDuration").value),old=plansFor().find(t=>t.id===editTask);
    if(!title||!validTime(time)||!CATEGORIES.includes(category)||!Number.isInteger(duration)||duration<5||duration>720){notify("Check the activity details.");return;}
    const task={id:editTask||uid(),title,time,category,duration,done:old?.done||false};
    state.plans[selectedDate()]=editTask?plansFor().map(t=>t.id===editTask?task:t):[...plansFor(),task];
    editTask=null;persist();render();notify("Daily plan updated.");return;
  }
  if(form.id==="profileForm"){
    event.preventDefault();
    const p={name:$("profileName").value.trim(),year:$("profileYear").value,type:$("profileType").value,commute:Number($("profileCommute").value),reminders:$("profileReminders").checked};
    for(const key of ["wake","bed","breakfast","lunch","dinner"])p[key]=$("profile-"+key).value;
    if(!Number.isInteger(p.commute)||p.commute<0||p.commute>300||!["wake","bed","breakfast","lunch","dinner"].every(k=>validTime(p[k]))){notify("Please check the times and commute minutes.");return;}
    state.profile=p;persist();render();notify("Preferences saved.");return;
  }
  if (!["waterForm", "goalForm", "sleepForm"].includes(form.id)) return;
  event.preventDefault();
  if (form.id === "waterForm") {
    const raw = $("waterInput").value, n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0 || n > 1000) { $("waterError").textContent = "Enter a whole number between 0 and 1000."; return; }
    writeDay({ water: n }); render(); notify("Water entry saved for " + selectedDay + ".");
  } else if (form.id === "goalForm") {
    const n = Number($("goalInput").value);
    if (!Number.isInteger(n) || n < 1 || n > 24) { $("goalError").textContent = "Choose a whole number from 1 to 24."; return; }
    state.goal = n; persist(); render(); notify("Personal target updated.");
  } else {
    const bed = $("bedInput").value, wake = $("wakeInput").value;
    if (!validTime(bed) || !validTime(wake) || bed === wake) { $("sleepError").textContent = "Enter two different valid times."; return; }
    writeDay({ sleep: sleepRecord(bed, wake) }); render(); notify("Sleep entry saved for " + selectedDay + ".");
  }
});

$("demoBtn").addEventListener("click", () => {
  if(!state.demo) sampleWeek();
});
$("resetBtn").addEventListener("click", () => ask("Clear all entries?", "This clears all routine history, exam dates and daily plans in the "+(state.demo?"sample":"personal")+" workspace. Settings stay saved.", clearWeek));
$("clearDemo").addEventListener("click", () => {state=personalState||getInitialState();personalState=null;timer.end=null;timer.remaining=timer.seconds;selectDate(dateKey());currentView="dashboard";render();notify("Personal workspace restored.");});
setInterval(updateTimer,250);
setInterval(()=>{const slot=$("reminderSlot");if(slot)slot.innerHTML=reminderMarkup();},30000);
persist();
render();
