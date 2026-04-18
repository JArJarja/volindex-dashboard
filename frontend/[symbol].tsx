// pages/index/[symbol].tsx
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";
import DiagnosticPanel from "../../components/DiagnosticPanel";
import FilterBar from "../../components/FilterBar";
import { fetchDetail, Detail } from "../../lib/api";

const TradingViewWidget = dynamic(() => import("../../components/TradingViewWidget"), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────
interface PricePoint { t: number; c: number; }
interface EarningsItem { date:string; quarter:string; year:string; eps_est:number; eps_act:number; rev_est:number; rev_act:number; url:string; }
interface DividendItem { ex_date:string; pay_date:string; amount:number; currency:string; frequency:string; yield_pct:number; }
interface NewsItem { headline:string; summary:string; source:string; url:string; datetime:number; image:string; sentiment:string; }
interface EarningsItemFMP {
  date:string; period:string; eps_actual:number; eps_estimate:number;
  surprise_pct:number; rev_actual:number; rev_estimate:number;
  beat_eps:boolean|null; beat_rev:boolean|null; source:string;
}
interface RecentAction { date:string; analyst:string; from_grade:string; to_grade:string; action:string; }
interface ConsensusFMP {
  type:string; verdict:string; strong_buy:number; buy:number; hold:number; sell:number; strong_sell:number;
  total:number; bull_pct:number; bear_pct:number; hold_pct:number;
  price_target_mean:number; price_target_high:number; price_target_low:number; price_target_median:number;
  recent_actions:RecentAction[]; source:string;
  overall_rating?:string; rating_score?:number; piotroski_score?:number; altman_score?:number;
}
interface ConsensusRec { period:string; strong_buy:number; buy:number; hold:number; sell:number; strong_sell:number; total:number; bull_pct:number; bear_pct:number; hold_pct:number; }
interface EpsSurprise { period:string; actual:number; estimate:number; surprise_pct:number; }
interface Consensus {
  type:string; verdict:string; bull_pct:number; bear_pct:number; hold_pct:number;
  price_target_mean:number; price_target_high:number; price_target_low:number; price_target_median?:number;
  recommendations:ConsensusRec[]; eps_surprises:EpsSurprise[];
  social_reddit_score?:number; social_twitter_score?:number;
  sentiment_up_pct?:number; sentiment_down_pct?:number;
  community_score?:number; reddit_subscribers?:number; twitter_followers?:number;
}

// ── Fetch inline ──────────────────────────────────────────────────────────────
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
async function loadHistory48(s:string):Promise<PricePoint[]>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/history48`);return r.ok?r.json():[]}catch{return[]}}
async function loadEarnings(s:string):Promise<EarningsItem[]>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/earnings`);return r.ok?r.json():[]}catch{return[]}}
async function loadDividends(s:string):Promise<DividendItem[]>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/dividends`);return r.ok?r.json():[]}catch{return[]}}
async function loadSentiment(s:string):Promise<any>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/sentiment`);return r.ok?r.json():null}catch{return null}}
async function loadNews(s:string):Promise<NewsItem[]>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/news`);return r.ok?r.json():[]}catch{return[]}}
async function loadConsensus(s:string):Promise<Consensus|null>{try{const r=await fetch(`${API}/api/index/${encodeURIComponent(s)}/consensus`);return r.ok?r.json():null}catch{return null}}

// ── Helpers ───────────────────────────────────────────────────────────────────
const TV_MAP:Record<string,string>={
  "BINANCE:BTCUSDT":"BINANCE:BTCUSDT","BINANCE:ETHUSDT":"BINANCE:ETHUSDT",
  "BINANCE:SOLUSDT":"BINANCE:SOLUSDT","BINANCE:DOGEUSDT":"BINANCE:DOGEUSDT",
  "BINANCE:SHIBUSDT":"BINANCE:SHIBUSDT","BINANCE:PEPEUSDT":"BINANCE:PEPEUSDT",
  "BINANCE:WIFUSDT":"BINANCE:WIFUSDT","BINANCE:BONKUSDT":"BINANCE:BONKUSDT",
  "OR.PA":"EURONEXT:OR","MC.PA":"EURONEXT:MC","TTE.PA":"EURONEXT:TTE","SAN.PA":"EURONEXT:SAN",
  "AIR.PA":"EURONEXT:AIR","BNP.PA":"EURONEXT:BNP","SU.PA":"EURONEXT:SU","HO.PA":"EURONEXT:HO",
  "SAF.PA":"EURONEXT:SAF","AI.PA":"EURONEXT:AI","DG.PA":"EURONEXT:DG","RI.PA":"EURONEXT:RI",
  "CAP.PA":"EURONEXT:CAP","BN.PA":"EURONEXT:BN","DSY.PA":"EURONEXT:DSY","CS.PA":"EURONEXT:CS",
  "GLE.PA":"EURONEXT:GLE","RMS.PA":"EURONEXT:RMS","EL.PA":"EURONEXT:EL","KER.PA":"EURONEXT:KER",
  "AAPL":"NASDAQ:AAPL","MSFT":"NASDAQ:MSFT","NVDA":"NASDAQ:NVDA","GOOGL":"NASDAQ:GOOGL",
  "META":"NASDAQ:META","AMZN":"NASDAQ:AMZN","TSM":"NYSE:TSM","AVGO":"NASDAQ:AVGO",
  "ORCL":"NYSE:ORCL","ASML":"NASDAQ:ASML",
};
const tvSym=(s:string)=>TV_MAP[s]||`AMEX:${s}`;
const dispSym=(s:string)=>s.replace("BINANCE:","").replace("USDT","").replace(".PA","");
const fmtDate=(d:string)=>{try{return new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})}catch{return d||"—"}};
const BIAS_C:Record<string,string>={haussier:"#00c49a",baissier:"#e05060",neutre:"#7a8098"};

// ── Mini graphique SVG 48h ────────────────────────────────────────────────────
function MiniChart({prices,direction}:{prices:PricePoint[];direction:string}){
  const closes=prices.map(p=>p.c).filter(c=>c>0);
  if(closes.length<2)return<p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",padding:"8px 0"}}>Graphique 48h non disponible</p>;
  const W=400,H=70,min=Math.min(...closes),max=Math.max(...closes),range=max-min||1;
  const px=(i:number)=>(i/(closes.length-1))*W;
  const py=(v:number)=>H-((v-min)/range)*H;
  const pts=closes.map((_,i)=>`${px(i).toFixed(1)},${py(closes[i]).toFixed(1)}`).join(" ");
  const color={haussier:"#00c49a",baissier:"#e05060",incertain:"#7a8098"}[direction]||"#7a8098";
  const t0=prices.length?new Date(prices[0].t*1000).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"";
  const t1=prices.length?new Date(prices[prices.length-1].t*1000).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"";
  return(
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:70}}>
        <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35"/><stop offset="100%" stopColor={color} stopOpacity="0.02"/></linearGradient></defs>
        <path d={`M${px(0)},${H} ${closes.map((_,i)=>`L${px(i)},${py(closes[i])}`).join(" ")} L${px(closes.length-1)},${H} Z`} fill="url(#gc)"/>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"/>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",fontFamily:"monospace",fontSize:8,color:"#7a8098",marginTop:2}}>
        <span>{t0}</span><span>{t1}</span>
      </div>
    </div>
  );
}

// ── Analyse 48h ───────────────────────────────────────────────────────────────
function analyze48h(prices:PricePoint[],cur:number){
  const closes=prices.map(p=>p.c).filter(c=>c>0);
  if(closes.length<4)return null;
  const first=closes[0],last=cur>0?cur:closes[closes.length-1];
  const change48=((last-first)/first)*100;
  const hrs:number[]=[];
  for(let i=1;i<closes.length;i++)if(closes[i-1]>0)hrs.push((closes[i]-closes[i-1])/closes[i-1]*100);
  const mean=hrs.reduce((a,b)=>a+b,0)/(hrs.length||1);
  const vol48=Math.sqrt(hrs.reduce((a,b)=>a+(b-mean)**2,0)/(hrs.length||1));
  const n=closes.length,xm=(n-1)/2,ym=closes.reduce((a,b)=>a+b,0)/n;
  const num=closes.reduce((a,c,i)=>a+(i-xm)*(c-ym),0);
  const den=closes.reduce((a,_,i)=>a+(i-xm)**2,0);
  const slopePct=den?((num/den)/ym)*100:0;
  const q=Math.max(1,Math.floor(closes.length/4));
  const ea=closes.slice(0,q).reduce((a,b)=>a+b,0)/q;
  const la=closes.slice(-q).reduce((a,b)=>a+b,0)/q;
  const momentumPct=((la-ea)/ea)*100;
  const mid=Math.floor(closes.length/2),f=closes.slice(0,mid),s=closes.slice(mid);
  let score=0;const points:{label:string;positive:boolean;text:string}[]=[];
  if(change48>2){score+=2;points.push({label:"+",positive:true,text:`Hausse de +${change48.toFixed(2)}% sur 48h`});}
  else if(change48>0.5){score+=1;points.push({label:"+",positive:true,text:`Légère hausse +${change48.toFixed(2)}% sur 48h`});}
  else if(change48<-2){score-=2;points.push({label:"−",positive:false,text:`Repli de ${change48.toFixed(2)}% sur 48h`});}
  else if(change48<-0.5){score-=1;points.push({label:"−",positive:false,text:`Légère baisse ${change48.toFixed(2)}% sur 48h`});}
  if(slopePct>0.05){score+=1;points.push({label:"+",positive:true,text:`Pente haussière (+${slopePct.toFixed(3)}%/h)`});}
  else if(slopePct<-0.05){score-=1;points.push({label:"−",positive:false,text:`Pente baissière (${slopePct.toFixed(3)}%/h)`});}
  if(momentumPct>1){score+=1;points.push({label:"+",positive:true,text:`Accélération récente +${momentumPct.toFixed(1)}%`});}
  else if(momentumPct<-1){score-=1;points.push({label:"−",positive:false,text:`Décélération récente ${momentumPct.toFixed(1)}%`});}
  if(Math.max(...s)>Math.max(...f)&&Math.min(...s)>Math.min(...f)){score+=1;points.push({label:"+",positive:true,text:"Structure HH/HL confirmée"});}
  else if(Math.max(...s)<Math.max(...f)&&Math.min(...s)<Math.min(...f)){score-=1;points.push({label:"−",positive:false,text:"Structure LH/LL confirmée"});}
  if(vol48>2)points.push({label:"~",positive:false,text:`Volatilité horaire élevée ${vol48.toFixed(2)}%`});
  const abs=Math.abs(score);
  const direction:"haussier"|"baissier"|"incertain"=abs<1?"incertain":score>0?"haussier":"baissier";
  const conviction:"faible"|"modérée"|"forte"=abs>=4?"forte":abs>=2?"modérée":"faible";
  const sum:any={haussier:{forte:"Dynamique clairement haussière sur 48h.",modérée:"Biais haussier modéré sur 48h.",faible:"Légère inclination haussière."},baissier:{forte:"Pression vendeuse dominante sur 48h.",modérée:"Biais baissier modéré sur 48h.",faible:"Légère pression baissière."},incertain:{forte:"Aucune direction dominante.",modérée:"Signaux contradictoires.",faible:"Données insuffisantes."}};
  return{direction,conviction,change48,vol48,momentumPct,slopePct,summary:sum[direction][conviction],points};
}

// ── Point de vue technique ────────────────────────────────────────────────────
function PredictionPanel({data}:{data:Detail}){
  const{diagnostic,indicators,change_pct,price}=data;
  const rsi=indicators.rsi14,macd=indicators.macd,ma20=indicators.ma20;
  let score=0;const pour:string[]=[],contre:string[]=[];
  if(diagnostic.trend==="haussier")score+=2;else if(diagnostic.trend==="baissier")score-=2;
  if(change_pct>1){score+=1;pour.push(`Variation +${change_pct.toFixed(2)}% session`);}
  else if(change_pct<-1){score-=1;contre.push(`Pression ${change_pct.toFixed(2)}% session`);}
  if(rsi!=null){if(rsi>70){score-=1;contre.push(`RSI ${rsi.toFixed(1)} surachat`);}else if(rsi<30){score+=1;pour.push(`RSI ${rsi.toFixed(1)} survente`);}else if(rsi>55){score+=1;pour.push(`RSI ${rsi.toFixed(1)} momentum+`);}else if(rsi<45){score-=1;contre.push(`RSI ${rsi.toFixed(1)} momentum−`);}}
  if(macd){if(macd.hist>0){score+=1;pour.push("MACD positif");}else{score-=1;contre.push("MACD négatif");}}
  if(ma20&&price>0){if(price>ma20*1.005){score+=1;pour.push(`Prix > MA20`);}else if(price<ma20*0.995){score-=1;contre.push(`Prix < MA20`);}}
  const abs=Math.abs(score);
  const dir=abs<1?"incertain":score>0?"haussier":"baissier";
  const conv=abs>=4?"forte":abs>=2?"modérée":"faible";
  const dc={haussier:"#00c49a",baissier:"#e05060",incertain:"#d49a00"}[dir];
  return(
    <div style={{background:`${dc}0a`,border:`1px solid ${dc}40`,borderRadius:8,padding:"12px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:dc,textTransform:"uppercase"}}>
          {dir==="haussier"?"↗ PLUTÔT HAUSSIER":dir==="baissier"?"↘ PLUTÔT BAISSIER":"→ INCERTAIN"}
        </span>
        <span style={{fontFamily:"monospace",fontSize:9,padding:"2px 6px",borderRadius:3,color:conv==="forte"?dc:"#d49a00",background:conv==="forte"?`${dc}20`:"rgba(212,154,0,.12)"}}>{conv.toUpperCase()}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{borderLeft:"2px solid #00c49a",paddingLeft:8}}>
          <p style={{fontFamily:"monospace",fontSize:9,color:"#00c49a",marginBottom:4}}>SIGNAUX +</p>
          {pour.length?pour.map((p,i)=><div key={i} style={{fontSize:11,color:"#c8cfe0",lineHeight:1.4,marginBottom:2}}>+ {p}</div>):<div style={{fontSize:11,color:"#7a8098"}}>Aucun</div>}
        </div>
        <div style={{borderLeft:"2px solid #e05060",paddingLeft:8}}>
          <p style={{fontFamily:"monospace",fontSize:9,color:"#e05060",marginBottom:4}}>SIGNAUX −</p>
          {contre.length?contre.map((c,i)=><div key={i} style={{fontSize:11,color:"#c8cfe0",lineHeight:1.4,marginBottom:2}}>− {c}</div>):<div style={{fontSize:11,color:"#7a8098"}}>Aucun</div>}
        </div>
      </div>
    </div>
  );
}

// ── Résultats & Dividendes ────────────────────────────────────────────────────
function EarningsPanel({items}:{items:EarningsItem[]}){
  if(!items.length)return<div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}><p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Aucun résultat disponible (ETF, crypto ou plan gratuit)</p></div>;
  const now=new Date();
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map((e,i)=>{
        const d=new Date(e.date),isPast=d<now,isNext=!isPast&&i===items.findIndex(x=>new Date(x.date)>=now);
        return(
          <div key={i} style={{background:"#0f1117",border:`1px solid ${isNext?"#00c49a":"#1e2130"}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#c8cfe0"}}>{fmtDate(e.date)}</span>
                {isNext&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(0,196,154,.15)",color:"#00c49a"}}>PROCHAIN</span>}
                {isPast&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(122,128,152,.1)",color:"#7a8098"}}>PUBLIÉ</span>}
              </div>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>T{e.quarter} {e.year}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {[{l:"BPA est.",v:e.eps_est?e.eps_est.toFixed(2):"—"},{l:"BPA réel",v:isPast&&e.eps_act?e.eps_act.toFixed(2):"—",c:isPast?(e.eps_act>e.eps_est?"#00c49a":e.eps_act<e.eps_est?"#e05060":undefined):undefined},{l:"CA est.",v:e.rev_est>0?`${(e.rev_est/1e9).toFixed(2)}Md`:"—"},{l:"CA réel",v:isPast&&e.rev_act>0?`${(e.rev_act/1e9).toFixed(2)}Md`:"—",c:isPast?(e.rev_act>e.rev_est?"#00c49a":e.rev_act<e.rev_est?"#e05060":undefined):undefined}].map(m=>(
                <div key={m.l}><div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:2}}>{m.l}</div><div style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:m.c||"#c8cfe0"}}>{m.v||"—"}</div></div>
              ))}
            </div>
            <a href={e.url} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",marginTop:8,fontFamily:"monospace",fontSize:10,color:"#00c49a",textDecoration:"none"}}>Résultats complets →</a>
          </div>
        );
      })}
    </div>
  );
}

function DividendPanel({items}:{items:DividendItem[]}){
  if(!items.length)return<div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}><p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Aucun dividende trouvé</p></div>;
  const now=new Date();
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map((d,i)=>{
        const upcoming=new Date(d.ex_date)>=now;
        return(
          <div key={i} style={{background:"#0f1117",border:`1px solid ${upcoming?"rgba(240,165,0,.4)":"#1e2130"}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#c8cfe0"}}>Ex-date : {fmtDate(d.ex_date)}</span>
                {upcoming&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(240,165,0,.15)",color:"#d49a00"}}>À VENIR</span>}
              </div>
              <span style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:"#00c49a"}}>{d.amount.toFixed(4)} {d.currency}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[{l:"Paiement",v:fmtDate(d.pay_date)},{l:"Rendement",v:d.yield_pct>0?d.yield_pct.toFixed(2)+"%":"—"},{l:"Fréquence",v:d.frequency||"—"}].map(m=>(
                <div key={m.l}><div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:2}}>{m.l}</div><div style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:"#c8cfe0"}}>{m.v}</div></div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Résultats FMP (historique enrichi) ───────────────────────────────────────
function EarningsFMPPanel({items}:{items:any[]}){
  if(!items||items.length===0) return(
    <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}>
      <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Résultats non disponibles — configurez FMP_API_KEY pour l'historique complet</p>
    </div>
  );

  const isFMP = items[0] && 'eps_actual' in items[0];
  const fmtMd = (v:number) => v>1e9?`${(v/1e9).toFixed(2)}Md`:v>1e6?`${(v/1e6).toFixed(1)}M`:`${v.toFixed(2)}`;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map((e:any,i:number)=>{
        const epsActual  = isFMP ? e.eps_actual  : e.eps_act;
        const epsEst     = isFMP ? e.eps_estimate: e.eps_est;
        const revActual  = isFMP ? e.rev_actual  : e.rev_act;
        const revEst     = isFMP ? e.rev_estimate: e.rev_est;
        const beatEps    = isFMP ? e.beat_eps    : epsActual>epsEst;
        const beatRev    = isFMP ? e.beat_rev    : revActual>revEst;
        const surprisePct= isFMP ? e.surprise_pct: epsEst?((epsActual-epsEst)/Math.abs(epsEst)*100):0;
        const period     = isFMP ? e.period : `T${e.quarter} ${e.year}`;
        const date       = e.date||"";
        const now        = new Date();
        const isPast     = new Date(date)<now;
        const isNext     = !isPast&&i===items.findIndex((x:any)=>new Date(x.date)>=now);

        return(
          <div key={i} style={{background:"#0f1117",border:`1px solid ${isNext?"#00c49a":"#1e2130"}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#c8cfe0"}}>
                  {date?new Date(date).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—"}
                </span>
                {isNext&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(0,196,154,.15)",color:"#00c49a"}}>PROCHAIN</span>}
                {!isPast&&!isNext&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(212,154,0,.12)",color:"#d49a00"}}>ATTENDU</span>}
                {isPast&&<span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,background:"rgba(122,128,152,.1)",color:"#7a8098"}}>PUBLIÉ</span>}
              </div>
              <span style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>{period}</span>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {/* BPA */}
              <div style={{background:"#1e2130",borderRadius:6,padding:"10px 12px",borderLeft:`3px solid ${beatEps===true?"#00c49a":beatEps===false?"#e05060":"#3a3f55"}`}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:6}}>BPA (Bénéfice par Action)</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>Estimé</div>
                    <div style={{fontFamily:"monospace",fontSize:13,color:"#c8cfe0"}}>{epsEst?epsEst.toFixed(2):"—"}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>Réel</div>
                    <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:beatEps===true?"#00c49a":beatEps===false?"#e05060":"#c8cfe0"}}>
                      {isPast&&epsActual?epsActual.toFixed(2):"—"}
                    </div>
                  </div>
                  {isPast&&surprisePct!==0&&(
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>Surprise</div>
                      <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:surprisePct>0?"#00c49a":"#e05060"}}>
                        {surprisePct>0?"+":""}{surprisePct.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* CA */}
              <div style={{background:"#1e2130",borderRadius:6,padding:"10px 12px",borderLeft:`3px solid ${beatRev===true?"#00c49a":beatRev===false?"#e05060":"#3a3f55"}`}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:6}}>CHIFFRE D'AFFAIRES</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>Estimé</div>
                    <div style={{fontFamily:"monospace",fontSize:13,color:"#c8cfe0"}}>{revEst>0?fmtMd(revEst):"—"}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>Réel</div>
                    <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:beatRev===true?"#00c49a":beatRev===false?"#e05060":"#c8cfe0"}}>
                      {isPast&&revActual>0?fmtMd(revActual):"—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <p style={{fontFamily:"monospace",fontSize:9,color:"#3a3f55",textAlign:"right"}}>Source: Financial Modeling Prep · T1 2022 → présent</p>
    </div>
  );
}

// ── Actualités & Consensus ────────────────────────────────────────────────────
function NewsConsensusPanel({news,consensus,symbol,price}:{news:NewsItem[];consensus:Consensus|null;symbol:string;price:number}){
  const[tab,setTab]=useState<"news"|"consensus"|"social">("consensus");

  const sentColor=(s:string)=>s==="positif"?"#00c49a":s==="négatif"?"#e05060":"#7a8098";
  const sentBg=(s:string)=>s==="positif"?"rgba(0,196,154,.1)":s==="négatif"?"rgba(224,80,96,.1)":"rgba(122,128,152,.1)";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>

      {/* Sous-onglets */}
      <div style={{display:"flex",gap:0,borderBottom:"1px solid #1e2130"}}>
        {([["consensus","🎯 Consensus analystes"],["news","📰 Actualités"],["social","🌐 Sentiment social"]] as [typeof tab, string][]).map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"7px 14px",fontFamily:"monospace",fontSize:11,whiteSpace:"nowrap",cursor:"pointer",background:"transparent",border:"none",color:tab===k?"#00c49a":"#7a8098",borderBottom:tab===k?"2px solid #00c49a":"2px solid transparent"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── CONSENSUS ── */}
      {tab==="consensus"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {!consensus||consensus.type==="none"?(
            <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}>
              <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Consensus non disponible pour cet instrument (ETF, crypto ou données insuffisantes)</p>
            </div>
          ):(
            <>
              {/* Verdict global */}
              {(() => {
                const dc=consensus.verdict==="haussier"?"#00c49a":consensus.verdict==="baissier"?"#e05060":"#d49a00";
                return(
                  <div style={{background:`${dc}0a`,border:`1px solid ${dc}40`,borderRadius:8,padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontSize:15,fontWeight:700,color:dc,textTransform:"uppercase"}}>
                        {consensus.verdict==="haussier"?"↗ CONSENSUS HAUSSIER":consensus.verdict==="baissier"?"↘ CONSENSUS BAISSIER":"→ CONSENSUS NEUTRE"}
                      </span>
                      {consensus.recommendations[0]&&(
                        <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>{consensus.recommendations[0].total} analystes · {consensus.recommendations[0].period}</span>
                      )}
                    </div>
                    {/* Barre de répartition */}
                    {consensus.recommendations[0]&&(
                      <div>
                        <div style={{display:"flex",height:20,borderRadius:4,overflow:"hidden",gap:1,marginBottom:6}}>
                          {consensus.recommendations[0].strong_buy>0&&<div style={{flex:consensus.recommendations[0].strong_buy,background:"#00c49a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"monospace",color:"#000",fontWeight:700}}>SB</div>}
                          {consensus.recommendations[0].buy>0&&<div style={{flex:consensus.recommendations[0].buy,background:"rgba(0,196,154,.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"monospace",color:"#000"}}>B</div>}
                          {consensus.recommendations[0].hold>0&&<div style={{flex:consensus.recommendations[0].hold,background:"#3a3f55",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"monospace",color:"#c8cfe0"}}>H</div>}
                          {consensus.recommendations[0].sell>0&&<div style={{flex:consensus.recommendations[0].sell,background:"rgba(224,80,96,.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"monospace",color:"#c8cfe0"}}>S</div>}
                          {consensus.recommendations[0].strong_sell>0&&<div style={{flex:consensus.recommendations[0].strong_sell,background:"#e05060",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontFamily:"monospace",color:"#fff",fontWeight:700}}>SS</div>}
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontFamily:"monospace",fontSize:10}}>
                          <span style={{color:"#00c49a"}}>Achat {consensus.recommendations[0].bull_pct}%</span>
                          <span style={{color:"#7a8098"}}>Conserver {consensus.recommendations[0].hold_pct}%</span>
                          <span style={{color:"#e05060"}}>Vente {consensus.recommendations[0].bear_pct}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Prix cibles */}
              {consensus.price_target_mean>0&&(
                <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px"}}>
                  <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:10,letterSpacing:".08em"}}>PRIX CIBLES ANALYSTES</p>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {[
                      {l:"Cible basse",v:consensus.price_target_low,c:"#e05060"},
                      {l:"Cible moyenne",v:consensus.price_target_mean,c:"#c8cfe0"},
                      {l:"Cible médiane",v:consensus.price_target_median||0,c:"#c8cfe0"},
                      {l:"Cible haute",v:consensus.price_target_high,c:"#00c49a"},
                    ].map(m=>{
                      const upside=price>0&&m.v>0?((m.v-price)/price*100):0;
                      return(
                        <div key={m.l} style={{background:"#1e2130",borderRadius:6,padding:"10px 10px",textAlign:"center"}}>
                          <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:4}}>{m.l}</div>
                          <div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:m.c}}>{m.v>0?m.v.toFixed(2):"—"}</div>
                          {upside!==0&&<div style={{fontFamily:"monospace",fontSize:10,color:upside>=0?"#00c49a":"#e05060",marginTop:3}}>{upside>=0?"+":""}{upside.toFixed(1)}%</div>}
                        </div>
                      );
                    })}
                  </div>
                  {/* Barre visuelle prix cible */}
                  {price>0&&consensus.price_target_low>0&&consensus.price_target_high>0&&(()=>{
                    const lo=Math.min(consensus.price_target_low,price)*0.98;
                    const hi=Math.max(consensus.price_target_high,price)*1.02;
                    const range=hi-lo;
                    const pPct=((price-lo)/range)*100;
                    const meanPct=((consensus.price_target_mean-lo)/range)*100;
                    return(
                      <div style={{marginTop:12}}>
                        <div style={{position:"relative",height:8,background:"#1e2130",borderRadius:4}}>
                          <div style={{position:"absolute",left:`${Math.max(0,Math.min(100,((consensus.price_target_low-lo)/range)*100))}%`,right:`${Math.max(0,100-Math.min(100,((consensus.price_target_high-lo)/range)*100))}%`,height:"100%",background:"rgba(0,196,154,.2)",borderRadius:4}}/>
                          <div style={{position:"absolute",left:`${Math.max(0,Math.min(98,meanPct))}%`,top:-2,width:3,height:12,background:"#d49a00",borderRadius:2,transform:"translateX(-50%)"}}/>
                          <div style={{position:"absolute",left:`${Math.max(0,Math.min(98,pPct))}%`,top:-3,width:14,height:14,background:"#c8cfe0",borderRadius:"50%",border:"2px solid #0f1117",transform:"translateX(-50%)"}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontFamily:"monospace",fontSize:9,color:"#7a8098",marginTop:4}}>
                          <span>{consensus.price_target_low.toFixed(2)}</span>
                          <span style={{color:"#d49a00"}}>▲ Cible moy. {consensus.price_target_mean.toFixed(2)}</span>
                          <span>{consensus.price_target_high.toFixed(2)}</span>
                        </div>
                        <div style={{textAlign:"center",fontFamily:"monospace",fontSize:9,color:"#7a8098",marginTop:2}}>● Prix actuel {price.toFixed(2)}</div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Historique recommandations */}
              {consensus.recommendations.length>1&&(
                <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px"}}>
                  <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:10,letterSpacing:".08em"}}>HISTORIQUE RECOMMANDATIONS</p>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {consensus.recommendations.map((r,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",minWidth:60}}>{r.period}</span>
                        <div style={{flex:1,height:12,background:"#1e2130",borderRadius:3,overflow:"hidden",display:"flex",gap:1}}>
                          {r.strong_buy>0&&<div style={{flex:r.strong_buy,background:"#00c49a"}}/>}
                          {r.buy>0&&<div style={{flex:r.buy,background:"rgba(0,196,154,.45)"}}/>}
                          {r.hold>0&&<div style={{flex:r.hold,background:"#3a3f55"}}/>}
                          {r.sell>0&&<div style={{flex:r.sell,background:"rgba(224,80,96,.45)"}}/>}
                          {r.strong_sell>0&&<div style={{flex:r.strong_sell,background:"#e05060"}}/>}
                        </div>
                        <span style={{fontFamily:"monospace",fontSize:10,color:"#00c49a",minWidth:30}}>{r.bull_pct}%</span>
                        <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",minWidth:30}}>{r.hold_pct}%</span>
                        <span style={{fontFamily:"monospace",fontSize:10,color:"#e05060",minWidth:30}}>{r.bear_pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* EPS Surprises */}
              {consensus.eps_surprises&&consensus.eps_surprises.length>0&&(
                <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px"}}>
                  <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:10,letterSpacing:".08em"}}>SURPRISES BPA (EPS)</p>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {consensus.eps_surprises.map((e,i)=>{
                      const beat=e.actual>e.estimate;
                      return(
                        <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 8px",background:"#1e2130",borderRadius:5,borderLeft:`3px solid ${beat?"#00c49a":"#e05060"}`}}>
                          <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>{e.period}</span>
                          <div style={{display:"flex",gap:16,fontFamily:"monospace",fontSize:11}}>
                            <span style={{color:"#7a8098"}}>Est. {e.estimate.toFixed(2)}</span>
                            <span style={{color:beat?"#00c49a":"#e05060",fontWeight:700}}>Réel {e.actual.toFixed(2)}</span>
                            <span style={{color:beat?"#00c49a":"#e05060"}}>{e.surprise_pct>=0?"+":""}{e.surprise_pct.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sentiment crypto */}
              {consensus.type==="crypto"&&consensus.sentiment_up_pct!==undefined&&(
                <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px"}}>
                  <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:10,letterSpacing:".08em"}}>SENTIMENT COMMUNAUTÉ</p>
                  <div style={{display:"flex",gap:2,height:20,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                    <div style={{flex:consensus.sentiment_up_pct,background:"#00c49a"}}/>
                    <div style={{flex:consensus.sentiment_down_pct||0,background:"#e05060"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontFamily:"monospace",fontSize:11}}>
                    <span style={{color:"#00c49a"}}>Positif {consensus.sentiment_up_pct?.toFixed(1)}%</span>
                    <span style={{color:"#e05060"}}>Négatif {consensus.sentiment_down_pct?.toFixed(1)}%</span>
                  </div>
                  {(consensus.reddit_subscribers||0)>0&&(
                    <div style={{marginTop:8,display:"flex",gap:16,fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>
                      <span>Reddit : {((consensus.reddit_subscribers||0)/1000).toFixed(0)}K abonnés</span>
                      {(consensus.twitter_followers||0)>0&&<span>Twitter : {((consensus.twitter_followers||0)/1000).toFixed(0)}K followers</span>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ACTUALITÉS ── */}
      {tab==="news"&&(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {news.length===0?(
            <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}>
              <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Aucune actualité disponible pour cet instrument</p>
            </div>
          ):news.map((n,i)=>(
            <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}>
              <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px",transition:"border-color .15s",cursor:"pointer"}}
                onMouseEnter={e=>(e.currentTarget.style.borderColor="#2a3050")}
                onMouseLeave={e=>(e.currentTarget.style.borderColor="#1e2130")}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>{n.source}</span>
                    <span style={{fontFamily:"monospace",fontSize:9,color:"#7a8098"}}>
                      {n.datetime>0?new Date(n.datetime*1000).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):""}
                    </span>
                  </div>
                  <span style={{padding:"2px 6px",borderRadius:3,fontFamily:"monospace",fontSize:9,fontWeight:600,flexShrink:0,color:sentColor(n.sentiment),background:sentBg(n.sentiment)}}>
                    {n.sentiment.toUpperCase()}
                  </span>
                </div>
                <p style={{fontSize:13,fontWeight:600,color:"#c8cfe0",lineHeight:1.4,marginBottom:n.summary?6:0}}>{n.headline}</p>
                {n.summary&&<p style={{fontSize:11,color:"#7a8098",lineHeight:1.5}}>{n.summary}</p>}
                <p style={{fontFamily:"monospace",fontSize:9,color:"#00c49a",marginTop:6}}>Lire l'article →</p>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* ── SENTIMENT SOCIAL ── */}
      {tab==="social"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {!consensus?(
            <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:16}}>
              <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Données sociales non disponibles</p>
            </div>
          ):(
            <>
              <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"14px 16px"}}>
                <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:12,letterSpacing:".08em"}}>SENTIMENT RÉSEAUX SOCIAUX</p>
                {consensus.type==="crypto"?(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:5}}>Score communauté global</p>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{flex:1,height:8,background:"#1e2130",borderRadius:4,overflow:"hidden"}}>
                          <div style={{width:`${Math.min(100,(consensus.community_score||0)*10)}%`,height:"100%",background:"#00c49a"}}/>
                        </div>
                        <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#00c49a"}}>{(consensus.community_score||0).toFixed(1)}/10</span>
                      </div>
                    </div>
                    {(consensus.reddit_subscribers||0)>0&&(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                        {[{l:"Reddit abonnés",v:((consensus.reddit_subscribers||0)/1000).toFixed(1)+"K"},{l:"Twitter followers",v:((consensus.twitter_followers||0)/1000).toFixed(1)+"K"}].map(m=>(
                          <div key={m.l} style={{background:"#1e2130",borderRadius:6,padding:"10px 12px",textAlign:"center"}}>
                            <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:4}}>{m.l}</div>
                            <div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:"#c8cfe0"}}>{m.v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[
                      {l:"Score Reddit (7j)",v:consensus.social_reddit_score||0,color:"#ff4500"},
                      {l:"Score Twitter/X (7j)",v:consensus.social_twitter_score||0,color:"#1da1f2"},
                    ].map(m=>(
                      <div key={m.l}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>{m.l}</span>
                          <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:m.v>=0?m.color:"#e05060"}}>{m.v>=0?"+":""}{m.v.toFixed(2)}</span>
                        </div>
                        <div style={{height:6,background:"#1e2130",borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${Math.min(100,Math.abs(m.v)*10)}%`,height:"100%",background:m.v>=0?m.color:"#e05060"}}/>
                        </div>
                      </div>
                    ))}
                    {(!consensus.social_reddit_score&&!consensus.social_twitter_score)&&(
                      <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>Données sociales non disponibles sur plan gratuit Finnhub</p>
                    )}
                  </div>
                )}
              </div>
              <div style={{background:"rgba(122,128,152,.06)",border:"1px solid #1e2130",borderRadius:6,padding:"8px 12px"}}>
                <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",lineHeight:1.6}}>
                  ⚠ Le sentiment social est un indicateur de perception, pas de valeur fondamentale. Ne constitue pas un conseil en investissement.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
type SectionKey="principal"|"actualites"|"technique"|"resultats"|"dividendes";

export default function DetailPage(){
  const router=useRouter();
  const rawSym=router.query.symbol as string;
  const symbol=rawSym?decodeURIComponent(rawSym).toUpperCase():"";
  const pageTitle="VOLINDEX · "+dispSym(symbol);

  const[data,setData]=useState<Detail|null>(null);
  const[prices48,setPrices48]=useState<PricePoint[]>([]);
  const[earnings,setEarnings]=useState<EarningsItem[]>([]);
  const[dividends,setDividends]=useState<DividendItem[]>([]);
  const[news,setNews]=useState<NewsItem[]>([]);
  const[consensus,setConsensus]=useState<any>(null);
  const[sentiment,setSentiment]=useState<any>(null);
  const[earningsFMP,setEarningsFMP]=useState<EarningsItemFMP[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[section,setSection]=useState<SectionKey>("principal");
  const[resolution,setResolution]=useState("5");
  const[win,setWin]=useState(60);
  const[tvFullscreen,setTvFullscreen]=useState(false);

  async function load(sym:string,res:string,w:number){
    setLoading(true);setError("");
    try{
      const d=await fetchDetail(sym,w,res);
      setData(d);setLoading(false);
      const[h,e,dv,nw,cs,sent]=await Promise.all([loadHistory48(sym),loadEarnings(sym),loadDividends(sym),loadNews(sym),loadConsensus(sym),loadSentiment(sym)]);
      setPrices48(h);setEarnings(e);setDividends(dv);setNews(nw);setConsensus(cs);setSentiment(sent);
      // Earnings FMP (format différent - déjà dans e si backend retourne FMP format)
      if(Array.isArray(e)&&e.length>0&&'eps_actual' in e[0]) setEarningsFMP(e as any);
    }catch(err:any){setError(err.message||"Erreur de connexion");setLoading(false);}
  }

  useEffect(()=>{if(symbol)load(symbol,resolution,win);},[symbol,resolution,win]);
  useEffect(()=>{if(!symbol)return;const id=setInterval(()=>load(symbol,resolution,win),30000);return()=>clearInterval(id);},[symbol,resolution,win]);

  // Plein écran TradingView via touche Escape
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setTvFullscreen(false);};
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const isCrypto=symbol.startsWith("BINANCE:");
  const t48=data?analyze48h(prices48,data.price):null;
  const t48dir=t48?.direction||"incertain";
  const t48dc={haussier:"#00c49a",baissier:"#e05060",incertain:"#d49a00"}[t48dir];
  const t48conv=t48?.conviction||"faible";

  const sections:{key:SectionKey;label:string}[]=[
    {key:"principal",label:"📈 Graphique & Analyse"},
    {key:"actualites",label:"📰 Actualités & Consensus"},
    {key:"technique",label:"🔬 Point de vue"},
    ...(!isCrypto?[
      {key:"resultats" as SectionKey,label:"📋 Résultats"},
      {key:"dividendes" as SectionKey,label:"💰 Dividendes"},
    ]:[]),
  ];

  const btnStyle={padding:"5px 10px",fontFamily:"monospace",fontSize:10,cursor:"pointer",background:"rgba(0,196,154,.1)",color:"#00c49a",border:"1px solid rgba(0,196,154,.3)",borderRadius:4};

  return(
    <>
      <Head><title>{pageTitle}</title></Head>

      {/* ── Overlay plein écran TradingView ── */}
      {tvFullscreen&&(
        <div style={{position:"fixed",inset:0,zIndex:9999,background:"#07080a",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid #1e2130",background:"#0f1117"}}>
            <span style={{fontFamily:"monospace",fontSize:12,color:"#00c49a",fontWeight:700}}>{dispSym(symbol)} — {tvSym(symbol)}</span>
            <button onClick={()=>setTvFullscreen(false)} style={{...btnStyle,background:"rgba(224,80,96,.1)",color:"#e05060",border:"1px solid rgba(224,80,96,.3)"}}>
              ✕ Fermer (Esc)
            </button>
          </div>
          <div style={{flex:1,overflow:"hidden"}}>
            <TradingViewWidget symbol={tvSym(symbol)} height={window.innerHeight-50}/>
          </div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:14}}>

        {/* Breadcrumb */}
        <div style={{display:"flex",alignItems:"center",gap:6,fontFamily:"monospace",fontSize:11,color:"#7a8098"}}>
          <Link href="/" style={{color:"#00c49a",textDecoration:"none"}}>← DASHBOARD</Link>
          <span>›</span><span style={{color:"#c8cfe0"}}>{dispSym(symbol)}</span>
        </div>

        {/* Header */}
        {data&&(
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div>
              <h1 style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:"#00c49a"}}>{dispSym(symbol)}</h1>
              <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098",marginTop:2}}>{data.name}</p>
            </div>
            <div style={{display:"flex",alignItems:"flex-end",gap:14}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"monospace",fontSize:22,fontWeight:600,color:"#c8cfe0"}}>
                  {data.price>0?data.price.toFixed(data.price<1?6:2):"—"}
                </div>
                <div style={{fontFamily:"monospace",fontSize:13,color:data.change_pct>=0?"#00c49a":"#e05060"}}>
                  {data.change_pct>=0?"+":""}{data.change_pct.toFixed(2)}%
                </div>
              </div>
              <span style={{padding:"6px 12px",borderRadius:5,fontFamily:"monospace",fontSize:12,fontWeight:700,color:BIAS_C[data.diagnostic.trend]||"#7a8098",border:`1px solid ${BIAS_C[data.diagnostic.trend]||"#1e2130"}`,background:`${BIAS_C[data.diagnostic.trend]||"#888"}15`,textTransform:"uppercase"}}>
                {data.diagnostic.trend}
              </span>
            </div>
          </div>
        )}

        <FilterBar resolution={resolution} window={win} onResolutionChange={setResolution} onWindowChange={setWin} loading={loading}/>

        {error&&<div style={{borderRadius:6,border:"1px solid #e05060",background:"rgba(224,80,96,.08)",padding:"12px 16px",fontFamily:"monospace",fontSize:12,color:"#e05060"}}>⚠ {error} — Vérifiez que le backend tourne sur le port 8000.</div>}
        {loading&&!data&&!error&&<div style={{display:"flex",justifyContent:"center",height:180,alignItems:"center"}}><div style={{width:28,height:28,borderRadius:"50%",border:"2px solid #00c49a",borderTopColor:"transparent",animation:"spin 1s linear infinite"}}/></div>}

        {data&&(
          <>
            {/* Onglets */}
            <div style={{display:"flex",gap:0,borderBottom:"1px solid #1e2130",overflowX:"auto"}}>
              {sections.map(s=>(
                <button key={s.key} onClick={()=>setSection(s.key)} style={{padding:"8px 14px",fontFamily:"monospace",fontSize:11,whiteSpace:"nowrap",cursor:"pointer",background:"transparent",border:"none",color:section===s.key?"#00c49a":"#7a8098",borderBottom:section===s.key?"2px solid #00c49a":"2px solid transparent"}}>{s.label}</button>
              ))}
            </div>

            {/* ── ONGLET PRINCIPAL : Graphique + 48h + Diagnostic ── */}
            {section==="principal"&&(
              <div style={{display:"flex",flexDirection:"column",gap:12}}>

                {/* Layout 2 colonnes */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 370px",gap:12,alignItems:"start"}}>

                  {/* Colonne gauche : TradingView */}
                  <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,overflow:"hidden"}}>
                    <div style={{padding:"8px 14px",borderBottom:"1px solid #1e2130",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>TRADINGVIEW · {tvSym(symbol)}</span>
                      <button onClick={()=>setTvFullscreen(true)} style={btnStyle}>⛶ Plein écran</button>
                    </div>
                    <TradingViewWidget symbol={tvSym(symbol)} height={480}/>
                  </div>

                  {/* Colonne droite : 48h + Point de vue */}
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"12px 14px"}}>
                      <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:8,letterSpacing:".08em"}}>TENDANCE 48H</p>
                      <MiniChart prices={prices48} direction={t48dir}/>
                      {t48?(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:"#1e2130",borderRadius:5,marginTop:10,overflow:"hidden"}}>
                            {[{l:"VAR. 48H",v:(t48.change48>=0?"+":"")+t48.change48.toFixed(2)+"%",c:t48.change48>=0?"#00c49a":"#e05060"},{l:"VOL/H",v:t48.vol48.toFixed(2)+"%",c:"#d49a00"},{l:"MOMENTUM",v:(t48.momentumPct>=0?"+":"")+t48.momentumPct.toFixed(1)+"%",c:"#c8cfe0"},{l:"PENTE",v:(t48.slopePct>=0?"+":"")+t48.slopePct.toFixed(3)+"%",c:"#c8cfe0"}].map(m=>(
                              <div key={m.l} style={{background:"#0f1117",padding:"7px 8px",textAlign:"center"}}>
                                <div style={{fontFamily:"monospace",fontSize:9,color:"#7a8098",marginBottom:2}}>{m.l}</div>
                                <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:m.c}}>{m.v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{marginTop:10,padding:"10px 12px",background:`${t48dc}0f`,border:`1px solid ${t48dc}40`,borderRadius:6}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                              <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:t48dc,textTransform:"uppercase"}}>
                                {t48dir==="haussier"?"↗ HAUSSIER":t48dir==="baissier"?"↘ BAISSIER":"→ INCERTAIN"}
                              </span>
                              <span style={{fontFamily:"monospace",fontSize:9,padding:"2px 6px",borderRadius:3,color:t48conv==="forte"?t48dc:"#d49a00",background:t48conv==="forte"?`${t48dc}20`:"rgba(212,154,0,.12)"}}>{t48conv.toUpperCase()}</span>
                            </div>
                            <p style={{fontSize:12,lineHeight:1.6,color:"#c8cfe0",marginBottom:8}}>{t48.summary}</p>
                            <div style={{display:"flex",flexDirection:"column",gap:4}}>
                              {t48.points.map((p,i)=>(
                                <div key={i} style={{display:"flex",gap:6,fontSize:11,color:"#c8cfe0",lineHeight:1.4}}>
                                  <span style={{flexShrink:0,fontWeight:700,color:p.label==="+"?"#00c49a":p.label==="−"?"#e05060":"#d49a00"}}>{p.label}</span>
                                  <span>{p.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      ):(
                        <p style={{fontFamily:"monospace",fontSize:11,color:"#7a8098",marginTop:8}}>Données 48h non disponibles.</p>
                      )}
                    </div>
                    <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"10px 12px"}}>
                      <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:8,letterSpacing:".08em"}}>POINT DE VUE TECHNIQUE</p>
                      <PredictionPanel data={data}/>
                    </div>
                  </div>
                </div>

                {/* Diagnostic en dessous, pleine largeur */}
                <div style={{background:"#0f1117",border:"1px solid #1e2130",borderRadius:8,padding:"14px 16px"}}>
                  <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",marginBottom:12,letterSpacing:".08em"}}>DIAGNOSTIC TECHNIQUE</p>
                  <DiagnosticPanel diagnostic={data.diagnostic} indicators={data.indicators}/>
                </div>

              </div>
            )}

            {section==="actualites"&&<NewsConsensusPanel news={news} consensus={consensus} symbol={symbol} price={data.price}/>}
            {section==="technique"&&<PredictionPanel data={data}/>}
            {section==="resultats"&&(
              <div>
                <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",letterSpacing:".08em",marginBottom:10}}>
                  RÉSULTATS TRIMESTRIELS · T1 2022 → PRÉSENT
                </p>
                <EarningsFMPPanel items={earningsFMP.length>0?earningsFMP:earnings}/>
              </div>
            )}
            {section==="dividendes"&&<div><p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098",letterSpacing:".08em",marginBottom:10}}>DIVIDENDES</p><DividendPanel items={dividends}/></div>}

            <p style={{fontFamily:"monospace",fontSize:10,color:"#7a8098"}}>
              Mis à jour le {new Date(data.updated_at).toLocaleString("fr-FR")} · Finnhub / CoinGecko
              {data.price===0&&<span style={{color:"#d49a00",marginLeft:8}}>· Marché fermé — données de la dernière session</span>}
            </p>
          </>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
