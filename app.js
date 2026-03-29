


// ── SUPABASE CONFIG ──────────────────────────────────
const SB_URL = 'https://lyyxxtqkpdhlrrssbyiw.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5eXh4dHFrcGRobHJyc3NieWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NDM4NDEsImV4cCI6MjA5MDMxOTg0MX0.iq_BkM-JKRrL1bpb6ItFYceYxwPBHQlhw6m3VG47ao4';

async function sbFetch(path, method='GET', body=null){
  const headers = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if(method==='POST') headers['Prefer'] = 'return=representation';
  if(method==='DELETE') headers['Prefer'] = 'return=minimal';
  const opts = { method, headers, mode:'cors' };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(SB_URL + '/rest/v1/' + path, opts);
  if(!res.ok){
    const err = await res.text();
    console.error('SB error', res.status, err);
    throw new Error('SB '+res.status+': '+err);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : [];
}

// ── STATE ─────────────────────────────────────────────
const DEFAULT_PERSONS=[
  {id:'p1',name:'Eu',emoji:'👤',color_idx:'0'},
  {id:'p2',name:'Parceiro(a)',emoji:'👤',color_idx:'1'}
];
let persons  = [];
let expenses = [];
let cards    = [];
let selPersonId = '';
let curFilter='all', curFilterAll='all';
const now=new Date();
let viewMonth={year:now.getFullYear(),month:now.getMonth()};
let editingCardId=null;
let editingPersonId=null;
let editingExpenseId=null;
let dbReady=false;

const R  =n=>'R$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=n=>n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function uid2(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}
const uid=uid2;
const COLORS=['#d4630a','#2c6e49','#1d4e89','#7b2d8b','#b5451b','#1a6b55','#364fc7','#862e9c'];
const pcIdx=id=>{const p=persons.find(x=>x.id===id);return p?parseInt(p.color_idx||p.colorIdx||0)%8:0;}
const pcIdxByName=name=>{const p=persons.find(x=>x.name===name);return p?parseInt(p.color_idx||p.colorIdx||0)%8:0;}
const personColor=name=>{const p=persons.find(x=>x.name===name);return p?COLORS[parseInt(p.color_idx||p.colorIdx||0)%8]:COLORS[0];}
const personEmoji=name=>{const p=persons.find(x=>x.name===name);return p?p.emoji:'👤';}

// localStorage fallback (offline)
function saveLocal(){
  localStorage.setItem('mc_persons2',JSON.stringify(persons));
  localStorage.setItem('mc_expenses',JSON.stringify(expenses));
  localStorage.setItem('mc_cards',JSON.stringify(cards));
}
function loadLocal(){
  persons  = JSON.parse(localStorage.getItem('mc_persons2')||'null')||DEFAULT_PERSONS;
  expenses = JSON.parse(localStorage.getItem('mc_expenses')||'[]');
  cards    = JSON.parse(localStorage.getItem('mc_cards')   ||'[]');
  // migrate old string persons
  if(persons.length && typeof persons[0]==='string')
    persons=persons.map((n,i)=>(({id:uid2(),name:n,emoji:'👤',color_idx:String(i%8)})));
  selPersonId=persons[0]?.id||'';
}


// ── DB COLUMN MAPPERS ─────────────────────────────────
function cardToDb(o){return{id:o.id,name:o.name,brand:o.brand,color_idx:o.colorIdx||o.color_idx||'0',close_day:parseInt(o.closeDay||o.close_day),due_day:parseInt(o.dueDay||o.due_day),created_at:o.created_at||new Date().toISOString()};}
function cardFromDb(o){return{id:o.id,name:o.name,brand:o.brand,colorIdx:String(o.color_idx||'0'),closeDay:o.close_day,dueDay:o.due_day,created_at:o.created_at};}
function expToDb(o){return{id:o.id,description:o.desc,amount:o.amount,cat:o.cat,card_id:o.cardId||o.card_id||null,date:o.date,person:o.person,installments:o.installments||1,created_at:o.created_at||new Date().toISOString()};}
function expFromDb(o){return{id:o.id,desc:o.description||o.desc,amount:parseFloat(o.amount),cat:o.cat,cardId:o.card_id,date:o.date,person:o.person,installments:o.installments||1,created_at:o.created_at};}
function personToDb(o){return{id:o.id,name:o.name,emoji:o.emoji||'👤',color_idx:String(o.colorIdx||o.color_idx||'0'),created_at:o.created_at||new Date().toISOString()};}
function personFromDb(o){return{id:o.id,name:o.name,emoji:o.emoji||'👤',colorIdx:String(o.color_idx||'0'),created_at:o.created_at};}

// ── SUPABASE LOAD ─────────────────────────────────────
async function loadFromDB(){
  showLoading(true);
  try{
    // 8s timeout so the app never freezes if Supabase is slow
    const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))]);
    const [p,e,ca] = await withTimeout(Promise.all([
      sbFetch('mc_persons?order=created_at'),
      sbFetch('mc_expenses?order=created_at.desc'),
      sbFetch('mc_cards?order=created_at')
    ]), 8000);
    if(p!==null)  persons  = p.map(personFromDb);
    if(e!==null)  expenses = e.map(expFromDb);
    if(ca!==null) cards    = ca.map(cardFromDb);
    if(!persons.length){
      // seed defaults
      for(const d of DEFAULT_PERSONS){
        const r=await sbFetch('mc_persons','POST',personToDb(d));
        if(r&&r[0]) persons.push(personFromDb(r[0]));
      }
    }
    selPersonId=persons[0]?.id||'';
    saveLocal(); // keep local cache
    dbReady=true;
  } catch(err){
    console.warn('DB offline, using local',err);
    loadLocal();
  }
  showLoading(false);
}

function showLoading(on){
  let el=document.getElementById('loadingOverlay');
  if(on && !el){
    el=document.createElement('div');
    el.id='loadingOverlay';
    // Non-blocking: small indicator at top instead of full overlay
    el.style.cssText='position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#820ad1,#d4630a);z-index:9999;animation:loadbar 1.2s ease-in-out infinite;';
    const style=document.createElement('style');
    style.textContent='@keyframes loadbar{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}'
    document.head.appendChild(style);
    document.body.appendChild(el);
  } else if(!on && el){
    el.remove();
  }
}

// ── SUPABASE SAVE HELPERS ─────────────────────────────
async function save(){
  saveLocal();
  // sync is done per-operation (upsert/delete) — no bulk save needed
}

async function dbUpsert(table, row){
  if(!row||!row.id) return;
  let mapped;
  if(table==='mc_cards')    mapped=cardToDb(row);
  else if(table==='mc_expenses') mapped=expToDb(row);
  else if(table==='mc_persons')  mapped=personToDb(row);
  else mapped={...row};
  // upsert via DELETE + POST (works without upsert permission)
  await sbFetch(table+'?id=eq.'+row.id,'DELETE');
  return await sbFetch(table,'POST',mapped);
}

async function dbDelete(table, id){
  await sbFetch(table+'?id=eq.'+id,'DELETE');
}
function toast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast show'+(err?' err':'');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2800);
}

// drawer
function openDrawer(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeDrawer(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow='';
}

function goPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  const ni=document.getElementById('ni-'+id);if(ni)ni.classList.add('active');
  closeDrawer();render();
}

function changeMonth(d){
  viewMonth.month+=d;
  if(viewMonth.month>11){viewMonth.month=0;viewMonth.year++;}
  if(viewMonth.month<0){viewMonth.month=11;viewMonth.year--;}
  render();
}

function getBillMonth(card,dateStr){
  const d=new Date(dateStr+'T12:00:00');
  const day=d.getDate(),close=parseInt(card.closeDay)||1;
  let y=d.getFullYear(),m=d.getMonth();
  if(day>close){m++;if(m>11){m=0;y++;}}
  return{billYear:y,billMonth:m};
}

function getMonthExpenses(person='all'){
  const res=[];
  expenses.forEach(exp=>{
    const card=cards.find(c=>c.id===exp.cardId);
    if(!card) return;
    if(exp.installments>1){
      for(let i=0;i<exp.installments;i++){
        let{billYear:y,billMonth:m}=getBillMonth(card,exp.date);
        m+=i;while(m>11){m-=12;y++;}
        if(y===viewMonth.year&&m===viewMonth.month){
          if(person==='all'||exp.person===person)
            res.push({...exp,_parcel:i+1,_amount:exp.amount/exp.installments,_isInst:true});
          break;
        }
      }
    } else {
      const{billYear:y,billMonth:m}=getBillMonth(card,exp.date);
      if(y===viewMonth.year&&m===viewMonth.month)
        if(person==='all'||exp.person===person)
          res.push({...exp,_parcel:1,_amount:exp.amount,_isInst:false});
    }
  });
  return res;
}

function getAllDebtRows(){
  const rows=[];
  expenses.forEach(exp=>{
    const card=cards.find(c=>c.id===exp.cardId);
    if(!card) return;
    const p=exp.installments>1?exp.installments:1;
    for(let i=0;i<p;i++){
      let{billYear:y,billMonth:m}=getBillMonth(card,exp.date);
      m+=i;while(m>11){m-=12;y++;}
      rows.push({...exp,_parcel:i+1,_total:p,_amount:exp.amount/p,_billYear:y,_billMonth:m,_isInst:p>1});
    }
  });
  rows.sort((a,b)=>a._billYear!==b._billYear?a._billYear-b._billYear:a._billMonth-b._billMonth);
  return rows;
}

function renderMonthLabel(){
  const d=new Date(viewMonth.year,viewMonth.month,1);
  const lbl=d.toLocaleDateString('pt-BR',{month:'short',year:'numeric'}).toUpperCase();
  document.getElementById('monthLabel').textContent=lbl;
  document.getElementById('topbarMonth').textContent=lbl;
}

function renderDashboard(){
  renderMonthLabel();
  const mE=getMonthExpenses();
  const total=mE.reduce((s,e)=>s+e._amount,0);
  const count=mE.length,avg=count?total/count:0;
  const allDebt=getAllDebtRows();
  const nk=viewMonth.year*12+viewMonth.month;
  const futDebt=allDebt.filter(r=>r._billYear*12+r._billMonth>=nk).reduce((s,r)=>s+r._amount,0);
  document.getElementById('metricsArea').innerHTML=`
    <div class="metric m-orange"><div class="metric-label">Total do mês</div><div class="metric-val">${R(total)}</div><div class="metric-sub">${count} lançamento${count!==1?'s':''}</div></div>
    <div class="metric m-purple"><div class="metric-label">Débito futuro total</div><div class="metric-val">${R(futDebt)}</div><div class="metric-sub">parcelas restantes</div></div>`;
  const grid=document.getElementById('personsGrid');
  grid.innerHTML='';
  persons.forEach(p=>{
    const pE=getMonthExpenses(p.name);
    const pT=pE.reduce((s,e)=>s+e._amount,0);
    const pPct=total?pT/total*100:0;
    const pDbt=allDebt.filter(r=>r.person===p.name&&r._billYear*12+r._billMonth>nk).reduce((s,r)=>s+r._amount,0);
    const ci=parseInt(p.colorIdx)%8;
    const el=document.createElement('div');
    el.className='person-card'+(curFilter===p.name?' fil':'');
    el.onclick=()=>setFilter(curFilter===p.name?'all':p.name);
    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.4rem;line-height:1">${p.emoji}</span>
        <div class="pc-name c${ci}" style="margin:0">${p.name}</div>
      </div>
      <div class="pc-month">${R(pT)}</div>
      <div class="pc-total">no mês · ${pPct.toFixed(1)}%</div>
      ${pDbt>0?`<div class="pc-debt c${ci}">Débito futuro: ${R(pDbt)}</div>`:''}
      <div class="bar-bg"><div class="bar-fill bg${ci}" style="width:${pPct}%"></div></div>
      <button class="btn-print" onclick="event.stopPropagation();printExtrato('${p.name.replace(/'/g,"\\'")}')">🖨️ Imprimir Extrato</button>`;
    grid.appendChild(el);
  });
  renderFilterRow('filterRow','curFilter',()=>renderDashboardList());
  renderDashboardList();
}

function renderDashboardList(){
  const exps=curFilter==='all'?getMonthExpenses():getMonthExpenses(curFilter);
  const tbl=document.getElementById('expTable');
  const empty=document.getElementById('emptyExp');
  tbl.innerHTML='';
  if(!exps.length){empty.classList.remove('hidden');document.getElementById('filteredMonthTotal').textContent='R$ 0,00';return;}
  empty.classList.add('hidden');
  document.getElementById('filteredMonthTotal').textContent=R(exps.reduce((s,e)=>s+e._amount,0));
  exps.forEach(e=>tbl.appendChild(makeExpRow(e,true)));
}

function renderLancamentos(){
  renderPersonSelect();renderCardSelect();
  renderFilterRow('filterRowAll','curFilterAll',()=>renderAllList());
  renderAllList();
  const fd=document.getElementById('fDate');
  if(!fd.value) fd.value=new Date().toISOString().split('T')[0];
}

function renderPersonSelect(){
  const sel=document.getElementById('fPerson');
  if(!sel) return;
  const cur=sel.value||selPersonId;
  sel.innerHTML='<option value="">— selecione a pessoa —</option>';
  persons.forEach(p=>{
    const o=document.createElement('option');
    o.value=p.id;
    o.textContent=p.emoji+' '+p.name;
    sel.appendChild(o);
  });
  if(cur) sel.value=cur;
  if(!sel.value && persons.length) sel.value=persons[0].id;
}

function renderCardSelect(){
  const sel=document.getElementById('fCard');
  const cur=sel.value;
  sel.innerHTML='<option value="">— selecione um cartão —</option>';
  cards.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${c.name} (fecha dia ${c.closeDay})`;sel.appendChild(o);});
  if(cur) sel.value=cur;
  updateInstPreview();
}

function toggleInst(){
  document.getElementById('instFields').classList.toggle('hidden',!document.getElementById('fInstCheck').checked);
  updateInstPreview();
}

function updateInstPreview(){
  const amount=parseFloat(document.getElementById('fAmount').value)||0;
  const on=document.getElementById('fInstCheck').checked;
  const n=parseInt(document.getElementById('fInstN').value)||0;
  const cardId=document.getElementById('fCard').value;
  const dateStr=document.getElementById('fDate').value;
  if(on&&n>=2&&amount>0){
    const pv=amount/n;
    document.getElementById('fInstVal').value='R$ '+fmt(pv);
    const card=cards.find(c=>c.id===cardId);
    const preview=document.getElementById('instPreview');
    preview.classList.remove('hidden');
    if(card&&dateStr){
      let lines=`<strong>${n}x de ${R(pv)}</strong> — Total: ${R(amount)}<br>`;
      for(let i=0;i<Math.min(n,6);i++){
        let{billYear:y,billMonth:m}=getBillMonth(card,dateStr);
        m+=i;while(m>11){m-=12;y++;}
        lines+=`${i+1}/${n} → fatura de <strong>${new Date(y,m,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</strong><br>`;
      }
      if(n>6) lines+=`... e mais ${n-6} parcela${n-6>1?'s':''}`;
      preview.innerHTML=lines;
    } else {
      preview.innerHTML=`<strong>${n}x de ${R(pv)}</strong><br><span style="color:var(--a1)">Selecione o cartão e a data para ver as faturas.</span>`;
    }
  } else {
    document.getElementById('fInstVal').value='';
    document.getElementById('instPreview').classList.add('hidden');
  }
}

function addExpense(){
  const desc=document.getElementById('fDesc').value.trim();
  const amount=parseFloat(document.getElementById('fAmount').value);
  const cat=document.getElementById('fCat').value;
  const cardId=document.getElementById('fCard').value;
  const dateStr=document.getElementById('fDate').value;
  const isInst=document.getElementById('fInstCheck').checked;
  const instN=parseInt(document.getElementById('fInstN').value)||1;
  const personId=document.getElementById('fPerson').value;
  const personObj=persons.find(p=>p.id===personId);
  if(!desc){toast('Informe a descrição!',true);return;}
  if(!amount||amount<=0){toast('Informe um valor válido!',true);return;}
  if(!cardId){toast('Selecione um cartão!',true);return;}
  if(!dateStr){toast('Informe a data da compra!',true);return;}
  if(!personObj){toast('Selecione a pessoa!',true);return;}
  if(isInst&&instN<2){toast('Parcelas mínimas: 2!',true);return;}

  if(editingExpenseId){
    // UPDATE existing
    const idx=expenses.findIndex(e=>e.id===editingExpenseId);
    if(idx!==-1){
      expenses[idx]={...expenses[idx],desc,amount,cat,cardId,date:dateStr,
        person:personObj.name,installments:isInst?instN:1};
    }
    editingExpenseId=null;
    document.getElementById('btnAddExpense').textContent='Registrar Gasto';
    document.getElementById('btnCancelEdit').classList.add('hidden');
    toast('✓ Gasto atualizado!');
  } else {
    expenses.unshift({id:uid(),desc,amount,cat,cardId,date:dateStr,
      person:personObj.name,installments:isInst?instN:1,createdAt:new Date().toISOString()});
    toast(`✓ Gasto${isInst?' parcelado':''} registrado!`);
  }
  saveLocal();
  {const _e=editingExpenseId?expenses.find(e=>e.id===editingExpenseId):expenses[0];if(_e)dbUpsert('mc_expenses',_e).catch(()=>{});}
  document.getElementById('fDesc').value='';document.getElementById('fAmount').value='';
  document.getElementById('fInstCheck').checked=false;document.getElementById('fInstN').value='';
  document.getElementById('instFields').classList.add('hidden');document.getElementById('instPreview').classList.add('hidden');
  render();
}

function editExpense(id){
  const exp=expenses.find(e=>e.id===id);
  if(!exp) return;
  editingExpenseId=id;
  goPage('lancamentos');
  // fill form
  document.getElementById('fDesc').value=exp.desc;
  document.getElementById('fAmount').value=exp.amount;
  document.getElementById('fCat').value=exp.cat;
  document.getElementById('fDate').value=exp.date||'';
  // card select
  renderCardSelect();
  document.getElementById('fCard').value=exp.cardId||'';
  // person select
  renderPersonSelect();
  const pObj=persons.find(p=>p.name===exp.person);
  if(pObj) document.getElementById('fPerson').value=pObj.id;
  // installments
  if(exp.installments>1){
    document.getElementById('fInstCheck').checked=true;
    document.getElementById('instFields').classList.remove('hidden');
    document.getElementById('fInstN').value=exp.installments;
  } else {
    document.getElementById('fInstCheck').checked=false;
    document.getElementById('instFields').classList.add('hidden');
  }
  updateInstPreview();
  document.getElementById('btnAddExpense').textContent='Salvar Alterações';
  document.getElementById('btnCancelEdit').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'smooth'});
}

function cancelEditExpense(){
  editingExpenseId=null;
  document.getElementById('fDesc').value='';document.getElementById('fAmount').value='';
  document.getElementById('fInstCheck').checked=false;document.getElementById('fInstN').value='';
  document.getElementById('instFields').classList.add('hidden');document.getElementById('instPreview').classList.add('hidden');
  document.getElementById('btnAddExpense').textContent='Registrar Gasto';
  document.getElementById('btnCancelEdit').classList.add('hidden');
}

function renderAllList(){
  const tbl=document.getElementById('expTableAll');const empty=document.getElementById('emptyAll');
  tbl.innerHTML='';
  document.getElementById('grandTotal').textContent=R(expenses.reduce((s,e)=>s+e.amount,0));
  let exps=curFilterAll==='all'?expenses:expenses.filter(e=>e.person===curFilterAll);
  if(!exps.length){empty.classList.remove('hidden');return;}
  empty.classList.add('hidden');
  exps.forEach(e=>tbl.appendChild(makeExpRow({...e,_amount:e.amount,_isInst:e.installments>1,_parcel:null},false)));
}

function makeExpRow(exp,showParcel){
  const ci=pcIdxByName(exp.person);
  const cardName=(cards.find(c=>c.id===exp.cardId)||{name:'?'}).name;
  const row=document.createElement('div');row.className='exp-row';
  const date=exp.date?new Date(exp.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):'';
  const inst=exp._isInst?(showParcel?`${exp._parcel}/${exp.installments}x`:`${exp.installments}x`):'';
  row.innerHTML=`
    <div class="exp-dot bg${ci}"></div>
    <div class="exp-info"><div class="name">${exp.desc}</div><div class="meta">${exp.cat} · ${date}</div></div>
    <div class="exp-card-tag">💳 ${cardName}</div>
    <div class="exp-person-tag c${ci}">${personEmoji(exp.person)} ${exp.person}</div>
    <div class="exp-inst">${inst}</div>
    <div class="exp-amount c${ci}">${R(showParcel?exp._amount:exp.amount)}</div>
    <div style="display:flex;align-items:center;gap:8px;border-left:1px solid var(--border);padding-left:12px;margin-left:4px;">
      <button class="btn-icon edit" onclick="editExpense('${exp.id}')" title="Editar gasto">✎</button>
      <button class="btn-icon btn-del" onclick="confirmDeleteExpense('${exp.id}','${exp.desc.replace(/'/g,"\\'")}')" title="Excluir gasto">✕</button>
    </div>`;
  return row;
}

function confirmDeleteExpense(id, desc){
  // first click — mark as pending
  const row = document.querySelector(`[data-del-id="${id}"]`);
  if(row){
    // already in confirm state — execute
    expenses=expenses.filter(e=>e.id!==id);
    save();render();toast('Lançamento removido.');
    return;
  }
  // find the button and put in confirm state
  const btns = document.querySelectorAll('.btn-del');
  btns.forEach(b=>{
    if(b.getAttribute('onclick')&&b.getAttribute('onclick').includes(`'${id}'`)){
      b.setAttribute('data-del-id', id);
      b.textContent='?';
      b.style.background='var(--dangerl)';
      b.style.borderColor='var(--danger)';
      b.style.color='var(--danger)';
      b.style.fontWeight='900';
      b.title='Clique novamente para confirmar exclusão';
      // auto-reset after 3s
      setTimeout(()=>{
        if(b.getAttribute('data-del-id')){
          b.removeAttribute('data-del-id');
          b.textContent='✕';
          b.style='';
          b.title='Excluir gasto';
        }
      }, 3000);
    }
  });
}
function deleteExpense(id){expenses=expenses.filter(e=>e.id!==id);saveLocal();dbDelete('mc_expenses',id).catch(()=>{});render();toast('Lançamento removido.');}

function clearMonth(){
  const ids=getMonthExpenses().map(e=>e.id);const rem=new Set();
  ids.forEach(id=>{
    const e=expenses.find(x=>x.id===id);if(!e) return;
    if(e.installments>1){if(confirm(`"${e.desc}" é parcelada. Remover todos os meses?`)) rem.add(id);}
    else rem.add(id);
  });
  expenses=expenses.filter(e=>!rem.has(e.id));save();render();toast('Mês limpo!');
}

function clearAll(){if(!confirm('Remover TODOS os lançamentos?')) return;
  const ids=expenses.map(e=>e.id);
  expenses=[];saveLocal();
  ids.forEach(id=>dbDelete('mc_expenses',id).catch(()=>{}));
  render();toast('Tudo removido.');}
function setFilter(v){curFilter=v;renderDashboard();}

function renderFilterRow(cid,vname,cb){
  const row=document.getElementById(cid);row.innerHTML='';
  const cur=vname==='curFilter'?curFilter:curFilterAll;
  const all=document.createElement('button');all.className='fpill'+(cur==='all'?' on':'');all.textContent='Todos';
  all.onclick=()=>{if(vname==='curFilter')curFilter='all';else curFilterAll='all';renderFilterRow(cid,vname,cb);cb();};
  row.appendChild(all);
  persons.forEach(p=>{
    const b=document.createElement('button');b.className='fpill'+(cur===p.name?' on':'');b.textContent=p.emoji+' '+p.name;
    b.onclick=()=>{if(vname==='curFilter')curFilter=p.name;else curFilterAll=p.name;renderFilterRow(cid,vname,cb);cb();};
    row.appendChild(b);
  });
}

function renderDebitos(){
  const all=getAllDebtRows();const nk=viewMonth.year*12+viewMonth.month;
  const tRem=all.filter(r=>r._billYear*12+r._billMonth>=nk).reduce((s,r)=>s+r._amount,0);
  const tAll=all.reduce((s,r)=>s+r._amount,0);
  const tPaid=all.filter(r=>r._billYear*12+r._billMonth<nk).reduce((s,r)=>s+r._amount,0);
  document.getElementById('debtMetrics').innerHTML=`
    <div class="metric m-purple"><div class="metric-label">Débito restante</div><div class="metric-val">${R(tRem)}</div><div class="metric-sub">este mês + futuro</div></div>
    <div class="metric m-green"><div class="metric-label">Já pago</div><div class="metric-val">${R(tPaid)}</div><div class="metric-sub">faturas anteriores</div></div>
    <div class="metric m-orange"><div class="metric-label">Total de compras</div><div class="metric-val">${R(tAll)}</div><div class="metric-sub">soma bruta</div></div>
    <div class="metric m-blue"><div class="metric-label">Parcelas em aberto</div><div class="metric-val">${all.filter(r=>r._billYear*12+r._billMonth>=nk).length}</div><div class="metric-sub">lançamentos</div></div>`;
  const content=document.getElementById('debtContent');content.innerHTML='';
  persons.forEach(p=>{
    const pRows=all.filter(r=>r.person===p.name&&r._billYear*12+r._billMonth>=nk);
    if(!pRows.length) return;
    const pTot=pRows.reduce((s,r)=>s+r._amount,0);const ci=parseInt(p.colorIdx)%8;
    const sec=document.createElement('div');sec.className='debt-section';
    sec.innerHTML=`<div class="sub-title" style="display:flex;align-items:center;gap:10px;"><span style="font-size:1.4rem">${p.emoji}</span><span class="c${ci}">${p.name}</span><span style="font-size:.8rem;color:var(--muted);font-weight:400">— débito restante: ${R(pTot)}</span></div>`;
    const byM={};
    pRows.forEach(r=>{const k=r._billYear*100+r._billMonth;if(!byM[k])byM[k]={rows:[],year:r._billYear,month:r._billMonth};byM[k].rows.push(r);});
    Object.keys(byM).sort((a,b)=>a-b).forEach(k=>{
      const g=byM[k];const mT=g.rows.reduce((s,r)=>s+r._amount,0);
      const d=new Date(g.year,g.month,1);const mLabel=d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
      const isView=g.year===viewMonth.year&&g.month===viewMonth.month;
      const ms=document.createElement('div');ms.style.marginBottom='16px';
      ms.innerHTML=`<div style="font-size:.67rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${isView?'var(--a1)':'var(--muted)'};margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        ${mLabel.toUpperCase()}
        ${isView?'<span style="color:var(--a1);background:var(--a1l);border:1px solid rgba(212,99,10,.3);border-radius:6px;padding:1px 8px;font-size:.55rem;">MÊS ATUAL</span>':''}
        <span style="margin-left:auto;color:var(--a1);font-weight:700">${R(mT)}</span></div>
        ${g.rows.map(r=>`<div class="debt-row">
          <div><div class="dr-desc">${r.desc}</div><div class="dr-meta">${r.cat} · ${(cards.find(c=>c.id===r.cardId)||{name:'?'}).name}</div></div>
          <div class="dr-month">${d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}</div>
          <div class="dr-parcel">${r._isInst?`${r._parcel}/${r._total}x`:''}</div>
          <div class="dr-total c${ci}">${R(r._amount)}</div>
        </div>`).join('')}`;
      sec.appendChild(ms);
    });
    content.appendChild(sec);
  });
  if(!all.filter(r=>r._billYear*12+r._billMonth>=nk).length)
    content.innerHTML='<div class="empty"><div class="ico">✅</div><p>Nenhum débito futuro registrado.</p></div>';
}

function saveCard(){
  const name=document.getElementById('ccName').value.trim();
  const brand=document.getElementById('ccBrand').value;
  const colorIdx=document.getElementById('ccColor').value;
  const closeDay=parseInt(document.getElementById('ccClose').value);
  const dueDay=parseInt(document.getElementById('ccDue').value);
  if(!name){toast('Informe o nome do cartão!',true);return;}
  if(!closeDay||closeDay<1||closeDay>31){toast('Informe o dia de fechamento (1-31)!',true);return;}
  if(!dueDay||dueDay<1||dueDay>31){toast('Informe o dia de vencimento (1-31)!',true);return;}
  if(editingCardId){
    const idx=cards.findIndex(c=>c.id===editingCardId);
    if(idx!==-1) cards[idx]={...cards[idx],name,brand,colorIdx,closeDay,dueDay};
    editingCardId=null;document.getElementById('btnSaveCard').textContent='Salvar Cartão';
  } else {cards.push({id:uid(),name,brand,colorIdx,closeDay,dueDay});}
  saveLocal();
  {const _c=editingCardId?cards.find(x=>x.id===editingCardId):cards[cards.length-1];if(_c)dbUpsert('mc_cards',_c).catch(()=>{});}
  render();
  document.getElementById('ccName').value='';document.getElementById('ccClose').value='';document.getElementById('ccDue').value='';
  toast('💳 Cartão salvo!');
}

function editCard(id){
  const c=cards.find(x=>x.id===id);if(!c) return;
  editingCardId=id;
  document.getElementById('ccName').value=c.name;document.getElementById('ccBrand').value=c.brand;
  document.getElementById('ccColor').value=c.colorIdx;document.getElementById('ccClose').value=c.closeDay;document.getElementById('ccDue').value=c.dueDay;
  document.getElementById('btnSaveCard').textContent='Atualizar Cartão';
  window.scrollTo({top:0,behavior:'smooth'});goPage('cartoes');
}

function deleteCard(id){
  const c=cards.find(x=>x.id===id);if(!c) return;
  if(expenses.some(e=>e.cardId===id)&&!confirm(`O cartão "${c.name}" tem lançamentos. Remover mesmo assim?`)) return;
  cards=cards.filter(x=>x.id!==id);expenses=expenses.filter(e=>e.cardId!==id);
  saveLocal();dbDelete('mc_cards',id).catch(()=>{});render();toast('Cartão removido.');
}

function renderCartoes(){
  const grid=document.getElementById('cardsGrid');const empty=document.getElementById('emptyCards');
  grid.innerHTML='';
  if(!cards.length){empty.classList.remove('hidden');return;}
  empty.classList.add('hidden');
  cards.forEach(c=>{
    const el=document.createElement('div');el.className=`cc-card card-grad-${c.colorIdx}`;
    el.innerHTML=`<div class="cc-card-shine"></div>
      <div class="cc-actions">
        <button class="btn-icon edit" onclick="editCard('${c.id}')" title="Editar">✎</button>
        <button class="btn-icon" onclick="deleteCard('${c.id}')" title="Excluir">✕</button>
      </div>
      <div><div class="cc-card-brand">${c.name}</div><div class="cc-card-info">${c.brand}</div></div>
      <div class="cc-card-dates">
        <div class="cc-date-block"><div class="lbl">FECHAMENTO</div><div class="val">dia ${c.closeDay}</div></div>
        <div class="cc-date-block"><div class="lbl">VENCIMENTO</div><div class="val">dia ${c.dueDay}</div></div>
      </div>`;
    grid.appendChild(el);
  });
}

function savePerson(){
  const name=document.getElementById('ppName').value.trim();
  const emoji=document.getElementById('ppEmoji').value;
  const colorIdx=document.getElementById('ppColor').value;
  if(!name){toast('Informe o nome!',true);return;}
  if(editingPersonId){
    const idx=persons.findIndex(p=>p.id===editingPersonId);
    if(idx!==-1) persons[idx]={...persons[idx],name,emoji,colorIdx};
    // update expenses with old name
    const old=persons[idx]?.name;
    if(old&&old!==name) expenses=expenses.map(e=>e.person===old?{...e,person:name}:e);
    editingPersonId=null;
    document.getElementById('btnSavePerson').textContent='Salvar Pessoa';
  } else {
    if(persons.find(p=>p.name===name)){toast('Pessoa já existe!',true);return;}
    persons.push({id:uid(),name,emoji,colorIdx});
  }
  saveLocal();
  {const _p=editingPersonId?persons.find(x=>x.id===editingPersonId):persons[persons.length-1];if(_p)dbUpsert('mc_persons',_p).catch(()=>{});}
  renderPessoas();renderDashboard();renderLancamentos();
  document.getElementById('ppName').value='';
  toast(`✓ ${name} salvo(a)!`);
}

function editPerson(id){
  const p=persons.find(x=>x.id===id);if(!p) return;
  editingPersonId=id;
  document.getElementById('ppName').value=p.name;
  document.getElementById('ppEmoji').value=p.emoji;
  document.getElementById('ppColor').value=p.colorIdx;
  document.getElementById('btnSavePerson').textContent='Atualizar Pessoa';
  window.scrollTo({top:0,behavior:'smooth'});
}

function deletePerson(id){
  if(persons.length<=1){toast('Precisa ter pelo menos uma pessoa.',true);return;}
  const p=persons.find(x=>x.id===id);if(!p) return;
  if(!confirm(`Remover "${p.name}"? Os gastos desta pessoa serão excluídos.`)) return;
  expenses=expenses.filter(e=>e.person!==p.name);
  persons=persons.filter(x=>x.id!==id);
  if(curFilter===p.name) curFilter='all';
  if(curFilterAll===p.name) curFilterAll='all';
  saveLocal();dbDelete('mc_persons',id).catch(()=>{});render();toast(`${p.name} removido(a).`);
}

function renderPessoas(){
  const grid=document.getElementById('personsRegisterGrid');
  const empty=document.getElementById('emptyPersons');
  if(!grid) return;
  grid.innerHTML='';
  if(!persons.length){empty.classList.remove('hidden');return;}
  empty.classList.add('hidden');
  persons.forEach(p=>{
    const ci=parseInt(p.colorIdx)%8;
    const el=document.createElement('div');
    el.className='person-reg-card';
    el.innerHTML=`
      <div class="prc-actions">
        <button class="btn-icon edit" onclick="editPerson('${p.id}')" title="Editar">✎</button>
        <button class="btn-icon" onclick="deletePerson('${p.id}')" title="Excluir">✕</button>
      </div>
      <div class="prc-avatar">${p.emoji}</div>
      <div class="prc-name c${ci}">${p.name}</div>
      <div class="prc-meta">Cor: <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[ci]};vertical-align:middle"></span></div>
    `;
    grid.appendChild(el);
  });
}

function render(){renderDashboard();renderLancamentos();renderDebitos();renderCartoes();renderPessoas();}

// ── INIT ──────────────────────────────────────────────
function init(){
  // ── Drawer ──
  var btnH = document.getElementById('btnHamburger');
  var ovl  = document.getElementById('overlay');
  if(btnH) btnH.addEventListener('click', function(){ openDrawer(); });
  if(ovl)  ovl.addEventListener('click',  function(){ closeDrawer(); });

  // ── Nav items ──
  var pages = ['dashboard','lancamentos','debitos','cartoes','pessoas'];
  pages.forEach(function(id){
    var el = document.getElementById('ni-'+id);
    if(el) el.addEventListener('click', function(){ goPage(id); });
  });

  // ── Month buttons ──
  document.querySelectorAll('[data-month]').forEach(function(btn){
    btn.addEventListener('click', function(){ changeMonth(parseInt(btn.getAttribute('data-month'))); });
  });

  // ── Load data ──
  loadLocal();
  render();
  loadFromDB().then(function(){
    render();
    if(cards.length===0 && persons.length<=2){
      goPage('pessoas');
      setTimeout(function(){ toast('👋 Cadastre as pessoas e depois os cartões!'); }, 400);
    } else if(cards.length===0){
      goPage('cartoes');
      setTimeout(function(){ toast('👋 Comece cadastrando seus cartões!'); }, 400);
    }
  }).catch(function(){
    render();
  });
}
document.addEventListener('DOMContentLoaded', function(){
 init(); });

function printExtrato(personName){
  const p = persons.find(x=>x.name===personName);
  if(!p) return;
  const exps = getMonthExpenses(personName);
  const total = exps.reduce((s,e)=>s+e._amount,0);
  const monthDate = new Date(viewMonth.year, viewMonth.month, 1);
  const monthStr = monthDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const COLORS_HEX = ['#d4630a','#2c6e49','#1d4e89','#7b2d8b','#b5451b','#1a6b55','#364fc7','#862e9c'];
  const ci = parseInt(p.colorIdx)%8;
  const color = COLORS_HEX[ci];

  // group by card
  const byCard = {};
  exps.forEach(e=>{
    const card = cards.find(c=>c.id===e.cardId)||{name:'Sem cartão'};
    if(!byCard[card.name]) byCard[card.name]={name:card.name,items:[],total:0};
    byCard[card.name].items.push(e);
    byCard[card.name].total += e._amount;
  });

  const cardBlocks = Object.values(byCard).map(grp=>`
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
                  color:#666;border-bottom:1px solid #e0ddd6;padding-bottom:6px;margin-bottom:10px;">
        💳 ${grp.name}
      </div>
      ${grp.items.map(e=>{
        const date = e.date ? new Date(e.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';
        const inst = e._isInst ? ` <span style="color:#999;font-size:10px">${e._parcel}/${e.installments}x</span>` : '';
        return `<div style="display:flex;justify-content:space-between;align-items:baseline;
                             padding:7px 0;border-bottom:1px solid #f0ede8;">
          <div>
            <span style="font-size:13px;">${e.desc}</span>${inst}
            <div style="font-size:10px;color:#999;margin-top:1px;">${e.cat} · ${date}</div>
          </div>
          <span style="font-size:13px;font-weight:700;color:${color};white-space:nowrap;margin-left:16px;">${R(e._amount)}</span>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:12px;font-weight:700;color:#666;">
        <span>Subtotal ${grp.name}</span>
        <span>${R(grp.total)}</span>
      </div>
    </div>
  `).join('');

  const emptyMsg = exps.length===0
    ? `<div style="text-align:center;padding:40px;color:#999;font-size:13px;">Nenhum gasto neste mês.</div>`
    : '';

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:40px 32px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;color:#1a1714;">
      <!-- header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid ${color};">
        <div>
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:6px;">EXTRATO DE COBRANÇA</div>
          <div style="font-size:22px;font-weight:900;color:#1a1714;font-family:Georgia,serif;">
            <span style="color:#820ad1">💳 Mandoca</span> Card
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;">Referência</div>
          <div style="font-size:14px;font-weight:700;color:#1a1714;margin-top:2px;">${monthStr.toUpperCase()}</div>
          <div style="font-size:11px;color:#999;margin-top:2px;">Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
        </div>
      </div>

      <!-- pessoa -->
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;
                  background:#fafaf8;border:1.5px solid #e0ddd6;border-radius:12px;padding:16px 20px;">
        <span style="font-size:2.2rem;line-height:1;">${p.emoji}</span>
        <div>
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;">Cobrar de</div>
          <div style="font-size:18px;font-weight:800;color:${color};font-family:Georgia,serif;">${p.name}</div>
        </div>
        <div style="margin-left:auto;text-align:right;">
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;">Total a pagar</div>
          <div style="font-size:22px;font-weight:900;color:${color};font-family:Georgia,serif;">${R(total)}</div>
        </div>
      </div>

      <!-- itens -->
      <div style="margin-bottom:24px;">
        ${cardBlocks}
        ${emptyMsg}
      </div>

      <!-- total final -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  background:${color};color:#fff;border-radius:10px;padding:14px 20px;margin-bottom:32px;">
        <span style="font-size:13px;font-weight:700;letter-spacing:.5px;">TOTAL DO MÊS — ${monthStr.toUpperCase()}</span>
        <span style="font-size:20px;font-weight:900;font-family:Georgia,serif;">${R(total)}</span>
      </div>

      <!-- rodapé -->
      <div style="text-align:center;font-size:10px;color:#bbb;border-top:1px solid #e0ddd6;padding-top:16px;">
        Gerado por Mandoca Card · ${new Date().toLocaleString('pt-BR')}
      </div>
    </div>
  `;

  // Open a new window for clean printing (works on mobile too)
  const win = window.open('', '_blank', 'width=700,height=900');
  if(!win){ toast('Permita pop-ups para imprimir!', true); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Extrato – ${p.name} – ${monthStr}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#fff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;color:#1a1714;}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .no-print{display:none!important;}
  }
  .btn-print-action{
    display:block;width:100%;padding:14px;margin-bottom:24px;
    background:#820ad1;color:#fff;border:none;border-radius:10px;
    font-size:15px;font-weight:700;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;
    letter-spacing:.3px;
  }
  .btn-print-action:hover{background:#6a09ab;}
</style>
</head>
<body>
<div style="max-width:620px;margin:0 auto;padding:36px 28px;">
  <button class="btn-print-action no-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  ${html}
</div>

    <div>
      <div style="font-weight:800;font-size:1rem;color:#1a1714;">Mandoca Card</div>
      <div style="font-size:.78rem;color:#8a8278;margin-top:2px;">Instale como app no seu iPhone</div>
    </div>
    <button onclick="document.getElementById('installBanner').style.display='none'"
      style="margin-left:auto;background:transparent;border:none;font-size:1.4rem;color:#8a8278;cursor:pointer;padding:4px;">✕</button>
  </div>
  <div style="background:#f5f4f0;border-radius:10px;padding:14px 16px;font-size:.82rem;color:#6b6460;line-height:1.9;">
    <div style="font-weight:700;color:#1a1714;margin-bottom:8px;">📲 Como instalar:</div>
    <div>1. Toque em <strong style="color:#820ad1;">Compartilhar</strong> <span style="font-size:1rem">⬆️</span> no Safari</div>
    <div>2. Role e toque em <strong style="color:#820ad1;">"Adicionar à Tela de Início"</strong></div>
    <div>3. Toque em <strong style="color:#820ad1;">"Adicionar"</strong> no canto superior direito</div>
  </div>
</div>

  </div>
  <div id="debugLog"></div>
</div>
<button id="debugToggle" onclick="document.getElementById('debugPanel').style.display='block'"
  style="position:fixed;bottom:80px;right:16px;z-index:9998;
  background:#1a1714;color:#7cfc6e;border:1px solid #7cfc6e;
  border-radius:8px;padding:8px 12px;font-size:11px;font-family:monospace;cursor:pointer;">
  🐛 Debug
</button>

</body>
</html>`);
  win.document.close();
}


