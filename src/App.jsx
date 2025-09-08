import React, { useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";

// ---------- helpers ----------
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const fmt = (n,d=1)=>Number(n).toLocaleString(undefined,{maximumFractionDigits:d});

function heatIndexC(tempC, rhPct) {
  const T = tempC * 9/5 + 32, R = rhPct ?? 50;
  if (T < 80) return tempC;
  let HI = -42.379 + 2.04901523*T + 10.14333127*R - 0.22475541*T*R
         - 0.00683783*T*T - 0.05481717*R*R + 0.00122874*T*T*R
         + 0.00085282*T*R*R - 0.00000199*T*T*R*R;
  if (R < 13 && T >= 80 && T <= 112) HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  if (R > 85 && T >= 80 && T <= 87) HI -= ((R - 85) / 10) * ((87 - T) / 5);
  return (HI - 32) * 5/9;
}
function riskFromHeatAndGreen(hiC, greenPct) {
  const heatScore = clamp(((hiC - 15) / (47 - 15)) * 100, 0, 100);
  return Math.round(0.7*heatScore + 0.3*(100 - clamp(greenPct,0,100)));
}
function riskLabel(score){
  if (score>=75) return {label:"High",color:"#e11d48"};
  if (score>=60) return {label:"Elevated",color:"#f59e0b"};
  if (score>=45) return {label:"Moderate",color:"#10b981"};
  return {label:"Low",color:"#22c55e"};
}

// ---------- APIs ----------
const API = {
  geocode: (q) =>
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
  weather: (lat,lon) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature`,
  overpass: (lat,lon) => {
    const body = `
[out:json][timeout:25];
(way["leisure"="park"](around:1500,${lat},${lon});
 way["landuse"="forest"](around:1500,${lat},${lon});
 way["natural"="wood"](around:1500,${lat},${lon});
 way["landuse"="grass"](around:1500,${lat},${lon});
 way["leisure"="garden"](around:1500,${lat},${lon}););
out geom;`;
    return { url: "https://overpass-api.de/api/interpreter", body };
  }
};

// ---------- UI ----------
function Header(){
  return (
    <header className="max-w-6xl mx-auto px-4 pt-8 pb-2">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🌆</span>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-800">CoolBlocks</h1>
      </div>
      <p className="mt-2 text-slate-600 max-w-2xl">
        Global heat-island insights with an action kit. Enter any ZIP/City → we geocode, fetch weather, estimate local greenspace,
        and compute a heat-risk score with climate actions.
      </p>
    </header>
  );
}

function Search({onResult}){
  const [q,setQ]=useState(""), [loading,setLoading]=useState(false), [err,setErr]=useState("");

  async function run(e){
    e.preventDefault(); setErr(""); if(!q.trim()) return; setLoading(true);
    try{
      // 1) geocode
      const gRes = await fetch(API.geocode(q)); const g = await gRes.json();
      if(!g?.results?.length) throw new Error("Location not found. Try 'ZIP, Country' or a city name.");
      const R = g.results[0]; const lat=R.latitude, lon=R.longitude;
      const place = `${R.name}${R.admin1 ? ", "+R.admin1 : ""}${R.country ? ", "+R.country : ""}`;

      // 2) weather
      const wRes = await fetch(API.weather(lat,lon)); const w = await wRes.json();
      const temp = w.current?.temperature_2m, rh = w.current?.relative_humidity_2m;
      const hi = heatIndexC(temp, rh);

      // 3) greenspace best-effort
      let greenPct = 30;
      try{
        const {url,body} = API.overpass(lat,lon);
        const oRes = await fetch(url,{method:"POST",body}); const o = await oRes.json();
        const circle = turf.circle([lon,lat], 1.5, {steps:48, units:"kilometers"});
        const area = turf.area(circle)/1e6; let green=0;
        for(const el of (o.elements||[])){
          const coords = (el.geometry||[]).map(p=>[p.lon,p.lat]); if(coords.length<3) continue;
          if (coords[0][0]!==coords.at(-1)[0] || coords[0][1]!==coords.at(-1)[1]) coords.push([...coords[0]]);
          try{
            const poly = turf.polygon([coords]);
            if(turf.booleanPointInPolygon(turf.centroid(poly), circle)) green += turf.area(poly)/1e6;
          }catch{}
        }
        greenPct = clamp((green/area)*100,0,100);
      }catch{}

      const score = riskFromHeatAndGreen(hi, greenPct);
      onResult({ lat, lon, place, temp, rh, hi, greenPct, score });
    }catch(e){ setErr(e.message||"Search failed."); } finally{ setLoading(false); }
  }

  return (
    <form onSubmit={run} className="rounded-3xl bg-white/80 backdrop-blur border border-white p-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <label className="text-sm text-slate-600">Enter ZIP/City (worldwide)</label>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="e.g., 21201, US or London or 10115, DE"
               className="mt-1 w-full rounded-xl border p-2 bg-white/90" />
      </div>
      <button type="submit" disabled={loading}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
        {loading ? "Searching…" : "Get Heat Risk"}
      </button>
      {err && <div className="text-sm text-rose-600">{err}</div>}
      <div className="text-xs text-slate-500 ml-auto">Uses Open-Meteo + OpenStreetMap (no keys).</div>
    </form>
  );
}

function ScoreCard({data}){
  if(!data) return null;
  const {place,temp,rh,hi,greenPct,score} = data; const rl = riskLabel(score);
  return (
    <div className="rounded-3xl bg-white/80 backdrop-blur border border-white p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-slate-500">Location</div>
          <div className="text-xl font-bold text-slate-800">{place}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-500">Heat Risk Score</div>
          <div className="text-3xl font-extrabold" style={{color:rl.color}}>{score} / 100</div>
          <div className="text-sm font-semibold text-slate-700">{rl.label}</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-4 gap-3 mt-4">
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs text-slate-500">Air temperature</div><div className="text-lg font-semibold">{fmt(temp,1)} °C</div></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs text-slate-500">Relative humidity</div><div className="text-lg font-semibold">{fmt(rh??0,0)}%</div></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs text-slate-500">Heat index</div><div className="text-lg font-semibold">{fmt(hi,1)} °C</div></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs text-slate-500">Greenspace (proxy)</div><div className="text-lg font-semibold">{fmt(greenPct,0)}%</div></div>
      </div>
      <div className="text-xs text-slate-500 mt-3">Demo estimates; Overpass may be slow sometimes.</div>
    </div>
  );
}

function MapView({data}){
  if(!data) return null;
  const {lat,lon,score} = data; const {color} = riskLabel(score);
  return (
    <div className="overflow-hidden rounded-3xl border border-white">
      <MapContainer center={[lat,lon]} zoom={12} scrollWheelZoom={false} style={{height:420, width:"100%"}}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <CircleMarker center={[lat,lon]} radius={14} pathOptions={{color, fillColor:color, fillOpacity:0.35}}>
          <Tooltip direction="top" opacity={1}>Heat risk: {score}</Tooltip>
        </CircleMarker>
      </MapContainer>
      <div className="p-3 text-xs text-slate-500 bg-white/70">Marker tinted by risk (green→amber→red).</div>
    </div>
  );
}

const ACTIONS = [
  { id:"trees", label:"Plant shade trees (2–3)", heatDrop:10, co2SavedKg:25, sdgs:[13,12] },
  { id:"coolroof", label:"Cool roof coating", heatDrop:8, co2SavedKg:150, sdgs:[13,7] },
  { id:"shade", label:"Shade structure / awnings", heatDrop:6, co2SavedKg:40, sdgs:[13,12] },
  { id:"leds", label:"Swap 10 bulbs to LED", heatDrop:2, co2SavedKg:140, sdgs:[7,13] },
  { id:"thermostat", label:"Smart thermostat schedule", heatDrop:2, co2SavedKg:72, sdgs:[7,13] },
];
const CAR_KG_PER_MILE = 0.404;

function ActionKit({onAdd}){
  const ranked = ACTIONS.slice().sort((a,b)=>(b.heatDrop-a.heatDrop)||(b.co2SavedKg-a.co2SavedKg));
  return (
    <div className="rounded-3xl bg-white/80 backdrop-blur border border-white p-5">
      <h3 className="text-xl font-bold text-slate-800">Action Kit</h3>
      <p className="text-slate-600">Add steps to reduce outdoor heat & indoor cooling demand.</p>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {ranked.map(a=>(
          <div key={a.id} className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{a.label}</div>
                <div className="text-sm text-slate-600">Heat ↓ ~{a.heatDrop} • CO₂ ↓ ~{fmt(a.co2SavedKg)}</div>
                <div className="text-xs text-slate-500">SDGs: {a.sdgs.join(", ")}</div>
              </div>
              <button onClick={()=>onAdd(a)} className="px-3 py-1 rounded-full text-sm bg-emerald-600 text-white hover:bg-emerald-700">Add</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({plan}){
  const totalHeatDrop = plan.reduce((s,a)=>s+a.heatDrop,0);
  const totalCO2 = plan.reduce((s,a)=>s+a.co2SavedKg,0);
  const miles = totalCO2 / CAR_KG_PER_MILE;
  return (
    <div className="rounded-3xl bg-white/80 backdrop-blur border border-white p-5">
      <h3 className="text-xl font-bold text-slate-800">Community Impact</h3>
      <div className="grid sm:grid-cols-3 gap-3 mt-3">
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-sm text-slate-500">Heat score reduction</div><div className="text-2xl font-extrabold text-emerald-700">{totalHeatDrop}</div></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-sm text-slate-500">CO₂ avoided (yr)</div><div className="text-2xl font-extrabold text-emerald-700">{fmt(totalCO2)}</div></div>
        <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-sm text-slate-500">Car miles equiv</div><div className="text-2xl font-extrabold text-emerald-700">{fmt(miles)}</div></div>
      </div>
      <div className="mt-3">
        <h4 className="font-semibold">Your Plan</h4>
        {plan.length===0 ? <div className="text-sm text-slate-600">No actions added yet.</div> :
          <ul className="mt-1 text-sm list-disc list-inside">
            {plan.map((a,i)=>(<li key={i}>{a.label} — heat ↓ {a.heatDrop}, CO₂ ↓ {fmt(a.co2SavedKg)} kg/yr</li>))}
          </ul>}
      </div>
      <div className="text-xs text-slate-500 mt-3">SDGs: 13 (Climate Action), 7 (Clean Energy), 12 (Responsible Consumption).</div>
    </div>
  );
}

export default function App(){
  const [data,setData]=useState(null);
  const [plan,setPlan]=useState([]);
  return (
    <div className="min-h-screen text-slate-800">
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-amber-50 via-emerald-50 to-sky-100" />
      <Header />
      <main className="max-w-6xl mx-auto px-4 pb-20 space-y-5">
        <Search onResult={setData}/>
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <ScoreCard data={data}/>
            <ActionKit onAdd={(a)=>setPlan(p=>[...p,a])}/>
          </div>
          <div className="space-y-4">
            <MapView data={data}/>
            <Dashboard plan={plan}/>
          </div>
        </div>
        <footer className="text-center text-sm text-slate-500 mt-8">CoolBlocks • Heat-Island Action Kit</footer>
      </main>
    </div>
  );
}
