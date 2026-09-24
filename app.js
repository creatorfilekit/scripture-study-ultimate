const D = window.ULTIMATE_DATA;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DB_NAME = 'scripture-study-ultimate-v3';
const DB_VERSION = 3;
const STORE_NAMES = ['chapters','study','assets','packs'];

const params = new URLSearchParams(location.search);
const state = {
  view: ['home','bible','study','strongs','maps','background','library','packs'].includes(params.get('view')) ? params.get('view') : 'home',
  book: localStorage.getItem('lastBook') || 'Genesis',
  chapter: Number(localStorage.getItem('lastChapter') || 1),
  translation: localStorage.getItem('lastTranslation') || 'BSB',
  compare: JSON.parse(localStorage.getItem('compareTranslations') || '["KJV","TAG1905"]'),
  mode: 'reader',
  selectedVerse: Number(localStorage.getItem('lastVerse') || 1),
  selectedStrong: null,
  mapPreset: 'Bible Lands',
  mapQuery: '',
  chapterCache: {},
  studyCache: {},
  customTranslations: JSON.parse(localStorage.getItem('customTranslations') || '{}'),
  fontSize: localStorage.getItem('fontSize') || 'normal',
  loadingToken: 0
};

const content = $('#content');
const bookSelect = $('#bookSelect');
const chapterSelect = $('#chapterSelect');
const translationSelect = $('#translationSelect');

let dbPromise;
function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for(const name of STORE_NAMES) if(!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbGet(store,key){try{const db=await openDB();return await new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}catch{return undefined}}
async function dbPut(store,key,value){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbDelete(store,key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbEntries(store){const db=await openDB();return new Promise((res,rej)=>{const out=[];const r=db.transaction(store,'readonly').objectStore(store).openCursor();r.onsuccess=()=>{const c=r.result;if(c){out.push([c.key,c.value]);c.continue()}else res(out)};r.onerror=()=>rej(r.error)})}
async function dbClear(store){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

const bookByName = name => D.books.find(b=>b.name===name) || D.books[0];
const bookByCode = code => D.books.find(b=>b.code===String(code).toUpperCase());
const refKey = (book=state.book,chapter=state.chapter,verse=state.selectedVerse) => `${book}|${chapter}|${verse}`;
const chapterKey = (code,book,chapter) => `${code}|${book}|${chapter}`;
const studyKey = (book,chapter) => `BSB|${book}|${chapter}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const MIDVASH_OSIS = {
  GEN:'Gen',EXO:'Exod',LEV:'Lev',NUM:'Num',DEU:'Deut',JOS:'Josh',JDG:'Judg',RUT:'Ruth',
  '1SA':'1Sam','2SA':'2Sam','1KI':'1Kgs','2KI':'2Kgs','1CH':'1Chr','2CH':'2Chr',EZR:'Ezra',NEH:'Neh',EST:'Esth',JOB:'Job',PSA:'Ps',PRO:'Prov',ECC:'Eccl',SNG:'Song',ISA:'Isa',JER:'Jer',LAM:'Lam',EZK:'Ezek',DAN:'Dan',HOS:'Hos',JOL:'Joel',AMO:'Amos',OBA:'Obad',JON:'Jonah',MIC:'Mic',NAM:'Nah',HAB:'Hab',ZEP:'Zeph',HAG:'Hag',ZEC:'Zech',MAL:'Mal',MAT:'Matt',MRK:'Mark',LUK:'Luke',JHN:'John',ACT:'Acts',ROM:'Rom','1CO':'1Cor','2CO':'2Cor',GAL:'Gal',EPH:'Eph',PHP:'Phil',COL:'Col','1TH':'1Thess','2TH':'2Thess','1TI':'1Tim','2TI':'2Tim',TIT:'Titus',PHM:'Phlm',HEB:'Heb',JAS:'Jas','1PE':'1Pet','2PE':'2Pet','1JN':'1John','2JN':'2John','3JN':'3John',JUD:'Jude',REV:'Rev'
};
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function stripHtml(v=''){const d=document.createElement('div');d.innerHTML=v;return d.textContent||''}
function saveReading(){localStorage.setItem('lastBook',state.book);localStorage.setItem('lastChapter',String(state.chapter));localStorage.setItem('lastVerse',String(state.selectedVerse));localStorage.setItem('lastTranslation',state.translation);const h=JSON.parse(localStorage.getItem('readingHistory')||'[]');const item={book:state.book,chapter:state.chapter,verse:state.selectedVerse,translation:state.translation,at:Date.now()};const filtered=h.filter(x=>!(x.book===item.book&&x.chapter===item.chapter&&x.translation===item.translation));localStorage.setItem('readingHistory',JSON.stringify([item,...filtered].slice(0,30)));window.ScriptureCloud?.readingChanged?.(item)}

function allTranslations(){return {...D.translations,...state.customTranslations}}
function translationMeta(code){return state.customTranslations[code] || D.translations[code] || {name:code,short:code,lang:'',status:'custom',license:'Private local pack'} }
function translationUnlocked(code){const meta=translationMeta(code);return meta.status!=='licensed' || !!state.customTranslations[code]}
function translationLabel(code){const m=translationMeta(code);return `${m.short||code} · ${m.lang||''}${translationUnlocked(code)?'':' · import required'}`}
function selectableTranslationCodes(){return Object.keys(allTranslations()).filter(translationUnlocked)}
function translationOptionsHTML(selected){
  const entries=Object.keys(allTranslations());
  const ready=entries.filter(translationUnlocked);
  const locked=entries.filter(c=>!translationUnlocked(c));
  const options=(codes,disabled=false)=>codes.map(c=>`<option value="${escapeHtml(c)}" ${c===selected?'selected':''} ${disabled?'disabled':''}>${escapeHtml(translationLabel(c))}</option>`).join('');
  return `<optgroup label="Ready to use">${options(ready)}</optgroup>${locked.length?`<optgroup label="Import licensed pack to activate">${options(locked,true)}</optgroup>`:''}`;
}
function fillTranslationSelect(selected=state.translation){
  translationSelect.innerHTML='';
  const entries=Object.keys(allTranslations());
  const ready=entries.filter(translationUnlocked);
  const locked=entries.filter(c=>!translationUnlocked(c));
  const readyGroup=document.createElement('optgroup'); readyGroup.label='Ready to use';
  ready.forEach(code=>readyGroup.append(new Option(translationLabel(code),code)));
  translationSelect.append(readyGroup);
  if(locked.length){
    const lockedGroup=document.createElement('optgroup'); lockedGroup.label='Import licensed pack to activate';
    locked.forEach(code=>{const option=new Option(translationLabel(code),code);option.disabled=true;lockedGroup.append(option)});
    translationSelect.append(lockedGroup);
  }
  translationSelect.value=translationUnlocked(selected)?selected:'BSB';
}

function initSelectors(){
  bookSelect.innerHTML='';
  D.books.forEach(b=>bookSelect.add(new Option(b.name,b.name)));
  if(!bookByName(state.book)) state.book='Genesis';
  if(!allTranslations()[state.translation] || !translationUnlocked(state.translation)) state.translation='BSB';
  fillTranslationSelect(state.translation);
  bookSelect.value=state.book;
  translationSelect.value=state.translation;
  syncChapters();
  document.body.dataset.font=state.fontSize;
}
function syncTranslations(){if(!allTranslations()[state.translation]||!translationUnlocked(state.translation))state.translation='BSB';fillTranslationSelect(state.translation)}
function syncChapters(){const b=bookByName(state.book);chapterSelect.innerHTML='';for(let i=1;i<=b.chapters;i++)chapterSelect.add(new Option(String(i),String(i)));if(state.chapter<1||state.chapter>b.chapters)state.chapter=1;chapterSelect.value=String(state.chapter)}

function sectionHead(title,sub='',tools=''){return `<div class="section-head"><div><div class="eyebrow">Scripture Study Ultimate</div><h1>${title}</h1>${sub?`<div class="subtitle">${sub}</div>`:''}</div>${tools}</div>`}
function busyCard(text='Loading study data…'){return `<div class="loading-card"><span class="spinner"></span><b>${escapeHtml(text)}</b><small>Downloaded material remains available offline.</small></div>`}
function errorCard(message, retry=''){return `<div class="error-card"><b>Could not load this resource.</b><p>${escapeHtml(message)}</p>${retry?`<button class="primary" data-action="${retry}">Try again</button>`:''}</div>`}
function badge(text,cls=''){return `<span class="badge ${cls}">${escapeHtml(text)}</span>`}

function normalizeMidvashBook(payload){const out={};for(const ch of payload?.chapters||[]){const n=Number(ch.chapter);out[n]=(ch.verses||[]).map(v=>typeof v==='string'?v:(v.text||''))}return out}
function normalizeGetBibleBook(payload){
  const out={};
  const source = payload?.book ? payload : (Array.isArray(payload)?payload[0]:payload);
  const chapters = source?.chapters || source?.chapter || source;
  if(Array.isArray(chapters)){
    for(const ch of chapters){const n=Number(ch.chapter||ch.nr||ch.number);const vs=ch.verses||ch.verse||[];if(n&&Array.isArray(vs))out[n]=vs.map(v=>typeof v==='string'?v:(v.text||v.verse||''));}
  } else if(chapters && typeof chapters==='object'){
    for(const [k,ch] of Object.entries(chapters)){const n=Number(k)||Number(ch?.chapter||ch?.nr);const vs=Array.isArray(ch)?ch:(ch?.verses||ch?.verse||[]);if(n&&Array.isArray(vs))out[n]=vs.map(v=>typeof v==='string'?v:(v.text||v.verse||''));}
  }
  return out;
}
async function fetchJSON(url){const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(url,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw new Error(`Download failed (${r.status})`);return await r.json()}finally{clearTimeout(timer)}}
async function fetchText(url){const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(url,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw new Error(`Download failed (${r.status})`);return await r.text()}finally{clearTimeout(timer)}}

async function fetchBSBStudy(book,chapter,{force=false}={}){
  const ck=studyKey(book,chapter);
  if(!force && state.studyCache[ck]) return state.studyCache[ck];
  if(!force){const cached=await dbGet('study',ck);if(cached){state.studyCache[ck]=cached;return cached}}
  const b=bookByName(book), code=b.code;
  const displayUrl=`${D.sources.bsbDisplayBase}/${code}/${code}${chapter}.json`;
  const indexUrl=`${D.sources.bsbIndexBase}/${code}/${code}${chapter}.jsonl`;
  try{
    const [display,indexText]=await Promise.all([fetchJSON(displayUrl),fetchText(indexUrl)]);
    const eng=display.eng||{};
    const verses=Object.keys(eng).sort((a,b)=>Number(a)-Number(b)).map(v=>(eng[v]||[]).map(seg=>seg[0]||'').join(''));
    const index=indexText.trim().split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return {}}});
    const originalKey=display.heb?'heb':display.grk?'grk':null;
    const data={book,chapter,display,index,verses,originalKey,language:originalKey==='heb'?'Hebrew':originalKey==='grk'?'Greek':'',fetchedAt:Date.now()};
    state.studyCache[ck]=data;
    await Promise.all([dbPut('study',ck,data),dbPut('chapters',chapterKey('BSB',book,chapter),verses)]);
    return data;
  }catch(err){
    const starter=D.starter.BSB?.[`${book}|${chapter}`];
    if(starter?.length){const data={book,chapter,display:null,index:[],verses:starter,originalKey:null,language:b.testament==='OT'?'Hebrew':'Greek',starter:true,error:err.message};state.studyCache[ck]=data;return data}
    throw err;
  }
}

async function fetchBook(code,book,{force=false,onProgress=null}={}){
  const meta=translationMeta(code);
  if(meta.status==='licensed'&&!state.customTranslations[code]) throw new Error(`${meta.name} needs a licensed local pack.`);
  if(state.customTranslations[code]){
    const out={};const bm=bookByName(book);for(let c=1;c<=bm.chapters;c++){const v=await dbGet('chapters',chapterKey(code,book,c));if(v)out[c]=v}return out;
  }
  if(code==='BSB'){
    const out={},bm=bookByName(book);
    for(let c=1;c<=bm.chapters;c++){const s=await fetchBSBStudy(book,c,{force});out[c]=s.verses;if(onProgress)onProgress(c,bm.chapters,`${book} ${c}`);}
    await dbPut('packs',`book|${code}|${book}`,{code,book,complete:true,at:Date.now()});
    return out;
  }
  const source=meta.source;
  let chapters={};
  if(source?.type==='midvash'){
    const osis=MIDVASH_OSIS[bookByName(book).code]; if(!osis) throw new Error('Book mapping is unavailable.');
    const url=`https://raw.githubusercontent.com/midvash/bible-data/main/versions/${source.lang}/${source.slug}/books/${osis}.json`;
    chapters=normalizeMidvashBook(await fetchJSON(url));
  } else if(source?.type==='getbible'){
    const nr=D.books.findIndex(b=>b.name===book)+1;
    const url=`https://api.getbible.net/v2/${source.slug}/${nr}.json`;
    chapters=normalizeGetBibleBook(await fetchJSON(url));
  } else throw new Error('No source is configured for this translation.');
  for(const [c,vs] of Object.entries(chapters))await dbPut('chapters',chapterKey(code,book,Number(c)),vs);
  await dbPut('packs',`book|${code}|${book}`,{code,book,complete:true,at:Date.now()});
  return chapters;
}

async function getChapter(code,book,chapter,{allowNetwork=true}={}){
  if(!translationUnlocked(code)) return {locked:true,verses:[],meta:translationMeta(code)};
  const ck=chapterKey(code,book,chapter);
  if(state.chapterCache[ck])return {verses:state.chapterCache[ck],source:'memory'};
  const cached=await dbGet('chapters',ck);
  if(cached?.length){state.chapterCache[ck]=cached;return {verses:cached,source:'offline'}}
  const starter=D.starter?.[code]?.[`${book}|${chapter}`];
  if(code==='BSB'){
    if(!allowNetwork){if(starter?.length)return{verses:starter,source:'starter'};return{verses:[],error:'This chapter is not downloaded yet.'}}
    try{const s=await fetchBSBStudy(book,chapter);state.chapterCache[ck]=s.verses;return {verses:s.verses,source:s.starter?'starter':'study'}}catch(e){if(starter?.length)return{verses:starter,source:'starter',error:e.message};return{verses:[],error:e.message}}
  }
  if(allowNetwork&&navigator.onLine&&!state.customTranslations[code]){
    try{const chapters=await fetchBook(code,book);const vs=chapters[chapter]||starter||[];if(vs.length){state.chapterCache[ck]=vs;return{verses:vs,source:'downloaded'}}}catch(e){if(starter?.length)return{verses:starter,source:'starter',error:e.message};return{verses:[],error:e.message}}
  }
  if(starter?.length)return{verses:starter,source:'starter'};
  return{verses:[],error:navigator.onLine?'This chapter is not in local storage.':'This chapter has not been downloaded for offline use.'};
}

function renderTaggedSegments(segments=[],verse){return segments.map((seg,i)=>{const [text,strong,flags]=seg;const safe=escapeHtml(text||'');if(!strong)return safe;const cls=flags?.supplied?' supplied':flags?.elided?' elided':'';return `<button class="tagged-word${cls}" data-strong="${escapeHtml(strong)}" data-verse="${verse}" title="${escapeHtml(strong)}">${safe}</button>`}).join('')}
function originalSegments(study,verse){if(!study?.display||!study.originalKey)return[];return study.display[study.originalKey]?.[String(verse)]||[]}

async function render(){
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  history.replaceState(null,'',state.view==='home'?location.pathname:`${location.pathname}?view=${state.view}`);
  const token=++state.loadingToken;
  content.innerHTML=busyCard();
  try{
    if(state.view==='home')await renderHome(token);
    else if(state.view==='bible')await renderBible(token);
    else if(state.view==='study')await renderStudy(token);
    else if(state.view==='strongs')await renderStrongs(token);
    else if(state.view==='maps')await renderMaps(token);
    else if(state.view==='background')renderBackground();
    else if(state.view==='library')await renderLibrary(token);
    else if(state.view==='packs')await renderPacks(token);
  }catch(e){if(token===state.loadingToken)content.innerHTML=sectionHead('Something went wrong','The app kept your local notes and downloads.')+errorCard(e.message)}
}

async function renderHome(token){
  const last={book:state.book,chapter:state.chapter,verse:state.selectedVerse};
  const today=D.verseOfDay[Math.floor(Date.now()/86400000)%D.verseOfDay.length];
  let vd=await getChapter('BSB',today[0],today[1],{allowNetwork:false});
  if(!vd.verses?.length) vd=await getChapter('BSB','Psalms',23,{allowNetwork:false});
  if(token!==state.loadingToken)return;
  const shownRef=vd.verses?.length&&today[0]=== 'Psalms'&&today[1]===23?today:['Psalms',23,1];
  const verse=vd.verses?.[shownRef[2]-1]||vd.verses?.[0]||'Open a downloaded chapter to begin.';
  const chapterEntries=await dbEntries('chapters');
  const studyEntries=await dbEntries('study');
  content.innerHTML=`
    <section class="hero-card">
      <div class="hero-copy"><div class="eyebrow">Offline first · serious study</div><h1>Read. Compare. Study the text.</h1><p>A Bible reader, parallel Bible, Strong’s concordance, Greek and Hebrew word study, morphology, cross references, maps, book backgrounds, notes, highlights, and downloadable study data in one app.</p><div class="hero-actions"><button class="primary" data-action="continue">Continue ${escapeHtml(last.book)} ${last.chapter}</button><button data-action="open-study">Open Study</button><button data-action="open-packs">Offline Packs</button></div></div>
      <div class="hero-stats"><div><b>66</b><span>books</span></div><div><b>H + G</b><span>Hebrew & Greek</span></div><div><b>S</b><span>Strong’s linked</span></div><div><b>∞</b><span>offline notes</span></div></div>
    </section>
    <div class="dashboard-grid">
      <section class="dash-card verse-today"><div class="eyebrow">Today</div><h3>${shownRef[0]} ${shownRef[1]}:${shownRef[2]}</h3><p>“${escapeHtml(verse)}”</p><button data-go-ref="${shownRef[0]}|${shownRef[1]}|${shownRef[2]}">Read chapter</button></section>
      <section class="dash-card"><div class="eyebrow">Word study</div><h3>Start with the text</h3><p>Tap Strong’s linked words in BSB. See the original Hebrew or Greek, morphology, cross references, topics, and then the lexicon.</p><div class="quick-row"><button data-strong="H7225">H7225</button><button data-strong="G3056">G3056</button></div></section>
      <section class="dash-card"><div class="eyebrow">Parallel Bible</div><h3>Compare translations</h3><p>Compare BSB, KJV, WEB, ASV, Ang Dating Biblia 1905, Reina Valera, Segond, Luther, and private licensed packs.</p><button data-action="parallel">Open parallel</button></section>
      <section class="dash-card"><div class="eyebrow">Offline library</div><h3>${chapterEntries.length} chapters saved</h3><p>${studyEntries.length} chapter study files are stored on this device. Download whole books or translations from Data Packs.</p><button data-action="open-packs">Manage packs</button></section>
    </div>
    <section class="principles-card"><div><b>Study guardrails</b><span>Strong’s is an index, not a magic definition. Grammar and context matter. Background notes identify disputed questions instead of pretending every tradition agrees.</span></div><button id="aboutInlineBtn">Sources & licenses</button></section>`;
  wireCommonDynamic();
}

async function renderBible(token){
  saveReading();
  const meta=translationMeta(state.translation);
  const tools=`<div class="segmented"><button data-mode="reader" class="${state.mode==='reader'?'active':''}">Reader</button><button data-mode="parallel" class="${state.mode==='parallel'?'active':''}">Parallel</button></div>`;
  if(state.mode==='parallel'){await renderParallel(token,tools);return}
  const chapter=await getChapter(state.translation,state.book,state.chapter);
  let study=null;
  if(state.translation==='BSB')study=await fetchBSBStudy(state.book,state.chapter).catch(()=>null);
  if(token!==state.loadingToken)return;
  if(chapter.locked){renderLockedTranslation(meta,tools);return}
  const highlights=JSON.parse(localStorage.getItem('highlights')||'{}');
  const bm=bookByName(state.book);
  const verses=chapter.verses||[];
  const sourceLabel=chapter.source==='offline'?'offline':chapter.source==='starter'?'starter data':'ready';
  const verseRows=verses.length?verses.map((t,i)=>{const v=i+1;const h=highlights[refKey(state.book,state.chapter,v)]||'';let html=escapeHtml(t);if(study?.display?.eng?.[String(v)])html=renderTaggedSegments(study.display.eng[String(v)],v);return `<div class="verse-row ${h?`hl-${h}`:''}" data-verse-row="${v}"><button class="verse-num" data-verse="${v}">${v}</button><div class="verse-text" data-verse="${v}">${html}</div></div>`}).join(''):`<div class="empty-state"><h3>Chapter not downloaded</h3><p>${escapeHtml(chapter.error||'Connect to the internet once, then download this book for offline use.')}</p><button class="primary" data-action="download-book">Download ${escapeHtml(state.book)}</button></div>`;
  content.innerHTML=sectionHead(`${state.book} ${state.chapter}`,`${meta.name} · ${meta.lang} · ${sourceLabel}`,tools)+`
    <div class="reader-grid"><article class="reader-card"><div class="reader-toolbar"><button data-action="prev-chapter" ${state.chapter<=1?'disabled':''}>‹ Previous</button><div><b>${state.book} ${state.chapter}</b><small>${verses.length} verses</small></div><button data-action="next-chapter" ${state.chapter>=bm.chapters?'disabled':''}>Next ›</button></div>${verseRows}</article>
    <aside class="side-stack">
      <section class="side-card"><div class="eyebrow">Translation</div><h3>${escapeHtml(meta.short||state.translation)}</h3><p>${escapeHtml(meta.note||'')}</p><div class="badge-row">${badge(meta.license||'')}${state.translation==='BSB'?badge('Strong’s linked','good'):''}</div></section>
      <section class="side-card"><h3>Study this chapter</h3><p>Open Hebrew or Greek, morphology, Strong’s links, cross references, and topics for any verse.</p><button class="primary block-btn" data-action="open-study">Open Study</button></section>
      <section class="side-card"><h3>Offline</h3><p>Save this whole book to the device. BSB also saves its original language study layer.</p><button class="block-btn" data-action="download-book">Download ${escapeHtml(state.book)}</button></section>
      <section class="side-card"><h3>Listen</h3><p>Uses your phone or computer’s built in speech voice.</p><button class="block-btn" data-action="speak-chapter">Read chapter aloud</button></section>
    </aside></div>`;
  wireBible();
}

function renderLockedTranslation(meta,tools){content.innerHTML=sectionHead(`${state.book} ${state.chapter}`,`${meta.name} · licensed translation`,tools)+`<div class="license-lock"><div class="lock-icon">🔒</div><h2>${escapeHtml(meta.name)}</h2><p>${escapeHtml(meta.note)}</p><div class="hero-actions"><button class="primary" data-action="import-pack">Import licensed private pack</button><a class="button-link" href="${escapeHtml(meta.permissionUrl||'#')}" target="_blank" rel="noopener">Publisher permission</a></div><small>The app never uploads an imported private pack. It stays in this browser storage.</small></div>`;wireBible()}

async function renderParallel(token,tools){
  const candidates=selectableTranslationCodes();
  let second=state.compare[0]||'KJV',third=state.compare[1]||'TAG1905';
  if(!translationUnlocked(second)||second===state.translation)second=candidates.find(c=>c!==state.translation)||'KJV';
  if(!translationUnlocked(third)||third===state.translation||third===second)third=candidates.find(c=>c!==state.translation&&c!==second)||'WEB';
  state.compare=[second,third];localStorage.setItem('compareTranslations',JSON.stringify(state.compare));
  const selectors=`<div class="parallel-selectors"><label>Compare <select id="compareOne">${translationOptionsHTML(second)}</select></label><label>And <select id="compareTwo">${translationOptionsHTML(third)}</select></label></div>`;
  const codes=[state.translation,second,third];
  const cols=await Promise.all(codes.map(c=>getChapter(c,state.book,state.chapter)));
  if(token!==state.loadingToken)return;
  const max=Math.max(...cols.map(x=>x.verses?.length||0),0);
  const columnHtml=codes.map((code,ci)=>{const meta=translationMeta(code),dat=cols[ci];if(dat.locked)return `<section class="parallel-col locked-col"><div class="parallel-head"><b>${escapeHtml(meta.short||code)}</b><small>${escapeHtml(meta.lang)}</small></div><div class="parallel-lock">🔒<p>${escapeHtml(meta.name)} needs a licensed local pack.</p><button data-action="import-pack">Import pack</button></div></section>`;return `<section class="parallel-col"><div class="parallel-head"><b>${escapeHtml(meta.short||code)}</b><small>${escapeHtml(meta.lang)}</small></div>${Array.from({length:max},(_,i)=>`<div class="parallel-verse"><button data-parallel-verse="${i+1}">${i+1}</button><span>${escapeHtml(dat.verses?.[i]||'—')}</span></div>`).join('')}</section>`}).join('');
  content.innerHTML=sectionHead(`${state.book} ${state.chapter}`,'Parallel Bible · compare three translations verse by verse.',tools)+selectors+`<div class="parallel-scroll"><div class="parallel-grid three">${columnHtml}</div></div><p class="small-note">Downloaded chapters work offline. NLT, ESV, and Ang Bible: Pinoy Version are shown as import-required and become selectable only after you import an authorized local pack.</p>`;
  $('#compareOne').onchange=e=>{state.compare[0]=e.target.value;localStorage.setItem('compareTranslations',JSON.stringify(state.compare));window.ScriptureCloud?.preferencesChanged?.({translation:state.translation,compare:state.compare,fontSize:state.fontSize,dark:document.body.classList.contains('dark')});renderBible(++state.loadingToken)};
  $('#compareTwo').onchange=e=>{state.compare[1]=e.target.value;localStorage.setItem('compareTranslations',JSON.stringify(state.compare));window.ScriptureCloud?.preferencesChanged?.({translation:state.translation,compare:state.compare,fontSize:state.fontSize,dark:document.body.classList.contains('dark')});renderBible(++state.loadingToken)};
  wireBible();
}

function wireBible(){
  $$('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render()});
  $$('[data-verse], [data-parallel-verse]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-strong]'))return;openVerse(Number(el.dataset.verse||el.dataset.parallelVerse))});
  $$('[data-strong]').forEach(el=>el.onclick=e=>{e.stopPropagation();state.selectedVerse=Number(el.dataset.verse||state.selectedVerse);openStrong(el.dataset.strong)});
  wireCommonDynamic();
}

async function openVerse(v){
  state.selectedVerse=v;saveReading();
  const chapter=await getChapter(state.translation,state.book,state.chapter);
  const ref=`${state.book} ${state.chapter}:${v}`;
  $('#dialogRef').textContent=ref;
  $('#dialogText').textContent=chapter.verses?.[v-1]||'';
  const notes=JSON.parse(localStorage.getItem('notes')||'{}');$('#noteInput').value=notes[refKey()]||'';
  const marks=JSON.parse(localStorage.getItem('bookmarks')||'[]');$('#bookmarkBtn').textContent=marks.includes(refKey())?'★ Bookmarked':'☆ Bookmark';
  $('#verseDialog').showModal();
}
function saveNote(){const key=refKey();const notes=JSON.parse(localStorage.getItem('notes')||'{}');const val=$('#noteInput').value.trim();if(val)notes[key]=val;else delete notes[key];localStorage.setItem('notes',JSON.stringify(notes));window.ScriptureCloud?.noteChanged?.({book:state.book,chapter:state.chapter,verse:state.selectedVerse,body:val});$('#verseDialog').close();if(state.view==='library')render()}
function toggleBookmark(){const key=refKey();let a=JSON.parse(localStorage.getItem('bookmarks')||'[]');a=a.includes(key)?a.filter(x=>x!==key):[...a,key];localStorage.setItem('bookmarks',JSON.stringify(a));const active=a.includes(key);window.ScriptureCloud?.bookmarkChanged?.({book:state.book,chapter:state.chapter,verse:state.selectedVerse,active});$('#bookmarkBtn').textContent=active?'★ Bookmarked':'☆ Bookmark'}
function setHighlight(color){const key=refKey();const h=JSON.parse(localStorage.getItem('highlights')||'{}');if(color)h[key]=color;else delete h[key];localStorage.setItem('highlights',JSON.stringify(h));window.ScriptureCloud?.highlightChanged?.({book:state.book,chapter:state.chapter,verse:state.selectedVerse,color});$('#verseDialog').close();if(state.view==='bible')render()}

async function renderStudy(token){
  const study=await fetchBSBStudy(state.book,state.chapter);
  if(token!==state.loadingToken)return;
  const v=Math.max(1,Math.min(state.selectedVerse,study.verses.length||1));state.selectedVerse=v;
  const idx=study.index?.[v-1]||{};
  const engSeg=study.display?.eng?.[String(v)]||[];
  const origSeg=originalSegments(study,v);
  const origText=origSeg.length?origSeg.map(x=>x[0]||'').join(''):'Original language detail for this verse is not in the local starter cache yet.';
  const morph=idx.m||[];
  content.innerHTML=sectionHead(`${state.book} ${state.chapter}:${v}`,`${study.language || (bookByName(state.book).testament==='OT'?'Hebrew':'Greek')} study · Berean Standard Bible alignment`,`<div class="study-nav"><button data-study-nav="-1">‹</button><span>Verse ${v}</span><button data-study-nav="1">›</button></div>`)+`
    <div class="study-layout">
      <section class="study-main">
        <div class="study-card"><div class="eyebrow">English · Strong’s linked</div><div class="study-english">${engSeg.length?renderTaggedSegments(engSeg,v):escapeHtml(study.verses[v-1]||'')}</div><p class="muted tiny">Tap a linked word to open Strong’s. The English alignment is a study aid, not a claim that one English gloss exhausts the original word.</p></div>
        <div class="study-card"><div class="eyebrow">${escapeHtml(study.language||'Original language')}</div><div class="original-study ${study.originalKey==='heb'?'rtl':''}">${origSeg.length?origSeg.map((seg,i)=>{const [text,strong]=seg;return strong?`<button data-strong="${escapeHtml(strong)}" data-verse="${v}">${escapeHtml(text||'')}</button>`:escapeHtml(text||'')}).join(''):escapeHtml(origText)}</div></div>
        <div class="study-card"><div class="eyebrow">Morphology</div>${morph.length?`<div class="morph-table">${morph.map(m=>`<button class="morph-row" data-strong="${escapeHtml(m.s||'')}"><span class="orig-mini">${escapeHtml(m.l||'')}</span><b>${escapeHtml(m.s||'')}</b><span>${escapeHtml(m.p||'')}</span><code>${escapeHtml(m.m||'')}</code></button>`).join('')}</div>`:`<p class="muted">Connect once to download full morphology for this chapter.</p>`}</div>
      </section>
      <aside class="side-stack">
        <section class="side-card"><h3>Cross references</h3>${(idx.x||[]).slice(0,24).length?`<div class="chip-cloud">${(idx.x||[]).slice(0,24).map(r=>`<button data-osis="${escapeHtml(r)}">${escapeHtml(osisToHuman(r))}</button>`).join('')}</div><small>${idx.x.length>24?`${idx.x.length-24} more in source data`:''}</small>`:'<p class="muted">No cross references loaded for this starter verse.</p>'}</section>
        <section class="side-card"><h3>Topics</h3><div class="chip-cloud">${(idx.tp||[]).map(t=>`<span>${escapeHtml(titleCase(t.replaceAll('_',' ')))}</span>`).join('')||'<span>Context first</span>'}</div></section>
        <section class="side-card"><h3>Book context</h3><p>${escapeHtml(D.profiles[state.book]?.overview||'')}</p><button data-action="background">Open full background</button></section>
        <section class="side-card"><h3>Verse tools</h3><button class="block-btn" data-action="open-verse">Notes, highlight, share</button></section>
      </aside>
    </div>`;
  $$('[data-strong]').forEach(el=>el.onclick=()=>openStrong(el.dataset.strong));
  $$('[data-study-nav]').forEach(b=>b.onclick=()=>{state.selectedVerse=Math.max(1,Math.min((study.verses.length||1),state.selectedVerse+Number(b.dataset.studyNav)));render()});
  $$('[data-osis]').forEach(b=>b.onclick=()=>navigateOsis(b.dataset.osis));
  wireCommonDynamic();
}

function osisToHuman(ref){const m=String(ref).match(/^([1-3A-Z]+)\.(\d+)\.(\d+)$/);if(!m)return ref;const b=bookByCode(m[1]);return b?`${b.name} ${m[2]}:${m[3]}`:ref}
function humanToOsis(book,chapter,verse){return `${bookByName(book).code}.${chapter}.${verse}`}
function navigateOsis(ref){const m=String(ref).match(/^([1-3A-Z]+)\.(\d+)\.(\d+)$/);if(!m)return;const b=bookByCode(m[1]);if(!b)return;state.book=b.name;state.chapter=Number(m[2]);state.selectedVerse=Number(m[3]);bookSelect.value=state.book;syncChapters();state.view='bible';state.mode='reader';render().then(()=>setTimeout(()=>openVerse(state.selectedVerse),120))}

async function renderStrongs(){
  content.innerHTML=sectionHead('Strong’s & Concordance','Search Hebrew H numbers or Greek G numbers. Use it with context, grammar, and the passage, not as a shortcut around them.')+`
    <div class="strong-search-card"><input id="strongSearchInput" placeholder="H7225 or G3056" value="${escapeHtml(state.selectedStrong||'')}"/><button class="primary" id="strongSearchGo">Open entry</button></div>
    <div class="strong-grid">
      <section class="dash-card"><div class="eyebrow">Hebrew</div><h3>H7225 · רֵאשִׁית</h3><p>Genesis 1:1. Open the entry, inspect morphology, then view its occurrences.</p><button data-strong="H7225">Open H7225</button></section>
      <section class="dash-card"><div class="eyebrow">Greek</div><h3>G3056 · λόγος</h3><p>John 1:1. Compare the word’s range with its actual use in context.</p><button data-strong="G3056">Open G3056</button></section>
      <section class="dash-card"><div class="eyebrow">Concordance</div><h3>Every occurrence</h3><p>The optional Strong’s concordance pack maps Strong’s numbers to verses across Scripture.</p><button data-action="load-concordance">Download concordance</button></section>
      <section class="dash-card"><div class="eyebrow">Method</div><h3>Don’t commit the “Strong’s fallacy”</h3><p>A lexicon lists possible senses. The meaning in a verse is constrained by syntax, genre, historical setting, and the author’s argument.</p><button data-action="open-study">Open verse study</button></section>
    </div>`;
  $('#strongSearchGo').onclick=()=>{const val=$('#strongSearchInput').value.trim().toUpperCase();if(/^[HG]\d{1,5}$/.test(val))openStrong(val);else alert('Enter a Strong’s number like H7225 or G3056.')};
  $('#strongSearchInput').onkeydown=e=>{if(e.key==='Enter')$('#strongSearchGo').click()};
  $$('[data-strong]').forEach(b=>b.onclick=()=>openStrong(b.dataset.strong));wireCommonDynamic();
}

async function loadAsset(key,url,{asText=false,force=false}={}){
  if(!force){const cached=await dbGet('assets',key);if(cached)return cached}
  if(!navigator.onLine)throw new Error('Connect to the internet once to download this study pack.');
  const data=asText?await fetchText(url):await fetchJSON(url);await dbPut('assets',key,data);await dbPut('packs',`asset|${key}`,{key,at:Date.now()});return data;
}
function strongCandidates(s){const raw=String(s).toUpperCase();const p=raw[0],n=raw.slice(1);const padded=n.padStart(4,'0');return [raw,`${p}${padded}`,n,padded,Number(n),String(Number(n))]}
function findStrongEntry(data,strong){if(!data)return null;for(const k of strongCandidates(strong)){if(data[k]!=null)return data[k]}if(Array.isArray(data))return data.find(x=>strongCandidates(strong).includes(String(x.strong||x.id||x.number||'').toUpperCase()))||null;return null}
function flattenValue(v,depth=0){if(v==null)return'';if(typeof v==='string'||typeof v==='number')return String(v);if(Array.isArray(v))return v.slice(0,12).map(x=>flattenValue(x,depth+1)).filter(Boolean).join('; ');if(typeof v==='object'&&depth<2){return Object.entries(v).filter(([k])=>!['id','strong','number'].includes(k)).slice(0,12).map(([k,val])=>`${k}: ${flattenValue(val,depth+1)}`).filter(x=>!x.endsWith(': ')).join(' · ')}return''}
function extractLex(entry,strong){if(!entry)return {strong};const pick=(...keys)=>{for(const k of keys)if(entry?.[k]!=null&&entry[k]!=='')return flattenValue(entry[k]);return''};return {strong,lemma:pick('lemma','unicode','word','greek','hebrew','xlit','original'),trans:pick('translit','transliteration','xlit','pronunciation','pron'),gloss:pick('gloss','brief','kjv_def','short','meaning','definition','strongs_def'),derivation:pick('derivation','root','origin'),raw:flattenValue(entry)}}
async function currentMorphForStrong(strong){try{const study=await fetchBSBStudy(state.book,state.chapter);const idx=study.index?.[state.selectedVerse-1]||{};return (idx.m||[]).filter(m=>m.s===strong)}catch{return[]}}
async function openStrong(strong){
  strong=String(strong).toUpperCase();state.selectedStrong=strong;
  $('#strongTitle').textContent=`${strong} · loading…`;$('#strongContent').innerHTML=busyCard('Loading lexicon entry…');$('#strongDialog').showModal();
  let lex=null,error='';
  try{const data=await loadAsset('lexicon',D.sources.lexicon);lex=extractLex(findStrongEntry(data,strong),strong)}catch(e){error=e.message;lex={strong}}
  const morph=await currentMorphForStrong(strong);
  $('#strongTitle').textContent=`Strong’s ${strong}`;
  $('#strongContent').innerHTML=`<div class="strong-entry"><div class="strong-hero"><div><div class="eyebrow">${strong.startsWith('H')?'Hebrew':'Greek'} lexicon</div><h2>${escapeHtml(lex.lemma||strong)}</h2><p>${escapeHtml(lex.trans||'')}</p></div><span class="strong-code">${strong}</span></div>
    ${lex.gloss?`<section><h3>Lexical summary</h3><p>${escapeHtml(lex.gloss)}</p></section>`:''}
    ${lex.derivation?`<section><h3>Derivation</h3><p>${escapeHtml(lex.derivation)}</p></section>`:''}
    ${morph.length?`<section><h3>Morphology in ${state.book} ${state.chapter}:${state.selectedVerse}</h3>${morph.map(m=>`<div class="detail-line"><b>${escapeHtml(m.l||'')}</b><span>${escapeHtml(m.p||'')}</span><code>${escapeHtml(m.m||'')}</code></div>`).join('')}</section>`:''}
    ${error?`<div class="caution">${escapeHtml(error)} The Strong’s number and verse morphology still work from downloaded chapter study data.</div>`:''}
    <section><div class="section-inline"><h3>Concordance</h3><button id="loadOccurrencesBtn">Load all occurrences</button></div><div id="occurrenceResults"><p class="muted">Load the concordance pack to see every linked occurrence.</p></div></section>
    <div class="caution"><b>Study note:</b> Strong’s numbers identify lexical entries. They do not prove that every dictionary sense applies in every verse.</div></div>`;
  $('#loadOccurrencesBtn').onclick=()=>loadOccurrences(strong);
}
async function loadOccurrences(strong){const box=$('#occurrenceResults');box.innerHTML=busyCard('Loading Strong’s concordance…');try{const data=await loadAsset('strongsConcordance',D.sources.strongsConcordance);let refs=findStrongEntry(data,strong);if(refs&&typeof refs==='object'&&!Array.isArray(refs))refs=refs.verses||refs.refs||refs.references||refs.v||Object.values(refs).find(Array.isArray);if(!Array.isArray(refs))refs=[];box.innerHTML=`<p><b>${refs.length.toLocaleString()}</b> linked verse${refs.length===1?'':'s'}</p><div class="ref-list">${refs.slice(0,120).map(r=>`<button data-osis="${escapeHtml(String(r).replace(/:/g,'.'))}">${escapeHtml(osisToHuman(String(r).replace(/:/g,'.')))}</button>`).join('')}</div>${refs.length>120?`<p class="muted">Showing first 120 of ${refs.length.toLocaleString()}.</p>`:''}`;box.querySelectorAll('[data-osis]').forEach(b=>b.onclick=()=>{$('#strongDialog').close();navigateOsis(b.dataset.osis)})}catch(e){box.innerHTML=errorCard(e.message)}}

const FALLBACK_PLACES=[
  {name:'Jerusalem',coordinates:{lat:31.778,lon:35.235},verses:['MAT.21.1','JHN.2.13'],place_types:['city']},{name:'Bethlehem',coordinates:{lat:31.705,lon:35.202},verses:['MIC.5.2','MAT.2.1'],place_types:['town']},{name:'Nazareth',coordinates:{lat:32.699,lon:35.304},verses:['MAT.2.23','LUK.4.16'],place_types:['town']},{name:'Capernaum',coordinates:{lat:32.881,lon:35.575},verses:['MAT.4.13','MRK.2.1'],place_types:['town']},{name:'Jericho',coordinates:{lat:31.871,lon:35.444},verses:['JOS.6.1','LUK.19.1'],place_types:['city']},{name:'Damascus',coordinates:{lat:33.513,lon:36.292},verses:['ACT.9.2'],place_types:['city']},{name:'Antioch',coordinates:{lat:36.202,lon:36.161},verses:['ACT.11.26','ACT.13.1'],place_types:['city']},{name:'Rome',coordinates:{lat:41.902,lon:12.496},verses:['ACT.28.14'],place_types:['city']},{name:'Corinth',coordinates:{lat:37.906,lon:22.88},verses:['ACT.18.1'],place_types:['city']},{name:'Ephesus',coordinates:{lat:37.94,lon:27.341},verses:['ACT.19.1','REV.2.1'],place_types:['city']},{name:'Ur',coordinates:{lat:30.962,lon:46.104},verses:['GEN.11.31'],place_types:['city']},{name:'Haran',coordinates:{lat:36.864,lon:39.031},verses:['GEN.11.31'],place_types:['city']},{name:'Shechem',coordinates:{lat:32.214,lon:35.282},verses:['GEN.12.6'],place_types:['city']},{name:'Bethel',coordinates:{lat:31.93,lon:35.222},verses:['GEN.12.8'],place_types:['town']},{name:'Hebron',coordinates:{lat:31.532,lon:35.099},verses:['GEN.13.18'],place_types:['city']},{name:'Beersheba',coordinates:{lat:31.252,lon:34.791},verses:['GEN.21.31'],place_types:['town']},{name:'Egypt',coordinates:{lat:30.044,lon:31.236},verses:['EXO.1.1'],place_types:['region']},{name:'Mount Sinai',coordinates:{lat:28.539,lon:33.975},verses:['EXO.19.20'],place_types:['mountain']},{name:'Mount Nebo',coordinates:{lat:31.768,lon:35.725},verses:['DEU.34.1'],place_types:['mountain']},{name:'Tarsus',coordinates:{lat:36.917,lon:34.892},verses:['ACT.9.11'],place_types:['city']},{name:'Philippi',coordinates:{lat:41.013,lon:24.287},verses:['ACT.16.12'],place_types:['city']},{name:'Thessalonica',coordinates:{lat:40.64,lon:22.944},verses:['ACT.17.1'],place_types:['city']},{name:'Athens',coordinates:{lat:37.984,lon:23.727},verses:['ACT.17.16'],place_types:['city']},{name:'Caesarea',coordinates:{lat:32.5,lon:34.892},verses:['ACT.10.1'],place_types:['city']},{name:'Smyrna',coordinates:{lat:38.419,lon:27.128},verses:['REV.2.8'],place_types:['city']},{name:'Pergamum',coordinates:{lat:39.12,lon:27.18},verses:['REV.2.12'],place_types:['city']},{name:'Thyatira',coordinates:{lat:38.925,lon:27.84},verses:['REV.2.18'],place_types:['city']},{name:'Sardis',coordinates:{lat:38.488,lon:28.04},verses:['REV.3.1'],place_types:['city']},{name:'Philadelphia',coordinates:{lat:38.35,lon:28.517},verses:['REV.3.7'],place_types:['city']},{name:'Laodicea',coordinates:{lat:37.835,lon:29.107},verses:['REV.3.14'],place_types:['city']}
];
async function loadPlaces(){try{const text=await loadAsset('places',D.sources.places,{asText:true});return String(text).split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)}catch{return FALLBACK_PLACES}}
function titleCase(s=''){return s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}
function projectPoint(lat,lon,w=840,h=480){const minLon=10,maxLon=47,minLat=26,maxLat=43;return {x:Math.max(15,Math.min(w-15,(lon-minLon)/(maxLon-minLon)*w)),y:Math.max(15,Math.min(h-15,(maxLat-lat)/(maxLat-minLat)*h))}}
async function renderMaps(token){
  const places=await loadPlaces();if(token!==state.loadingToken)return;
  const names=D.mapPresets[state.mapPreset]||[];
  let selected=names.map(n=>places.find(p=>p.name?.toLowerCase()===n.toLowerCase()||(p.name_variants||[]).some(v=>v.name?.toLowerCase()===n.toLowerCase()))||FALLBACK_PLACES.find(p=>p.name===n)).filter(Boolean);
  if(state.mapQuery){const q=state.mapQuery.toLowerCase();selected=places.filter(p=>p.name?.toLowerCase().includes(q)||(p.name_variants||[]).some(v=>v.name?.toLowerCase().includes(q))).slice(0,80)}
  const pts=selected.filter(p=>p.coordinates?.lat!=null&&p.coordinates?.lon!=null).map(p=>({...p,...projectPoint(p.coordinates.lat,p.coordinates.lon)}));
  const route=pts.length>1&&!state.mapQuery?`<polyline class="map-route" points="${pts.map(p=>`${p.x},${p.y}`).join(' ')}"/>`:'';
  content.innerHTML=sectionHead('Bible Atlas','Search verse linked places or choose a journey and region preset. Coordinates come from downloadable Bible geography data.')+`
    <div class="map-controls"><div class="preset-row">${Object.keys(D.mapPresets).map(n=>`<button data-preset="${escapeHtml(n)}" class="${n===state.mapPreset?'active':''}">${escapeHtml(n)}</button>`).join('')}</div><div class="map-search"><input id="mapSearchInput" placeholder="Search Jerusalem, Corinth, Sinai…" value="${escapeHtml(state.mapQuery)}"><button id="mapSearchBtn">Search</button><button id="mapClearBtn">Clear</button></div></div>
    <div class="atlas-layout"><section class="atlas-card"><svg class="atlas" viewBox="0 0 840 480" role="img" aria-label="Bible lands map"><rect class="map-water" width="840" height="480"/><path class="map-land" d="M0 0H840V480H650C620 430 610 380 620 330C630 280 640 235 620 190C590 125 570 85 560 0Z"/><path class="map-land" d="M0 0H300C270 55 240 90 190 110C125 135 65 180 0 255Z"/><path class="map-land" d="M280 0C300 50 340 75 390 95C440 115 460 155 445 210C430 265 420 315 450 370L500 480H250C250 410 230 350 205 295C180 235 190 175 220 120Z"/>${route}${pts.map((p,i)=>`<g class="map-point" data-place-index="${i}"><circle cx="${p.x}" cy="${p.y}" r="6"/><text x="${p.x+9}" y="${p.y+4}">${escapeHtml(p.name)}</text></g>`).join('')}</svg><small class="map-disclaimer">Schematic basemap. Place points use stored geographic coordinates where available. Journey lines are visual study guides, not reconstructed exact roads.</small></section><aside class="map-info" id="mapInfo"><div class="eyebrow">${state.mapQuery?'Search results':state.mapPreset}</div><h3>${pts.length} places</h3><div class="place-list">${pts.slice(0,40).map((p,i)=>`<button data-place-index="${i}"><b>${escapeHtml(p.name)}</b><small>${escapeHtml((p.place_types||[]).join(', ')||p.modern_place?.name||'Biblical place')}</small></button>`).join('')}</div></aside></div>`;
  $$('[data-preset]').forEach(b=>b.onclick=()=>{state.mapPreset=b.dataset.preset;state.mapQuery='';render()});
  $('#mapSearchBtn').onclick=()=>{state.mapQuery=$('#mapSearchInput').value.trim();render()};$('#mapSearchInput').onkeydown=e=>{if(e.key==='Enter')$('#mapSearchBtn').click()};$('#mapClearBtn').onclick=()=>{state.mapQuery='';render()};
  $$('[data-place-index]').forEach(el=>el.onclick=()=>showPlace(pts[Number(el.dataset.placeIndex)]));
}
function showPlace(p){if(!p)return;const info=$('#mapInfo');info.innerHTML=`<div class="eyebrow">Place</div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.comment||p.modern_place?.name?`Modern association: ${p.modern_place?.name||''}`:'')}</p><div class="detail-grid"><span>Type</span><b>${escapeHtml((p.place_types||[]).join(', ')||'place')}</b><span>Coordinates</span><b>${Number(p.coordinates?.lat).toFixed(3)}, ${Number(p.coordinates?.lon).toFixed(3)}</b>${p.confidence_score?`<span>Confidence</span><b>${p.confidence_score}</b>`:''}</div><h3>Verse links</h3><div class="chip-cloud">${(p.verses||[]).slice(0,30).map(r=>`<button data-osis="${escapeHtml(r)}">${escapeHtml(osisToHuman(r))}</button>`).join('')||'<span>No verse list loaded.</span>'}</div>`;info.querySelectorAll('[data-osis]').forEach(b=>b.onclick=()=>navigateOsis(b.dataset.osis))}

function renderBackground(){const p=D.profiles[state.book]||{};content.innerHTML=sectionHead(`${state.book} Background`,'Historical and literary orientation before detailed interpretation.')+`<div class="background-grid"><section class="profile-hero"><div class="eyebrow">${escapeHtml(p.genre||'Biblical book')}</div><h2>${escapeHtml(state.book)}</h2><p>${escapeHtml(p.overview||'')}</p><div class="profile-facts"><div><span>Setting</span><b>${escapeHtml(p.setting||'')}</b></div><div><span>Language</span><b>${escapeHtml(p.language||'')}</b></div><div><span>Testament</span><b>${bookByName(state.book).testament}</b></div></div></section><section class="study-card"><h3>Major themes</h3><div class="theme-tags">${(p.themes||[]).map(t=>`<span>${escapeHtml(t)}</span>`).join('')}</div></section><section class="study-card"><h3>Observation questions</h3><ol class="question-list">${(p.questions||[]).map(q=>`<li>${escapeHtml(q)}</li>`).join('')}</ol></section><section class="study-card"><h3>Interpret carefully</h3><p>Questions of date, authorship, sources, historical reconstruction, and interpretation are not equally settled across Jewish and Christian scholarship. Use the text, genre, ancient context, and multiple responsible sources before drawing conclusions.</p></section></div><div class="hero-actions"><button class="primary" data-action="bible">Read ${escapeHtml(state.book)}</button><button data-action="open-study">Study current verse</button></div>`;wireCommonDynamic()}

async function renderLibrary(){
  const marks=JSON.parse(localStorage.getItem('bookmarks')||'[]'), notes=JSON.parse(localStorage.getItem('notes')||'{}'), highlights=JSON.parse(localStorage.getItem('highlights')||'{}'), history=JSON.parse(localStorage.getItem('readingHistory')||'[]');
  content.innerHTML=sectionHead('My Library','Local first. Sign in only if you want optional CreatorFileKit cloud sync across devices.')+`
    <div class="library-stats"><div><b>${marks.length}</b><span>bookmarks</span></div><div><b>${Object.keys(notes).length}</b><span>notes</span></div><div><b>${Object.keys(highlights).length}</b><span>highlights</span></div><div><b>${history.length}</b><span>recent passages</span></div></div>
    <div class="library-grid"><section class="library-card"><h3>Bookmarks</h3>${marks.length?marks.map(k=>libraryRef(k)).join(''):'<p class="muted">No bookmarks yet.</p>'}</section><section class="library-card"><h3>Notes</h3>${Object.entries(notes).length?Object.entries(notes).map(([k,v])=>`<div class="library-item">${libraryRef(k)}<p>${escapeHtml(v)}</p></div>`).join(''):'<p class="muted">No notes yet.</p>'}</section><section class="library-card"><h3>Highlights</h3>${Object.entries(highlights).length?Object.entries(highlights).map(([k,c])=>`<div class="library-item highlight-swatch ${`hl-${c}`}">${libraryRef(k)}</div>`).join(''):'<p class="muted">No highlights yet.</p>'}</section><section class="library-card"><h3>Recent reading</h3>${history.slice(0,15).map(h=>`<button class="history-item" data-lib-ref="${h.book}|${h.chapter}|${h.verse||1}"><b>${escapeHtml(h.book)} ${h.chapter}</b><small>${escapeHtml(h.translation||'BSB')}</small></button>`).join('')||'<p class="muted">Open a chapter to start history.</p>'}</section></div>
    <section class="backup-card"><div><h3>CreatorFileKit Cloud Sync</h3><p>Keep your study library local, or sign in to sync notes, bookmarks, highlights, and reading history across devices. Bible packs and private imported translations stay local.</p></div><div><button id="libraryCloudBtn">Account & sync</button></div></section>
    <section class="backup-card"><div><h3>Backup your study</h3><p>Export notes, bookmarks, highlights, settings, and reading history as a small JSON file. Bible packs are not included.</p></div><div><button id="exportBackupBtn">Export backup</button><button id="importBackupBtn">Import backup</button></div></section>`;
  $('[data-lib-ref]').forEach(b=>b.onclick=()=>goPipeRef(b.dataset.libRef));$('#libraryCloudBtn').onclick=()=>window.ScriptureCloud?.showAccount?.();$('#exportBackupBtn').onclick=exportBackup;$('#importBackupBtn').onclick=importBackup;
}
function libraryRef(key){const [b,c,v]=key.split('|');return `<button class="library-ref" data-lib-ref="${escapeHtml(key)}">${escapeHtml(b)} ${c}:${v}</button>`}
function goPipeRef(key){const [b,c,v]=key.split('|');if(!bookByName(b))return;state.book=b;state.chapter=Number(c);state.selectedVerse=Number(v||1);bookSelect.value=b;syncChapters();state.view='bible';render()}
function exportBackup(){const data={version:1,createdAt:new Date().toISOString(),notes:JSON.parse(localStorage.getItem('notes')||'{}'),bookmarks:JSON.parse(localStorage.getItem('bookmarks')||'[]'),highlights:JSON.parse(localStorage.getItem('highlights')||'{}'),history:JSON.parse(localStorage.getItem('readingHistory')||'[]'),settings:{book:state.book,chapter:state.chapter,verse:state.selectedVerse,translation:state.translation,fontSize:state.fontSize,dark:document.body.classList.contains('dark')}};downloadBlob(JSON.stringify(data,null,2),'scripture-study-backup.json','application/json')}
function importBackup(){const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const d=JSON.parse(await f.text());if(d.notes)localStorage.setItem('notes',JSON.stringify(d.notes));if(d.bookmarks)localStorage.setItem('bookmarks',JSON.stringify(d.bookmarks));if(d.highlights)localStorage.setItem('highlights',JSON.stringify(d.highlights));if(d.history)localStorage.setItem('readingHistory',JSON.stringify(d.history));alert('Study backup imported.');render()}catch{alert('That backup file could not be read.')}};input.click()}
function downloadBlob(text,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function renderPacks(){
  const packEntries=await dbEntries('packs');const pk=new Map(packEntries);
  const cards=Object.entries(allTranslations()).map(([code,m])=>{const locked=m.status==='licensed'&&!state.customTranslations[code];const bookInstalled=pk.has(`book|${code}|${state.book}`);return `<section class="pack-card"><div class="pack-top"><div><div class="eyebrow">${escapeHtml(m.lang||'')}</div><h3>${escapeHtml(m.name)}</h3></div>${locked?badge('License required','warn'):bookInstalled?badge(`${state.book} offline`,'good'):badge('Available')}</div><p>${escapeHtml(m.note||'')}</p><small>${escapeHtml(m.license||'')}</small><div class="pack-actions">${locked?`<button data-action="import-pack">Import licensed pack</button><a href="${escapeHtml(m.permissionUrl||'#')}" target="_blank" rel="noopener">Permission</a>`:`<button data-download-book-code="${code}">Download ${escapeHtml(state.book)}</button><button data-download-all-code="${code}">Full Bible</button>`}</div></section>`}).join('');
  const assetCards=[['lexicon','Strong’s Lexicon','Hebrew and Greek lexical entries',D.sources.lexicon],['strongsConcordance','Strong’s Concordance','Strong’s numbers mapped to verse occurrences',D.sources.strongsConcordance],['englishConcordance','English Concordance','English words mapped across BSB',D.sources.englishConcordance],['places','Bible Places','Verse linked place coordinates and names',D.sources.places]].map(([key,name,desc,url])=>`<section class="pack-card"><div class="pack-top"><div><div class="eyebrow">Study data</div><h3>${name}</h3></div>${pk.has(`asset|${key}`)?badge('Offline','good'):badge('Optional')}</div><p>${desc}</p><div class="pack-actions"><button data-asset-key="${key}" data-asset-url="${url}">${pk.has(`asset|${key}`)?'Update':'Download'}</button>${pk.has(`asset|${key}`)?`<button data-remove-asset="${key}">Remove</button>`:''}</div></section>`).join('');
  content.innerHTML=sectionHead('Offline Data Packs','Download only what you use. Chapters, original language study, lexicons, concordances, and maps are stored separately.')+`<div id="downloadProgress" class="download-progress" hidden><div><b id="progressTitle">Downloading…</b><span id="progressText"></span></div><progress id="progressBar" value="0" max="100"></progress><button id="cancelDownloadBtn">Cancel</button></div><div class="packs-grid"><section class="pack-card featured"><div class="pack-top"><div><div class="eyebrow">Ultimate study layer</div><h3>BSB Hebrew + Greek Study</h3></div>${badge('Strong’s + morphology','good')}</div><p>English text aligned to Strong’s, Hebrew or Greek original words, morphology, topics, and cross references for every chapter.</p><div class="pack-actions"><button data-download-study-book>Download ${escapeHtml(state.book)}</button><button data-download-study-all>Full study Bible</button></div></section>${assetCards}${cards}<section class="pack-card"><div class="pack-top"><div><div class="eyebrow">Private local pack</div><h3>Import another translation</h3></div>${badge('Your file')}</div><p>Use a Bible JSON file you are legally allowed to keep. This is how licensed NLT, ESV, or Pinoy Version data can be activated without redistributing it.</p><div class="pack-actions"><button data-action="import-pack">Import JSON</button></div></section></div><div class="storage-tools"><button id="clearStudyCacheBtn">Remove downloaded Bible and study data</button><small>Your notes, bookmarks, highlights, and imported translations are kept unless you remove them separately.</small></div>`;
  $$('[data-download-book-code]').forEach(b=>b.onclick=()=>downloadOneBook(b.dataset.downloadBookCode));$$('[data-download-all-code]').forEach(b=>b.onclick=()=>downloadWholeTranslation(b.dataset.downloadAllCode));
  $$('[data-asset-key]').forEach(b=>b.onclick=()=>downloadAssetUI(b.dataset.assetKey,b.dataset.assetUrl));$$('[data-remove-asset]').forEach(b=>b.onclick=async()=>{await dbDelete('assets',b.dataset.removeAsset);await dbDelete('packs',`asset|${b.dataset.removeAsset}`);render()});
  $('[data-download-study-book]').onclick=()=>downloadOneBook('BSB');$('[data-download-study-all]').onclick=()=>downloadWholeTranslation('BSB');$('#clearStudyCacheBtn').onclick=clearBibleDownloads;wireCommonDynamic();
}
let cancelDownload=false;
function progressStart(title,total){cancelDownload=false;const box=$('#downloadProgress');if(!box)return;box.hidden=false;$('#progressTitle').textContent=title;$('#progressBar').max=total;$('#progressBar').value=0;$('#progressText').textContent=`0 / ${total}`;$('#cancelDownloadBtn').onclick=()=>{cancelDownload=true}}
function progressStep(done,total,text=''){if(!$('#progressBar'))return;$('#progressBar').value=done;$('#progressText').textContent=`${done} / ${total}${text?` · ${text}`:''}`}
function progressEnd(text='Done'){if($('#progressTitle'))$('#progressTitle').textContent=text;if($('#cancelDownloadBtn'))$('#cancelDownloadBtn').textContent='Close', $('#cancelDownloadBtn').onclick=()=>{$('#downloadProgress').hidden=true}}
async function downloadOneBook(code){const m=translationMeta(code);if(m.status==='licensed'&&!state.customTranslations[code]){openImportDialog();return}const bm=bookByName(state.book);progressStart(`Downloading ${m.short||code} · ${state.book}`,bm.chapters);try{if(code==='BSB'){for(let c=1;c<=bm.chapters;c++){if(cancelDownload)break;await fetchBSBStudy(state.book,c,{force:true});progressStep(c,bm.chapters,`${state.book} ${c}`)}}else await fetchBook(code,state.book,{force:true,onProgress:(d,t,x)=>progressStep(d,t,x)});if(!cancelDownload)await dbPut('packs',`book|${code}|${state.book}`,{code,book:state.book,complete:true,at:Date.now()});progressEnd(cancelDownload?'Stopped':'Download complete')}catch(e){progressEnd('Download failed');alert(e.message)}}
async function downloadWholeTranslation(code){const m=translationMeta(code);if(m.status==='licensed'&&!state.customTranslations[code]){openImportDialog();return}if(!confirm(`Download the full ${m.name}? This can take time and use significant storage.`))return;const total=D.books.reduce((n,b)=>n+b.chapters,0);progressStart(`Downloading full ${m.short||code}`,total);let done=0;try{for(const b of D.books){if(cancelDownload)break;if(code==='BSB'){for(let c=1;c<=b.chapters;c++){if(cancelDownload)break;await fetchBSBStudy(b.name,c,{force:true});done++;progressStep(done,total,`${b.name} ${c}`)}}else{const chapters=await fetchBook(code,b.name,{force:true});done+=Math.max(1,Object.keys(chapters).length);progressStep(done,total,b.name)}await sleep(20)}if(!cancelDownload)await dbPut('packs',`full|${code}`,{code,complete:true,at:Date.now()});progressEnd(cancelDownload?'Stopped':'Full Bible saved offline')}catch(e){progressEnd('Download failed');alert(e.message)}}
async function downloadAssetUI(key,url){progressStart(`Downloading ${key}`,1);try{await loadAsset(key,url,{asText:key==='places',force:true});progressStep(1,1);progressEnd('Study pack ready offline');setTimeout(()=>render(),500)}catch(e){progressEnd('Download failed');alert(e.message)}}
async function clearBibleDownloads(){if(!confirm('Remove downloaded Bible chapters and study packs? Your notes, bookmarks and highlights will stay.'))return;await Promise.all([dbClear('chapters'),dbClear('study'),dbClear('assets'),dbClear('packs')]);state.chapterCache={};state.studyCache={};alert('Downloaded study data removed.');render()}

function wireCommonDynamic(){
  $$('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b));
  $$('[data-go-ref]').forEach(b=>b.onclick=()=>goPipeRef(b.dataset.goRef));
  $$('[data-strong]').forEach(b=>b.onclick=()=>openStrong(b.dataset.strong));
  const a=$('#aboutInlineBtn');if(a)a.onclick=showAbout;
}
async function handleAction(action,el){
  if(action==='continue'||action==='bible'){state.view='bible';state.mode='reader';render()}
  else if(action==='parallel'){state.view='bible';state.mode='parallel';render()}
  else if(action==='open-study'){state.view='study';render()}
  else if(action==='open-packs'){state.view='packs';render()}
  else if(action==='background'){state.view='background';render()}
  else if(action==='import-pack')openImportDialog();
  else if(action==='download-book')downloadOneBook(state.translation);
  else if(action==='prev-chapter'||action==='next-chapter'){state.chapter+=action==='next-chapter'?1:-1;syncChapters();saveReading();render()}
  else if(action==='speak-chapter'){const ch=await getChapter(state.translation,state.book,state.chapter);speak((ch.verses||[]).join(' '))}
  else if(action==='open-verse')openVerse(state.selectedVerse);
  else if(action==='load-concordance')downloadAssetQuick('strongsConcordance',D.sources.strongsConcordance);
}
async function downloadAssetQuick(key,url){content.insertAdjacentHTML('afterbegin','<div id="quickLoading" class="toast-note">Downloading study pack…</div>');try{await loadAsset(key,url,{force:true});$('#quickLoading').textContent='Study pack saved offline.';setTimeout(()=>$('#quickLoading')?.remove(),1400)}catch(e){$('#quickLoading').textContent=e.message}}

const aliases={gen:'Genesis',ge:'Genesis',ex:'Exodus',exo:'Exodus',lev:'Leviticus',num:'Numbers',deut:'Deuteronomy',dt:'Deuteronomy',jos:'Joshua',josh:'Joshua',jdg:'Judges',judg:'Judges',rut:'Ruth','1sa':'1 Samuel','1sam':'1 Samuel','2sa':'2 Samuel','2sam':'2 Samuel','1ki':'1 Kings','1kgs':'1 Kings','2ki':'2 Kings','2kgs':'2 Kings','1ch':'1 Chronicles','2ch':'2 Chronicles',ezr:'Ezra',neh:'Nehemiah',est:'Esther',job:'Job',ps:'Psalms',psa:'Psalms',psalm:'Psalms',psalms:'Psalms',pro:'Proverbs',prov:'Proverbs',ecc:'Ecclesiastes',eccl:'Ecclesiastes',sng:'Song of Solomon',song:'Song of Solomon',sos:'Song of Solomon',isa:'Isaiah',jer:'Jeremiah',lam:'Lamentations',ezk:'Ezekiel',ezek:'Ezekiel',dan:'Daniel',hos:'Hosea',jol:'Joel',amos:'Amos',oba:'Obadiah',jon:'Jonah',mic:'Micah',nam:'Nahum',hab:'Habakkuk',zep:'Zephaniah',hag:'Haggai',zec:'Zechariah',zech:'Zechariah',mal:'Malachi',mat:'Matthew',matt:'Matthew',mrk:'Mark',mk:'Mark',luk:'Luke',lk:'Luke',jhn:'John',jn:'John',john:'John',act:'Acts',rom:'Romans','1co':'1 Corinthians','1cor':'1 Corinthians','2co':'2 Corinthians','2cor':'2 Corinthians',gal:'Galatians',eph:'Ephesians',php:'Philippians',phil:'Philippians',col:'Colossians','1th':'1 Thessalonians','2th':'2 Thessalonians','1ti':'1 Timothy','2ti':'2 Timothy',tit:'Titus',phm:'Philemon',heb:'Hebrews',jas:'James',jam:'James','1pe':'1 Peter','1pet':'1 Peter','2pe':'2 Peter','2pet':'2 Peter','1jn':'1 John','2jn':'2 John','3jn':'3 John',jud:'Jude',rev:'Revelation'};
function parseReference(q){q=q.trim().replace(/\s+/g,' ');let m=q.match(/^(.+?)\s+(\d+)(?::(\d+))?$/i);if(!m)m=q.match(/^([1-3A-Za-z]+)\.(\d+)\.(\d+)$/);if(!m)return null;const raw=m[1].replace(/\./g,'').toLowerCase();let book=aliases[raw]||D.books.find(b=>b.name.toLowerCase()===m[1].toLowerCase()||b.code.toLowerCase()===raw)?.name;if(!book)return null;const chapter=Number(m[2]),verse=Number(m[3]||1),bm=bookByName(book);if(chapter<1||chapter>bm.chapters)return null;return{book,chapter,verse}}
async function search(){const q=$('#searchInput').value.trim();if(!q)return;const ref=parseReference(q);if(ref){state.book=ref.book;state.chapter=ref.chapter;state.selectedVerse=ref.verse;bookSelect.value=state.book;syncChapters();state.view='bible';state.mode='reader';await render();setTimeout(()=>openVerse(ref.verse),100);return}if(/^[HG]\d{1,5}$/i.test(q)){state.view='strongs';await render();openStrong(q.toUpperCase());return}content.innerHTML=sectionHead(`Search: “${escapeHtml(q)}”`,'Searching downloaded Bible text on this device…')+busyCard('Searching offline chapters…');const entries=await dbEntries('chapters');const term=q.toLowerCase();const results=[];for(const [key,verses] of entries){const [code,book,chapter]=String(key).split('|');(verses||[]).forEach((text,i)=>{if(String(text).toLowerCase().includes(term)&&results.length<250)results.push({code,book,chapter:Number(chapter),verse:i+1,text})})}content.innerHTML=sectionHead(`Search: “${escapeHtml(q)}”`,`${results.length} result${results.length===1?'':'s'} in downloaded text.`)+`<div class="search-results">${results.map(r=>`<button class="search-result" data-search-ref="${r.book}|${r.chapter}|${r.verse}" data-search-code="${r.code}"><div><b>${escapeHtml(r.book)} ${r.chapter}:${r.verse}</b><span>${escapeHtml(r.code)}</span></div><p>${highlightTerm(r.text,q)}</p></button>`).join('')||`<div class="empty-state"><h3>No local match</h3><p>Download more Bible books, or use the full BSB English concordance for exact words.</p><button id="fullWordSearchBtn">Search full BSB word index</button></div>`}</div>`;$$('[data-search-ref]').forEach(b=>b.onclick=()=>{state.translation=b.dataset.searchCode;syncTranslations();translationSelect.value=state.translation;goPipeRef(b.dataset.searchRef)});const fw=$('#fullWordSearchBtn');if(fw)fw.onclick=()=>fullWordSearch(q)}
function highlightTerm(text,term){const s=escapeHtml(text),safe=escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return s.replace(new RegExp(`(${safe})`,'ig'),'<mark>$1</mark>')}
async function fullWordSearch(q){content.innerHTML=sectionHead(`Full concordance: “${escapeHtml(q)}”`,'Loading the optional BSB English word index…')+busyCard('Downloading English concordance…');try{const data=await loadAsset('englishConcordance',D.sources.englishConcordance);let val=data[q.toLowerCase()]||data[q]||data[q.replace(/[^\w']/g,'').toLowerCase()];if(val&&typeof val==='object'&&!Array.isArray(val))val=val.verses||val.refs||Object.values(val).find(Array.isArray);const refs=Array.isArray(val)?val:[];content.innerHTML=sectionHead(`Full concordance: “${escapeHtml(q)}”`,`${refs.length.toLocaleString()} indexed occurrence${refs.length===1?'':'s'}.`)+`<div class="ref-list large">${refs.slice(0,400).map(r=>`<button data-osis="${escapeHtml(String(r).replace(/:/g,'.'))}">${escapeHtml(osisToHuman(String(r).replace(/:/g,'.')))}</button>`).join('')}</div>${refs.length>400?'<p class="muted">Showing first 400 references.</p>':''}`;$$('[data-osis]').forEach(b=>b.onclick=()=>navigateOsis(b.dataset.osis))}catch(e){content.innerHTML=sectionHead('Concordance')+errorCard(e.message)}}

function openImportDialog(){$('#importResult').textContent='';$('#translationFile').value='';$('#importDialog').showModal()}
async function importTranslation(){const f=$('#translationFile').files?.[0];if(!f){$('#importResult').textContent='Choose a JSON file first.';return}try{const d=JSON.parse(await f.text());if(!d.code||!d.name||!d.books||typeof d.books!=='object')throw new Error('Missing code, name, or books.');const code=String(d.code).toUpperCase().replace(/[^A-Z0-9_]/g,'').slice(0,16);let count=0;for(const [book,chs] of Object.entries(d.books)){if(!bookByName(book))continue;for(const [c,vs] of Object.entries(chs)){if(Array.isArray(vs)){await dbPut('chapters',chapterKey(code,book,Number(c)),vs.map(String));count++}}}state.customTranslations[code]={name:String(d.name),short:String(d.short||code),lang:String(d.lang||'Private'),license:String(d.license||'Private local licensed pack'),status:'custom',note:'Imported privately on this device. Not uploaded by Scripture Study.'};localStorage.setItem('customTranslations',JSON.stringify(state.customTranslations));syncTranslations();$('#importResult').textContent=`Imported ${count} chapters as ${code}.`;setTimeout(()=>$('#importDialog').close(),900)}catch(e){$('#importResult').textContent=`Import failed: ${e.message}`}}

function showAbout(){$('#aboutContent').innerHTML=`<div class="about-sections"><section><h3>Built for serious study</h3><p>Scripture Study separates Bible text, original language data, lexicon entries, morphology, cross references, geography, and background notes so one source does not silently masquerade as another.</p></section><section><h3>Core open data</h3><p><b>Berean Standard Bible and BSB data:</b> used as the main Strong’s linked study layer. The BSB display and concordance data are published as CC0. The morphology index is CC BY 4.0 and includes Hebrew morphology data from <b>Open Scriptures Hebrew Bible (OSHB)</b>, licensed CC BY 4.0. <b>World English Bible, KJV, ASV, Ang Dating Biblia 1905, Reina Valera 1909, Louis Segond 1910, and Luther 1912:</b> offered through open or public domain sources where available. <b>STEP Bible</b> and open Bible geography data are additional upstream scholarly references.</p></section><section><h3>Licensed translations</h3><p><b>New Living Translation</b>, <b>English Standard Version</b>, and <b>Ang Bible: Pinoy Version</b> are not bundled as complete text. If you obtain legal permission or an authorized local file, import it privately into this browser.</p></section><section><h3>Privacy</h3><p>Bible reading and downloaded study packs remain local and work without an account. If you choose CreatorFileKit Cloud Sync, your notes, bookmarks, highlights, reading history, and preferences are synced through Supabase under your account. Imported private Bible translation files are never uploaded by cloud sync.</p></section><section><h3>Interpretive caution</h3><p>A Strong’s number is an index. A dictionary entry gives a range of possible senses. Meaning in a specific verse depends on grammar, syntax, literary context, historical context, and the argument of the biblical author.</p></section></div>`;$('#aboutDialog').showModal()}

function speak(text){if(!('speechSynthesis'in window))return alert('Speech is not available in this browser.');speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(stripHtml(text));u.rate=.92;speechSynthesis.speak(u)}
function copyText(text){navigator.clipboard?.writeText(text).then(()=>toast('Copied')).catch(()=>{const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();toast('Copied')})}
function toast(text){let n=document.createElement('div');n.className='toast-note';n.textContent=text;document.body.appendChild(n);setTimeout(()=>n.remove(),1600)}

// Static controls
$$('.nav-item').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;if(innerWidth<900)$('#sidebar').classList.remove('open');render()});
bookSelect.onchange=()=>{state.book=bookSelect.value;state.chapter=1;state.selectedVerse=1;syncChapters();saveReading();render()};
chapterSelect.onchange=()=>{state.chapter=Number(chapterSelect.value);state.selectedVerse=1;saveReading();render()};
translationSelect.onchange=()=>{const next=translationSelect.value;if(!translationUnlocked(next)){syncTranslations();return}state.translation=next;saveReading();window.ScriptureCloud?.preferencesChanged?.({translation:state.translation,compare:state.compare,fontSize:state.fontSize,dark:document.body.classList.contains('dark')});render()};
$('#searchBtn').onclick=search;$('#searchInput').onkeydown=e=>{if(e.key==='Enter')search()};
$('#themeBtn').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('dark',document.body.classList.contains('dark')?'1':'0');window.ScriptureCloud?.preferencesChanged?.({translation:state.translation,compare:state.compare,fontSize:state.fontSize,dark:document.body.classList.contains('dark')})};
$('#fontBtn').onclick=()=>{state.fontSize=state.fontSize==='normal'?'large':state.fontSize==='large'?'small':'normal';localStorage.setItem('fontSize',state.fontSize);document.body.dataset.font=state.fontSize;window.ScriptureCloud?.preferencesChanged?.({translation:state.translation,compare:state.compare,fontSize:state.fontSize,dark:document.body.classList.contains('dark')});toast(`Reading size: ${state.fontSize}`)};
$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');$('#aboutBtn').onclick=showAbout;
$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
$('#saveNoteBtn').onclick=saveNote;$('#bookmarkBtn').onclick=toggleBookmark;$$('[data-highlight]').forEach(b=>b.onclick=()=>setHighlight(b.dataset.highlight));
$('#copyVerseBtn').onclick=()=>copyText(`${$('#dialogRef').textContent} ${$('#dialogText').textContent}`);$('#shareVerseBtn').onclick=async()=>{const text=`${$('#dialogRef').textContent} ${$('#dialogText').textContent}`;if(navigator.share)try{await navigator.share({title:$('#dialogRef').textContent,text})}catch{}else copyText(text)};$('#speakVerseBtn').onclick=()=>speak($('#dialogText').textContent);$('#openStudyBtn').onclick=()=>{$('#verseDialog').close();state.view='study';render()};
$('#importTranslationBtn').onclick=importTranslation;
if(localStorage.getItem('dark')==='1')document.body.classList.add('dark');

function updateConnection(){const on=navigator.onLine;$('#connectionLabel').textContent=on?'Online · offline ready':'Offline mode';$('#offlineDetail').textContent=on?'Download books and study packs for travel, church, class, or weak signal.':'Downloaded Bible and study data remain available.'}window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);

// PWA install
let deferredInstallPrompt=null;const installBtn=$('#installBtn'),installToast=$('#installToast');
function isStandalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}function isAndroid(){return /android/i.test(navigator.userAgent)}
function showInstallUI(){if(isStandalone())return;installBtn.hidden=false;if(localStorage.getItem('installToastDismissed')!=='1')installToast.hidden=false}function hideInstallUI(){installBtn.hidden=true;installToast.hidden=true}
function manualInstall(){let html=isIOS()?'<h3>iPhone or iPad</h3><ol><li>Open in Safari.</li><li>Tap Share.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap Add.</li></ol>':isAndroid()?'<h3>Android</h3><ol><li>Open in Chrome.</li><li>Tap the browser menu.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Confirm.</li></ol>':'<h3>Install the app</h3><p>Use your browser menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.</p>';$('#installHelpContent').innerHTML=html+'<p class="pwa-badge">Downloaded books and study packs work offline after installation.</p>';$('#installHelpDialog').showModal()}
async function installApp(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice.catch(()=>null);deferredInstallPrompt=null;hideInstallUI()}else manualInstall()}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;showInstallUI()});window.addEventListener('appinstalled',hideInstallUI);installBtn.onclick=installApp;$('#installToastBtn').onclick=installApp;$('#installToastClose').onclick=()=>{installToast.hidden=true;localStorage.setItem('installToastDismissed','1')};

if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

initSelectors();updateConnection();if(!isStandalone()&&isIOS())showInstallUI();render();
